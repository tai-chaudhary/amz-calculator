import React, { useState, useEffect } from 'react'
import { Modal, Icon, Flag } from './UI'
import { QtyInput } from './CareParts'
import { editGoodsIn, correctPutAway, loadGoodsInPoLines } from '../lib/db'
import { cleanLocation } from '../lib/inventory'

const num = (v) => Number(v) || 0
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Edit a booking before it's all put away: delivery note, cartons, pallets, each line's numbers — and for a delivery
 * with no order, the supplier and product names. A line can't go below what's already on a shelf; on an order, the
 * PO's received quantities follow. Every change is kept and shown on the delivery.
 */
export function EditBooking({ d, who, showToast, onClose, onSaved }) {
  const [fields, setFields] = useState({ delivery_note_no: d.delivery_note_no || '', cartons: d.cartons ?? '', pallets: d.pallets ?? '', supplier_name: d.supplier_name || '' })
  const [lines, setLines] = useState((d.lines || []).map(l => ({ ...l, arrived: num(l.arrived ?? l.qty) })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = d.data?.put_done || {}
  const set = (i, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const order = d.kind !== 'unexpected'
  // The PO's lines, so a booked line can be put on the right product when the PO changed under it
  const [poLines, setPoLines] = useState([])
  useEffect(() => { if (order && d.po_id) loadGoodsInPoLines(d.id).then(setPoLines).catch(() => {}) }, [d.id, d.po_id, order])
  const [choosing, setChoosing] = useState(null)
  const usedElsewhere = (i, id) => lines.some((x, k) => k !== i && x.po_item_id === id)
  const unresolved = lines.filter(l => l.removed_from_po && !l.po_item_id).length
  return (
    <Modal title={`Edit ${d.ref}`} description={order ? 'Correct what was booked in. The order’s received numbers follow.' : 'Correct what was booked in.'} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {!order && <div className="col-span-2"><label className="label">Supplier</label><input className="input text-base sm:text-sm" value={fields.supplier_name} onChange={e => setFields(f => ({ ...f, supplier_name: e.target.value }))} /></div>}
          <div className={order ? 'col-span-2' : ''}><label className="label">Delivery note no.</label><input className="input text-base sm:text-sm" value={fields.delivery_note_no} onChange={e => setFields(f => ({ ...f, delivery_note_no: e.target.value }))} /></div>
          <div><label className="label">Cartons</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={fields.cartons === '' ? 0 : fields.cartons} onChange={n => setFields(f => ({ ...f, cartons: n }))} /></div>
          <div><label className="label">Pallets</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={fields.pallets === '' ? 0 : fields.pallets} onChange={n => setFields(f => ({ ...f, pallets: n }))} /></div>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const already = num(done[l.name])
            return (
              <div key={i} className="card p-3 space-y-2">
                {order ? (() => {
                  const po = poLines.find(x => x.id === l.po_item_id)
                  const lost = l.removed_from_po && !l.po_item_id
                  return (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold ${lost ? 'text-loss line-through' : 'text-ink'}`}>{po?.name || l.name}</div>
                          <div className="text-xs text-ink/50">
                            {[(po?.qty ?? l.expected) ? `${po?.qty ?? l.expected} ordered` : null, po?.note, po?.pack_units > 1 ? `${po.pack_units} in each` : null].filter(Boolean).join(' · ')}
                            {l.was_name && l.was_name !== (po?.name || l.name) ? <span> · was booked as {l.was_name}</span> : null}
                          </div>
                        </div>
                        {poLines.length > 1 && already === 0 && (
                          <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={() => setChoosing(choosing === i ? null : i)}>
                            <Icon name="swap" size={12} /> {lost ? 'Choose product' : 'Change product'}
                          </button>
                        )}
                      </div>
                      {lost && choosing !== i && <div className="panel-notice text-xs border-coral/50">This product was taken off the order. Choose which product on the PO it actually is.</div>}
                      {choosing === i && (
                        <div className="border border-rule rounded-[6px] bg-white divide-y divide-rule/70 overflow-hidden">
                          {poLines.map(x => {
                            const taken = usedElsewhere(i, x.id)
                            return (
                              <button key={x.id} type="button" disabled={taken}
                                className={`w-full text-left px-3 py-2 text-sm ${x.id === l.po_item_id ? 'bg-royal-50' : 'hover:bg-sky/25'} ${taken ? 'opacity-45 cursor-not-allowed' : ''}`}
                                onClick={() => { set(i, { po_item_id: x.id, name: x.name, expected: x.qty, removed_from_po: false, check_qty: false }); setChoosing(null) }}>
                                <div className="text-ink">{x.name}</div>
                                <div className="text-xs text-ink/50">{x.qty} ordered{x.note ? ` · ${x.note}` : ''}{taken ? ' · already on another line' : ''}</div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )
                })() : <input className="input text-base sm:text-sm font-semibold" value={l.name} onChange={e => set(i, { name: e.target.value })} aria-label="Product" />}
                <div className="grid grid-cols-4 gap-2">
                  <div><label className="label">Arrived</label><QtyInput min={already} className="input w-full text-base sm:text-sm" value={l.arrived} onChange={n => set(i, { arrived: n })} /></div>
                  <div><label className="label">Damaged</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={num(l.damaged)} onChange={n => set(i, { damaged: n })} /></div>
                  <div><label className="label">Wrong item</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={num(l.wrong_qty)} onChange={n => set(i, { wrong_qty: n })} /></div>
                  <div><label className="label">Short</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={num(l.short_qty)} onChange={n => set(i, { short_qty: n, short: n > 0 })} /></div>
                </div>
                {already > 0 && <div className="text-[11px] text-ink/55">{already} already on a shelf — arrived can't be less</div>}
                {l.check_qty && !(l.removed_from_po && !l.po_item_id) && (
                  <label className="flex items-start gap-2 p-2.5 rounded-[6px] border border-warn/50 bg-warn/5 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 mt-0.5 accent-royal-500" checked={false} onChange={() => set(i, { check_qty: false, _checked: true })} />
                    <span className="text-sm text-ink"><b>Check the quantity.</b> The product changed on the order — count what actually arrived, correct Arrived above, then tick.</span>
                  </label>
                )}
                {lines[i]._checked && <div className="text-xs text-gain">Quantity checked</div>}
                <input className="input text-base sm:text-sm" value={l.note || ''} onChange={e => set(i, { note: e.target.value || null })} placeholder="Note (optional)" />
              </div>
            )
          })}
        </div>
        {err && <div className="text-sm text-loss">{err}</div>}
        {unresolved > 0 && <div className="text-xs text-ink/55">{unresolved} line{unresolved === 1 ? '' : 's'} still to put on a product — you can save the rest now.</div>}
        <button className="btn btn-primary w-full justify-center" disabled={busy || !who} onClick={async () => {
          setBusy(true); setErr('')
          try {
            const r = await editGoodsIn(d.id, { ...fields, cartons: String(fields.cartons ?? ''), pallets: String(fields.pallets ?? '') }, lines.map(({ _checked, ...l }) => l), who)
            showToast?.(r?.changed ? `${d.ref} updated — ${r.changed} change${r.changed === 1 ? '' : 's'}` : 'Nothing changed')
            onSaved?.()
          } catch (e) { setErr(e?.message || 'Couldn’t save'); setBusy(false) }
        }}>{!who ? 'Choose who you are first' : busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </Modal>
  )
}

/** What went on which shelf, with a "Correct" on each line. */
export function PutAwayHistory({ d, who, locations = [], showToast, onSaved }) {
  const [fixing, setFixing] = useState(null)
  const entries = (d.data?.put_away || []).map((e, i) => ({ ...e, i })).filter(e => num(e.units) > 0 && e.location)
  if (!entries.length) return null
  return (
    <div className="card mb-4 p-0 overflow-hidden">
      <div className="section-title px-4 py-3 border-b border-rule bg-paper">Put away</div>
      {entries.map(e => (
        <div key={e.i} className="px-4 py-2.5 border-b border-rule/70 last:border-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-ink">{num(e.units)} × {e.name} → <b className="font-mono">{e.location}</b></div>
            {e.was && <div className="text-[11px] text-ink/50">Corrected {when(e.corrected_at)} by {e.corrected_by} (was {e.was.units} on {e.was.location}) — {e.correction}</div>}
          </div>
          <button className="btn btn-ghost btn-xs shrink-0" onClick={() => setFixing(e)}><Icon name="edit" size={12} /> Correct</button>
        </div>
      ))}
      {(d.data?.edits || []).length > 0 && (
        <div className="px-4 py-2.5 bg-paper/60 text-[11px] text-ink/55 space-y-1">
          {d.data.edits.map((x, k) => <div key={k}>Booking edited {when(x.at)} by {x.by}: {(x.changes || []).join(' · ')}</div>)}
        </div>
      )}
      {fixing && <CorrectPutAway d={d} e={fixing} who={who} locations={locations} showToast={showToast} onClose={() => setFixing(null)} onSaved={() => { setFixing(null); onSaved?.() }} />}
    </div>
  )
}

function CorrectPutAway({ d, e, who, locations, showToast, onClose, onSaved }) {
  const [loc, setLoc] = useState(e.location)
  const [units, setUnits] = useState(num(e.units))
  const [reason, setReason] = useState('')
  const [pickable, setPickable] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const clean = cleanLocation(loc)
  const known = locations.length === 0 || locations.some(x => x.code === clean)
  const changed = clean !== e.location || units !== num(e.units)
  return (
    <Modal title="Correct this put-away" description={`${num(e.units)} × ${e.name} on ${e.location}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Shelf it's actually on</label><input className="input text-base sm:text-sm font-mono uppercase" value={loc} onChange={x => setLoc(x.target.value)} /></div>
          <div><label className="label">How many</label><QtyInput min={0} className="input w-full text-base sm:text-sm" value={units} onChange={setUnits} /></div>
        </div>
        {!known && clean && (
          <div className="flex items-center gap-2 text-sm"><Flag tone="amber">New shelf</Flag>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={pickable === true} onChange={() => setPickable(true)} /> Pick shelf</label>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={pickable === false} onChange={() => setPickable(false)} /> Overstock</label></div>
        )}
        <div><label className="label">Why</label><input className="input text-base sm:text-sm" value={reason} onChange={x => setReason(x.target.value)} placeholder="e.g. typed the wrong shelf / counted 48 instead of 288" /></div>
        <div className="text-[11px] text-ink/55">Stock moves to match: {num(e.units)} off {e.location}{units > 0 ? `, ${units} onto ${clean || '…'}` : ''}. It shows in the stock history as a correction.</div>
        {err && <div className="text-sm text-loss">{err}</div>}
        <button className="btn btn-primary w-full justify-center" disabled={busy || !changed || !reason.trim() || !who || (!known && pickable == null)} onClick={async () => {
          setBusy(true); setErr('')
          try { await correctPutAway(d.id, e.i, clean, units, reason.trim(), who, known ? null : pickable); showToast?.('Put-away corrected — stock moved to match'); onSaved?.() }
          catch (x) { setErr(x?.message || 'Couldn’t correct it'); setBusy(false) }
        }}>{!changed ? 'Change the shelf or the number' : !reason.trim() ? 'Say why' : busy ? 'Saving…' : 'Correct it'}</button>
      </div>
    </Modal>
  )
}
