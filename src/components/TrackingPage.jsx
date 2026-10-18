import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Tabs, Spinner, InfoBox } from './UI'
import { loadParcels, loadTrackingSync } from '../lib/db'
import { STATUS, PROBLEM, parcelState, realParcel, needsAttention, carrierName, viaAmazon, summariseParcels, productPatterns } from '../lib/tracking'
import { exportRowsToCsv } from '../lib/csv'

const RANGES = [['7', '7 days'], ['14', '14 days'], ['30', '30 days']]
const SHOW = 60

const londonDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return londonDay(d) }
const when = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const dayLabel = (ymd) => ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
const ago = (iso) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const itemsText = (p) => (p.items || []).map(i => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name || i.code}`).join(', ') || 'Items not known'

function Metric({ label, value, sub, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left px-3 py-2.5 sm:px-4 sm:py-3.5 ${onClick ? 'hover:border-royal-300 transition-colors' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-lg sm:text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] sm:text-xs text-ink/45 mt-0.5 leading-snug">{sub}</div>}
    </Tag>
  )
}

function StatePill({ s }) {
  const tone = s.state === 'delivered' ? (s.late ? 'pill-paused' : 'pill-live')
    : s.state === 'problem' || s.state === 'late' || (s.state === 'stuck' && s.late) ? 'pill-alert'
    : s.state === 'stuck' ? 'pill-paused' : s.state === 'moving' ? 'pill-brand' : 'pill-quiet'
  const text = s.state === 'delivered' && s.late ? 'Delivered late' : s.state === 'stuck' ? 'Not scanned yet' : s.label
  return <span className={`pill ${tone} whitespace-nowrap`}>{text}</span>
}

function TrackLink({ p, className = '' }) {
  if (!p.tracking) return null
  const text = <span className="font-mono text-[11px] truncate">{p.tracking}</span>
  return p.tracking_url
    ? <a href={p.tracking_url} target="_blank" rel="noreferrer" className={`link-chip ${className}`} onClick={e => e.stopPropagation()}>{text}<Icon name="external" size={11} /></a>
    : <span className={`link-chip ${className}`}>{text}</span>
}

/** One parcel, as a row that works on a phone and a laptop. */
function ParcelRow({ p, s, onOpen }) {
  return (
    <button className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70 transition-colors" onClick={() => onOpen(p)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-ink">{p.order_ref || `Shipment ${p.shipment_id}`}</span>
            <span className="text-xs text-ink/50">{carrierName(p)}{p.parcels > 1 ? ` · parcel ${p.parcel_no} of ${p.parcels}` : ''}</span>
          </div>
          <div className="text-xs text-ink/70 mt-0.5 line-clamp-2">{itemsText(p)}</div>
          <div className="text-[11px] text-ink/45 mt-1">
            Booked {when(p.shipped_at)} · due {dayLabel(s.due)}
            {p.last_event_at && <> · last scan {ago(p.last_event_at)}</>}
          </div>
          {p.last_event && <div className="text-[11px] text-ink/55 mt-0.5 truncate">{p.last_event}</div>}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatePill s={s} />
          {s.state !== 'delivered' && s.days > 0 && <span className={`text-[11px] tabular-nums ${s.late ? 'text-loss font-semibold' : 'text-ink/45'}`}>{plural(s.days, 'working day')}</span>}
          <TrackLink p={p} className="hidden sm:inline-flex" />
        </div>
      </div>
    </button>
  )
}

function Group({ title, note, rows, onOpen, tone = '' }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 25)
  return (
    <div className="card p-0 overflow-hidden">
      <div className={`px-4 py-3 border-b border-rule bg-paper flex items-baseline justify-between gap-3 flex-wrap ${tone}`}>
        <div className="text-sm font-semibold text-ink">{title} <span className="text-ink/45 font-normal">· {rows.length}</span></div>
        {note && <div className="text-xs text-ink/50">{note}</div>}
      </div>
      {shown.map(({ p, s }) => <ParcelRow key={p.id} p={p} s={s} onOpen={onOpen} />)}
      {rows.length > shown.length && (
        <button className="w-full py-2.5 text-xs font-semibold text-royal-600 hover:bg-royal-50" onClick={() => setAll(true)}>Show all {rows.length}</button>
      )}
    </div>
  )
}

function ParcelDrawer({ p, onClose }) {
  const s = parcelState(p)
  const events = [...(p.events || [])].reverse()
  return (
    <Drawer title={p.order_ref || `Shipment ${p.shipment_id}`} onClose={onClose}
      description={`${carrierName(p)}${viaAmazon(p) ? ' (bought through Amazon)' : ''} · ${p.service || ''}`}>
      <div className="space-y-4">
        <div className="card space-y-2.5">
          <div className="flex items-center justify-between gap-3"><StatePill s={s} /><TrackLink p={p} /></div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="text-ink/45">Label booked</div><div className="text-ink font-medium">{when(p.shipped_at)}</div></div>
            <div><div className="text-ink/45">Due by</div><div className={`font-medium ${s.late ? 'text-loss' : 'text-ink'}`}>{dayLabel(s.due)}</div></div>
            <div><div className="text-ink/45">First courier scan</div><div className="text-ink font-medium">{when(p.collected_at)}</div></div>
            <div><div className="text-ink/45">Delivered</div><div className="text-ink font-medium">{when(p.delivered_at)}</div></div>
          </div>
        </div>
        <div className="card">
          <div className="text-xs font-semibold text-ink/55 mb-2">In the parcel</div>
          {(p.items || []).length ? (p.items || []).map((i, k) => (
            <div key={k} className="flex items-baseline gap-2 text-sm py-1">
              <span className="font-semibold tabular-nums w-8 text-right">{i.qty}×</span>
              <span className="text-ink">{i.name || i.code}</span>
              {i.code && <span className="text-[11px] text-ink/40 font-mono ml-auto">{i.code}</span>}
            </div>
          )) : <div className="text-sm text-ink/50">Not known</div>}
        </div>
        <div className="card">
          <div className="text-xs font-semibold text-ink/55 mb-3">What the courier said</div>
          {events.length ? (
            <ol className="relative border-l border-rule ml-1.5 space-y-3">
              {events.map((e, k) => (
                <li key={k} className="pl-4 relative">
                  <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${e.s === 7 ? 'bg-gain' : PROBLEM.includes(e.s) ? 'bg-coral' : k === 0 ? 'bg-royal-500' : 'bg-ink/25'}`} />
                  <div className="text-sm text-ink font-medium">{STATUS[e.s] || 'Update'}</div>
                  {e.d && <div className="text-xs text-ink/60">{e.d}</div>}
                  <div className="text-[11px] text-ink/40">{when(e.at)}</div>
                </li>
              ))}
            </ol>
          ) : <div className="text-sm text-ink/50">No scans yet.</div>}
        </div>
      </div>
    </Drawer>
  )
}

export default function TrackingPage({ showToast }) {
  const [range, setRange] = useState('14')
  const [parcels, setParcels] = useState(null)
  const [sync, setSync] = useState(null)
  const [tab, setTab] = useState('attention')
  const [carrier, setCarrier] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [limit, setLimit] = useState(SHOW)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    setParcels(null)
    try {
      const [p, s] = await Promise.all([loadParcels({ from: daysAgo(Number(range)) }), loadTrackingSync()])
      setParcels(p); setSync(s)
    } catch (e) { showToast?.(`Couldn't load tracking — ${e?.message || 'try again'}`, 'error'); setParcels([]) }
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const real = useMemo(() => (parcels || []).filter(realParcel), [parcels])
  const carriers = useMemo(() => [...new Set(real.map(carrierName))].sort(), [real])
  const shown = useMemo(() => real.filter(p => !carrier || carrierName(p) === carrier), [real, carrier])
  const rows = useMemo(() => shown.map(p => ({ p, s: parcelState(p) })), [shown])
  const sum = useMemo(() => summariseParcels(shown), [shown])
  const bySum = useMemo(() => summariseParcels(real), [real])
  const patterns = useMemo(() => productPatterns(shown), [shown])

  const attention = rows.filter(r => needsAttention(r.p))
  const lateOnes = attention.filter(r => r.s.state === 'late').sort((a, b) => b.s.days - a.s.days)
  const problems = attention.filter(r => r.s.state === 'problem').sort((a, b) => (b.p.status === 10) - (a.p.status === 10) || b.s.days - a.s.days)
  const stuck = attention.filter(r => r.s.state === 'stuck').sort((a, b) => b.s.days - a.s.days)
  const untracked = rows.filter(r => r.s.state === 'untracked')

  const q = query.trim().toLowerCase()
  const list = rows.filter(({ p, s }) => {
    if (status === 'late' && !s.late) return false
    if (status && status !== 'late' && s.state !== status) return false
    if (!q) return true
    return [p.order_ref, p.tracking, ...(p.items || []).flatMap(i => [i.code, i.name])].some(v => String(v || '').toLowerCase().includes(q))
  })

  const exportCsv = () => exportRowsToCsv(`delivery-tracking-${londonDay()}.csv`, rows, [
    { header: 'Order', value: r => r.p.order_ref || '' },
    { header: 'Courier', value: r => carrierName(r.p) },
    { header: 'Service', value: r => r.p.service || '' },
    { header: 'Tracking', value: r => r.p.tracking || '' },
    { header: 'Status', value: r => (r.s.state === 'delivered' && r.s.late ? 'Delivered late' : r.s.label) },
    { header: 'Late', value: r => (r.s.late ? 'Yes' : '') },
    { header: 'Booked', value: r => r.p.shipped_at || '' },
    { header: 'Due', value: r => r.s.due || '' },
    { header: 'Delivered', value: r => r.p.delivered_at || '' },
    { header: 'Working days', value: r => r.s.days },
    { header: 'Items', value: r => itemsText(r.p) },
    { header: 'Last scan', value: r => r.p.last_event || '' },
  ])

  const stale = sync?.last_ok && Date.now() - Date.parse(sync.last_ok) > 2 * 3600e3
  const t = sum.total

  return (
    <div>
      <PageHeader eyebrow="Warehouse / delivery tracking" title="Delivery tracking"
        description="Every parcel booked through HELM, as the courier sees it. Parcels go Next Day, so anything not delivered within 2 working days (Sunday off) is late and counts against the account."
        meta={<span className={stale || sync?.last_error ? 'text-loss' : ''}>
          {sync?.last_error ? `HELM's last update failed (${ago(sync.last_run)}) — showing what we had` : `Updated from HELM ${ago(sync?.last_ok)}`} · every half hour
        </span>}
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={load}><Icon name="swap" size={14} /> Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={14} /> Export</button>
        </>} />

      <div className="filter-bar mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {RANGES.map(([id, label]) => (
            <button key={id} className={`btn btn-sm ${range === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
        {carriers.length > 1 && (
          <div className="flex gap-1.5 flex-wrap sm:ml-auto">
            <button className={`btn btn-sm ${!carrier ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCarrier('')}>All couriers</button>
            {carriers.map(c => <button key={c} className={`btn btn-sm ${carrier === c ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCarrier(c)}>{c}</button>)}
          </div>
        )}
      </div>

      {!parcels ? <Spinner /> : !real.length ? (
        <div className="surface"><EmptyState icon="pin" title="No parcels in these dates yet" sub="Parcels appear here once HELM has booked their labels. The first update after go-live can take half an hour." /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <Metric label="Late now" value={t.lateOpen} sub="past due, not delivered" tone={t.lateOpen ? 'text-loss' : 'text-gain'} onClick={() => setTab('attention')} />
            <Metric label="On time" value={t.onTimePct == null ? '—' : `${t.onTimePct}%`} sub={`${t.onTime} of ${t.delivered + t.lateOpen} due so far`}
              tone={t.onTimePct == null ? '' : t.onTimePct >= 95 ? 'text-gain' : t.onTimePct < 85 ? 'text-loss' : 'text-warn'} />
            <Metric label="Courier problems" value={t.problems} sub="failed, held, address, returned" tone={t.problems ? 'text-loss' : ''} onClick={() => setTab('attention')} />
            <Metric label="Returned to sender" value={t.returned} sub={t.returned ? 'see Products for patterns' : 'none'} tone={t.returned ? 'text-loss' : ''} onClick={() => setTab('products')} />
            <Metric label="Delivered" value={t.delivered} sub={t.medianHours != null ? `usually in ${t.medianHours} h` : `of ${t.tracked} tracked`} />
            <Metric label="Not tracked" value={t.untracked} sub="courier doesn't report to HELM" />
          </div>

          <Tabs className="mb-0" value={tab} onChange={setTab} items={[
            { id: 'attention', label: 'Needs attention', count: attention.length },
            { id: 'all', label: 'All parcels', count: rows.length },
            { id: 'couriers', label: 'Couriers' },
            { id: 'products', label: 'Products', count: patterns.length || undefined },
          ]} />

          {tab === 'attention' && (attention.length === 0 ? (
            <div className="surface"><EmptyState icon="check" title="Nothing late, nothing stuck" sub="Every tracked parcel is either delivered or still within its 2 working days." /></div>
          ) : (
            <div className="space-y-4">
              <Group title="Late" note="Past 2 working days and not delivered — chase the courier" rows={lateOnes} onOpen={setOpen} />
              <Group title="Courier problems" note="Failed attempt, on hold, address problem or returned" rows={problems} onOpen={setOpen} />
              <Group title="Not scanned by the courier" note="Label booked, but no scan since — did it go out?" rows={stuck} onOpen={setOpen} />
            </div>
          ))}

          {tab === 'all' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <SearchInput className="flex-1" value={query} onChange={e => { setQuery(e.target.value); setLimit(SHOW) }} placeholder="Order number, tracking number or product" />
                <select className="input text-sm sm:w-[200px]" value={status} onChange={e => { setStatus(e.target.value); setLimit(SHOW) }} aria-label="Status">
                  <option value="">Every status</option>
                  <option value="late">Late (open or delivered late)</option>
                  <option value="moving">On its way</option>
                  <option value="delivered">Delivered</option>
                  <option value="problem">Courier problem</option>
                  <option value="stuck">Not scanned yet</option>
                  <option value="untracked">Not tracked</option>
                </select>
              </div>
              {list.length === 0 ? <div className="surface"><EmptyState icon="search" title="No parcels match" sub="Try a different search or status." /></div> : (
                <div className="card p-0 overflow-hidden">
                  {list.slice(0, limit).map(({ p, s }) => <ParcelRow key={p.id} p={p} s={s} onOpen={setOpen} />)}
                  {list.length > limit && (
                    <button className="w-full py-2.5 text-xs font-semibold text-royal-600 hover:bg-royal-50" onClick={() => setLimit(l => l + SHOW)}>Show more ({list.length - limit} left)</button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'couriers' && (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper">
                      {['Courier', 'Parcels', 'On time', 'Late now', 'Delivered late', 'Problems', 'Returned', 'Usual time', 'Not tracked'].map((h, i) => (
                        <th key={h} className={`${i ? 'text-right' : 'text-left'} px-3 first:px-4 last:px-4 py-3 text-xs font-semibold text-ink/45 whitespace-nowrap`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySum.carriers.map(c => (
                      <tr key={c.name} className={`border-b border-rule last:border-0 ${carrier && carrier !== c.name ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{c.parcels}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${c.onTimePct == null ? 'text-ink/35' : c.onTimePct >= 95 ? 'text-gain' : c.onTimePct < 85 ? 'text-loss' : 'text-warn'}`}>{c.onTimePct == null ? '—' : `${c.onTimePct}%`}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${c.lateOpen ? 'text-loss font-semibold' : 'text-ink/35'}`}>{c.lateOpen || '—'}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${c.lateDelivered ? 'text-warn' : 'text-ink/35'}`}>{c.lateDelivered || '—'}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${c.problems ? 'text-loss' : 'text-ink/35'}`}>{c.problems || '—'}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${c.returned ? 'text-loss' : 'text-ink/35'}`}>{c.returned || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink/70">{c.medianHours != null ? `${c.medianHours} h` : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink/45">{c.untracked || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-rule text-xs text-ink/50">
                On time counts parcels delivered within 2 working days, out of every parcel that's been delivered or is already past due. Usual time is the middle time from label to delivery.
                {untracked.length > 0 && ' Not tracked: the Evri account labels (Hermes 24/48) don\'t send tracking to HELM.'}
              </div>
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-3">
              <InfoBox title="Packing patterns">
                Returns to sender are usually damage in transit or a refusal. A product that keeps coming back, or keeps arriving late or failing delivery, may need better packing or a different service.
              </InfoBox>
              {patterns.length === 0 ? (
                <div className="surface"><EmptyState icon="check" title="No product has had trouble in these dates" sub="Nothing returned, late or failed." /></div>
              ) : (
                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-rule bg-paper">
                          {['Product', 'Parcels', 'With trouble', 'Returned', 'Failed delivery', 'Held / address', 'Late', 'Couriers'].map((h, i) => (
                            <th key={h} className={`${i && i < 7 ? 'text-right' : 'text-left'} px-3 first:px-4 last:px-4 py-3 text-xs font-semibold text-ink/45 whitespace-nowrap`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {patterns.map(r => (
                          <tr key={r.key} className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper/70" onClick={() => { setTab('all'); setQuery(r.code || r.name); setStatus('') }}>
                            <td className="px-4 py-2.5 text-ink min-w-[200px]">{r.name}{r.code && <div className="text-[11px] text-ink/40 font-mono">{r.code}</div>}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{r.parcels}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.rate >= 20 ? 'text-loss' : r.rate >= 8 ? 'text-warn' : ''}`}>{r.trouble} <span className="text-ink/40 font-normal">· {r.rate}%</span></td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${r.returned ? 'text-loss font-semibold' : 'text-ink/35'}`}>{r.returned || '—'}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${r.failed ? 'text-warn' : 'text-ink/35'}`}>{r.failed || '—'}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${r.other ? 'text-warn' : 'text-ink/35'}`}>{r.other || '—'}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${r.late ? 'text-warn' : 'text-ink/35'}`}>{r.late || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-ink/55 whitespace-nowrap">{r.carriers.map(([c, n]) => `${c} ${n}`).join(' · ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-rule text-xs text-ink/50">Most returns first. Tap a product to see its parcels. A parcel with several products counts against each of them.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {open && <ParcelDrawer p={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
