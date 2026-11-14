import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader, MetricCard, SegmentedControl, StatusBadge, EmptyState, Spinner, Tabs, Icon, InfoBox } from './UI'
import { ListingLink, AmazonLink } from './Links'
import { loadSalesReport, importReportSales, loadPlLines, loadCostVersions } from '../lib/db'
import { buildPnl, groupPnl } from '../lib/pnl'
import { readSalesReport, sheetRows } from '../lib/salesImport'
import { downloadCsv } from '../lib/csv'

/**
 * Reports (v2.75.0) — release 1 of the Reporting module: the sales ledger.
 * Every order line from 1 August 2026: sales (with and without VAT), fees, refunds and Amazon's other charges, by
 * month, day, channel, ASIN or Listing SKU. Amazon's transaction report gives exact figures (imported here); HELM's
 * orders fill in what the report doesn't cover yet, with fees estimated from each listing's verified fee.
 * Costs (stock, shipping, packaging) and the P&L come in the next release.
 */
const money = (v) => (v == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v))
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d)
const START = '2026-08-01'
function periods() {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth()
  const first = (yy, mm) => ymd(new Date(Date.UTC(yy, mm, 1, 12)))
  const last = (yy, mm) => ymd(new Date(Date.UTC(yy, mm + 1, 0, 12)))
  return [
    { id: 'month', label: 'This month', from: first(y, m), to: ymd(now) },
    { id: 'last', label: 'Last month', from: first(y, m - 1), to: last(y, m - 1) },
    { id: 'all', label: 'Since 1 Aug', from: START, to: ymd(now) },
    { id: 'custom', label: 'Custom' },
  ]
}
const GROUPS = [
  { id: 'month', label: 'Month' }, { id: 'day', label: 'Day' }, { id: 'channel', label: 'Channel' },
  { id: 'asin', label: 'ASIN' }, { id: 'listing', label: 'Listing SKU' },
]
const CHANNELS = ['Amazon', 'eBay', 'TikTok', 'WooCommerce', 'Wholesale']
const monthName = (k) => new Date(`${k}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const dayName = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function ReportsPage({ me, showToast, savedProducts = [], stockItems = [], settings, purchaseOrders = [] }) {
  const [tab, setTab] = useState('pnl')
  const isAdmin = me?.role === 'admin'
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Reporting / P&L" title="Reports"
        description="Every order from 1 August — sales, fees, refunds, product cost, shipping and packaging — and the profit they leave, by month, day, channel, ASIN or Listing SKU." />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'pnl', label: 'P&L' }, { id: 'sales', label: 'Sales' }, ...(isAdmin ? [{ id: 'import', label: 'Import reports' }] : [])]} />
      {tab === 'pnl' && <PnlView savedProducts={savedProducts} stockItems={stockItems} settings={settings} purchaseOrders={purchaseOrders} />}
      {tab === 'sales' && <SalesView />}
      {tab === 'import' && isAdmin && <ImportView me={me} showToast={showToast} onDone={() => setTab('sales')} />}
    </div>
  )
}

function SalesView() {
  const P = useMemo(periods, [])
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState(START)
  const [to, setTo] = useState(P[0].to)
  const [group, setGroup] = useState('month')
  const [channel, setChannel] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ k: 'key', dir: 1 })

  useEffect(() => { const p = P.find(x => x.id === period); if (p?.from) { setFrom(p.from); setTo(p.to) } }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRows(null); setError(null)
    loadSalesReport(from, to, group, channel || null).then(setRows).catch(e => setError(e?.message || 'Could not load'))
  }, [from, to, group, channel])
  // Sort: by name/date for time and channel views, by sales for ASIN and Listing SKU
  useEffect(() => { setSort(['asin', 'listing'].includes(group) ? { k: 'sales_net', dir: -1 } : { k: 'key', dir: 1 }) }, [group])

  const t = useMemo(() => (rows || []).reduce((a, r) => {
    for (const k of ['orders', 'units', 'sales_gross', 'sales_vat', 'sales_net', 'refunds_net', 'fees', 'charges']) a[k] = (a[k] || 0) + (Number(r[k]) || 0)
    a.est = a.est || r.has_estimates; return a
  }, {}), [rows])
  const net = (r) => (Number(r.sales_net) || 0) + (Number(r.refunds_net) || 0) + (Number(r.fees) || 0)
  const list = useMemo(() => [...(rows || [])].sort((a, b) => {
    const va = sort.k === 'net' ? net(a) : a[sort.k], vb = sort.k === 'net' ? net(b) : b[sort.k]
    return (typeof va === 'string' || typeof vb === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (Number(va) || 0) - (Number(vb) || 0)) * sort.dir
  }), [rows, sort])

  const label = (r) => group === 'month' ? monthName(r.key) : group === 'day' ? dayName(r.key) : r.key
  const exportCsv = () => {
    const head = ['Group', 'Name', 'Orders', 'Units', 'Sales incl VAT', 'VAT', 'Sales ex VAT', 'Refunds ex VAT', 'Fees ex VAT', 'Net after fees', 'Fees estimated']
    const lines = list.map(r => [label(r), r.name || '', r.orders, r.units, r.sales_gross, r.sales_vat, r.sales_net, r.refunds_net || 0, r.fees, net(r).toFixed(2), r.has_estimates ? 'Some' : 'No'])
    downloadCsv(`sales-${group}-${from}-to-${to}.csv`, [head, ...lines].map(x => x.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'))
  }
  const Th = ({ k, children, right = true }) => (
    <th className={`th ${right ? 'text-right' : 'text-left'} cursor-pointer select-none`} onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : (k === 'key' ? 1 : -1) }))}>
      {children}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div>
      <div className="filter-bar mb-4 flex-wrap gap-3">
        <SegmentedControl label="Period" items={P.map(p => ({ id: p.id, label: p.label }))} value={period} onChange={setPeriod} />
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input text-sm w-auto" value={from} min={START} max={to} onChange={e => setFrom(e.target.value || START)} aria-label="From" />
            <span className="text-ink/40 text-sm">to</span>
            <input type="date" className="input text-sm w-auto" value={to} min={from} onChange={e => setTo(e.target.value || to)} aria-label="To" />
          </div>
        )}
        <select className="input text-sm w-auto" value={channel} onChange={e => setChannel(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>
          {CHANNELS.map(c => <option key={c} value={c}>{c === 'WooCommerce' ? 'Salt 4 U' : c}</option>)}
        </select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-ink/45">Group by</span>
          <SegmentedControl label="Group by" items={GROUPS} value={group} onChange={setGroup} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Sales incl. VAT" value={money(t.sales_gross)} sub={`${(t.orders || 0).toLocaleString('en-GB')} orders · ${(t.units || 0).toLocaleString('en-GB')} units`} />
        <MetricCard label="Sales ex VAT" value={money(t.sales_net)} sub={`VAT ${money(t.sales_vat)}`} />
        <MetricCard label="Fees ex VAT" value={money(t.fees)} color="text-loss" sub={t.est ? 'Some estimated from the listing’s fee' : 'As charged'} />
        <MetricCard label="Sales after fees & refunds" value={money((t.sales_net || 0) + (t.refunds_net || 0) + (t.fees || 0))} prominent
          sub={`Refunds ${money(t.refunds_net || 0)} · before stock, shipping and packaging`} />
      </div>
      {group !== 'asin' && group !== 'listing' && (t.charges || 0) !== 0 && (
        <div className="text-xs text-ink/55 mb-3">Amazon’s other charges and credits in this period (subscription, delivery incentives, claims, adjustments): <b className="text-ink">{money(t.charges)}</b>, shown in each row’s last column.</div>
      )}

      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && !rows && <div className="surface flex justify-center py-10"><Spinner /></div>}
      {rows && (
        <div className="table-shell overflow-x-auto">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule">
            <div className="text-xs text-ink/50">{list.length} row{list.length !== 1 ? 's' : ''} · {from === to ? dayName(from) : `${dayName(from)} – ${dayName(to)}`}</div>
            <button className="btn btn-secondary btn-xs" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={13} /> Export CSV</button>
          </div>
          <table className="w-full min-w-[1040px] border-collapse">
            <thead className="table-head">
              <tr>
                <Th k="key" right={false}>{GROUPS.find(g => g.id === group)?.label}</Th>
                <Th k="orders">Orders</Th><Th k="units">Units</Th><Th k="sales_gross">Sales incl. VAT</Th><Th k="sales_vat">VAT</Th>
                <Th k="sales_net">Sales ex VAT</Th><Th k="refunds_net">Refunds</Th><Th k="fees">Fees</Th><Th k="net">After fees</Th>
                {(group === 'month' || group === 'day' || group === 'channel') && <Th k="charges">Other Amazon charges</Th>}
                <th className="th text-left">Figures</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.key} className="table-row">
                  <td className="td">
                    {group === 'listing' ? (
                      <div className="min-w-[240px]">
                        <div className="text-sm font-semibold text-ink">{r.key}</div>
                        <div className="text-xs text-ink/45 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {r.listing_id ? <ListingLink id={r.listing_id} name={r.name} /> : <span className="text-warn">No listing for this SKU</span>}
                          {r.asin && <AmazonLink asin={r.asin} label={r.asin} />}
                          {r.channels && r.channels !== 'Amazon' && <span>{r.channels}</span>}
                        </div>
                      </div>
                    ) : group === 'asin' ? (
                      <div className="min-w-[220px]">
                        <div className="text-sm font-semibold text-ink flex items-center gap-2">{r.key}{r.key.startsWith('B0') || r.key.startsWith('B') ? <AmazonLink asin={r.key} /> : null}</div>
                        {r.name && <div className="text-xs text-ink/45 mt-0.5 truncate max-w-[320px]">{r.name}</div>}
                      </div>
                    ) : <span className="text-sm font-semibold text-ink whitespace-nowrap">{label(r)}</span>}
                  </td>
                  <td className="td text-right tabular-nums">{(r.orders || 0).toLocaleString('en-GB')}</td>
                  <td className="td text-right tabular-nums">{(Number(r.units) || 0).toLocaleString('en-GB')}</td>
                  <td className="td text-right tabular-nums font-medium">{money(r.sales_gross)}</td>
                  <td className="td text-right tabular-nums text-ink/55">{money(r.sales_vat)}</td>
                  <td className="td text-right tabular-nums font-medium">{money(r.sales_net)}</td>
                  <td className="td text-right tabular-nums text-loss">{r.refunds_net ? money(r.refunds_net) : '—'}</td>
                  <td className="td text-right tabular-nums text-loss">{money(r.fees)}</td>
                  <td className="td text-right tabular-nums font-semibold">{money(net(r))}</td>
                  {(group === 'month' || group === 'day' || group === 'channel') && <td className="td text-right tabular-nums text-ink/60">{r.charges ? money(r.charges) : '—'}</td>}
                  <td className="td">
                    {r.has_actual && !r.has_estimates && <StatusBadge tone="success">As charged</StatusBadge>}
                    {r.has_actual && r.has_estimates && <StatusBadge tone="info">Some estimated</StatusBadge>}
                    {!r.has_actual && r.has_estimates && <StatusBadge tone="quiet">Fees estimated</StatusBadge>}
                    {Number(r.unlinked) > 0 && <div className="text-[11px] text-warn mt-1 whitespace-nowrap">{r.unlinked} line{Number(r.unlinked) !== 1 ? 's' : ''} not linked to a listing — no fee</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <EmptyState icon="trend" title="No sales in this period" sub="Change the dates or channel, or import Amazon’s transaction report." />}
        </div>
      )}
      <div className="text-xs text-ink/45 mt-3">
        “As charged” comes from Amazon’s transaction report. Where the report doesn’t cover an order yet, it comes from HELM — what the customer paid — and its fee is
        estimated from the listing’s fee until the next report is imported. Fees are shown without the VAT you reclaim.
      </div>
    </div>
  )
}

function ImportView({ me, showToast, onDone }) {
  const [busy, setBusy] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const input = useRef(null)

  const read = async (file) => {
    setError(null); setResult(null); setParsed(null)
    try {
      const XLSX = await import('xlsx')
      const sheetsOf = (wb) => wb.SheetNames.map(name => ({ name, rows: sheetRows(wb.Sheets[name], XLSX.utils) }))
      // Excel files (TikTok) are read as they are; CSVs as plain text so order numbers and dates stay exactly as written
      const wb = /\.xlsx?$/i.test(file.name)
        ? XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true })
        : XLSX.read(await file.text(), { type: 'string', raw: true })
      const r = readSalesReport(sheetsOf(wb))
      const dates = r.lines.map(l => l.sale_date).sort()
      const by = r.lines.reduce((m, l) => ({ ...m, [l.kind]: (m[l.kind] || 0) + 1 }), {})
      setParsed({ ...r, name: file.name, from: dates[0], to: dates[dates.length - 1], by })
    } catch (e) { setError(e?.message || 'Could not read the file') }
  }
  const run = async () => {
    setBusy({ done: 0, of: parsed.lines.length }); setError(null)
    try {
      const res = await importReportSales(parsed.source, parsed.lines, me?.name || null, (done) => setBusy({ done, of: parsed.lines.length }))
      setResult(res); showToast?.(`Imported — ${res.new.toLocaleString('en-GB')} new lines`)
      setParsed(null)
    } catch (e) { setError(e?.message || 'Import failed') } finally { setBusy(null) }
  }

  return (
    <div className="max-w-[760px]">
      <div className="card">
        <div className="text-sm font-semibold text-ink">Sales and fee reports</div>
        <div className="text-sm text-ink/60 mt-1 mb-3">
          Choose a file and the portal works out which report it is. Any date range works; re-importing a file, or overlapping dates, adds nothing twice.
          Customer names, towns and postcodes in the files are never saved.
        </div>
        <ul className="text-sm text-ink/70 mb-4 space-y-1.5">
          <li><b>Amazon</b> — Seller Central → Payments → Reports Repository → <b>Transaction</b> → download the CSV.</li>
          <li><b>eBay</b> — Seller Hub → Payments → Reports → <b>Transaction report</b> → download the CSV.</li>
          <li><b>TikTok</b> — Seller Centre → Finance → Statements → Export (the <b>Income</b> Excel file). It only holds orders TikTok has settled; the rest stay on HELM’s figures until a later file has them.</li>
        </ul>
        <input ref={input} type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f) }} />
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={!!busy}><Icon name="upload" size={15} /> Choose a report</button>
        {error && <div className="text-sm text-loss mt-3">{error}</div>}
        {parsed && (
          <div className="mt-4 surface-sky p-4">
            <div className="text-sm font-semibold text-ink">{parsed.label} · {parsed.name}</div>
            <div className="text-sm text-ink/70 mt-1">
              {parsed.lines.length.toLocaleString('en-GB')} lines · {parsed.from} to {parsed.to} ·{' '}
              {(parsed.by.sale || 0).toLocaleString('en-GB')} order lines, {parsed.by.refund || 0} refunds, {(parsed.by.charge || 0).toLocaleString('en-GB')} charges and credits
              {parsed.by.transfer ? `, ${parsed.by.transfer} payouts and holds (kept out of sales)` : ''}
            </div>
            <button className="btn btn-primary mt-3" disabled={!!busy} onClick={run}>
              {busy ? `Importing… ${Math.round((busy.done / busy.of) * 100)}%` : 'Import'}
            </button>
          </div>
        )}
        {result && (
          <InfoBox title="Imported">{result.new.toLocaleString('en-GB')} new lines of {result.lines.toLocaleString('en-GB')} in the file — the rest were already in. <button className="underline" onClick={onDone}>See the sales</button></InfoBox>
        )}
      </div>
    </div>
  )
}

const pct1 = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`)

function PnlView({ savedProducts, stockItems, settings, purchaseOrders }) {
  const P = useMemo(periods, [])
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState(START)
  const [to, setTo] = useState(P[0].to)
  const [group, setGroup] = useState('month')
  const [channel, setChannel] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [versions, setVersions] = useState([])
  const [sort, setSort] = useState({ k: 'key', dir: 1 })
  useEffect(() => { loadCostVersions('carrier').then(setVersions).catch(() => setVersions([])) }, [])
  useEffect(() => { const p = P.find(x => x.id === period); if (p?.from) { setFrom(p.from); setTo(p.to) } }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setData(null); setError(null)
    loadPlLines(from, to, channel || null).then(setData).catch(e => setError(e?.message || 'Could not load'))
  }, [from, to, channel])
  useEffect(() => { setSort(['asin', 'listing'].includes(group) ? { k: 'sales', dir: -1 } : { k: 'key', dir: 1 }) }, [group])

  const savedById = useMemo(() => new Map(savedProducts.map(r => [r.id, r])), [savedProducts])
  const worked = useMemo(() => (data && settings ? buildPnl({ lines: data.lines, parcels: data.parcels, bulk: data.bulk || {}, savedById, stockItems, settings, carrierVersions: versions, purchaseOrders }) : null),
    [data, settings, savedById, stockItems, versions, purchaseOrders])
  const rows = useMemo(() => (worked ? groupPnl(worked, group) : null), [worked, group])
  const T = useMemo(() => {
    if (!rows) return null
    const t = rows.reduce((a, r) => { for (const k of ['orders', 'units', 'sales', 'refunds', 'fees', 'cogs', 'shipping', 'packaging', 'profit', 'cogsCurrent', 'shipEstimated', 'shipPallet', 'unlinked', 'lines']) a[k] = (a[k] || 0) + (Number(r[k]) || 0); return a }, {})
    t.charges = Number(data?.amazon_charges) || 0
    t.afterCharges = t.profit + t.charges
    return t
  }, [rows, data])
  const list = useMemo(() => [...(rows || [])].sort((a, b) => {
    const va = a[sort.k], vb = b[sort.k]
    return (typeof va === 'string' || typeof vb === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (Number(va) || 0) - (Number(vb) || 0)) * sort.dir
  }), [rows, sort])
  const label = (r) => group === 'month' ? monthName(r.key) : group === 'day' ? dayName(r.key) : r.key
  const Th = ({ k, children, right = true }) => (
    <th className={`th ${right ? 'text-right' : 'text-left'} cursor-pointer select-none`} onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : (k === 'key' ? 1 : -1) }))}>
      {children}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  const exportCsv = () => {
    const head = ['Group', 'Name', 'Orders', 'Units', 'Sales ex VAT', 'Refunds', 'Fees', 'Product cost', 'Shipping', 'Packaging', 'Profit', 'Margin %']
    const out = list.map(r => [label(r), r.name || '', r.orders, r.units, r.sales, r.refunds, r.fees, r.cogs, r.shipping, r.packaging, r.profit, r.margin == null ? '' : r.margin.toFixed(1)])
    downloadCsv(`pnl-${group}-${from}-to-${to}.csv`, [head, ...out].map(x => x.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'))
  }
  const line = (labelText, v, opts = {}) => (
    <div className={`flex items-center justify-between py-1.5 ${opts.strong ? 'border-t border-rule mt-1 pt-2.5' : ''}`}>
      <span className={`text-sm ${opts.strong ? 'font-semibold text-ink' : 'text-ink/70'}`}>{labelText}{opts.hint && <span className="text-xs text-ink/40 ml-1.5">{opts.hint}</span>}</span>
      <span className={`text-sm tabular-nums ${opts.strong ? 'font-semibold' : ''} ${v < 0 ? 'text-loss' : 'text-ink'}`}>{money(v)}</span>
    </div>
  )

  return (
    <div>
      <div className="filter-bar mb-4 flex-wrap gap-3">
        <SegmentedControl label="Period" items={P.map(p => ({ id: p.id, label: p.label }))} value={period} onChange={setPeriod} />
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input text-sm w-auto" value={from} min={START} max={to} onChange={e => setFrom(e.target.value || START)} aria-label="From" />
            <span className="text-ink/40 text-sm">to</span>
            <input type="date" className="input text-sm w-auto" value={to} min={from} onChange={e => setTo(e.target.value || to)} aria-label="To" />
          </div>
        )}
        <select className="input text-sm w-auto" value={channel} onChange={e => setChannel(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>
          {CHANNELS.map(c => <option key={c} value={c}>{c === 'WooCommerce' ? 'Salt 4 U' : c}</option>)}
        </select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-ink/45">Group by</span>
          <SegmentedControl label="Group by" items={GROUPS} value={group} onChange={setGroup} />
        </div>
      </div>

      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && (!rows || !T) && <div className="surface flex justify-center py-10"><Spinner /></div>}
      {rows && T && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <MetricCard label="Sales ex VAT" value={money(T.sales)} sub={`${T.orders.toLocaleString('en-GB')} orders · ${T.units.toLocaleString('en-GB')} units`} />
            <MetricCard label="Costs" value={money(-(T.cogs + T.shipping + T.packaging) + T.fees + T.refunds)} color="text-loss" sub="Fees, refunds, stock, shipping, packaging" />
            <MetricCard label="Profit before overheads" value={money(T.afterCharges)} prominent color={T.afterCharges >= 0 ? 'text-gain' : 'text-loss'} sub="Incl. Amazon’s other charges and credits" />
            <MetricCard label="Margin" value={pct1(T.sales ? (T.afterCharges / T.sales) * 100 : null)} sub="Of sales ex VAT" />
          </div>

          <div className="grid lg:grid-cols-[360px_1fr] gap-4 mb-4">
            <div className="card">
              <div className="text-sm font-semibold text-ink mb-2">P&L · {from === to ? dayName(from) : `${dayName(from)} – ${dayName(to)}`}</div>
              {line('Sales ex VAT', T.sales)}
              {line('Refunds', T.refunds)}
              {line('Marketplace fees', T.fees, { hint: 'ex VAT' })}
              {line('Amazon other charges & credits', T.charges, { hint: 'subscription, incentives, claims' })}
              {line('Product cost', -T.cogs)}
              {line('Shipping', -T.shipping)}
              {line('Packaging', -T.packaging)}
              {line('Profit before overheads', T.afterCharges, { strong: true })}
              <div className="text-xs text-ink/45 mt-2">Overheads (wages, rent, software…) come in the next release.</div>
            </div>
            <div className="card">
              <div className="text-sm font-semibold text-ink mb-2">How the figures were worked out</div>
              <ul className="text-sm text-ink/70 space-y-1.5">
                <li><b className="text-ink">Product cost</b> — the price paid on the latest purchase order on or before each sale (case price ÷ units in the case).
                  {T.cogsCurrent > 0 && <span className="text-warn"> {T.cogsCurrent.toLocaleString('en-GB')} lines used today’s cost because the product had no PO that early.</span>}</li>
                <li><b className="text-ink">Shipping</b> — from the parcels HELM booked for each order, at the carrier rates on that day (DHL / DPD multi-parcel rules; Evri by the order’s weight).
                  {T.shipPallet > 0 && <span> {T.shipPallet.toLocaleString('en-GB')} bulk order line{T.shipPallet === 1 ? '' : 's'} went by pallet and use Farrall’s price with the fuel surcharge.</span>}
                  {T.shipEstimated > 0 && <span className="text-warn"> {T.shipEstimated.toLocaleString('en-GB')} lines had no parcels in HELM (before 13 Oct, or labelled elsewhere) and use the listing’s shipping.</span>}</li>
                <li><b className="text-ink">Packaging</b> — the listing’s packaging per parcel, at today’s packaging costs <span className="text-warn">(being reviewed — it updates here as soon as they’re corrected)</span>.</li>
                <li><b className="text-ink">Fees</b> — as charged on Amazon’s report; estimated from the listing’s fee where the report isn’t imported yet.</li>
                {T.unlinked > 0 && <li className="text-warn">{T.unlinked.toLocaleString('en-GB')} sold lines aren’t linked to a listing (eBay and TikTok mostly), so they have no product, shipping or packaging cost yet.</li>}
              </ul>
            </div>
          </div>

          <div className="table-shell overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule">
              <div className="text-xs text-ink/50">{list.length} row{list.length !== 1 ? 's' : ''}</div>
              <button className="btn btn-secondary btn-xs" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={13} /> Export CSV</button>
            </div>
            <table className="w-full min-w-[1120px] border-collapse">
              <thead className="table-head">
                <tr>
                  <Th k="key" right={false}>{GROUPS.find(g => g.id === group)?.label}</Th>
                  <Th k="orders">Orders</Th><Th k="units">Units</Th><Th k="sales">Sales ex VAT</Th><Th k="refunds">Refunds</Th><Th k="fees">Fees</Th>
                  <Th k="cogs">Product cost</Th><Th k="shipping">Shipping</Th><Th k="packaging">Packaging</Th><Th k="profit">Profit</Th><Th k="margin">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.key} className="table-row">
                    <td className="td">
                      {group === 'listing' ? (
                        <div className="min-w-[240px]">
                          <div className="text-sm font-semibold text-ink">{r.key}</div>
                          <div className="text-xs text-ink/45 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {r.listing_id ? <ListingLink id={r.listing_id} name={r.name} /> : <span className="text-warn">No listing for this SKU</span>}
                            {r.asin && <AmazonLink asin={r.asin} label={r.asin} />}
                          </div>
                        </div>
                      ) : group === 'asin' ? (
                        <div className="min-w-[220px]">
                          <div className="text-sm font-semibold text-ink flex items-center gap-2">{r.key}<AmazonLink asin={r.key} /></div>
                          {r.name && <div className="text-xs text-ink/45 mt-0.5 truncate max-w-[320px]">{r.name}</div>}
                        </div>
                      ) : <span className="text-sm font-semibold text-ink whitespace-nowrap">{label(r)}</span>}
                      {(r.cogsCurrent > 0 || r.shipEstimated > 0 || r.unlinked > 0) && (
                        <div className="text-[11px] text-ink/45 mt-1">
                          {[r.unlinked > 0 && `${r.unlinked} not linked`, r.cogsCurrent > 0 && `${r.cogsCurrent} at today’s cost`, r.shipEstimated > 0 && `${r.shipEstimated} shipping estimated`].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="td text-right tabular-nums">{r.orders.toLocaleString('en-GB')}</td>
                    <td className="td text-right tabular-nums">{r.units.toLocaleString('en-GB')}</td>
                    <td className="td text-right tabular-nums font-medium">{money(r.sales)}</td>
                    <td className="td text-right tabular-nums text-loss">{r.refunds ? money(r.refunds) : '—'}</td>
                    <td className="td text-right tabular-nums text-loss">{money(r.fees)}</td>
                    <td className="td text-right tabular-nums text-loss">{money(-r.cogs)}</td>
                    <td className="td text-right tabular-nums text-loss">{money(-r.shipping)}</td>
                    <td className="td text-right tabular-nums text-loss">{money(-r.packaging)}</td>
                    <td className={`td text-right tabular-nums font-semibold ${r.profit >= 0 ? 'text-gain' : 'text-loss'}`}>{money(r.profit)}</td>
                    <td className={`td text-right tabular-nums ${r.margin != null && r.margin < 10 ? 'text-loss' : 'text-ink'}`}>{pct1(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <EmptyState icon="trend" title="No sales in this period" sub="Change the dates or channel." />}
          </div>
          {group !== 'month' && group !== 'day' && group !== 'channel' && T.charges !== 0 && (
            <div className="text-xs text-ink/45 mt-3">Amazon’s other charges and credits ({money(T.charges)}) aren’t part of any one listing, so they’re in the totals above but not in these rows.</div>
          )}
        </>
      )}
    </div>
  )
}
