import React, { useState, useEffect } from 'react'
import { Icon, Modal } from './UI'
import { LocationInput, ProductSearch, WhoSelect, useWho, num } from './InventoryParts'
import { cleanLocation, byLocation, fmtUnits } from '../lib/inventory'
import { invPutAwayPlan, invPutAway, invSaveProduct } from '../lib/db'
import { canApproveProducts } from '../lib/access'

/**
 * Putting a delivery away: for each line, which product it is and which
 * shelf (or shelves) it went on. The product's own shelves are one tap; a
 * shelf not used before is logged as wherever the team actually put it.
 * What a line is gets remembered, so next time it's filled in.
 */
export default function PutAwaySheet({ delivery, me, people = [], office, products = [], locations = [], onClose, onDone, showToast }) {
  const [lines, setLines] = useState(null)
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finish, setFinish] = useState(false)    // the rest isn't going on a shelf: close it anyway
  // The office gives a new product its SKU; anyone else's goes to the office to check
  const isOffice = canApproveProducts(me)

  useEffect(() => {
    invPutAwayPlan(delivery.id).then(plan => {
      // Put away in parts: what's already on a shelf from this delivery comes off what's left to do
      const done = delivery.data?.put_done || {}
      setLines((plan || []).filter(l => num(l.units) > 0 && done[l.name] !== 'skip').map(l => {
        const already = num(done[l.name])
        const left = Math.max(0, num(l.units) - already)
        return {
          // A line with no product on the PO (carrier charges, fees, equipment) isn't stock
          ...l, total: num(l.units), already, units: left, skip: l.match === 'not_stock', newProduct: null, other: false, reason: '', product_id_po: l.product_id,
          shelves: [{ location: '', units: String(left), pickable: null }],
        }
      }).filter(l => l.units > 0))
    }).catch(e => setError(e.message))
  }, [delivery.id])

  const set = (i, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const setShelf = (i, j, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, shelves: l.shelves.map((s, m) => (m === j ? { ...s, ...patch } : s)) } : l)))

  // What the PO says it is: locked to its product, or made in Inventory on its first delivery
  const fromPo = (l) => !l.other && (l.match === 'product' || l.match === 'new')
  const problemOf = (l) => {
    if (l.skip) return null
    if (l.other && !l.product_id) return 'Choose what arrived instead'
    if (l.other && !l.reason?.trim()) return 'Say why something else is going on the shelf'
    if (!fromPo(l) && !l.product_id && !l.newProduct?.name?.trim()) return 'Choose the product'
    if (!fromPo(l) && !l.product_id && isOffice && !l.newProduct?.code?.trim()) return 'Give the new product its SKU'
    for (const s of l.shelves) {
      if (!cleanLocation(s.location)) return 'Enter the shelf it went on'
      if (!(num(s.units) > 0)) return 'Enter how many went on each shelf'
      const known = locations.some(x => x.code === cleanLocation(s.location))
      if (!known && s.pickable == null) return `Say whether ${cleanLocation(s.location)} is a pick shelf`
    }
    return null
  }
  const problems = (lines || []).map(problemOf)
  const ready = lines && problems.every(p => !p) && who

  const save = async () => {
    setBusy(true); setError('')
    try {
      const out = []
      for (const l of lines) {
        if (l.skip) { out.push({ name: l.name, key: l.name, skip: true }); continue }
        // How many this line needs in all, so the delivery stays open until it's all on a shelf
        out.push({ name: l.name, key: l.name, expected: l.total, units: 0 })
        // From the PO: the database knows the product (and makes it in Inventory on its first delivery)
        let pid = fromPo(l) ? (l.match === 'product' ? l.product_id : null) : l.product_id
        if (!pid && !fromPo(l)) {
          pid = await invSaveProduct(null, { code: l.newProduct.code.trim(), name: l.newProduct.name.trim(), in_helm: false, stock_item_id: l.stock_item_id || '' }, who)
          // Kept on the line, so trying again after a failure doesn't add the product twice
          setLines(ls => ls.map(x => (x === l ? { ...x, product_id: pid } : x)))
        }
        for (const s of l.shelves) {
          out.push({ name: l.name, key: l.name, stock_item_id: l.stock_item_id, product_id: pid, reason: l.other ? l.reason.trim() : undefined,
            location: cleanLocation(s.location), units: num(s.units), pickable: locations.some(x => x.code === cleanLocation(s.location)) ? null : s.pickable })
        }
      }
      const r = await invPutAway(delivery.id, out, who, finish)
      showToast?.(r.closed ? `${delivery.ref} put away · ${fmtUnits(r.units)} units${r.made ? ` · ${r.made} new in Inventory` : ''}`
        : `${fmtUnits(r.units)} put away · ${fmtUnits(r.left)} still to put away — ${delivery.ref} stays in To put away`)
      onDone?.()
    } catch (e) { setError(e.message || 'That didn’t save — try again'); setBusy(false) }
  }

  return (
    <Modal title={`Put away ${delivery.ref}`} description={`${delivery.supplier_name || 'Delivery'} — where did each thing go?`} onClose={onClose} maxWidth="max-w-2xl">
      {!lines ? <div className="text-sm text-ink/50">{error || 'Loading…'}</div> : (
        <div className="space-y-4">
          {lines.length === 0 && <div className="text-sm text-ink/60">Nothing on this delivery to put on a shelf.</div>}
          {lines.map((l, i) => {
            const p = products.find(x => x.id === l.product_id)
            const shelves = [...(p?.locations || [])].sort((a, b) => (a.pickable - b.pickable) || byLocation(a, b))
            const placed = l.shelves.reduce((s, x) => s + num(x.units), 0)
            return (
              <div key={i} className={`card p-3.5 space-y-3 ${l.skip ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-ink/50">On the delivery</div>
                    <div className="font-semibold text-ink leading-snug">{fmtUnits(l.units)} × {l.name}</div>
                    {l.already > 0 && <div className="text-xs text-warn font-semibold mt-0.5">{fmtUnits(l.already)} of {fmtUnits(l.total)} already put away — {fmtUnits(l.units)} left</div>}
                    {num(l.pack_units) > 1 && <div className="text-xs text-ink/55 mt-0.5 tabular-nums">{fmtUnits(l.packs)} {num(l.packs) === 1 ? 'pack' : 'packs'} × {fmtUnits(l.pack_units)} in a pack</div>}
                    {l.match === 'not_stock' && l.skip && <div className="text-xs text-ink/50 mt-0.5">Not a product on the PO — nothing to put on a shelf.</div>}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-ink/60 shrink-0">
                    <input type="checkbox" checked={l.skip} onChange={e => set(i, { skip: e.target.checked })} /> Not stock
                  </label>
                </div>
                {!l.skip && (
                  <>
                    {fromPo(l) ? (
                      <div className={`p-2.5 rounded-[6px] border flex items-start justify-between gap-2 ${l.match === 'new' ? 'border-gain/40 bg-gain/5' : 'border-royal-200 bg-sky/30'}`}>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">{l.match === 'new' ? 'First delivery — added to Inventory' : 'From the PO'}</div>
                          <div className="text-sm text-ink mt-0.5">{l.match === 'new' ? l.new_name : l.product_name}</div>
                          <div className="text-xs text-ink/55 tabular-nums">
                            {l.match === 'new' ? (l.new_sku ? `${l.new_sku} · goes live when you put it away` : 'Gets a temporary code — the office gives it its SKU') : l.product_code}
                          </div>
                        </div>
                        <button className="btn btn-ghost btn-xs shrink-0" onClick={() => set(i, { other: true, product_id: null })}>Something else arrived?</button>
                      </div>
                    ) : l.other ? (
                      <div className="space-y-2">
                        <div className="text-xs text-warn bg-warn/5 border border-warn/25 rounded-[6px] px-2.5 py-1.5">
                          The PO is for <b>{l.match === 'new' ? l.new_name : l.product_name}</b>. Choose what actually arrived and say why — the office sees it.
                        </div>
                        {p ? (
                          <div className="p-2.5 rounded-[6px] border border-royal-200 bg-sky/30 flex items-center justify-between gap-2">
                            <div className="min-w-0"><div className="text-sm text-ink">{p.name}</div><div className="text-xs text-ink/50 tabular-nums">{p.code}</div></div>
                            <button className="btn btn-secondary btn-xs" onClick={() => set(i, { product_id: null })}>Change</button>
                          </div>
                        ) : <ProductSearch products={products} onPick={(x) => set(i, { product_id: x.id })} id={`pa-o${i}`} />}
                        <input className="input text-base sm:text-sm" value={l.reason} placeholder="Why — e.g. supplier sent the 300ml instead"
                          onChange={e => set(i, { reason: e.target.value })} />
                        <button className="btn btn-ghost btn-xs" onClick={() => set(i, { other: false, reason: '', product_id: l.match === 'product' ? l.product_id_po : null })}>No — it’s what the PO says</button>
                      </div>
                    ) : p ? (
                      <div className="p-2.5 rounded-[6px] border border-royal-200 bg-sky/30 flex items-center justify-between gap-2">
                        <div className="min-w-0"><div className="text-sm text-ink">{p.name}</div><div className="text-xs text-ink/50 tabular-nums">{p.code}</div></div>
                        <button className="btn btn-secondary btn-xs" onClick={() => set(i, { product_id: null })}>Change</button>
                      </div>
                    ) : l.newProduct ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><label className="label">Product name</label>
                          <input className="input text-base sm:text-sm" value={l.newProduct.name} onChange={e => set(i, { newProduct: { ...l.newProduct, name: e.target.value } })} /></div>
                        <div><label className="label">{isOffice ? 'SKU' : 'SKU (if you know it)'}</label>
                          <input className="input text-base sm:text-sm uppercase" value={l.newProduct.code} onChange={e => set(i, { newProduct: { ...l.newProduct, code: e.target.value } })} /></div>
                        {!isOffice && (
                          <div className="sm:col-span-2 text-xs text-warn bg-warn/5 border border-warn/25 rounded-[6px] px-2.5 py-1.5">
                            The office checks the name and gives it its SKU. It goes on the shelf now and shows in Inventory as “Office to verify” until then.
                          </div>
                        )}
                        <button className="btn btn-ghost btn-xs justify-self-start" onClick={() => set(i, { newProduct: null })}>Search instead</button>
                      </div>
                    ) : (
                      <div>
                        <div className="label">Which product is it?</div>
                        <ProductSearch products={products} onPick={(x) => set(i, { product_id: x.id })} id={`pa-p${i}`} />
                        <button className="btn btn-ghost btn-xs mt-1" onClick={() => set(i, { newProduct: { name: l.name, code: '' } })}>
                          <Icon name="plus" size={12} /> It’s a new product
                        </button>
                      </div>
                    )}
                    {l.shelves.map((s, j) => {
                      const clean = cleanLocation(s.location)
                      const isNew = clean && !locations.some(x => x.code === clean)
                      return (
                        <div key={j} className="grid grid-cols-[1fr_96px] gap-2 items-start">
                          <LocationInput id={`pa-l${i}-${j}`} label={l.shelves.length > 1 ? `Shelf ${j + 1}` : 'Went on shelf'} value={s.location}
                            onChange={v => setShelf(i, j, { location: v })} locations={locations} suggestions={shelves} />
                          <div>
                            <label className="label" htmlFor={`pa-u${i}-${j}`}>Units</label>
                            <input id={`pa-u${i}-${j}`} type="number" min="0" inputMode="numeric" className="input text-base sm:text-sm tabular-nums"
                              value={s.units} onChange={e => setShelf(i, j, { units: e.target.value })} />
                          </div>
                          {isNew && (
                            <div className="col-span-2 grid grid-cols-2 gap-2">
                              <button type="button" className={`btn btn-sm justify-center ${s.pickable === true ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShelf(i, j, { pickable: true })}>Pick shelf</button>
                              <button type="button" className={`btn btn-sm justify-center ${s.pickable === false ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShelf(i, j, { pickable: false })}>Overflow</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between gap-2">
                      <button className="btn btn-ghost btn-xs" onClick={() => set(i, { shelves: [...l.shelves, { location: '', units: '', pickable: null }] })}>
                        <Icon name="plus" size={12} /> Split across another shelf
                      </button>
                      {l.shelves.length > 1 && <button className="btn btn-ghost btn-xs" onClick={() => set(i, { shelves: l.shelves.slice(0, -1) })}>Remove last shelf</button>}
                    </div>
                    {placed > num(l.units) && (
                      <div className="text-xs text-ink/55">{fmtUnits(placed)} going on shelves, {fmtUnits(l.units)} on the delivery — fine if it came in packs, counted here in singles.</div>
                    )}
                    {problems[i] && <div className="text-xs text-ink/45">{problems[i]}</div>}
                  </>
                )}
              </div>
            )
          })}
          {(() => {
            const left = (lines || []).filter(l => !l.skip).reduce((t, l) => t + Math.max(0, l.units - l.shelves.reduce((s, x) => s + num(x.units), 0)), 0)
            return left > 0 ? (
              <div className="card border-l-2 border-l-warn space-y-1.5">
                <div className="text-sm text-ink"><b>{fmtUnits(left)}</b> won't be on a shelf yet — the delivery stays in <b>To put away</b> for the rest.</div>
                <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4" checked={finish} onChange={e => setFinish(e.target.checked)} /> That's everything — the rest isn't going on a shelf, close it
                </label>
              </div>
            ) : null
          })()}
          <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} label="Who put it away?" />
          {error && <div className="text-sm text-loss">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={!ready || busy} onClick={save}>
              <Icon name="check" size={15} /> {busy ? 'Saving…' : 'Put away'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
