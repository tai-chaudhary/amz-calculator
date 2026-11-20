import React, { createContext, useContext, useMemo, useRef, useState } from 'react'
import { smartFilter, hay } from '../lib/match'
import { supplierForName } from '../lib/proposals'
import { Icon } from './UI'

/**
 * Pick the supplier from your Suppliers list instead of typing it (v2.73.2), so one company is never saved under
 * three spellings ("Pricecheck", "PriceCheck", "Price Check"). Typing searches names and their aliases; a name that
 * isn't there yet can be added as a new supplier on the spot — like adding a product to a listing.
 * The app provides the list and the way to add one (CompaniesProvider).
 */
const Companies = createContext({ suppliers: [], addSupplier: null })
export const CompaniesProvider = Companies.Provider

const isStock = (s) => !(s.data?.kinds?.length) || s.data.kinds.includes('stock')

export default function SupplierPicker({ value = '', onChange, label = 'Supplier', id = 'supplier-picker', placeholder = 'Search your suppliers…', compact = false }) {
  const { suppliers = [], addSupplier } = useContext(Companies)
  const [query, setQuery] = useState(null)        // null = not typing; shows the chosen value
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  const stock = useMemo(() => suppliers.filter(isStock), [suppliers])
  const known = supplierForName(value, suppliers)
  const text = query ?? value
  const options = useMemo(() => (query == null ? [] : (query.trim()
    ? smartFilter(stock, query, s => hay(s.name, s.data?.aliases || []))
    : stock).slice(0, 8)), [query, stock])
  const exact = query != null && supplierForName(query, suppliers)

  const choose = (s) => { onChange(s.name); setQuery(null) }
  const addNew = async () => {
    const name = (query || '').trim()
    if (!name || !addSupplier || busy) return
    setBusy(true)
    try { const row = await addSupplier(name); if (row?.name) choose(row) } finally { setBusy(false) }
  }
  // Leaving the box: a typed alias becomes the supplier's real name; anything else stays as typed (flagged below)
  const onBlur = (e) => {
    if (box.current?.contains(e.relatedTarget)) return
    if (query != null) { const m = supplierForName(query, suppliers); onChange(m ? m.name : query.trim()); setQuery(null) }
  }

  return (
    <div ref={box} className="relative" onBlur={onBlur}>
      {label && <label className="label" htmlFor={id}>{label}</label>}
      <div className="relative">
        <input id={id} type="text" autoComplete="off" className={`input ${compact ? 'text-sm' : 'text-base sm:text-sm'} pr-8`}
          value={text} placeholder={placeholder}
          onFocus={() => setQuery(value || '')} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setQuery(null); e.currentTarget.blur() }
            if (e.key === 'Enter') { e.preventDefault(); if (options[0]) choose(exact || options[0]); else addNew() }
          }} />
        {known && query == null && <Icon name="check" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gain" />}
      </div>
      {query == null && value && !known && (
        <div className="text-xs text-warn mt-1">“{value}” isn’t in your suppliers — pick one, or add it as a new supplier.</div>
      )}
      {query != null && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-rule rounded-[6px] shadow-lg overflow-hidden">
          {options.map(s => (
            <button key={s.id} type="button" className="w-full text-left px-3 py-2 hover:bg-royal-50 border-b border-rule/60 last:border-0"
              onMouseDown={e => e.preventDefault()} onClick={() => choose(s)}>
              <div className="text-sm font-medium text-ink">{s.name}</div>
              {(s.data?.aliases || []).filter(a => a.toLowerCase() !== s.name.toLowerCase()).length > 0 && (
                <div className="text-xs text-ink/45 truncate">Also: {(s.data.aliases || []).filter(a => a.toLowerCase() !== s.name.toLowerCase()).join(', ')}</div>
              )}
            </button>
          ))}
          {!options.length && <div className="px-3 py-2 text-sm text-ink/50">No supplier matches “{query.trim()}”.</div>}
          {query.trim() && !exact && addSupplier && (
            <button type="button" className="w-full text-left px-3 py-2 bg-paper hover:bg-royal-50 text-sm font-medium text-royal-600 disabled:opacity-60"
              disabled={busy} onMouseDown={e => e.preventDefault()} onClick={addNew}>
              {busy ? 'Adding…' : `+ Add “${query.trim()}” as a new supplier`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
