import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Modal, Icon, Flag } from './UI'
import { ShortCheck } from './PickList'
import { saveCollection, loadCollections } from '../lib/db'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '')
const range = (nums) => {
  const s = [...new Set(nums.map(Number))].filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`); i = j
  }
  return out.join(', ')
}

/**
 * Before collection (warehouse feedback, Oct 2026): three checks — everything printed, nothing on hold,
 * substitutes logged. Labels not printed are listed, and carrying on without printing them has to be
 * confirmed. Then the driver signs on the phone for each carrier's parcels.
 */
export function CollectionFlow({ date, dayLabel, batches, statOf, held = [], labels = [], people, me, showToast, onLog, onOpenHeld, onPrint, onClose, onSheet }) {
  const [step, setStep] = useState('check')
  const [carryOn, setCarryOn] = useState(false)
  const [subsOk, setSubsOk] = useState(false)
  const unprinted = batches.filter(b => !b.printed_at && statOf(b).ready > 0)
  const heldOrders = new Set(held.map(l => `${l.upload_id}|${l.order_key}`)).size
  const printedOk = unprinted.length === 0 || carryOn
  const allOk = printedOk && heldOrders === 0 && subsOk

  // What the driver takes: printed labels not yet gone and not kept back, per carrier
  const perCarrier = useMemo(() => {
    const byBatch = new Map(batches.map(b => [b.id, b]))
    const m = new Map()
    for (const l of labels) {
      const b = byBatch.get(l.batch_id)
      if (!b || l.status !== 'ready' || !l.printed_at || l.kept_back) continue
      const c = String(b.carrier || 'Other').split(' ')[0]
      m.set(c, (m.get(c) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [labels, batches])

  return (
    <Modal maxWidth="max-w-xl" onClose={onClose} title={step === 'check' ? `Before collection · ${dayLabel}` : 'Driver signs for the parcels'}
      description={step === 'check' ? 'Three checks, then the driver signs for each carrier.' : 'Hand the phone to the driver for each carrier.'}>
      {step === 'check' ? (
        <div className="space-y-3">
          <Check ok={unprinted.length === 0} warn={unprinted.length > 0 && carryOn} title="Everything printed">
            {unprinted.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-loss font-semibold">{plural(unprinted.reduce((s, b) => s + statOf(b).ready, 0), 'label')} not printed:</div>
                <ul className="text-sm border border-coral/30 rounded-[6px] divide-y divide-rule/70 bg-white">
                  {unprinted.map(b => (
                    <li key={b.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span><b>{b.code}</b> · {b.label_name} <span className="text-ink/50">· {plural(statOf(b).ready, 'label')}</span></span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-primary btn-sm" onClick={() => onPrint(unprinted)}><Icon name="printer" size={14} /> Print them now</button>
                  <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
                    <input type="checkbox" className="w-5 h-5 accent-coral" checked={carryOn} onChange={e => setCarryOn(e.target.checked)} />
                    Carry on without printing them
                  </label>
                </div>
              </div>
            )}
          </Check>
          <Check ok={heldOrders === 0} title="Nothing on hold">
            {heldOrders > 0 && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-loss font-semibold">{plural(heldOrders, 'order')} on hold</span>
                <button className="btn btn-secondary btn-sm" onClick={onOpenHeld}>Open On hold</button>
              </div>
            )}
          </Check>
          <Check ok={subsOk} title="Substitutes logged">
            <ShortCheck batchIds={batches.map(b => b.id)} people={people} me={me} showToast={showToast} onReady={setSubsOk} />
          </Check>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1" onClick={onSheet}><Icon name="printer" size={14} /> Collection sheet</button>
            <button className="btn btn-primary flex-1" disabled={!allOk} onClick={() => setStep('sign')}>{allOk ? 'Next: driver signs' : 'Finish the checks first'}</button>
          </div>
        </div>
      ) : (
        <SignForCarriers date={date} perCarrier={perCarrier} me={me} showToast={showToast} onLog={onLog} onDone={onClose} />
      )}
    </Modal>
  )
}

function Check({ ok, warn, title, children }) {
  return (
    <div className={`card ${ok ? 'border-l-2 border-l-gain' : warn ? 'border-l-2 border-l-warn' : 'border-l-2 border-l-coral'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white ${ok ? 'bg-gain' : warn ? 'bg-warn' : 'bg-coral'}`}>
          <Icon name={ok ? 'check' : 'alert'} size={12} /></span>
        <span className="font-semibold text-sm text-ink">{title}</span>
        {ok && <Flag tone="green">Done</Flag>}
        {!ok && warn && <Flag tone="amber">Confirmed</Flag>}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

function SignForCarriers({ date, perCarrier, me, showToast, onLog, onDone }) {
  const [signed, setSigned] = useState([])
  const [current, setCurrent] = useState(perCarrier[0]?.[0] || '')
  useEffect(() => { loadCollections(date).then(setSigned) }, [date])
  const done = new Set(signed.map(s => s.carrier))
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {perCarrier.map(([c, n]) => (
          <button key={c} className={`btn btn-sm ${current === c ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCurrent(c)}>
            {done.has(c) && <Icon name="check" size={13} />} {c} · {n}
          </button>
        ))}
      </div>
      {!perCarrier.length && <div className="text-sm text-ink/55">No parcels waiting for collection.</div>}
      {current && (
        <SignaturePad key={current} carrier={current} parcels={(perCarrier.find(([c]) => c === current) || [])[1] || 0}
          onSave={async ({ driver, blob, parcels, note }) => {
            try {
              const row = await saveCollection({ date, carrier: current, parcels, driver, note, by: me?.name, signature: blob })
              setSigned(s => [...s, row])
              onLog?.({ entity_type: 'dispatch', entity_name: `Collection · ${current}`, action: 'Collected', detail: `${parcels} parcels · signed by ${driver || 'the driver'}`, source: 'dispatch' })
              showToast?.(`${current}: ${parcels} parcels signed for`)
              const next = perCarrier.find(([c]) => c !== current && !done.has(c))
              if (next) setCurrent(next[0])
            } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error') }
          }} />
      )}
      {signed.length > 0 && (
        <div className="text-xs text-ink/55">Signed today: {signed.map(s => `${s.carrier} ${s.parcels} at ${time(s.signed_at)}${s.driver_name ? ` (${s.driver_name})` : ''}`).join(' · ')}</div>
      )}
      <button className="btn btn-secondary w-full justify-center" onClick={onDone}>Done</button>
    </div>
  )
}

function SignaturePad({ carrier, parcels: suggested, onSave }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const [inked, setInked] = useState(false)
  const [driver, setDriver] = useState('')
  const [parcels, setParcels] = useState(suggested)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d'); ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0B1B3F'
  }, [])
  const at = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = (e) => { e.preventDefault(); drawing.current = true; const ctx = ref.current.getContext('2d'); const [x, y] = at(e); ctx.beginPath(); ctx.moveTo(x, y) }
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); const [x, y] = at(e); ctx.lineTo(x, y); ctx.stroke(); setInked(true) }
  const up = () => { drawing.current = false }
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setInked(false) }
  return (
    <div className="card space-y-3">
      <div className="text-sm text-ink"><b>{carrier}</b> — the driver is taking</div>
      <div className="flex items-center gap-2">
        <input type="number" min="0" className="input w-24 text-base sm:text-sm" value={parcels} onChange={e => setParcels(Number(e.target.value) || 0)} aria-label="Parcels" />
        <span className="text-sm text-ink/60">parcels</span>
        {parcels !== suggested && <Flag tone="amber">The portal counts {suggested}</Flag>}
      </div>
      <input className="input text-base sm:text-sm" value={driver} onChange={e => setDriver(e.target.value)} placeholder="Driver's name" aria-label="Driver's name" />
      <div>
        <div className="label">Driver's signature</div>
        <canvas ref={ref} className="w-full h-40 rounded-[6px] border border-rule bg-white touch-none"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        <button className="btn btn-ghost btn-xs mt-1" onClick={clear}>Clear</button>
      </div>
      <button className="btn btn-primary w-full justify-center" disabled={busy || !inked || !driver.trim()} onClick={() => {
        setBusy(true)
        ref.current.toBlob(async (blob) => {
          await onSave({ driver: driver.trim(), blob, parcels, note: parcels !== suggested ? `Portal counted ${suggested}` : null })
          setBusy(false)
        }, 'image/png')
      }}>{!driver.trim() ? "Add the driver's name" : !inked ? 'Driver signs above' : `Save ${carrier} collection`}</button>
    </div>
  )
}

/**
 * The day, when it's closed: anything left over first (by batch, label number and order), then what went,
 * who did it, substitutes, parcels kept back, reprints and the collections signed for.
 */
export function buildDaySummary({ date, batches, statOf, labels = [], subs = [], leftovers = [], collections = [], by }) {
  const byBatch = new Map(batches.map(b => [b.id, b]))
  const left = []
  for (const lo of leftovers) {
    const b = byBatch.get(lo.batchId)
    for (const n of lo.seqs) {
      const l = labels.find(x => x.batch_id === lo.batchId && Number(x.seq) === Number(n))
      left.push({ batch: b?.code, stamp: b?.label_name, seq: n, order: l?.channel_ref || l?.helm_order || l?.order_key || '', postcode: (l?.postcode || '').slice(0, 4), carrier: b?.carrier })
    }
  }
  const people = new Map()
  for (const l of labels) {
    if (l.status !== 'dispatched' && !leftovers.some(lo => lo.batchId === l.batch_id)) continue
    const who = l.packer || 'Not recorded'
    people.set(who, (people.get(who) || 0) + (l.status === 'dispatched' || !l.kept_back ? 1 : 0))
  }
  const sent = batches.reduce((s, b) => s + statOf(b).dispatched, 0)
  const orders = new Set(labels.filter(l => l.status !== 'cancelled' && l.status !== 'held').map(l => `${l.upload_id}|${l.order_key}`)).size
  const labelOf = (s) => labels.find(l => l.upload_id === s.upload_id && l.order_key === s.order_key)
  return {
    date, by, closed_at: new Date().toISOString(),
    left, sent, orders, batches: [...new Set(batches.map(b => b.code))].length,
    people: [...people.entries()].map(([name, n]) => ({ name, labels: n })),
    substitutes: subs.map(s => { const l = labelOf(s); const b = l && byBatch.get(l.batch_id); return { batch: b?.code, seq: l?.seq, from: s.product_name || s.name || '', to: s.sub_name, by: s.by_name } }),
    kept: labels.filter(l => l.kept_back).map(l => ({ batch: byBatch.get(l.batch_id)?.code, seq: l.seq, why: l.kept_back, by: l.kept_back_by })),
    collections: collections.map(c => ({ carrier: c.carrier, parcels: c.parcels, driver: c.driver_name, at: c.signed_at })),
  }
}

export function DaySummary({ summary, onClose }) {
  const s = summary || {}
  return (
    <Modal maxWidth="max-w-xl" onClose={onClose} title={`Day closed · ${s.date || ''}`} description={s.by ? `Closed by ${s.by} at ${time(s.closed_at)}` : ''}>
      <div className="space-y-3">
        {(s.left || []).length > 0 ? (
          <div className="card border-l-2 border-l-coral">
            <div className="flex items-center gap-2 mb-2"><Flag tone="red" icon="alert">{plural(s.left.length, 'label')} left over</Flag><span className="text-xs text-ink/55">These go first tomorrow</span></div>
            <ul className="text-sm divide-y divide-rule/70">
              {s.left.map((l, i) => (
                <li key={i} className="py-1.5 flex justify-between gap-2">
                  <span><b>{l.batch} #{l.seq}</b> · {l.stamp}</span>
                  <span className="text-ink/55 text-xs text-right">{[l.order, l.postcode, l.carrier].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <div className="card border-l-2 border-l-gain"><Flag tone="green" icon="check">Everything went — nothing left over</Flag></div>}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat k="Labels sent" v={s.sent} /><Stat k="Orders" v={s.orders} /><Stat k="Batches" v={s.batches} />
        </div>
        {(s.people || []).length > 0 && <Block title="Who did what">{s.people.map(p => <Row key={p.name} a={p.name} b={plural(p.labels, 'label')} />)}</Block>}
        {(s.substitutes || []).length > 0 && <Block title={`Substitutes (${s.substitutes.length})`}>{s.substitutes.map((x, i) => <Row key={i} a={`${x.batch || ''}${x.seq ? ` #${x.seq}` : ''} ${x.from}`} b={`→ ${x.to}${x.by ? ` · ${x.by}` : ''}`} />)}</Block>}
        {(s.kept || []).length > 0 && <Block title="Kept back">{s.kept.map((x, i) => <Row key={i} a={`${x.batch} #${x.seq}`} b={`${x.why}${x.by ? ` · ${x.by}` : ''}`} />)}</Block>}
        {(s.collections || []).length > 0 && <Block title="Collected">{s.collections.map((c, i) => <Row key={i} a={c.carrier} b={`${c.parcels} parcels · ${c.driver || 'driver'} · ${time(c.at)}`} />)}</Block>}
        <button className="btn btn-primary w-full justify-center" onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}
const Stat = ({ k, v }) => <div className="card py-2"><div className="text-xl font-semibold tabular-nums">{v ?? 0}</div><div className="text-[11px] text-ink/50">{k}</div></div>
const Block = ({ title, children }) => <div className="card"><div className="section-title mb-1.5">{title}</div><div className="divide-y divide-rule/70">{children}</div></div>
const Row = ({ a, b }) => <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-ink">{a}</span><span className="text-ink/55 text-right text-xs">{b}</span></div>

export { range as labelRange }
