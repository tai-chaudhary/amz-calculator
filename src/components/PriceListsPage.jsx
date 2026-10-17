import React, { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { parsePriceList, dateFromFileName, FORMATS } from '../lib/priceLists'
import { fmt } from '../lib/calc'
import { Icon, PageHeader, StatusBadge } from './UI'
import OnlineSuppliers from './OnlineSuppliers'

const SOURCES = {
  list: 'Sends a price list',
  online: 'Online ordering',
  manual: 'Manual only',
}

export default function PriceListsPage({ suppliers, imports, catalogueStats = [], onImport, onUpdateSupplier, syncStatus = { states: [], runs: [] }, onSyncNow }) {
  // Product counts come from the database, not from downloading the catalogue
  const counts = Object.fromEntries(catalogueStats.map(s => [s.supplier_id, Number(s.products)]))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const [tab, setTab] = useState('import')
  return (
    <div>
      <PageHeader
        eyebrow="Sourcing / suppliers"
        title="Suppliers & price lists"
        description="Import each supplier's price list to keep costs current. Changes to products you already sell go to Proposed Changes for approval."
        meta={`${suppliers.length} suppliers · ${total.toLocaleString()} products on file`}
      />
      <div className="flex gap-1 mb-5 p-1 bg-ink/5 rounded-lg w-fit">
        <button className={`tab ${tab === 'import' ? 'tab-active' : ''}`} onClick={() => setTab('import')}>Import a price list</button>
        <button className={`tab ${tab === 'online' ? 'tab-active' : ''}`} onClick={() => setTab('online')}>Online suppliers</button>
        <button className={`tab ${tab === 'suppliers' ? 'tab-active' : ''}`} onClick={() => setTab('suppliers')}>Supplier terms</button>
      </div>
      {tab === 'import' && <ImportPanel suppliers={suppliers} imports={imports} onImport={onImport} />}
      {tab === 'online' && <OnlineSuppliers suppliers={suppliers} counts={counts} syncStatus={syncStatus} onSyncNow={onSyncNow} onUpdateSupplier={onUpdateSupplier} />}
      {tab === 'suppliers' && <SupplierTerms suppliers={suppliers} counts={counts} onUpdate={onUpdateSupplier} />}
    </div>
  )
}

/* ── Import ────────────────────────────────────────────────────────────── */

export function ImportPanel({ suppliers, imports, onImport }) {
  const fileRef = useRef(null)
  const [parsed, setParsed] = useState(null)
  const [supplierId, setSupplierId] = useState('')
  const [listDate, setListDate] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)

  const readFile = async (file) => {
    if (!file) return
    setError(''); setParsed(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const r = parsePriceList(XLSX, wb)
      if (!r.format) {
        setError("This doesn't match a price list format the portal knows yet (Pricecheck, Sian or Daler-Rowney). Send it over and it can be added.")
        return
      }
      const sup = suppliers.find(s => s.name === FORMATS[r.format].supplier)
      setSupplierId(sup?.id || '')
      setListDate(dateFromFileName(file.name) || new Date().toISOString().slice(0, 10))
      setParsed({ ...r, fileName: file.name })
    } catch (e) {
      setError('Could not read that file. Is it an Excel or CSV export?')
    }
  }

  const doImport = async () => {
    const supplier = suppliers.find(s => s.id === supplierId)
    if (!supplier || !parsed) return
    setProgress({ done: 0, total: parsed.rows.length })
    await onImport({ supplier, rows: parsed.rows, listDate, fileName: parsed.fileName },
      (done, total) => setProgress({ done, total }))
    setProgress(null); setParsed(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const flagCounts = {}
  ;(parsed?.rows || []).forEach(r => (r.data.flags || []).forEach(f => { flagCounts[f] = (flagCounts[f] || 0) + 1 }))
  const withBarcode = (parsed?.rows || []).filter(r => r.barcode).length
  const excluded = (parsed?.rows || []).filter(r => r.data.excluded).length

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div className="card">
        {!parsed ? (
          <div
            className="border-2 border-dashed border-rule rounded-card py-12 text-center cursor-pointer hover:border-royal-300 transition-colors" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (() => fileRef.current?.click())() } }} onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}
          >
            <Icon name="upload" size={28} />
            <div className="font-semibold text-ink mt-2">Drop a supplier price list here</div>
            <div className="text-sm text-ink/50 mt-1">Excel or CSV — the supplier is recognised automatically</div>
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={e => readFile(e.target.files?.[0])} />
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="font-semibold text-ink">{parsed.fileName}</div>
                <div className="text-sm text-ink/50 mt-0.5">Recognised as a {FORMATS[parsed.format].label} list</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = '' }}>
                Choose another file
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Products" value={parsed.rows.length.toLocaleString()} />
              <Stat label="With barcode" value={`${Math.round(withBarcode / Math.max(1, parsed.rows.length) * 100)}%`} />
              <Stat label="Excluded" value={excluded} tone={excluded ? 'text-warn' : ''} />
              <Stat label="Rows skipped" value={parsed.skipped} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="label">Supplier</label>
                <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">Choose…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Price list date</label>
                <input type="date" className="input" value={listDate} onChange={e => setListDate(e.target.value)} />
              </div>
            </div>

            {Object.keys(flagCounts).length > 0 && (
              <div className="mb-4">
                <div className="label">Flagged in this list</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([f, n]) => (
                    <StatusBadge key={f} tone={/pharmacy|discontinued|wrong/.test(f) ? 'alert' : 'quiet'}>{n} {f}</StatusBadge>
                  ))}
                </div>
                {excluded > 0 && (
                  <div className="text-[13px] text-ink/50 mt-2">
                    Pharmacy-only medicines are stored but excluded from product hunting — they can't be sold without a pharmacist.
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-primary w-full justify-center" disabled={!supplierId || !!progress} onClick={doImport}>
              {progress
                ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…`
                : `Import ${parsed.rows.length.toLocaleString()} products`}
            </button>
            <div className="text-[13px] text-ink/50 mt-2 text-center">
              Nothing on your existing products changes — any differences are raised as proposals for you to approve.
            </div>
          </div>
        )}
        {error && <div className="mt-3 text-sm text-loss">{error}</div>}
      </div>

      <div className="card">
        <div className="font-semibold text-ink mb-3">Recent imports</div>
        {imports.length === 0 ? (
          <div className="text-sm text-ink/50">No price lists imported yet.</div>
        ) : (
          <div className="space-y-2.5">
            {imports.slice(0, 12).map(im => {
              const sup = suppliers.find(s => s.id === im.supplier_id)
              const sm = im.summary || {}
              return (
                <div key={im.id} className="text-sm border-b border-rule/60 pb-2.5 last:border-0">
                  <div className="font-medium text-ink">{sup?.name || 'Supplier'}</div>
                  <div className="text-[13px] text-ink/50">
                    {(sm.products || 0).toLocaleString()} products
                    {im.list_date ? ` · list dated ${new Date(im.list_date).toLocaleDateString('en-GB')}` : ''}
                  </div>
                  <div className="text-[13px] text-ink/50">
                    {sm.proposals ? `${sm.proposals} change${sm.proposals !== 1 ? 's' : ''} proposed` : 'No changes needed'}
                    {' · '}{new Date(im.created_at).toLocaleDateString('en-GB')}
                    {im.imported_by ? ` by ${im.imported_by}` : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Supplier terms ────────────────────────────────────────────────────── */

function SupplierTerms({ suppliers, counts = {}, onUpdate }) {
  return (
    <div className="card-flush overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-paper border-b border-rule">
              <th className="th text-left px-5">Supplier</th>
              <th className="th text-left px-3">How they sell</th>
              <th className="th text-right px-3">Minimum order</th>
              <th className="th text-right px-3">Delivery</th>
              <th className="th text-right px-3">Lead time</th>
              <th className="th text-right px-3">Products on file</th>
              <th className="th px-5"></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => <SupplierRow key={s.id} s={s} count={counts[s.id] || 0} onUpdate={onUpdate} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SupplierRow({ s, count, onUpdate }) {
  const d = s.data || {}
  const [form, setForm] = useState({ moq: d.moq ?? '', delivery: d.delivery ?? 0, leadDays: d.leadDays ?? '', source: d.source || 'online' })
  const changed = String(form.moq) !== String(d.moq ?? '') || String(form.delivery) !== String(d.delivery ?? 0) ||
    String(form.leadDays) !== String(d.leadDays ?? '') || form.source !== (d.source || 'online')
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const save = () => onUpdate(s.id, {
    ...d, source: form.source,
    moq: parseFloat(form.moq) || 0, delivery: parseFloat(form.delivery) || 0, leadDays: parseInt(form.leadDays) || 0,
  })
  return (
    <tr className="border-b border-rule/60">
      <td className="td px-5">
        <div className="font-medium text-ink">{s.name}</div>
        {d.website && <a className="text-xs text-royal-500 hover:underline" href={d.website} target="_blank" rel="noopener noreferrer">{d.website.replace(/^https?:\/\//, '')} ↗</a>}
      </td>
      <td className="td px-3">
        <select className="input py-1.5 text-sm w-full sm:w-[170px]" value={form.source} onChange={set('source')}>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className="td px-3 text-right">
        <div className="inline-flex items-center gap-1">£<input type="number" className="input py-1.5 text-sm text-right w-full sm:w-[90px]" value={form.moq} onChange={set('moq')} /></div>
      </td>
      <td className="td px-3 text-right">
        <div className="inline-flex items-center gap-1">£<input type="number" step="0.01" className="input py-1.5 text-sm text-right w-full sm:w-[80px]" value={form.delivery} onChange={set('delivery')} /></div>
      </td>
      <td className="td px-3 text-right">
        <div className="inline-flex items-center gap-1"><input type="number" className="input py-1.5 text-sm text-right w-full sm:w-[60px]" value={form.leadDays} onChange={set('leadDays')} /> days</div>
      </td>
      <td className="td px-3 text-right text-ink/60">{count ? count.toLocaleString() : '—'}</td>
      <td className="td px-5 text-right">
        {changed && <button className="btn btn-primary btn-xs" onClick={save}>Save</button>}
      </td>
    </tr>
  )
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-lg ${tone}`}>{value}</div>
    </div>
  )
}
