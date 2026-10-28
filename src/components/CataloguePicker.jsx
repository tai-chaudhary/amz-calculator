import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Icon, SearchInput, Spinner, Flag } from './UI'
import { searchCatalogue } from '../lib/db'
import { smartFilter, matchScore } from '../lib/match'
import { fmt } from '../lib/calc'

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Find in price list (PO, Oct 2026): search the suppliers' price lists — this supplier's first — and add a line
 * with its name, SKU, barcode, case size and price. Already in Products (same barcode or supplier SKU, or the
 * same name): it's linked, and a price different from what we last paid is flagged. Not in Products: one tap
 * adds it there too, so it's found straight away next time and its price history starts.
 */
export default function CataloguePicker({ supplier, stockItems = [], onAdd, onCreateProduct, onClose }) {
  const [q, setQ] = useState('')
  const [onlyThem, setOnlyThem] = useState(!!supplier)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [addToProducts, setAddToProducts] = useState(true)
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return }
    setLoading(true)
    const t = setTimeout(() => searchCatalogue(q.trim(), onlyThem ? supplier?.id : null)
      .then(r => setRows(smartFilter(r, q, x => `${x.data?.brand || ''} ${x.name} ${x.supplier_sku || ''} ${x.barcode || ''}`, { closest: true, fillTo: 60 })))
      .catch(() => setRows([])).finally(() => setLoading(false)), 300)
    return () => clearTimeout(t)
  }, [q, onlyThem, supplier?.id])

  const live = useMemo(() => stockItems.filter(si => !si.data?.archived), [stockItems])
  const matchOf = (r) => {
    const bc = norm(r.barcode), sku = norm(r.supplier_sku)
    return live.find(si => (bc && norm(si.data?.barcode) === bc) || (sku && (norm(si.data?.supplierSku) === sku ||
      (si.data?.suppliers || []).some(x => norm(x.supplierSku) === sku)))) ||
      live.find(si => { const m = matchScore(si.name, r.name); return m.all && m.score >= 0.95 })
  }

  const pick = async (r) => {
    const caseSize = Math.max(1, parseInt(r.data?.caseSize, 10) || 1)
    let si = matchOf(r)
    setBusy(r.id)
    try {
      if (!si && addToProducts && onCreateProduct) {
        si = await onCreateProduct({ name: r.name, supplierSku: r.supplier_sku || '', costPrice: String(r.unit_cost || ''), barcode: r.barcode || '',
          weightKg: r.data?.weightKg || '', supplierName: r.supplier_name || supplier?.name || '', brand: r.data?.brand || '' })
      }
      onAdd({
        stock_item_id: si?.id || null, name: si?.name || r.name, supplier_sku: r.supplier_sku || '',
        qty: caseSize, unit_cost: Number(r.unit_cost) || 0,
        line_note: caseSize > 1 ? `Sold in cases of ${caseSize}` : null,
        data: { fromCatalogue: r.id, barcode: r.barcode || null, caseSize, systemCost: si ? Number(si.data?.costPrice) || null : null },
      })
    } finally { setBusy(null) }
  }

  return (
    <Modal title="Find in price list" description="Search the suppliers' price lists by name, brand, SKU or barcode. Picking one adds the line with its price and case size." onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. scola poster paint black, or a barcode" className="flex-1 min-w-[220px]" autoFocus />
          {supplier && (
            <label className="inline-flex items-center gap-2 text-sm text-ink/70">
              <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={onlyThem} onChange={e => setOnlyThem(e.target.checked)} /> Only {supplier.name}
            </label>
          )}
          {onCreateProduct && (
            <label className="inline-flex items-center gap-2 text-sm text-ink/70" title="Lines not in Products yet are added there too">
              <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={addToProducts} onChange={e => setAddToProducts(e.target.checked)} /> Also add new ones to Products
            </label>
          )}
        </div>
        {loading && <Spinner />}
        {!loading && q.trim().length >= 2 && !rows.length && <div className="text-sm text-ink/55 py-4 text-center">Nothing in {onlyThem && supplier ? `${supplier.name}'s` : 'the'} price list{onlyThem && supplier ? ' — try all suppliers' : 's'}.</div>}
        <div className="border border-rule rounded-[6px] divide-y divide-rule/70 max-h-[55vh] overflow-y-auto bg-white">
          {rows.map(r => {
            const si = matchOf(r)
            const caseSize = Math.max(1, parseInt(r.data?.caseSize, 10) || 1)
            const last = si ? Number(si.data?.costPrice) || null : null
            const diff = last && r.unit_cost ? Math.round(((Number(r.unit_cost) - last) / last) * 100) : null
            const out = r.data?.available === false || (r.data?.flags || []).includes('out of stock') || r.data?.stock === 0
            return (
              <div key={r.id} className="px-3 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink font-medium leading-snug">{r.name}</div>
                  <div className="text-[11px] text-ink/50">{[r.supplier_name, r.data?.brand, r.supplier_sku && `SKU ${r.supplier_sku}`, r.barcode].filter(Boolean).join(' · ')}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {si ? <Flag tone="green" icon="check">In Products</Flag> : <Flag tone="grey">New to Products</Flag>}
                    {caseSize > 1 && <Flag tone="blue">Case of {caseSize}</Flag>}
                    {out && <Flag tone="red">Out of stock at supplier</Flag>}
                    {diff != null && Math.abs(diff) >= 3 && <Flag tone={diff > 0 ? 'amber' : 'green'}>{diff > 0 ? '+' : ''}{diff}% vs last paid {fmt(last)}</Flag>}
                    {r.list_date && <span className="text-[11px] text-ink/40">list {new Date(r.list_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{fmt(Number(r.unit_cost) || 0)}</div>
                    {caseSize > 1 && <div className="text-[11px] text-ink/45">{fmt((Number(r.unit_cost) || 0) * caseSize)} a case</div>}
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => pick(r)}><Icon name="plus" size={13} /> {busy === r.id ? 'Adding…' : 'Add'}</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
