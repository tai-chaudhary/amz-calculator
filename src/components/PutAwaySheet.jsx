import React, { useState, useEffect } from 'react'
import { Icon, Modal } from './UI'
import { LocationInput, ProductSearch, WhoSelect, useWho, num } from './InventoryParts'
import { cleanLocation, byLocation, fmtUnits } from '../lib/inventory'
import { invPutAwayPlan, invPutAway, invSaveProduct } from '../lib/db'

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

  useEffect(() => {
    invPutAwayPlan(delivery.id).then(plan => {
      setLines((plan || []).filter(l => num(l.units) > 0).map(l => ({
        ...l, skip: false, newProduct: null,
        shelves: [{ location: '', units: String(num(l.units)), pickable: null }],
      })))
    }).catch(e => setError(e.message))
  }, [delivery.id])

  const set = (i, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const setShelf = (i, j, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, shelves: l.shelves.map((s, m) => (m === j ? { ...s, ...patch } : s)) } : l)))

  const problemOf = (l) => {
    if (l.skip) return null
    if (!l.product_id && !(l.newProduct?.code?.trim() && l.newProduct?.name?.trim())) return 'Choose the product'
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
        if (l.skip) { out.push({ name: l.name, skip: true }); continue }
        let pid = l.product_id
        if (!pid) pid = await invSaveProduct(null, { code: l.newProduct.code.trim(), name: l.newProduct.name.trim(), in_helm: false, stock_item_id: l.stock_item_id || '' }, who)
        for (const s of l.shelves) {
          out.push({ name: l.name, stock_item_id: l.stock_item_id, product_id: pid, location: cleanLocation(s.location),
            units: num(s.units), pickable: locations.some(x => x.code === cleanLocation(s.location)) ? null : s.pickable })
        }
      }
      const r = await invPutAway(delivery.id, out, who)
      showToast?.(`${delivery.ref} put away · ${fmtUnits(r.units)} units`)
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
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-ink/60 shrink-0">
                    <input type="checkbox" checked={l.skip} onChange={e => set(i, { skip: e.target.checked })} /> Not stock
                  </label>
                </div>
                {!l.skip && (
                  <>
                    {p ? (
                      <div className="p-2.5 rounded-[6px] border border-royal-200 bg-sky/30 flex items-center justify-between gap-2">
                        <div className="min-w-0"><div className="text-sm text-ink">{p.name}</div><div className="text-xs text-ink/50 tabular-nums">{p.code}</div></div>
                        <button className="btn btn-secondary btn-xs" onClick={() => set(i, { product_id: null })}>Change</button>
                      </div>
                    ) : l.newProduct ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><label className="label">Product name</label>
                          <input className="input text-base sm:text-sm" value={l.newProduct.name} onChange={e => set(i, { newProduct: { ...l.newProduct, name: e.target.value } })} /></div>
                        <div><label className="label">HELM code (or a new one)</label>
                          <input className="input text-base sm:text-sm uppercase" value={l.newProduct.code} onChange={e => set(i, { newProduct: { ...l.newProduct, code: e.target.value } })} /></div>
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
                    {placed !== num(l.units) && placed > 0 && (
                      <div className="text-xs text-ink/55">{fmtUnits(placed)} going on shelves, {fmtUnits(l.units)} on the delivery — fine if it came in packs, counted here in singles.</div>
                    )}
                    {problems[i] && <div className="text-xs text-ink/45">{problems[i]}</div>}
                  </>
                )}
              </div>
            )
          })}
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
