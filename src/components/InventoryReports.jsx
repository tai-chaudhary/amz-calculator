import React, { useState, useEffect, useMemo } from 'react'
import { Icon, StatusBadge, SegmentedControl, EmptyState, MetricCard, Modal, SearchInput } from './UI'
import { LocationInput, WhoSelect, useWho, num } from './InventoryParts'
import {
  DAMAGE_STATUS, slowState, fmtUnits, fmtMoney, fmtMoney0, parseLocation, cleanLocation, AISLES, stockState, fmtDays,
} from '../lib/inventory'
import { loadDamages, invResolveDamage, goodsInPhotoUrl, loadInventoryValue, invSetCost } from '../lib/db'

const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const todayLondon = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

// ── Damages ──────────────────────────────────────────────────────────────────

/**
 * Every damage report, what happened, and — for the office — what to do with
 * it and what damage is costing.
 */
export function DamagesView({ me, people, office, locations, products, showToast, onReport, onOpenProduct, onRefresh, refreshKey }) {
  const [show, setShow] = useState('open')
  const [range, setRange] = useState(30)
  const [rows, setRows] = useState(null)
  const [costs, setCosts] = useState({})
  const [deciding, setDeciding] = useState(null)
  const reload = () => {
    const since = new Date(Date.now() - range * 86400000).toISOString()
    loadDamages(show === 'open' ? { status: 'open' } : { since }).then(setRows).catch(() => setRows([]))
  }
  useEffect(() => { setRows(null); reload() }, [show, range, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!office) return
    loadInventoryValue().then(v => setCosts(Object.fromEntries((v.products || []).map(p => [p.id, num(p.unit_cost) || null])))).catch(() => {})
  }, [office])

  const summary = useMemo(() => {
    const list = rows || []
    const by = (key) => {
      const m = new Map()
      for (const d of list) {
        const k = key(d); const c = costs[d.product_id]
        const x = m.get(k) || { key: k, units: 0, value: 0, n: 0 }
        x.units += num(d.qty); x.value += c ? c * num(d.qty) : 0; x.n += 1; m.set(k, x)
      }
      return [...m.values()].sort((a, b) => b.units - a.units)
    }
    return {
      units: list.reduce((s, d) => s + num(d.qty), 0),
      value: list.reduce((s, d) => s + (costs[d.product_id] || 0) * num(d.qty), 0),
      reasons: by(d => d.reason), products: by(d => d.product?.name || '?'), people: by(d => d.reported_by),
    }
  }, [rows, costs])

  return (
    <div>
      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <div className="overflow-x-auto max-w-full -mx-1 px-1">
          <SegmentedControl label="Show" value={show} onChange={setShow}
            items={[{ id: 'open', label: office ? 'To decide' : 'Waiting' }, { id: 'all', label: 'All reports' }]} />
        </div>
        <button className="btn btn-primary w-full sm:w-auto justify-center py-3 sm:py-2" onClick={() => onReport()}>
          <Icon name="alert" size={15} /> Report damage
        </button>
      </div>

      {show === 'all' && (
        <>
          <div className="flex gap-1.5 mb-3">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setRange(d)} className={`px-3 py-1.5 rounded-full border text-xs ${range === d ? 'border-royal-500 bg-royal-500 text-white' : 'border-rule bg-white text-ink/70'}`}>Last {d} days</button>
            ))}
          </div>
          {rows && rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
                <MetricCard label="Units damaged" value={fmtUnits(summary.units)} sub={`${rows.length} reports`} />
                {office && <MetricCard label="Cost of damage" value={fmtMoney0(summary.value)} color="text-loss" sub="at cost price" />}
                <MetricCard label="Top reason" value={<span className="text-base">{summary.reasons[0]?.key}</span>} sub={`${fmtUnits(summary.reasons[0]?.units)} units`} />
                <MetricCard label="Most damaged" value={<span className="text-base">{summary.products[0]?.key}</span>} sub={`${fmtUnits(summary.products[0]?.units)} units`} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
                <Breakdown title="By reason" rows={summary.reasons} office={office} />
                <Breakdown title="By product" rows={summary.products.slice(0, 8)} office={office} />
                <Breakdown title="Reported by" rows={summary.people} office={office} />
              </div>
            </>
          )}
        </>
      )}

      {rows == null ? <div className="text-sm text-ink/45">Loading…</div> : !rows.length ? (
        <EmptyState icon="check" title={show === 'open' ? 'Nothing waiting' : 'No damage reported'} sub={show === 'open' ? 'Damaged stock reported by the warehouse shows here until the office decides what to do with it.' : ''} />
      ) : (
        <div className="space-y-2">
          {rows.map(d => (
            <DamageCard key={d.id} d={d} office={office} cost={costs[d.product_id]} onDecide={() => setDeciding(d)} onOpenProduct={onOpenProduct} />
          ))}
        </div>
      )}

      {deciding && (
        <Decide d={deciding} me={me} people={people} office={office} locations={locations} products={products} showToast={showToast}
          onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); onRefresh?.() }} />
      )}
    </div>
  )
}

function Breakdown({ title, rows, office }) {
  const max = Math.max(1, ...rows.map(r => r.units))
  return (
    <div className="card p-3.5">
      <h3 className="text-xs font-semibold text-ink/50 mb-2">{title}</h3>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.key}>
            <div className="flex justify-between gap-2 text-sm"><span className="truncate text-ink/80">{r.key}</span>
              <span className="tabular-nums shrink-0">{fmtUnits(r.units)}{office && r.value ? <span className="text-ink/45"> · {fmtMoney0(r.value)}</span> : null}</span></div>
            <div className="h-1.5 rounded-full bg-paper mt-1"><div className="h-1.5 rounded-full bg-coral" style={{ width: `${(r.units / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DamageCard({ d, office, cost, onDecide, onOpenProduct }) {
  const [url, setUrl] = useState(null)
  const st = DAMAGE_STATUS[d.status] || DAMAGE_STATUS.open
  return (
    <div className="card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-ink/45 tabular-nums">{d.ref} · {when(d.reported_at)} · {d.reported_by}</div>
          <button className="font-semibold text-ink text-left leading-snug hover:underline" onClick={() => onOpenProduct?.(d.product_id)}>
            {fmtUnits(d.qty)} × {d.product?.name}
          </button>
          <div className="text-sm text-ink/70 mt-0.5">{d.reason}{d.location ? ` · from ${d.location}` : ''}</div>
          {d.note && <div className="text-xs text-ink/55 mt-0.5">“{d.note}”</div>}
          {d.status !== 'open' && (
            <div className="text-xs text-ink/50 mt-1">{st.label}{d.restock_location ? ` (${d.restock_location})` : ''} by {d.resolved_by}{d.resolution_note ? ` — ${d.resolution_note}` : ''}</div>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {office && cost ? <div className="text-xs text-loss tabular-nums">{fmtMoney(cost * num(d.qty))}</div> : null}
        </div>
      </div>
      <div className="flex gap-2 mt-2.5">
        {d.photo_path && !url && <button className="btn btn-secondary btn-xs" onClick={async () => setUrl(await goodsInPhotoUrl(d.photo_path))}><Icon name="camera" size={12} /> Photo</button>}
        {office && d.status === 'open' && <button className="btn btn-primary btn-xs ml-auto" onClick={onDecide}>Decide</button>}
      </div>
      {url && <img src={url} alt={`Damage ${d.ref}`} className="mt-2.5 rounded-[6px] max-h-72 object-contain border border-rule" />}
    </div>
  )
}

function Decide({ d, me, people, office, locations, products, showToast, onClose, onDone }) {
  const [action, setAction] = useState('')
  const [loc, setLoc] = useState(d.location || '')
  const [note, setNote] = useState('')
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  const p = products.find(x => x.id === d.product_id)
  const ok = action && who && (action !== 'restocked' || cleanLocation(loc))
  const ACTIONS = [
    { id: 'written_off', label: 'Write it off', hint: 'Can’t be sold — bin or recycle it' },
    { id: 'returned', label: 'Send back to the supplier', hint: 'For a credit or replacement — say which order in the note' },
    { id: 'restocked', label: 'Put it back on a shelf', hint: 'It’s fine to sell after all' },
  ]
  return (
    <Modal title={`${d.ref} · ${fmtUnits(d.qty)} × ${d.product?.name}`} description={`${d.reason} — reported by ${d.reported_by}`} onClose={onClose}>
      <div className="space-y-3">
        {ACTIONS.map(a => (
          <label key={a.id} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[6px] border cursor-pointer ${action === a.id ? 'border-royal-400 bg-sky/30' : 'border-rule bg-white'}`}>
            <input type="radio" name="dm-action" className="mt-0.5" checked={action === a.id} onChange={() => setAction(a.id)} />
            <span><span className="text-sm text-ink">{a.label}</span><span className="block text-xs text-ink/50">{a.hint}</span></span>
          </label>
        ))}
        {action === 'restocked' && (
          <LocationInput value={loc} onChange={setLoc} locations={locations} label="Back on shelf" suggestions={p?.locations || []} />
        )}
        <div><label className="label" htmlFor="dm-dnote">Note (optional)</label><input id="dm-dnote" className="input" value={note} onChange={e => setNote(e.target.value)} /></div>
        <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} />
        <button className="btn btn-primary w-full justify-center py-3 sm:py-2" disabled={!ok || busy}
          onClick={async () => { setBusy(true); try { await invResolveDamage(d.id, action, cleanLocation(loc), note, who); showToast?.(`${d.ref} done`); onDone() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) } }}>
          Save
        </button>
      </div>
    </Modal>
  )
}

// ── Value and slow stock (office only) ───────────────────────────────────────

export function ValueView({ me, products, showToast, onOpenProduct }) {
  const [data, setData] = useState(null)
  const [show, setShow] = useState('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const reload = () => loadInventoryValue().then(setData).catch(e => setData({ error: e.message }))
  useEffect(() => { reload() }, [])
  const today = todayLondon()
  const rows = useMemo(() => {
    if (!data?.products) return []
    const live = new Map(products.map(p => [p.id, p]))
    return data.products.map(v => {
      const p = live.get(v.id) || {}
      const cost = v.unit_cost == null ? null : num(v.unit_cost)
      const daily = stockState(p).daily
      return { ...v, cost, value: cost != null ? cost * Math.max(0, num(v.on_hand)) : null, daily, slow: slowState({ on_hand: v.on_hand, last_sold: v.last_sold, daily }, today) }
    }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  }, [data, products, today])

  if (!data) return <div className="text-sm text-ink/45">Loading…</div>
  if (data.error) return <div className="text-sm text-loss">{data.error}</div>

  const sum = (list) => list.reduce((s, r) => s + (r.value || 0), 0)
  const slow = rows.filter(r => r.slow?.kind === 'slow')
  const over = rows.filter(r => r.slow?.kind === 'over')
  const noCost = rows.filter(r => r.cost == null && num(r.on_hand) > 0)
  const aisles = AISLES.map(a => ({
    a, value: rows.reduce((s, r) => s + (r.cost || 0) * (r.locations || []).filter(l => parseLocation(l.code)?.aisle === a).reduce((t, l) => t + Math.max(0, num(l.qty)), 0), 0),
  }))
  const maxAisle = Math.max(1, ...aisles.map(x => x.value))
  const shown = (show === 'slow' ? slow : show === 'over' ? over : show === 'nocost' ? noCost : rows.filter(r => num(r.on_hand) > 0))
    .filter(r => !q.trim() || `${r.name} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <MetricCard label="Stock value" value={fmtMoney0(sum(rows))} sub={`at cost · ${rows.filter(r => r.value).length} products costed`} onClick={() => setShow('all')} />
        <MetricCard label="Not sold in 60+ days" value={fmtMoney0(sum(slow))} color={slow.length ? 'text-loss' : 'text-ink'} sub={`${slow.length} products`} onClick={() => setShow('slow')} />
        <MetricCard label="Over 4 months’ stock" value={fmtMoney0(sum(over))} color={over.length ? 'text-warn' : 'text-ink'} sub={`${over.length} products`} onClick={() => setShow('over')} />
        <MetricCard label="No cost price" value={noCost.length} sub="value can’t be worked out" onClick={() => setShow('nocost')} />
      </div>

      <div className="card p-3.5 mb-4">
        <h3 className="text-xs font-semibold text-ink/50 mb-2">Value by aisle</h3>
        <div className="space-y-1.5">
          {aisles.map(x => (
            <div key={x.a} className="flex items-center gap-2 text-sm">
              <span className="w-5 font-semibold">{x.a}</span>
              <div className="flex-1 h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-royal-400" style={{ width: `${(x.value / maxAisle) * 100}%` }} /></div>
              <span className="w-20 text-right tabular-nums text-ink/70">{fmtMoney0(x.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center justify-between mb-3">
        <div className="overflow-x-auto max-w-full -mx-1 px-1">
          <SegmentedControl label="Show" value={show} onChange={setShow}
            items={[{ id: 'all', label: 'All' }, { id: 'slow', label: 'Not selling', count: slow.length }, { id: 'over', label: 'Too much', count: over.length }, { id: 'nocost', label: 'No cost', count: noCost.length }]} />
        </div>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Product or code" className="w-full sm:w-64" />
      </div>
      {show === 'slow' && <div className="text-xs text-ink/55 mb-2">On the shelves but nothing sold for 60 days or more — worth a price cut, a bundle or clearing out.</div>}
      {show === 'over' && <div className="text-xs text-ink/55 mb-2">More than four months of stock at the rate it sells — hold off reordering.</div>}
      {show === 'nocost' && <div className="text-xs text-ink/55 mb-2">Set a cost here, or link the product to one in Products (from the product’s settings).</div>}

      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {shown.slice(0, 150).map(r => (
          <div key={r.id} className="px-3 py-2.5 flex items-center gap-3">
            <button className="min-w-0 flex-1 text-left" onClick={() => onOpenProduct(r.id)}>
              <div className="text-sm text-ink leading-snug">{r.name}</div>
              <div className="text-xs text-ink/50 tabular-nums">
                {fmtUnits(r.on_hand)} on shelves · {r.cost != null ? `${fmtMoney(r.cost)} each` : 'no cost'}
                {r.last_sold ? ` · last sold ${new Date(`${r.last_sold}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ' · no sales on record'}
                {r.slow?.kind === 'over' ? ` · ${fmtDays(r.slow.days)} of stock` : ''}
              </div>
            </button>
            {r.slow?.kind === 'slow' && <StatusBadge tone="alert">Not selling</StatusBadge>}
            {r.slow?.kind === 'over' && <StatusBadge tone="paused">Too much</StatusBadge>}
            <span className="w-20 text-right tabular-nums font-semibold">{fmtMoney0(r.value)}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setEditing(r)} aria-label="Set cost"><Icon name="edit" size={12} /></button>
          </div>
        ))}
        {!shown.length && <div className="px-3 py-3 text-sm text-ink/50">Nothing here.</div>}
      </div>

      {editing && <CostEditor r={editing} me={me} showToast={showToast} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function CostEditor({ r, me, showToast, onClose, onDone }) {
  const [v, setV] = useState(r.cost_from === 'set here' && r.cost != null ? String(r.cost) : '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Cost price" description={r.name} onClose={onClose}>
      <div className="space-y-3">
        {r.cost_from === 'Products' && <div className="text-xs text-ink/55">Currently {fmtMoney(r.cost)} from Products. A cost set here takes priority.</div>}
        <div><label className="label" htmlFor="cost-v">Cost per unit (£, ex VAT)</label>
          <input id="cost-v" type="number" step="0.01" min="0" className="input w-40 tabular-nums" value={v} onChange={e => setV(e.target.value)} autoFocus /></div>
        <div className="flex gap-2">
          {r.cost_from === 'set here' && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await invSetCost(r.id, null, me?.name); onDone() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) } }}>Clear</button>}
          <button className="btn btn-primary flex-1 justify-center" disabled={busy || v === '' || num(v) < 0}
            onClick={async () => { setBusy(true); try { await invSetCost(r.id, num(v), me?.name); showToast?.('Cost saved'); onDone() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) } }}>Save</button>
        </div>
      </div>
    </Modal>
  )
}
