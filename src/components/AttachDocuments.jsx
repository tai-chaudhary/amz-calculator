import React, { useState, useMemo, useRef } from 'react'
import { fmt } from '../lib/calc'
import { isCredit } from '../lib/purchases'
import { Drawer, Icon, StatusBadge, EmptyState } from './UI'

/**
 * Filing a pile of invoices at once. Drop them all in; each is matched to its
 * order by the file name, then by the invoice number inside it. Anything that
 * can't be matched is left for you to place by hand — nothing is guessed.
 */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function matchFile(fileName, orders) {
  const n = norm(fileName)
  // The file it was imported from, if we know it
  const exact = orders.find(o => o.data?.sourceFile && norm(o.data.sourceFile) === n)
  if (exact) return { po: exact, how: 'file name' }
  // Otherwise the invoice number appearing in the file name (longest first,
  // so INV-13822 wins over a short number that happens to be inside it)
  const byRef = orders
    .filter(o => o.invoice_number && norm(o.invoice_number).length >= 4 && n.includes(norm(o.invoice_number)))
    .sort((a, b) => norm(b.invoice_number).length - norm(a.invoice_number).length)[0]
  if (byRef) return { po: byRef, how: 'invoice number' }
  return { po: null, how: null }
}

export default function AttachDocuments({ orders, onClose, onAttach }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [errors, setErrors] = useState([])
  const inputRef = useRef(null)

  const needing = useMemo(() => orders.filter(o =>
    !o.invoice_path && !o.data?.noDocumentNeeded && !['draft', 'cancelled'].includes(o.status)), [orders])

  const take = (files) => {
    const list = [...files].map(file => {
      const { po, how } = matchFile(file.name, orders)
      return { file, poId: po?.id || '', how, replacing: !!po?.invoice_path }
    })
    setRows(prev => {
      const seen = new Set(prev.map(r => r.file.name))
      return [...prev, ...list.filter(r => !seen.has(r.file.name))]
    })
  }

  const matched = rows.filter(r => r.poId)
  const unmatched = rows.filter(r => !r.poId)

  const upload = async () => {
    setBusy(true); setErrors([]); setDone(0)
    let n = 0
    for (const r of matched) {
      const po = orders.find(o => o.id === r.poId)
      try {
        await onAttach(po, r.file)
        n++; setDone(n)
      } catch (e) {
        setErrors(errs => [...errs, `${r.file.name}: ${e?.message || 'failed'}`])
      }
    }
    setBusy(false)
    setRows(rows.filter(r => !r.poId))
  }

  return (
    <Drawer title="Attach invoices" width="max-w-3xl"
      description={`${needing.length} order${needing.length !== 1 ? 's' : ''} without a document on file`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-ink/60">
            {rows.length === 0 ? 'Drop the files in above.'
              : `${matched.length} matched${unmatched.length ? `, ${unmatched.length} need placing` : ''}`}
            {busy && ` · uploading ${done} of ${matched.length}`}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Close</button>
            <button className="btn btn-primary btn-sm" disabled={busy || matched.length === 0} onClick={upload}>
              <Icon name="upload" size={14} /> {busy ? `Uploading… ${done}/${matched.length}` : `Attach ${matched.length} file${matched.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      }>

      <div role="button" tabIndex={0} aria-label="Choose invoice files"
        className="border-2 border-dashed border-rule rounded-card py-10 text-center cursor-pointer hover:border-royal-300 transition-colors mb-4"
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); take(e.dataTransfer.files) }}>
        <Icon name="upload" size={24} className="text-royal-400 mx-auto" />
        <div className="text-sm font-medium text-ink mt-2">Drop all your invoices here</div>
        <div className="text-xs text-ink/50 mt-1">PDFs or photos — they’re matched to their orders automatically</div>
        <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
          onChange={e => { take(e.target.files); e.target.value = '' }} />
      </div>

      {errors.length > 0 && (
        <div className="panel-notice mb-4 text-sm text-loss">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>
      )}

      {rows.length === 0 ? (
        needing.length === 0
          ? <EmptyState icon="check" title="Every order has its paperwork" />
          : (
            <div>
              <div className="text-xs font-semibold text-ink/55 mb-2">Still waiting for a document</div>
              <div className="card-flush overflow-hidden">
                {needing.slice(0, 40).map(o => (
                  <div key={o.id} className="px-4 py-2 border-b border-rule/60 last:border-0 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <b className="text-ink">{o.po_number}</b>
                      <span className="text-ink/60"> · {o.supplier_name}{o.invoice_number ? ` · ${o.invoice_number}` : ''}</span>
                      {o.data?.sourceFile && <span className="block text-xs text-ink/45 truncate">expects {o.data.sourceFile}</span>}
                    </span>
                    <span className="text-ink/70 flex-shrink-0">{fmt(o.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.file.name} className="flex items-center gap-3 p-2.5 rounded-lg border border-rule bg-white">
              <Icon name={r.poId ? 'check' : 'alert'} size={15} className={r.poId ? 'text-gain' : 'text-warn'} />
              <span className="text-sm text-ink truncate flex-1 min-w-0" title={r.file.name}>{r.file.name}</span>
              <select className="input w-full sm:w-[300px] text-sm" value={r.poId} aria-label={`Order for ${r.file.name}`}
                onChange={e => setRows(list => list.map((x, j) => j === i ? { ...x, poId: e.target.value, how: 'you chose' } : x))}>
                <option value="">Not matched — choose an order</option>
                {orders.filter(o => !['draft', 'cancelled'].includes(o.status)).map(o => (
                  <option key={o.id} value={o.id}>
                    {o.po_number} · {o.supplier_name} · {o.invoice_number || 'no invoice no.'} · {fmt(o.total)}{o.invoice_path ? ' (has one)' : ''}
                  </option>
                ))}
              </select>
              {r.how && <StatusBadge tone={r.how === 'you chose' ? 'brand' : 'live'}>{r.how}</StatusBadge>}
              <button className="btn btn-xs btn-secondary" aria-label={`Remove ${r.file.name}`}
                onClick={() => setRows(list => list.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
            </div>
          ))}
          {matched.some(r => r.replacing) && (
            <div className="text-xs text-warn pt-1">Some of these orders already have a document — attaching will replace it.</div>
          )}
        </div>
      )}
    </Drawer>
  )
}
