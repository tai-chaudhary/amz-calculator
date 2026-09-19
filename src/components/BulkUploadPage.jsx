import React, { useState, useRef } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { CSV_COLUMNS, generateTemplateCsv, generateAiBrief, downloadCsv, downloadText, parseCsv, rowsToProducts } from '../lib/csv'
import { ProductImage } from './UI'

export default function BulkUploadPage({ settings, stockItems = [], onBulkImport }) {
  const [parsed, setParsed] = useState(null)      // { products, errors }
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [showTemplate, setShowTemplate] = useState(false)
  const [globalPushLive, setGlobalPushLive] = useState(false)
  const [globalReview, setGlobalReview] = useState(false)
  const [rowFlags, setRowFlags] = useState({})     // { line: { live: bool, review: bool } }
  const fileRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    const rows = parseCsv(text)
    const result = rowsToProducts(rows, settings)
    setParsed(result)
    // Seed per-row flags from the CSV itself
    const flags = {}
    result.products.forEach(p => {
      flags[p._line] = { live: p._pushLive, review: p._sendReview }
    })
    setRowFlags(flags)
    setProgress(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const setFlag = (line, key, val) => {
    setRowFlags(f => ({ ...f, [line]: { ...f[line], [key]: val } }))
  }

  const applyGlobal = (key, val) => {
    if (key === 'live') setGlobalPushLive(val)
    else setGlobalReview(val)
    setRowFlags(f => {
      const next = { ...f }
      Object.keys(next).forEach(line => { next[line] = { ...next[line], [key]: val } })
      return next
    })
  }

  const handleImport = async () => {
    if (!parsed?.products.length) return
    setImporting(true)
    const toImport = parsed.products.map(p => {
      const flags = rowFlags[p._line] || {}
      const { _line, _pushLive, _sendReview, ...clean } = p
      return {
        product: { ...clean, reviewStatus: flags.review ? 'review' : 'none' },
        pushLive: !!flags.live,
      }
    })
    await onBulkImport(toImport, (done, total) => setProgress({ done, total }))
    setImporting(false)
    setParsed(null)
    setFileName('')
    setRowFlags({})
    setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const reset = () => {
    setParsed(null); setFileName(''); setRowFlags({}); setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const liveCount = Object.values(rowFlags).filter(f => f.live).length
  const reviewCount = Object.values(rowFlags).filter(f => f.review).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Bulk Upload</h1>
          <p className="text-sm text-ink/50 mt-1">
            Import many products at once from a CSV file. Hand the template <em>and</em> the filling
            instructions to whoever is completing it — the instructions contain your exact carrier
            and packaging names.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowTemplate(t => !t)}>
            {showTemplate ? 'Hide' : 'View'} field guide
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => downloadText('how-to-fill-the-template.txt', generateAiBrief(settings))}>
            📋 Filling instructions
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => downloadCsv('product-upload-template.csv', generateTemplateCsv())}>
            ⬇ Download template
          </button>
        </div>
      </div>

      {/* Field guide */}
      {showTemplate && (
        <div className="card mb-5">
          <div className="font-semibold text-sm text-ink mb-3">Template fields</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th className="text-left py-2 text-xs font-semibold text-ink/45">Column</th>
                  <th className="text-left py-2 text-xs font-semibold text-ink/45">Required</th>
                  <th className="text-left py-2 text-xs font-semibold text-ink/45">Example</th>
                  <th className="text-left py-2 text-xs font-semibold text-ink/45">Notes</th>
                </tr>
              </thead>
              <tbody>
                {CSV_COLUMNS.map(c => (
                  <tr key={c.key} className="border-b border-rule/60">
                    <td className="py-2 font-medium text-ink/80">{c.label}</td>
                    <td className="py-2">
                      {c.required
                        ? <span className="text-xs font-semibold text-loss">Required</span>
                        : <span className="text-xs text-ink/30">Optional</span>}
                    </td>
                    <td className="py-2 text-ink/55 text-xs font-mono">{c.example || '—'}</td>
                    <td className="py-2 text-ink/45 text-xs">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-ink/45 mt-3 bg-paper rounded-lg p-3">
            Carrier, Carrier Category and Packaging must match exactly what's set up in Settings, otherwise those fields are left blank and you can fill them in later. Product images are pulled from Amazon automatically using the ASIN.
          </div>
        </div>
      )}

      {/* Upload zone */}
      {!parsed && (
        <div
          className="card border-2 border-dashed border-rule hover:border-royal-300 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-4xl mb-3">📤</div>
            <div className="font-medium text-ink/80 mb-1">Drop your CSV here, or click to browse</div>
            <div className="text-sm text-ink/45">Download the template above if you haven't got one yet</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {/* Preview */}
      {parsed && (
        <>
          <div className="card mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="font-semibold text-ink">{fileName}</div>
                <div className="text-sm text-ink/50 mt-1">
                  {parsed.products.length} product{parsed.products.length !== 1 ? 's' : ''} ready
                  {liveCount > 0 && ` · ${liveCount} to push live`}
                  {reviewCount > 0 && ` · ${reviewCount} to review`}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={reset}>Choose another file</button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={importing || parsed.products.length === 0}
                >
                  {importing
                    ? (progress ? `Importing ${progress.done}/${progress.total}…` : 'Importing…')
                    : `Import ${parsed.products.length} product${parsed.products.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>

            {/* Bulk toggles */}
            {parsed.products.length > 0 && (
              <div className="flex gap-4 mt-4 pt-4 border-t border-rule flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink/70">
                  <input type="checkbox" className="w-4 h-4 accent-gain"
                    checked={globalPushLive} onChange={e => applyGlobal('live', e.target.checked)} />
                  🚀 Push all live on import
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink/70">
                  <input type="checkbox" className="w-4 h-4 accent-warn"
                    checked={globalReview} onChange={e => applyGlobal('review', e.target.checked)} />
                  🔍 Send all to review
                </label>
              </div>
            )}
          </div>

          {/* Errors */}
          {parsed.errors.length > 0 && (
            <div className="card mb-4 border border-warn/25 bg-warn/5">
              <div className="font-semibold text-sm text-warn mb-2">
                {parsed.errors.length} issue{parsed.errors.length !== 1 ? 's' : ''} found
              </div>
              <ul className="text-xs text-warn space-y-1 max-h-40 overflow-y-auto">
                {parsed.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          {/* Product preview table */}
          {parsed.products.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper">
                      <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Product</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Sell</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Cost</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Profit</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Margin</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-ink/45">Live</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-ink/45">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.products.map(p => {
                      const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
                      const flags = rowFlags[p._line] || {}
                      const isBundle = parseInt(p.bundleQty) > 1
                      return (
                        <tr key={p._line} className="border-b border-rule/60 hover:bg-paper">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-lg border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                                <ProductImage asin={p.asin} alt={p.name} className="object-contain w-full h-full p-0.5" placeholderSize="text-base" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-ink truncate" style={{maxWidth: 260}}>{p.name}</div>
                                <div className="text-xs text-ink/45 flex gap-1.5 flex-wrap">
                                  {p.brand && <span>{p.brand}</span>}
                                  {p.asin && <span>· {p.asin}</span>}
                                  {isBundle && <span className="text-royal-500">· Bundle ×{p.bundleQty}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-ink/70">{fmt(r.sellPrice)}</td>
                          <td className="px-3 py-2 text-right text-ink/70">{fmt(r.costPrice)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${r.margin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(r.margin)}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="w-4 h-4 accent-gain cursor-pointer"
                              checked={!!flags.live} onChange={e => setFlag(p._line, 'live', e.target.checked)} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="w-4 h-4 accent-warn cursor-pointer"
                              checked={!!flags.review} onChange={e => setFlag(p._line, 'review', e.target.checked)} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
