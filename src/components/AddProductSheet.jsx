import React, { useMemo, useState } from 'react'
import { Icon, Modal } from './UI'
import { LocationInput, WhoSelect, useWho, num } from './InventoryParts'
import { cleanLocation, fmtUnits } from '../lib/inventory'
import { invSaveProduct, invAdjust, invSetKind, itemSetDetails, invAddFromStockItem } from '../lib/db'
import SkuField from './SkuField'
import { canApproveProducts } from '../lib/access'
import { stampName } from '../lib/dispatch'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * A new product straight into Inventory, for stock that's already here (no delivery to book in).
 * Same rules as Goods In: the office gives it its SKU and it's live; anyone else's gets a NEW-…
 * code and waits as "Office to verify", and orders for it hold until then. A shelf and opening
 * stock are both optional — without a shelf it shows under "No location" until it's put away.
 * Opening stock is logged with who added it, like any stock added by hand.
 *
 * The office can also bring a product that's already on Products into Inventory here, without
 * Goods In (stock found in the warehouse that missed the count). The warehouse still books
 * anything already on Products in through Goods In.
 */
export default function AddProductSheet({ me, people = [], office, products = [], locations = [], stockItems = [], initial = null, note = '', showToast, onClose, onDone }) {
  const isOffice = canApproveProducts(me)
  const [who, setWho] = useWho(me, people, office)
  const [f, setF] = useState({ name: '', code: '', stamp: null, in_helm: false, units: '', location: '', pickable: null, kind: 'product', ...(initial || {}) })
  // The stamp follows the name (shortened for the label) until someone changes it: usually just confirmed
  const stamp = f.stamp ?? stampName(f.name)
  const [savedId, setSavedId] = useState(null)   // kept, so trying again after a stock error doesn't add it twice
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The office creates the whole product here: the Products side (supplier, cost, weight…) as well as the stock
  const [d, setD] = useState({ brand: '', supplierName: '', supplierSku: '', costPrice: '', weightKg: '' })
  // Office only: the Products entry this is for, when it's on Products already (no new Products entry made)
  const [fromItem, setFromItem] = useState(isOffice ? initial?.stockItem || null : null)
  const useItem = (si) => {
    setFromItem(si)
    setF(x => ({ ...x, name: si.name, code: (si.data?.sku || '').trim() || x.code, stamp: null }))
  }
  // The SKU it already has on Products: used as it is, never asked for again
  const itemSku = (fromItem?.data?.sku || '').trim().toUpperCase()
  const setDet = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }))
  const suppliers = useMemo(() => [...new Set(stockItems.map(si => (si.data?.supplierName || '').trim()).filter(Boolean))].sort(), [stockItems])
  const brands = useMemo(() => [...new Set(stockItems.map(si => (si.data?.brand || '').trim()).filter(Boolean))].sort(), [stockItems])
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  // Already in Inventory under a similar name? Better to use that than make a second one
  const similar = useMemo(() => {
    const words = norm(f.name).split(' ').filter(w => w.length > 2)
    if (words.length < 2) return []
    return products
      .map(p => ({ p, hits: words.filter(w => norm(`${p.name} ${p.code}`).includes(w)).length }))
      .filter(x => x.hits >= Math.min(3, words.length))
      .sort((a, b) => b.hits - a.hits).slice(0, 3).map(x => x.p)
  }, [f.name, products])
  // On Products but not stocked yet (being tested, or on order): that one arrives through Goods In
  const onProducts = useMemo(() => {
    const words = norm(f.name).split(' ').filter(w => w.length > 2)
    if (words.length < 2 || fromItem) return []
    const stocked = new Set(products.map(p => p.stock_item_id).filter(Boolean))
    return stockItems.filter(si => !si.data?.archived && !stocked.has(si.id))
      .map(si => ({ si, hits: words.filter(w => norm(si.name).includes(w)).length }))
      .filter(x => x.hits >= Math.min(3, words.length)).sort((a, b) => b.hits - a.hits).slice(0, 3).map(x => x.si)
  }, [f.name, products, stockItems, fromItem])

  const shelf = cleanLocation(f.location)
  const newShelf = shelf && !locations.some(l => l.code === shelf)
  const units = num(f.units)
  const problem = !f.name.trim() ? 'Enter the product name'
    : isOffice && !(itemSku || f.code).trim() ? 'Give it its SKU'
      : isOffice && !stamp.trim() ? 'Give it a stamp name'
      : f.code.trim().toUpperCase().startsWith('NEW-') ? 'NEW-… is only a placeholder — give its real SKU or leave it blank'
        : f.units !== '' && !(units > 0 && Number.isInteger(units)) ? 'Opening stock has to be a whole number above 0'
          : f.location && !shelf ? 'That shelf code doesn’t look right'
            : shelf && !(units > 0) ? 'Say how many are on that shelf'
              : newShelf && f.pickable == null ? `Say whether ${shelf} is a pick shelf`
                : !who ? 'Choose your name' : null

  const save = async () => {
    setBusy(true); setError('')
    try {
      let id = savedId
      if (!id) {
        id = fromItem
          ? await invAddFromStockItem(fromItem.id, itemSku || f.code.trim(), f.kind, who)
          : await invSaveProduct(null, { name: f.name.trim(), code: f.code.trim(), in_helm: f.in_helm }, who)
        setSavedId(id)
        // A new product is created without its stamp name; the office sets it straight after
        if (isOffice && stamp.trim()) await invSaveProduct(id, { stamp_name: stamp.trim() }, who)
        // Packaging: in Inventory like anything else, kept out of selling (only the office says so)
        if (office && f.kind === 'packaging' && !fromItem) await invSetKind(id, 'packaging')
        if (fromItem && f.in_helm) await invSaveProduct(id, { in_helm: true }, who)
        if (office && !fromItem) {
          const det = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v))
          if (Object.keys(det).length) await itemSetDetails(id, det)
        }
      }
      if (units > 0) {
        await invAdjust({ productId: id, location: shelf || '', qty: units,
          reason: fromItem ? 'Found stock' : 'New product: opening stock',
          note: [fromItem ? 'Added to Inventory by the office without Goods In' : '', shelf ? '' : 'Not on a shelf yet'].filter(Boolean).join(' · '),
          by: who, pickable: newShelf ? f.pickable : null })
      }
      showToast?.(`${f.name.trim()} added${units > 0 ? ` · ${fmtUnits(units)} ${shelf ? `on ${shelf}` : 'with no location yet'}` : ''}${isOffice ? '' : ' · the office will check it'}`)
      onDone?.(id)
    } catch (e) {
      setError(savedId ? `The product was added, but the rest didn’t save: ${e.message}. Try again.` : (e.message || 'That didn’t save — try again'))
      setBusy(false)
    }
  }

  return (
    <Modal title={fromItem ? 'Add to Inventory' : office ? 'Create a product' : 'Add a product'}
      description={fromItem ? 'Already on Products — this puts it in Inventory with the stock that’s here, without Goods In. Logged with your name.'
        : office ? 'Makes the product on Products and in Inventory. A delivery goes through Goods In instead.' : 'For stock that’s already here. A delivery goes through Goods In instead.'}
      onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {note && <div className="text-xs text-ink/70 bg-sky/30 border border-rule rounded-[6px] px-2.5 py-2">{note}</div>}
        <div>
          <label className="label" htmlFor="ap-name">Product name</label>
          <input id="ap-name" className="input text-base sm:text-sm" value={f.name} onChange={set('name')} disabled={!!savedId || !!fromItem}
            placeholder="Brand, product, size — e.g. Pyrex Glass Measuring Jug 500ml" autoComplete="off" />
          {onProducts.length > 0 && !savedId && (
            <div className="text-xs text-ink/70 mt-1.5 px-2.5 py-2 rounded-[6px] bg-warn/5 border border-warn/25">
              Already on Products, not stocked yet: {onProducts.map((si, i) => <span key={si.id}>{i > 0 && ', '}<b className="text-ink">{si.name}</b></span>)}.
              {isOffice ? ' If it’s that one, use it so it isn’t made twice:' : ' If it’s that one, book it in through Goods In so it isn’t made twice.'}
              {isOffice && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {onProducts.map(si => (
                    <button key={si.id} type="button" className="btn btn-secondary btn-sm" onClick={() => useItem(si)}>Use {si.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {fromItem && !savedId && !initial?.stockItem && (
            <div className="text-xs text-ink/60 mt-1.5 flex items-center gap-2">
              Using the Products entry. <button type="button" className="text-royal-600 hover:underline" onClick={() => { setFromItem(null); setF(x => ({ ...x, name: '', code: '' })) }}>Make a new one instead</button>
            </div>
          )}
          {similar.length > 0 && !savedId && (
            <div className="text-xs text-ink/60 mt-1.5 px-2.5 py-2 rounded-[6px] bg-warn/5 border border-warn/25">
              Already in Inventory? {similar.map((p, i) => <span key={p.id}>{i > 0 && ', '}<b className="text-ink">{p.name}</b> <span className="text-ink/45">{p.code}</span></span>)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <SkuField key={fromItem?.id || 'new'} id="ap-code" label={itemSku ? 'SKU (from Products)' : isOffice ? 'SKU' : 'SKU (if you know it)'}
              name={f.name} brand={d.brand} value={itemSku || f.code} stockItemId={fromItem?.id || null}
              onChange={(v) => setF(x => ({ ...x, code: v }))} disabled={!!savedId || !!itemSku} check={office && !itemSku}
              suggest={isOffice && !initial?.code && !fromItem} />
          </div>

        </div>
        {f.name.trim() && (
          <div>
            <label className="label" htmlFor="ap-stamp">Stamp name <span className="text-ink/40 font-normal">(from the name — change it if it’s wrong)</span></label>
            {isOffice ? (
              <div className="flex gap-2">
                <input id="ap-stamp" className="input text-base sm:text-sm uppercase flex-1" value={stamp} disabled={!!savedId}
                  onChange={e => setF(x => ({ ...x, stamp: e.target.value }))} />
                {f.stamp !== null && !savedId && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(x => ({ ...x, stamp: null }))}>Reset</button>
                )}
              </div>
            ) : null}
            <div className="text-xs text-ink/50 mt-1">Label reads: <span className="font-mono">1 X {stampName(stamp || f.name).toUpperCase()}</span></div>
          </div>
        )}
        {!isOffice && (
          <div className="text-xs text-warn bg-warn/5 border border-warn/25 rounded-[6px] px-2.5 py-1.5">
            The office checks the name and gives it its SKU. Until then it shows as “Office to verify”, and orders for it wait.
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.in_helm} onChange={set('in_helm')} disabled={!!savedId} /> It’s in HELM
        </label>
        {office && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.kind === 'packaging'} disabled={!!savedId}
              onChange={e => setF(x => ({ ...x, kind: e.target.checked ? 'packaging' : 'product' }))} /> It’s packaging (a box or mailer we send things in)
          </label>
        )}

        {office && !fromItem && (
          <div className="border-t border-rule pt-3">
            <div className="title-case text-sm font-semibold text-ink">Product details <span className="font-normal text-ink/45">(for Products — fill in what you know)</span></div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div><label className="label" htmlFor="ap-brand">Brand</label>
                <input id="ap-brand" list="ap-brands" className="input text-base sm:text-sm" value={d.brand} onChange={setDet('brand')} disabled={!!savedId} />
                <datalist id="ap-brands">{brands.map(b => <option key={b} value={b} />)}</datalist></div>
              <div><label className="label" htmlFor="ap-supplier">Supplier</label>
                <input id="ap-supplier" list="ap-suppliers" className="input text-base sm:text-sm" value={d.supplierName} onChange={setDet('supplierName')} disabled={!!savedId} />
                <datalist id="ap-suppliers">{suppliers.map(x => <option key={x} value={x} />)}</datalist></div>
              <div><label className="label" htmlFor="ap-ssku">Supplier SKU</label>
                <input id="ap-ssku" className="input text-base sm:text-sm" value={d.supplierSku} onChange={setDet('supplierSku')} disabled={!!savedId} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label" htmlFor="ap-cost">Unit cost £</label>
                  <input id="ap-cost" type="number" min="0" step="0.0001" inputMode="decimal" className="input text-base sm:text-sm tabular-nums" value={d.costPrice} onChange={setDet('costPrice')} disabled={!!savedId} /></div>
                <div><label className="label" htmlFor="ap-weight">Weight kg</label>
                  <input id="ap-weight" type="number" min="0" step="0.001" inputMode="decimal" className="input text-base sm:text-sm tabular-nums" value={d.weightKg} onChange={setDet('weightKg')} disabled={!!savedId} /></div>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-rule pt-3">
          <div className="title-case text-sm font-semibold text-ink">Stock already here <span className="font-normal text-ink/45">(optional)</span></div>
          <div className="grid grid-cols-[1fr_96px] gap-2 mt-2 items-start">
            <LocationInput id="ap-loc" label="Shelf (leave blank if it isn’t on one yet)" value={f.location}
              onChange={v => setF(x => ({ ...x, location: v, pickable: null }))} locations={locations} />
            <div>
              <label className="label" htmlFor="ap-units">Units</label>
              <input id="ap-units" type="number" min="1" step="1" inputMode="numeric" className="input text-base sm:text-sm tabular-nums" value={f.units} onChange={set('units')} />
            </div>
          </div>
          {newShelf && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" className={`btn btn-sm justify-center ${f.pickable === true ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setF(x => ({ ...x, pickable: true }))}>Pick shelf</button>
              <button type="button" className={`btn btn-sm justify-center ${f.pickable === false ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setF(x => ({ ...x, pickable: false }))}>Overflow</button>
            </div>
          )}
          {units > 0 && !shelf && (
            <div className="text-xs text-ink/55 mt-2">It’ll show under <b>No location</b> until it’s put on a shelf.</div>
          )}
        </div>

        {!office && <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} id="ap-who" />}

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={busy || !!problem} onClick={save} title={problem || ''}>
            <Icon name="plus" size={14} /> {busy ? 'Adding…' : savedId ? 'Save the stock' : fromItem ? 'Add to Inventory' : 'Add product'}
          </button>
        </div>
        {problem && f.name.trim() && <div className="text-xs text-ink/50 text-center">{problem}</div>}
      </div>
    </Modal>
  )
}
