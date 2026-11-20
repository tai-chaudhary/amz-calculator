import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Spinner, StatusBadge, SegmentedControl, InfoBox, WarnBox } from './UI'
import { loadOffshoreOrders, setHelmCourier, loadHelmCourierChanges } from '../lib/db'
import { smartFilter, hay } from '../lib/match'

/**
 * Off Shore (v2.109.0) — the open HELM orders going to remote postcodes (Highlands & Islands, Northern Ireland, the
 * islands), with the cheapest way to send each: the carrier (only those switched on in Cost Settings; for Prime only
 * those that take Prime), how many parcels (25kg at most each, Evri under 15kg) and — for people who see costs — what it
 * costs and how much more than mainland. "Set in HELM" changes the order's courier service in HELM before the label is
 * made. The answers come from the offshore-check edge function, the same engine as the ClickUp alert.
 */
const gbp = (v) => (v == null ? '—' : `£${Number(v).toFixed(2)}`)
const kg = (v) => `${(Math.round(Number(v || 0) * 10) / 10).toLocaleString('en-GB')}kg`
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const dayLabel = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

const STATE = {
  surcharged: { label: 'Surcharged', tone: 'warn' },
  free: { label: 'Free to send', tone: 'live' },
  'no-carrier': { label: 'No carrier', tone: 'alert' },
  'no-weight': { label: 'No weight', tone: 'alert' },
  mainland: { label: 'Mainland price', tone: 'live' },
}
const needsLook = (r) => r.status_off === 'no-carrier' || r.status_off === 'no-weight' || r.weight_unknown > 0

function Metric({ label, value, sub, tone = '', onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={`metric-card text-left px-3 py-2.5 sm:px-4 sm:py-3.5 ${onClick ? 'hover:border-royal-300 transition-colors' : ''} ${active ? 'border-royal-400' : ''}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-lg sm:text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] sm:text-xs text-ink/45 mt-0.5 leading-snug">{sub}</div>}
    </Tag>
  )
}

function OrderCard({ r, costs, busy, onSet }) {
  const st = STATE[r.status_off] || STATE.mainland
  const [svc, setSvc] = useState(() => (r.services.find(s => s.level === 'nextday') || r.services[0])?.id || '')
  const others = (r.options || []).slice(1)
  const parcels = r.best?.boxes || []
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink break-all">{r.ref || r.order_number}</div>
          <div className="text-xs text-ink/55 mt-0.5">
            {r.channel || 'Order'}{r.order_date ? ` · ordered ${dayLabel(r.order_date)}` : ''}{r.ship_by ? ` · ship by ${dayLabel(r.ship_by)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1 flex-shrink-0">
          <StatusBadge tone={st.tone} dot>{st.label}</StatusBadge>
          {r.prime && <StatusBadge tone="brand">Prime</StatusBadge>}
          {r.is_hold && <StatusBadge tone="alert">On hold</StatusBadge>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 font-medium"><Icon name="pin" size={14} className="text-royal-600" />{r.district}</span>
        <span className="text-ink/60">{r.area}</span>
        <span className="text-ink/60">{r.units_kg.length ? kg(r.kg) : 'Weight not known'}{r.weight_from_listing ? ' (from the listing)' : ''}</span>
      </div>

      <div className="text-xs text-ink/70 space-y-0.5">
        {(r.lines || []).map((l, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{Number(l.qty) > 1 ? `${Number(l.qty)} × ` : ''}{l.name || l.code}</span>
            <span className={`flex-shrink-0 ${l.kg ? 'text-ink/45' : 'text-coral'}`}>{l.kg ? kg(l.kg) : 'no weight'}</span>
          </div>
        ))}
      </div>

      {r.best ? (
        <div className="surface-sky px-3 py-2.5 rounded-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-royal-700/70 font-semibold">Send with</div>
              <div className="font-semibold text-royal-800">{r.best.name} · {plural(parcels.length, 'parcel')}</div>
              {parcels.length > 1 && <div className="text-xs text-royal-800/70">Split: {parcels.map(kg).join(' + ')}</div>}
              {r.best.zone && <div className="text-xs text-royal-800/70">{r.best.name} {r.best.zone.name}</div>}
            </div>
            {costs && (
              <div className="text-right flex-shrink-0">
                <div className="font-semibold text-royal-800">{gbp(r.best.cost)}</div>
                <div className={`text-xs ${r.best.extra > 0.004 ? 'text-coral font-medium' : 'text-gain'}`}>{r.best.extra > 0.004 ? `+${gbp(r.best.extra)} vs mainland` : 'No extra'}</div>
              </div>
            )}
          </div>
          {costs && others.length > 0 && (
            <div className="text-xs text-royal-800/60 mt-1.5">Next best: {others.map(o => `${o.name} ${gbp(o.cost)}${o.boxes.length > 1 ? ` (${o.boxes.length} parcels)` : ''}`).join(' · ')}</div>
          )}
        </div>
      ) : (
        <div className="panel-alert text-xs text-ink/70 px-3 py-2.5">
          {r.status_off === 'no-weight' || r.weight_unknown ? 'Some items have no weight in Products, so the parcels can’t be worked out. Add the weight, or check by hand.' : 'No carrier that is switched on can take this order.'}
        </div>
      )}
      {(r.refused || []).length > 0 && <div className="text-[11px] text-ink/45">{r.refused.map(x => x.why).join(' · ')}</div>}

      <div className="pt-2.5 border-t border-ink/5 space-y-2">
        <div className="text-xs text-ink/55">In HELM now: <span className="text-ink/80 font-medium">{r.helm_service || r.helm_carrier || 'not set'}</span></div>
        {r.best && (r.on_best ? (
          <StatusBadge tone="live">Already on {r.best.name}</StatusBadge>
        ) : r.services.length ? (
          <div className="flex items-center gap-2 min-w-0">
            {r.services.length > 1 ? (
              <select className="input text-sm flex-1 min-w-0" value={svc} onChange={e => setSvc(Number(e.target.value))} aria-label="HELM service">
                {r.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <span className="text-sm text-ink/80 flex-1 min-w-0 truncate">{r.services[0].name}</span>}
            <button className="btn btn-primary btn-sm flex-shrink-0 whitespace-nowrap" disabled={busy || !svc} onClick={() => onSet(r, Number(svc))}>
              {busy ? 'Setting…' : 'Set in HELM'}
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-ink/45">No HELM service id for {r.best.name} in Cost Settings</span>
        ))}
      </div>
    </div>
  )
}

export default function OffshorePage({ showToast, me }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [changes, setChanges] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await loadOffshoreOrders()) } catch (e) { setError(e?.message || 'Could not load') } finally { setLoading(false) }
    loadHelmCourierChanges().then(setChanges).catch(() => setChanges(null))
  }, [])
  useEffect(() => { load() }, [load])

  const rows = data?.rows || []
  const costs = !!data?.costs
  const counts = useMemo(() => ({
    all: rows.length,
    surcharged: rows.filter(r => r.status_off === 'surcharged').length,
    free: rows.filter(r => r.status_off === 'free' || r.status_off === 'mainland').length,
    look: rows.filter(needsLook).length,
    change: rows.filter(r => r.best && !r.on_best && r.services.length).length,
    extra: rows.reduce((a, r) => a + (r.best?.extra > 0 ? r.best.extra : 0), 0),
  }), [rows])
  const shown = useMemo(() => {
    let xs = rows
    if (filter === 'surcharged') xs = xs.filter(r => r.status_off === 'surcharged')
    if (filter === 'free') xs = xs.filter(r => r.status_off === 'free' || r.status_off === 'mainland')
    if (filter === 'look') xs = xs.filter(needsLook)
    if (filter === 'change') xs = xs.filter(r => r.best && !r.on_best && r.services.length)
    if (q.trim()) xs = smartFilter(xs, q, r => hay(r.ref, r.order_number, r.district, r.area, r.channel, r.best?.name, r.helm_service, ...(r.lines || []).map(l => `${l.name} ${l.code}`)))
    // the costliest first (people who see costs), then the heaviest
    return [...xs].sort((a, b) => (needsLook(b) - needsLook(a)) || ((b.best?.extra || 0) - (a.best?.extra || 0)) || (b.kg - a.kg))
  }, [rows, filter, q])

  const onSet = async (r, serviceId) => {
    setBusy(r.id)
    const res = await setHelmCourier(r.id, serviceId, r.ref || r.order_number)
    setBusy(null)
    if (res.ok) { showToast?.(res.unchanged ? 'Already set in HELM' : `Courier changed in HELM for ${r.ref || r.order_number}`); load() }
    else showToast?.(res.error || 'HELM did not take the change', 'error')
  }

  const active = (data?.carriers || []).filter(c => c.active)
  const off = (data?.carriers || []).filter(c => !c.active)

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Warehouse" title="Off Shore"
        description="Open orders going to remote postcodes, and the cheapest way to send each — check here before making the label."
        actions={<button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}><Icon name="swap" size={14} />{loading ? 'Checking…' : 'Refresh'}</button>} />

      {data && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink/60 mb-3">
          <span>Carriers in use:</span>
          {active.map(c => <StatusBadge key={c.id} tone="live">{c.name}{!c.prime ? ' (not Prime)' : ''}</StatusBadge>)}
          {off.map(c => <StatusBadge key={c.id} tone="quiet">{c.name} switched off</StatusBadge>)}
          <span className="text-ink/40">· switched on and off in Cost Settings → Carriers</span>
        </div>
      )}

      {error && <WarnBox title="Couldn’t load the orders">{error}</WarnBox>}
      {!data && !error && <div className="py-16 flex justify-center"><Spinner /></div>}

      {data && (
        <>
          <div className={`grid grid-cols-2 ${costs ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-2 sm:gap-3 mb-4`}>
            <Metric label="Off shore orders" value={counts.all} sub={`of ${data.open} open in HELM`} onClick={() => setFilter('all')} active={filter === 'all'} />
            <Metric label="Surcharged" value={counts.surcharged} tone={counts.surcharged ? 'text-warn' : ''} sub="cost more than mainland" onClick={() => setFilter('surcharged')} active={filter === 'surcharged'} />
            <Metric label="Free to send" value={counts.free} tone={counts.free ? 'text-gain' : ''} sub="no extra with the carrier shown" onClick={() => setFilter('free')} active={filter === 'free'} />
            <Metric label="Need a look" value={counts.look} tone={counts.look ? 'text-coral' : ''} sub="no weight, or no carrier" onClick={() => setFilter('look')} active={filter === 'look'} />
            {costs && <Metric label="Extra cost" value={gbp(counts.extra)} tone={counts.extra ? 'text-coral' : ''} sub="over mainland, cheapest way" />}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Order, postcode, product…" className="flex-1" />
            <SegmentedControl value={filter} onChange={setFilter} items={[
              { id: 'all', label: 'All' }, { id: 'change', label: 'Change carrier', count: counts.change || null },
            ]} />
          </div>

          {shown.length === 0 ? (
            <EmptyState icon="pin" title={rows.length ? 'Nothing here' : 'No off shore orders open'} sub={rows.length ? 'Try another filter.' : 'Open HELM orders to remote postcodes show here as they come in.'} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {shown.map(r => <OrderCard key={r.id} r={r} costs={costs} busy={busy === r.id} onSet={onSet} />)}
            </div>
          )}

          <InfoBox title="How the suggestion is worked out">
            Each order is packed into parcels of 25kg at most (Evri under 15kg), heaviest items first. Every carrier switched on is priced with its
            remote-zone rate for the postcode (Cost Settings → Carriers → Remote zones) or its normal rate where it has none; a Prime order only goes to
            carriers that take Prime. The cheapest wins. “Free to send” means that carrier charges no more than mainland for it.
            Orders costing over £10 extra are also sent to ClickUp, once each.
          </InfoBox>

          {changes && changes.length > 0 && (
            <div className="card p-0 overflow-hidden mt-4">
              <div className="px-4 py-3 border-b border-ink/5 font-semibold text-sm">Courier changes made in HELM (14 days)</div>
              <div className="divide-y divide-ink/5">
                {changes.slice(0, 30).map((c, i) => (
                  <div key={i} className="px-4 py-2 text-xs flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{c.order_ref || c.order_id}</span>
                    <span className="text-ink/55">{when(c.at)} · {c.by_name || '—'}</span>
                    <span className={c.ok ? 'text-gain' : 'text-coral'}>{c.ok ? 'Done' : 'Not done'}{c.note ? ` — ${c.note}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
