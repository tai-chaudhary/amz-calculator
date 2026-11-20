import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, EmptyState, Flag, Spinner, Icon, InfoBox } from './UI'
import { importReportSales, refreshCosting, loadReportUploads, logReportUpload, saveOrderDistricts } from '../lib/db'
import { readSalesReport, sheetRows } from '../lib/salesImport'
import { fmtDate } from '../lib/dates'
import { dayName, int, Tile } from './FinanceParts'

/**
 * Finance → Uploads (a page of its own since v2.84.0; the "Import reports" tab of Reports before): the weekly
 * channel reports, and a log of what was uploaded and when (migration 109: report_uploads).
 *
 * The file is read in the browser; only order lines, fees and charges are saved — never a customer's name, town or
 * postcode. Re-uploading a file, or overlapping dates, adds nothing twice. After an upload the costing reruns, so the
 * P&L's cost of goods sold covers the new sales.
 */
const SOURCES = {
  amazon_report: { channel: 'Amazon', report: 'Transaction report' },
  ebay_report: { channel: 'eBay', report: 'Transaction report' },
  tiktok_report: { channel: 'TikTok', report: 'Income report' },
  amazon_returns: { channel: 'Amazon', report: 'Returns report (uploaded on the Returns page)' },
}
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '-').replace(',', '')
const daysAgo = (date, today) => Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${date}T12:00:00Z`)) / 86400000)

export default function UploadsPage({ me, showToast, onNavigate }) {
  const [busy, setBusy] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [log, setLog] = useState(null)
  const [logError, setLogError] = useState(null)
  const input = useRef(null)

  const loadLog = useCallback(() => loadReportUploads().then(d => { setLog(d); setLogError(null) }).catch(e => setLogError(e?.message || 'Could not load the log')), [])
  useEffect(() => { loadLog() }, [loadLog])

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
    const p = parsed
    setBusy({ done: 0, of: p.lines.length }); setError(null)
    try {
      const res = await importReportSales(p.source, p.lines, me?.name || null, (done) => setBusy({ done, of: p.lines.length }))
      setResult(res); showToast?.(`Uploaded — ${res.new.toLocaleString('en-GB')} new lines`)
      setParsed(null)
      // The log is a record of what was done: the lines are in whether or not this line is written
      await logReportUpload({ source: p.source, file: p.name, from: p.from, to: p.to, lines: res.lines, added: res.new, by: me?.name || null })
      // v2.109.0: each order's postcode district (the first half only), for the carriers' remote-zone prices. Never stops the upload
      if (p.districts && Object.keys(p.districts).length) await saveOrderDistricts(p.districts).catch(() => {})
      loadLog()
      // New sales need costing before the P&L can show their real cost of goods sold. It runs in the background; if it
      // fails, tonight's run picks them up (they are estimated until then, and counted on the P&L).
      if (res.new > 0) refreshCosting().then(() => showToast?.('Costs recalculated for the new sales')).catch(() => {})
    } catch (e) { setError(e?.message || 'Upload failed') } finally { setBusy(null) }
  }

  const today = log?.today
  const covered = Object.entries(SOURCES).map(([source, s]) => ({ source, ...s, ...(log?.covered || []).find(c => c.source === source) }))

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Finance / weekly reports" title="Uploads"
        description="The channels’ own reports give the exact fees, refunds and charges. Until a report covers an order, the P&L uses HELM’s figures with the fee estimated from the listing." />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        <div className="lg:col-span-7 bg-white border border-rule rounded-card px-5 py-4">
          <div className="text-sm font-semibold text-ink">Upload a report</div>
          <div className="text-sm text-ink/60 mt-1 mb-3">
            Choose a file and the portal works out which report it is. Any date range works; uploading a file again, or overlapping dates, adds nothing twice.
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
                {parsed.lines.length.toLocaleString('en-GB')} lines · {fmtDate(parsed.from)} to {fmtDate(parsed.to)} ·{' '}
                {(parsed.by.sale || 0).toLocaleString('en-GB')} order lines, {parsed.by.refund || 0} refunds, {(parsed.by.charge || 0).toLocaleString('en-GB')} charges and credits
                {parsed.by.transfer ? `, ${parsed.by.transfer} payouts and holds (kept out of sales)` : ''}
              </div>
              <button className="btn btn-primary mt-3" disabled={!!busy} onClick={run}>
                {busy ? `Uploading… ${Math.round((busy.done / busy.of) * 100)}%` : 'Upload'}
              </button>
            </div>
          )}
          {result && (
            <InfoBox title="Uploaded">{result.new.toLocaleString('en-GB')} new lines of {result.lines.toLocaleString('en-GB')} in the file — the rest were already in.{' '}
              {onNavigate && <button className="underline" onClick={() => onNavigate('pnl')}>See the Profit &amp; Loss</button>}</InfoBox>
          )}
        </div>

        <Tile label="How far each report reaches" right="Latest order in an uploaded report" className="lg:col-span-5">
          {!log && !logError && <div className="flex justify-center py-6"><Spinner /></div>}
          {log && covered.map(c => {
            const ago = c.to && today ? daysAgo(c.to, today) : null
            return (
              <div key={c.source} className="flex items-center justify-between gap-3 py-2.5 border-t border-rule/70 first:border-t-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{c.channel}</div>
                  <div className="text-xs text-ink/50">{c.report}{c.lines ? ` · ${int(c.lines)} order lines` : ''}</div>
                </div>
                <div className="text-right">
                  {c.to ? <div className="text-sm tabular-nums text-ink">{dayName(c.to)}</div> : <div className="text-sm text-ink/50">Never uploaded</div>}
                  {ago != null && <div className="mt-0.5"><Flag tone={ago <= 7 ? 'green' : ago <= 14 ? 'amber' : 'red'}>{ago <= 0 ? 'Up to today' : ago === 1 ? 'Up to yesterday' : `${ago} days behind`}</Flag></div>}
                </div>
              </div>
            )
          })}
          <div className="text-xs text-ink/45 mt-auto pt-3 leading-relaxed">Orders after these dates show on the P&L with estimated fees until the next upload. TikTok’s file only has orders it has settled, so it runs about a month behind.</div>
        </Tile>
      </div>

      <div className="table-shell overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-rule text-sm font-semibold text-ink">Upload log</div>
        {logError && <div className="p-4 text-sm text-loss">{logError}</div>}
        {!log && !logError && <div className="flex justify-center py-10"><Spinner /></div>}
        {log && (
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="table-head">
              <tr>
                <th className="th text-left pl-4">Uploaded</th><th className="th text-left">By</th><th className="th text-left">Report</th>
                <th className="th text-left">Dates in the file</th><th className="th text-right">Lines</th><th className="th text-right">New</th><th className="th text-left pr-4">File</th>
              </tr>
            </thead>
            <tbody>
              {log.uploads.map(u => (
                <tr key={u.id} className="table-row">
                  <td className="td pl-4 whitespace-nowrap tabular-nums">{when(u.uploaded_at)}</td>
                  <td className="td">{u.uploaded_by || '—'}</td>
                  <td className="td"><span className="font-semibold text-ink">{SOURCES[u.source]?.channel || u.source}</span> <span className="text-ink/55">{SOURCES[u.source]?.report}</span></td>
                  <td className="td whitespace-nowrap tabular-nums">{u.date_from ? `${fmtDate(u.date_from)} to ${fmtDate(u.date_to)}` : '—'}</td>
                  <td className="td text-right tabular-nums">{int(u.lines)}</td>
                  <td className="td text-right tabular-nums font-semibold">{int(u.new_lines)}</td>
                  <td className="td pr-4 text-ink/60 max-w-[280px] truncate" title={u.file_name || ''}>{u.file_name || <span className="text-ink/40">Before the log began</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {log && !log.uploads.length && <EmptyState icon="upload" title="Nothing uploaded yet" sub="Choose a report above. Each upload is listed here with who did it and when." />}
      </div>
    </div>
  )
}
