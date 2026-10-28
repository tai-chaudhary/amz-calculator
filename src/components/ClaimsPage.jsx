import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Modal, Spinner, MetricCard, StatusBadge, Flag, SegmentedControl } from './UI'
import { loadClaims, saveClaim, addClaim, uploadClaimPhoto, claimPhotoUrl, findParcelsFor, loadClaimContext } from '../lib/db'
import { smartFilter, hay, matchScore } from '../lib/match'
import { carrierName } from '../lib/tracking'
import { seesCosts } from '../lib/access'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { fmt } from '../lib/calc'

/**
 * Claims: parcels the carrier owes us for. Returned to sender, undeliverable and tracking-expired
 * parcels, and anything not delivered 4+ working days after it was due, are added automatically
 * (claims_scan, every half hour and when this page opens); damaged ones are added by hand. Each claim
 * goes To raise → Raised (carrier ref) → Won / Lost → Closed, every step logged with who and when.
 * Its own page, locked like any other; it never appears in warehouse Tasks.
 */

export const REASONS = {
  returned: 'Returned to sender', undeliverable: 'Undeliverable', expired: 'Tracking expired',
  not_delivered: 'Not delivered (late)', lost: 'Lost', damaged: 'Damaged in transit', other: 'Other',
}
export const STATUSES = {
  to_raise:   { label: 'To raise', tone: 'alert' },
  raised:     { label: 'Raised — awaiting outcome', tone: 'warn' },
  accepted:   { label: 'Won', tone: 'live' },
  rejected:   { label: 'Lost', tone: 'alert' },
  closed:     { label: 'Closed', tone: 'quiet' },
  not_needed: { label: 'Not needed', tone: 'quiet' },
}
const VIEWS = [
  { id: 'to_raise', label: 'To raise', test: c => c.status === 'to_raise' },
  { id: 'raised', label: 'Awaiting outcome', test: c => c.status === 'raised' },
  { id: 'accepted', label: 'Won', test: c => c.status === 'accepted' },
  { id: 'rejected', label: 'Lost', test: c => c.status === 'rejected' },
  { id: 'done', label: 'Closed', test: c => c.status === 'closed' || c.status === 'not_needed' },
  { id: 'all', label: 'All', test: () => true },
]

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const itemsText = (c) => (c.items || []).map(i => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name || i.code}`).join(', ') || '—'
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null)

/** The carrier's claim time limit (days from despatch), set on the Carriers page. */
function windowFor(c, carriers) {
  const name = carrierName(c)
  const co = carriers.find(x => x.name?.toLowerCase() === name.toLowerCase()) || carriers.find(x => name.toLowerCase().includes(String(x.name || '').toLowerCase()) && x.name)
  const days = num(co?.data?.claimDays)
  if (!days || !c.shipped_at) return null
  const left = days - daysSince(c.shipped_at)
  return { days, left, contact: co?.data?.claimsContact || '' }
}

/** What the customer paid, if HELM said; otherwise the live listing price × quantity, marked estimated. */
function suggestedValue(c, listings) {
  if (num(c.value) !== null) return { value: num(c.value), source: c.value_source || 'manual' }
  let sum = 0, all = true
  for (const it of c.items || []) {
    let best = null
    for (const l of listings) {
      const m = matchScore(l.name, it.name || it.code)
      if (m.all && (!best || m.score > best.m.score)) best = { l, m }
    }
    const price = parseFloat(best?.l?.data?.sellPrice)
    if (price > 0) sum += price * (Number(it.qty) || 1); else all = false
  }
  return sum > 0 ? { value: Math.round(sum * 100) / 100, source: 'estimated', partial: !all } : { value: null, source: null }
}

export default function ClaimsPage({ me, showToast, carriers = [], savedProducts = [], liveProducts = [], focusId, onNavigate }) {
  const [claims, setClaims] = useState(null)
  const [view, setView] = useState('to_raise')
  const [q, setQ] = useState('')
  const [carrier, setCarrier] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [openId, setOpenId] = useState(focusId || null)
  const [adding, setAdding] = useState(false)

  // Without Purchasing access the cost tables are closed: fetch just the claim limits and sell prices
  const [ctx, setCtx] = useState(null)
  const noCosts = !seesCosts(me)
  useEffect(() => { if (noCosts) loadClaimContext().then(setCtx).catch(() => setCtx({ carriers: [], listings: [] })) }, [noCosts])
  carriers = noCosts ? (ctx?.carriers || []) : carriers
  const liveIds = useMemo(() => new Set(liveProducts.map(lp => lp.saved_product_id || lp.savedProductId || lp.id)), [liveProducts])
  const listings = useMemo(() => {
    if (noCosts) return ctx?.listings || []
    const live = savedProducts.filter(r => liveIds.has(r.id))
    return live.length ? live : savedProducts
  }, [savedProducts, liveIds, noCosts, ctx])

  const load = useCallback(async () => {
    try { setClaims(await loadClaims()) } catch (e) { showToast?.(`Couldn't load claims — ${e?.message || 'try again'}`, 'error'); setClaims([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(() => { if (focusId) setOpenId(focusId) }, [focusId])

  const rows = useMemo(() => (claims || []).map(c => ({ ...c, carrierShown: carrierName(c), sv: suggestedValue(c, listings), win: windowFor(c, carriers) })), [claims, listings, carriers])
  const inDates = rows.filter(c => (!from || String(c.shipped_at || c.created_at) >= from) && (!to || String(c.shipped_at || c.created_at).slice(0, 10) <= to))
  const byCarrierRows = inDates.filter(c => !carrier || c.carrierShown === carrier)
  const counts = Object.fromEntries(VIEWS.map(v => [v.id, byCarrierRows.filter(v.test).length]))
  const shown = smartFilter(byCarrierRows.filter((VIEWS.find(v => v.id === view) || VIEWS[0]).test), q,
    c => hay(c.ref, c.order_ref, c.tracking, c.carrierShown, c.carrier_ref, REASONS[c.reason], c.notes, (c.items || []).map(i => [i.code, i.name])), { keepOrder: true })
  const carriersSeen = [...new Set(rows.map(c => c.carrierShown))].sort()
  const open = rows.find(c => c.id === openId)

  // ── The figures ──
  const stats = useMemo(() => {
    const live = byCarrierRows.filter(c => c.status !== 'not_needed')
    const decided = live.filter(c => c.status === 'accepted' || c.status === 'rejected' || (c.status === 'closed' && c.outcome_at))
    const won = live.filter(c => c.status === 'accepted' || (c.status === 'closed' && num(c.outcome_amount) > 0))
    const claimed = live.filter(c => c.status !== 'to_raise').reduce((s, c) => s + (c.sv.value || 0), 0)
    const recovered = live.reduce((s, c) => s + (num(c.outcome_amount) || 0), 0)
    const resolveDays = decided.filter(c => c.raised_at && c.outcome_at).map(c => (Date.parse(c.outcome_at) - Date.parse(c.raised_at)) / 864e5)
    const closing = live.filter(c => c.status === 'to_raise' && c.win && c.win.left <= 3)
    const group = (key) => {
      const m = new Map()
      for (const c of live) for (const k of key(c)) {
        if (!m.has(k)) m.set(k, { k, n: 0, won: 0, lost: 0, open: 0, value: 0, recovered: 0 })
        const r = m.get(k); r.n++; r.value += c.sv.value || 0; r.recovered += num(c.outcome_amount) || 0
        if (c.status === 'accepted') r.won++; else if (c.status === 'rejected') r.lost++; else if (c.status === 'to_raise' || c.status === 'raised') r.open++
      }
      return [...m.values()].sort((a, b) => b.n - a.n)
    }
    return {
      toRaise: live.filter(c => c.status === 'to_raise').length, awaiting: live.filter(c => c.status === 'raised').length,
      won: won.length, lost: live.filter(c => c.status === 'rejected').length, claimed, recovered,
      rate: decided.length ? Math.round((won.length / decided.length) * 100) : null,
      avgDays: resolveDays.length ? Math.round(resolveDays.reduce((a, b) => a + b, 0) / resolveDays.length) : null,
      closing,
      byCarrier: group(c => [c.carrierShown]), byReason: group(c => [REASONS[c.reason] || c.reason]),
      byProduct: group(c => [...new Set((c.items || []).map(i => i.name || i.code))]).slice(0, 10),
    }
  }, [byCarrierRows])

  const exportCsv = () => exportRowsToCsv(stampedName('claims'), shown, [
    { header: 'Claim', value: c => c.ref }, { header: 'Status', value: c => STATUSES[c.status]?.label || c.status },
    { header: 'Reason', value: c => REASONS[c.reason] || c.reason }, { header: 'Carrier', value: c => c.carrierShown },
    { header: 'Service', value: c => c.service || '' }, { header: 'Order', value: c => c.order_ref || '' },
    { header: 'Tracking', value: c => c.tracking || '' }, { header: 'Items', value: c => itemsText(c) },
    { header: 'Despatched', value: c => (c.shipped_at || '').slice(0, 10) }, { header: 'Due', value: c => c.due_day || '' },
    { header: 'Claim value £', value: c => (c.sv.value ?? '') }, { header: 'Value from', value: c => ({ order: 'What the customer paid', estimated: 'Estimated from listing price', manual: 'Typed in' }[c.sv.source] || '') },
    { header: 'Carrier ref', value: c => c.carrier_ref || '' }, { header: 'Raised', value: c => (c.raised_at || '').slice(0, 10) },
    { header: 'Raised by', value: c => c.raised_by || '' }, { header: 'Outcome £', value: c => c.outcome_amount ?? '' },
    { header: 'Outcome date', value: c => (c.outcome_at || '').slice(0, 10) }, { header: 'Claim window left (days)', value: c => (c.win ? c.win.left : '') },
    { header: 'Notes', value: c => c.notes || '' },
  ])

  const changed = (row) => setClaims(list => list.map(c => (c.id === row.id ? row : c)))

  return (
    <div>
      <PageHeader eyebrow="Warehouse / claims" title="Claims"
        description="Parcels to claim for from the carrier. Returned, undeliverable and lost ones are added automatically; add damaged ones by hand. Log each claim as you raise it, then its outcome."
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={load}><Icon name="swap" size={14} /> Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}><Icon name="download" size={14} /> Export</button>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add a claim</button>
        </>} />

      {!claims ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
            <MetricCard label="To raise" value={stats.toRaise} color={stats.toRaise ? 'text-loss' : 'text-ink'} onClick={() => setView('to_raise')} prominent />
            <MetricCard label="Awaiting outcome" value={stats.awaiting} color={stats.awaiting ? 'text-warn' : 'text-ink'} onClick={() => setView('raised')} />
            <MetricCard label="Won" value={stats.won} color="text-gain" onClick={() => setView('accepted')} />
            <MetricCard label="Lost" value={stats.lost} onClick={() => setView('rejected')} />
            <MetricCard label="Success rate" value={stats.rate == null ? '—' : `${stats.rate}%`} sub="of claims decided" color={stats.rate == null ? 'text-ink' : stats.rate >= 70 ? 'text-gain' : stats.rate < 40 ? 'text-loss' : 'text-warn'} />
            <MetricCard label="Value claimed" value={fmt(stats.claimed)} sub="raised so far" />
            <MetricCard label="Recovered" value={fmt(stats.recovered)} color="text-gain" />
            <MetricCard label="Days to resolve" value={stats.avgDays == null ? '—' : stats.avgDays} sub="on average" />
          </div>

          {stats.closing.length > 0 && (
            <div className="card border-l-2 border-l-coral flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-ink flex items-center gap-2 flex-wrap">
                <Flag tone="red" icon="clock">{stats.closing.length} claim window{stats.closing.length === 1 ? '' : 's'} closing</Flag>
                <span className="text-ink/60">3 days or less left to raise {stats.closing.length === 1 ? 'it' : 'them'} with the carrier.</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setView('to_raise')}>Show them</button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Breakdown title="By carrier" rows={stats.byCarrier} onPick={(k) => setCarrier(c => (c === k ? '' : k))} active={carrier} />
            <Breakdown title="By reason" rows={stats.byReason} />
            <Breakdown title="By product" rows={stats.byProduct} />
          </div>

          <div className="filter-bar">
            <SegmentedControl value={view} onChange={setView} label="Show"
              items={VIEWS.map(v => ({ id: v.id, label: `${v.label}${counts[v.id] ? ` ${counts[v.id]}` : ''}` }))} />
            <div className="flex items-center gap-1.5 text-xs text-ink/55">
              <input type="date" className="input text-sm w-[145px]" value={from} onChange={e => setFrom(e.target.value)} aria-label="Despatched from" />
              to
              <input type="date" className="input text-sm w-[145px]" value={to} onChange={e => setTo(e.target.value)} aria-label="Despatched to" />
            </div>
            <select className="input text-sm sm:w-[150px]" value={carrier} onChange={e => setCarrier(e.target.value)} aria-label="Carrier">
              <option value="">All carriers</option>
              {carriersSeen.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Claim, order, tracking or product" className="w-full sm:w-72 sm:ml-auto" />
          </div>

          {!shown.length ? (
            <div className="surface"><EmptyState icon="check" title={view === 'to_raise' ? 'Nothing to claim for' : 'No claims here'}
              sub={view === 'to_raise' ? 'Returned, undeliverable and lost parcels appear here by themselves.' : 'Try another view or wider dates.'} /></div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {shown.map(c => <ClaimRow key={c.id} c={c} onOpen={() => setOpenId(c.id)} />)}
            </div>
          )}
        </div>
      )}

      {open && <ClaimDrawer c={open} me={me} showToast={showToast} onClose={() => setOpenId(null)} onChanged={changed} onNavigate={onNavigate} />}
      {adding && <AddClaim me={me} showToast={showToast} onClose={() => setAdding(false)} onAdded={(row) => { setClaims(l => [row, ...(l || [])]); setAdding(false); setOpenId(row.id) }} />}
    </div>
  )
}

function Breakdown({ title, rows, onPick, active }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="section-title px-4 py-3 border-b border-rule bg-paper">{title}</div>
      {!rows.length ? <div className="px-4 py-4 text-sm text-ink/45">No claims yet.</div> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-rule"><th className="text-left px-4 py-2 text-xs text-ink/45 font-semibold"> </th>
            <th className="text-right px-2 py-2 text-xs text-ink/45 font-semibold">Claims</th><th className="text-right px-2 py-2 text-xs text-ink/45 font-semibold">Won</th>
            <th className="text-right px-4 py-2 text-xs text-ink/45 font-semibold">Recovered</th></tr></thead>
          <tbody>
            {rows.slice(0, 8).map(r => (
              <tr key={r.k} className={`border-b border-rule/70 last:border-0 ${onPick ? 'cursor-pointer hover:bg-sky/20' : ''} ${active === r.k ? 'bg-sky/30' : ''}`} onClick={() => onPick?.(r.k)}>
                <td className="px-4 py-2 text-ink truncate max-w-[180px]">{r.k}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.n}{r.open ? <span className="text-ink/40"> ({r.open} open)</span> : ''}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gain">{r.won || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.recovered ? fmt(r.recovered) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ClaimRow({ c, onOpen }) {
  const st = STATUSES[c.status] || STATUSES.to_raise
  return (
    <button className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70 transition-colors" onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-ink">{c.ref}</span>
            <span className="text-xs text-ink/55">{c.carrierShown} · {c.order_ref || 'no order ref'}</span>
            <Flag tone={c.reason === 'damaged' || c.reason === 'lost' ? 'red' : c.reason === 'not_delivered' ? 'amber' : 'blue'}>{REASONS[c.reason] || c.reason}</Flag>
          </div>
          <div className="text-xs text-ink/70 mt-0.5 line-clamp-2">{itemsText(c)}</div>
          <div className="text-[11px] text-ink/45 mt-1">
            Despatched {day(c.shipped_at)}{c.carrier_ref ? ` · carrier ref ${c.carrier_ref}` : ''}{c.raised_by ? ` · raised by ${c.raised_by}` : ''}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {c.sv.value != null && <span className="text-sm font-semibold tabular-nums">{fmt(c.sv.value)}{c.sv.source === 'estimated' && <span className="text-[10px] text-ink/45 font-normal"> est.</span>}</span>}
          {c.status === 'to_raise' && c.win && <Flag tone={c.win.left <= 3 ? 'red' : c.win.left <= 7 ? 'amber' : 'green'} icon="clock">{c.win.left < 0 ? 'Window closed' : `${c.win.left} days left`}</Flag>}
        </div>
      </div>
    </button>
  )
}

function ClaimDrawer({ c, me, showToast, onClose, onChanged, onNavigate }) {
  const who = me?.name || 'Someone'
  const [busy, setBusy] = useState(false)
  const [value, setValue] = useState(c.sv.value ?? '')
  const [ref, setRef] = useState(c.carrier_ref || '')
  const [amount, setAmount] = useState(c.outcome_amount ?? '')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState({})
  useEffect(() => { setValue(c.sv.value ?? ''); setRef(c.carrier_ref || ''); setAmount(c.outcome_amount ?? '') }, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true
    Promise.all((c.photos || []).map(p => claimPhotoUrl(p).then(u => [p, u]).catch(() => [p, null])))
      .then(list => { if (live) setPhotos(Object.fromEntries(list)) })
    return () => { live = false }
  }, [c.photos])

  const save = async (patch, what) => {
    setBusy(true)
    try { onChanged(await saveClaim(c.id, patch, { what, by: who }, c.history)); showToast?.(what) }
    catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error') }
    finally { setBusy(false) }
  }
  const v = value === '' ? null : Math.round(Number(value) * 100) / 100
  const valueChanged = v !== (num(c.value) ?? c.sv.value ?? null) || (num(c.value) === null && v !== null)
  const st = STATUSES[c.status] || STATUSES.to_raise

  return (
    <Drawer title={c.ref} onClose={onClose} description={`${c.carrierShown}${c.service ? ` · ${c.service}` : ''} · ${REASONS[c.reason] || c.reason}`}>
      <div className="space-y-4">
        <div className="card space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            {c.win && <Flag tone={c.win.left <= 3 ? 'red' : c.win.left <= 7 ? 'amber' : 'green'} icon="clock">{c.win.left < 0 ? `Window closed (${c.win.days} days)` : `${c.win.left} of ${c.win.days} days left to claim`}</Flag>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="text-ink/45">Order</div><div className="text-ink font-medium">{c.order_ref || '—'}</div></div>
            <div><div className="text-ink/45">Tracking</div><div className="text-ink font-medium font-mono text-[11px] break-all">{c.tracking || '—'}</div></div>
            <div><div className="text-ink/45">Despatched</div><div className="text-ink font-medium">{day(c.shipped_at)}</div></div>
            <div><div className="text-ink/45">Was due</div><div className="text-ink font-medium">{day(c.due_day)}</div></div>
          </div>
          {c.win?.contact && <div className="text-xs text-ink/60">Claim with: {/^https?:/.test(c.win.contact) ? <a className="text-royal-600 hover:underline" href={c.win.contact} target="_blank" rel="noreferrer">{c.win.contact}</a> : c.win.contact}</div>}
          {c.tracking && <button className="link-chip text-xs" onClick={() => onNavigate?.('tracking')}><Icon name="pin" size={12} /> Delivery tracking</button>}
        </div>

        <div className="card">
          <div className="section-title mb-2">In the parcel</div>
          {(c.items || []).length ? c.items.map((i, k) => (
            <div key={k} className="flex items-baseline gap-2 text-sm py-1">
              <span className="font-semibold tabular-nums w-8 text-right">{i.qty}×</span><span className="text-ink">{i.name || i.code}</span>
            </div>
          )) : <div className="text-sm text-ink/50">Not known</div>}
        </div>

        <div className="card space-y-2">
          <div className="section-title">Claim value</div>
          <div className="flex items-center gap-2">
            <span className="text-ink/60">£</span>
            <input type="number" step="0.01" className="input w-32 text-base sm:text-sm" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" />
            {valueChanged && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save({ value: v, value_source: 'manual' }, `Claim value set to ${v == null ? 'nothing' : fmt(v)}`)}>Save</button>}
          </div>
          <div>{c.sv.source === 'order' && num(c.value) !== null ? <Flag tone="green">What the customer paid (from HELM)</Flag>
            : c.sv.source === 'estimated' ? <Flag tone="amber">Estimated: listing price × quantity{c.sv.partial ? ' (some items not priced)' : ''}</Flag>
            : c.sv.source === 'manual' ? <Flag tone="blue">Typed in</Flag> : <Flag tone="grey">No value yet — type it in</Flag>}</div>
        </div>

        <div className="card space-y-3">
          <div className="section-title">What's happened</div>
          {c.status === 'to_raise' && (
            <div className="space-y-2">
              <label className="label" htmlFor="cl-ref">Carrier's claim reference</label>
              <input id="cl-ref" className="input text-base sm:text-sm" value={ref} onChange={e => setRef(e.target.value)} placeholder="From the carrier's claim form" />
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary btn-sm" disabled={busy || !ref.trim()} onClick={() => save({ status: 'raised', carrier_ref: ref.trim(), raised_at: new Date().toISOString(), raised_by: who, value: num(c.value) ?? c.sv.value, value_source: c.value_source || c.sv.source }, `Raised with the carrier — ref ${ref.trim()}`)}>
                  <Icon name="send" size={13} /> Mark as raised</button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ status: 'not_needed' }, `Not needed${note.trim() ? ` — ${note.trim()}` : ''}`)}>Not needed</button>
              </div>
            </div>
          )}
          {c.status === 'raised' && (
            <div className="space-y-2">
              <label className="label" htmlFor="cl-amt">Amount the carrier is paying £</label>
              <input id="cl-amt" type="number" step="0.01" className="input w-36 text-base sm:text-sm" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary btn-sm" disabled={busy || !(Number(amount) > 0)} onClick={() => save({ status: 'accepted', outcome_amount: Number(amount), outcome_at: new Date().toISOString(), outcome_by: who }, `Won — the carrier pays ${fmt(Number(amount))}`)}>
                  <Icon name="check" size={13} /> Won</button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ status: 'rejected', outcome_amount: 0, outcome_at: new Date().toISOString(), outcome_by: who }, `Lost — the carrier turned it down${note.trim() ? `: ${note.trim()}` : ''}`)}>Lost</button>
              </div>
            </div>
          )}
          {(c.status === 'accepted' || c.status === 'rejected') && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ status: 'closed' }, c.status === 'accepted' ? 'Closed — money received' : 'Closed')}>
              <Icon name="archive" size={13} /> {c.status === 'accepted' ? 'Money received — close it' : 'Close it'}</button>
          )}
          {(c.status === 'closed' || c.status === 'not_needed') && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ status: c.carrier_ref ? 'raised' : 'to_raise' }, 'Opened again')}>Open again</button>
          )}
          <div>
            <label className="label" htmlFor="cl-note">Note</label>
            <div className="flex gap-2">
              <input id="cl-note" className="input flex-1 text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. customer says the box was crushed" />
              <button className="btn btn-secondary btn-sm" disabled={busy || !note.trim()} onClick={async () => { await save({ notes: [c.notes, note.trim()].filter(Boolean).join('\n') }, `Note: ${note.trim()}`); setNote('') }}>Add</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="section-title">Photos</div>
            <label className="btn btn-secondary btn-xs cursor-pointer"><Icon name="camera" size={12} /> Add
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (!f) return
                setBusy(true)
                try { const path = await uploadClaimPhoto(c.id, f); onChanged(await saveClaim(c.id, { photos: [...(c.photos || []), path] }, { what: 'Photo added', by: who }, c.history)) }
                catch (er) { showToast?.(`Couldn't upload — ${er?.message || 'try again'}`, 'error') }
                finally { setBusy(false) }
              }} /></label>
          </div>
          {(c.photos || []).length ? (
            <div className="grid grid-cols-3 gap-2">{c.photos.map(p => photos[p]
              ? <a key={p} href={photos[p]} target="_blank" rel="noreferrer"><img src={photos[p]} alt="" className="w-full h-24 object-cover rounded-[6px] border border-rule" /></a>
              : <div key={p} className="h-24 rounded-[6px] bg-paper border border-rule" />)}</div>
          ) : <div className="text-sm text-ink/45">None yet — add photos of any damage.</div>}
        </div>

        <div className="card">
          <div className="section-title mb-3">History</div>
          <ol className="relative border-l border-rule ml-1.5 space-y-3">
            {[...(c.history || [])].reverse().map((h, k) => (
              <li key={k} className="pl-4 relative">
                <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${k === 0 ? 'bg-royal-500' : 'bg-ink/25'}`} />
                <div className="text-sm text-ink">{h.what}</div>
                <div className="text-[11px] text-ink/40">{h.by} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Drawer>
  )
}

function AddClaim({ me, showToast, onClose, onAdded }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [pick, setPick] = useState(null)
  const [reason, setReason] = useState('damaged')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => { findParcelsFor(q).then(setFound) }, 300)
    return () => clearTimeout(t)
  }, [q])
  return (
    <Modal title="Add a claim" description="Find the parcel by its order reference or tracking number." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <SearchInput value={q} onChange={e => { setQ(e.target.value); setPick(null) }} placeholder="Order ref or tracking number" className="w-full" autoFocus />
        {!pick && found.length > 0 && (
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 max-h-60 overflow-y-auto">
            {found.map(p => (
              <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-paper" onClick={() => setPick(p)}>
                <div className="text-sm text-ink font-medium">{p.order_ref || 'No ref'} · {carrierName(p)}</div>
                <div className="text-xs text-ink/50 truncate">{(p.items || []).map(i => `${i.qty} × ${i.name || i.code}`).join(', ')} · {day(p.shipped_at)}</div>
              </button>
            ))}
          </div>
        )}
        {pick && <div className="surface-sky p-3 text-sm"><b>{pick.order_ref}</b> · {carrierName(pick)} · {pick.tracking}</div>}
        <div><label className="label" htmlFor="ac-reason">Why</label>
          <select id="ac-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>
            {['damaged', 'lost', 'returned', 'undeliverable', 'not_delivered', 'other'].map(k => <option key={k} value={k}>{REASONS[k]}</option>)}
          </select></div>
        <div><label className="label" htmlFor="ac-note">Note</label>
          <input id="ac-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="What happened" /></div>
        <button className="btn btn-primary w-full justify-center" disabled={!pick || busy} onClick={async () => {
          setBusy(true)
          try {
            onAdded(await addClaim({
              parcel_id: pick.id, order_id: pick.order_id, order_ref: pick.order_ref, tracking: pick.tracking, carrier: pick.carrier,
              service: pick.service, channel: pick.channel, items: pick.items || [], reason, shipped_at: pick.shipped_at, notes: note.trim() || null,
            }, me?.name))
          } catch (e) {
            showToast?.(/duplicate|unique/i.test(e?.message || '') ? 'This parcel already has a claim — find it in the list' : `Couldn't add — ${e?.message || 'try again'}`, 'error')
            setBusy(false)
          }
        }}>Add the claim</button>
      </div>
    </Modal>
  )
}
