import React, { useEffect, useMemo, useState } from 'react'
import { PageHeader, Spinner, Icon } from './UI'
import { loadChecks, loadListingProposals } from '../lib/db'
import { money, int, dayName } from './FinanceParts'
import { exportRowsToCsv, stampedName } from '../lib/csv'

/**
 * Finance → Checks (v2.91.0, first version). The portal checking its own figures, so an error is seen the day it
 * happens and not found months later in an audit. Each check answers "how many, and which" (report_checks,
 * migration 120). Read-only; admins only.
 *
 * NOT here yet (see docs/COSTING_SCENARIOS.md): the pound-for-pound comparison of every order with its listing's cost
 * in force on the day, a daily run with a ClickUp alert, and the "unexplained" count on the Profit & Loss.
 */
const money3 = (v) => (v == null ? '—' : `£${Number(v).toFixed(Math.abs(Number(v)) < 1 ? 4 : 2)}`)
const cell = (t, v) => (v == null || v === '' ? '—' : t === 'date' ? dayName(String(v).slice(0, 10)) : t === 'money' ? money(Number(v)) : t === 'money3' ? money3(v) : t === 'int' ? int(v) : String(v))
const plain = (t, v) => (v == null ? '' : t === 'money' || t === 'money3' || t === 'int' ? Number(v) : String(v))
const RIGHT = new Set(['money', 'money3', 'int'])

export default function ChecksPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const run = () => {
    setBusy(true); setError('')
    loadChecks().then(d => setData(d)).catch(e => setError(e?.message || 'Couldn’t run the checks')).finally(() => setBusy(false))
  }
  useEffect(run, [])
  const checks = data?.checks || []
  const groups = useMemo(() => {
    const m = new Map()
    for (const c of checks) (m.get(c.group) || m.set(c.group, []).get(c.group)).push(c)
    return [...m.entries()]
  }, [checks])
  const failing = checks.filter(c => Number(c.count) > 0)
  const serious = failing.filter(c => c.serious)
  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="page-shell" data-checks>
      <PageHeader eyebrow="Finance / the portal checking its own figures" title="Checks"
        description="Each check counts what does not add up and lists it. Nothing here changes a figure — it shows where to look." />
      {error && <div className="card p-4 text-sm text-loss mb-4" role="alert">{error} <button className="underline" onClick={run}>Try again</button></div>}
      {!data && !error && <div className="card p-8 flex justify-center"><Spinner /></div>}
      {data && (
        <>
          <div className="card p-4 mb-5 flex items-center justify-between gap-4 flex-wrap" data-checks-summary>
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${serious.length ? 'bg-coral/10 text-loss' : failing.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                <Icon name={failing.length ? 'alert' : 'check'} size={18} />
              </span>
              <div className="min-w-0">
                <div className="text-base font-semibold text-ink">
                  {failing.length === 0 ? 'Every check is clear' : `${failing.length} of ${checks.length} checks have something to look at`}
                </div>
                <div className="text-xs text-ink/55">
                  Orders since {dayName(String(data.from))} · run {new Date(data.ran_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {data.costed_at ? ` · costs worked out ${new Date(data.costed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                </div>
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run again'}</button>
          </div>

          {groups.map(([group, list]) => (
            <section key={group} className="mb-6">
              <h2 className="title-case text-xs font-semibold text-ink/50 mb-2">{group}</h2>
              <div className="space-y-2.5">
                {list.map(c => {
                  const n = Number(c.count) || 0
                  const isOpen = open.has(c.id)
                  const tone = n === 0 ? 'bg-emerald-100 text-emerald-700' : c.serious ? 'bg-coral/10 text-loss' : 'bg-amber-100 text-amber-700'
                  return (
                    <div key={c.id} className="card overflow-hidden" data-check={c.id}>
                      <button className="w-full text-left p-4 flex items-start gap-3.5 hover:bg-sky/20 disabled:hover:bg-transparent" onClick={() => toggle(c.id)} disabled={!c.rows?.length} aria-expanded={isOpen}>
                        <span className={`inline-flex items-center justify-center min-w-[3.25rem] h-8 px-2 rounded-full text-sm font-semibold tabular-nums shrink-0 ${tone}`} data-check-count>
                          {n === 0 ? 'Clear' : int(n)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ink leading-snug">{c.title}</span>
                          <span className="block text-xs text-ink/60 mt-0.5 leading-relaxed">{c.why}</span>
                          {n > 0 && c.value != null && Number(c.value) !== 0 && <span className="block text-xs text-ink/70 mt-1">Worth {money(Number(c.value))}</span>}
                        </span>
                        {c.rows?.length > 0 && <span className="text-xs font-medium text-royal-600 shrink-0 mt-1.5">{isOpen ? 'Hide' : 'Show'}</span>}
                      </button>
                      {isOpen && c.rows?.length > 0 && (
                        <div className="border-t border-rule">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-[11px] text-ink/50 bg-paper">
                                  {c.cols.map(col => <th key={col.k} className={`px-4 py-2 font-semibold whitespace-nowrap ${RIGHT.has(col.t) ? 'text-right' : 'text-left'}`}>{col.label}</th>)}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-rule/70">
                                {c.rows.map((r, i) => (
                                  <tr key={i} className="align-top">
                                    {c.cols.map(col => (
                                      <td key={col.k} className={`px-4 py-2 ${RIGHT.has(col.t) ? 'text-right tabular-nums whitespace-nowrap' : col.t === 'date' ? 'whitespace-nowrap text-ink/70' : col.t === 'order' ? 'font-mono text-xs whitespace-nowrap' : 'text-ink min-w-[12rem]'}`}>
                                        {cell(col.t, r[col.k])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-rule bg-paper flex-wrap">
                            <div className="text-xs text-ink/50">{c.rows.length >= 300 ? 'The first 300 are shown.' : `${int(c.rows.length)} ${c.rows.length === 1 ? 'line' : 'lines'}`}</div>
                            <button className="btn btn-ghost btn-xs" onClick={() => exportRowsToCsv(stampedName(`check-${c.id}`), c.rows, c.cols.map(col => ({ header: col.label, value: (r) => plain(col.t, r[col.k]) })))}>
                              <Icon name="download" size={13} /> Download
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          <ListingProposals />
          <div className="text-xs text-ink/45">
            Still to come: every order compared pound for pound with its listing's cost on the day, a daily run with an alert in ClickUp, and the count of unexplained orders on the Profit &amp; Loss.
          </div>
        </>
      )}
    </div>
  )
}

/**
 * eBay and TikTok listings — a PROPOSAL (v2.92.0, migration 122). For every item that has sold on those channels: the
 * products its code is linked to, the Amazon listing with exactly the same products that its packaging and carrier
 * would be copied from, the fee the channel has really charged, and what stands in the way. Nothing is created here:
 * the owner reviews it first ("extremely careful … with the correct packaging selected").
 */
const P_COLS = [
  ['channel', 'Channel'], ['item_code', 'Code'], ['title', 'Title on the channel'], ['listing_skus', 'SKUs seen'], ['orders', 'Orders'], ['price', 'Last price'],
  ['fee_pct', 'Fee %'], ['products', 'Products it sends'], ['kg', 'Weight kg'], ['amazon_listing', 'Amazon listing to copy from'], ['packaging', 'Packaging'],
  ['carrier', 'Carrier'], ['service', 'Service'], ['status', 'Status'], ['notes', 'To check'],
]
function ListingProposals() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [only, setOnly] = useState('all')
  const load = () => { setBusy(true); setError(''); loadListingProposals().then(setData).catch(e => setError(e?.message || 'Couldn’t load the proposal')).finally(() => setBusy(false)) }
  const rows = data?.rows || []
  const ready = rows.filter(r => r.status === 'Ready'), blocked = rows.filter(r => r.status !== 'Ready'), toCheck = rows.filter(r => r.notes)
  const shown = only === 'ready' ? ready : only === 'blocked' ? blocked : only === 'check' ? toCheck : rows
  return (
    <section className="mb-6" data-proposals>
      <h2 className="title-case text-xs font-semibold text-ink/50 mb-2">eBay and TikTok listings</h2>
      <div className="card overflow-hidden">
        <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Proposed listings — nothing has been created</div>
            <div className="text-xs text-ink/60 mt-0.5 leading-relaxed">
              Every eBay and TikTok item that has sold, as its listing would be set up: the products it sends, the Amazon listing with the same products that its packaging and carrier would be copied from, and the fee the channel really charges. Each one is for you to check before anything is made.
            </div>
            {data && (
              <div className="text-xs text-ink/70 mt-1.5" data-proposals-summary>
                {int(rows.length)} items · {int(ready.length)} ready · {int(blocked.length)} need a decision · {int(toCheck.length)} have something to check
              </div>
            )}
            {error && <div className="text-xs text-loss mt-1.5" role="alert">{error}</div>}
          </div>
          <div className="flex gap-2 shrink-0">
            {data && <button className="btn btn-ghost btn-sm" onClick={() => exportRowsToCsv(stampedName('ebay-tiktok-listings-proposal'), rows, P_COLS.map(([k, h]) => ({ header: h, value: (r) => r[k] ?? '' })))}><Icon name="download" size={13} /> Download</button>}
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={busy}>{busy ? 'Working it out…' : data ? 'Refresh' : 'Show the proposal'}</button>
          </div>
        </div>
        {data && (
          <div className="border-t border-rule">
            <div className="px-4 py-2.5 flex gap-1.5 flex-wrap bg-paper border-b border-rule">
              {[['all', `All ${rows.length}`], ['blocked', `Need a decision ${blocked.length}`], ['check', `To check ${toCheck.length}`], ['ready', `Ready ${ready.length}`]].map(([id, label]) => (
                <button key={id} className={`btn btn-xs ${only === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnly(id)}>{label}</button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-ink/50 bg-paper">
                  {['Item', 'Sold', 'Products it sends', 'Copied from Amazon', 'Fee', 'Status'].map(h => <th key={h} className="px-4 py-2 font-semibold text-left whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-rule/70">
                  {shown.map(r => (
                    <tr key={`${r.channel}|${r.item_code}`} className="align-top">
                      <td className="px-4 py-2 min-w-[16rem]">
                        <div className="text-ink">{r.title || '—'}</div>
                        <div className="text-[11px] text-ink/50 break-all">{r.channel} · {r.item_code}{r.listing_skus && r.listing_skus !== r.item_code ? ` · SKU ${r.listing_skus}` : ''}</div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap tabular-nums">{int(r.orders)} {Number(r.orders) === 1 ? 'order' : 'orders'}<div className="text-[11px] text-ink/50">{r.price > 0 ? `last at ${money(Number(r.price))}` : 'price not known'}</div></td>
                      <td className="px-4 py-2 min-w-[14rem]"><div className="text-ink">{r.products || '—'}</div><div className="text-[11px] text-ink/50">{r.kg != null ? `${r.kg}kg` : 'weight not known'}</div></td>
                      <td className="px-4 py-2 min-w-[14rem]">
                        {r.amazon_listing ? <><div className="text-ink">{r.packaging || 'no packaging set'}</div><div className="text-[11px] text-ink/50">{r.carrier} {r.service === 'standard' ? '48 hour' : 'next day'} · from “{r.amazon_listing}”</div></> : <span className="text-ink/45">—</span>}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap tabular-nums">{r.fee_pct != null ? `${r.fee_pct}%` : '—'}</td>
                      <td className="px-4 py-2 min-w-[14rem]">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'Ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                        {r.notes && <div className="text-[11px] text-ink/60 mt-1">{r.notes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
