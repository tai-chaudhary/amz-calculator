import React, { useState, useMemo } from 'react'
import { fmt, componentCost, componentWeight } from '../lib/calc'
import { ProductImage } from './UI'

/**
 * Lets a listing be built from products. Handles searching existing items
 * and creating a brand new one inline, without leaving the calculator.
 */
export default function ComponentPicker({ components = [], stockItems, onChange, onCreateStockItem, asin }) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', costPrice: '', weightKg: '', supplierName: '', supplierSku: '', brand: '' })

  const chosenIds = new Set(components.map(c => c.stockItemId))

  const matches = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return stockItems
      .filter(si => !chosenIds.has(si.id) && !si.data?.archived)
      .filter(si => {
        const d = si.data || {}
        return si.name.toLowerCase().includes(q) ||
          (d.supplierSku || '').toLowerCase().includes(q) ||
          (d.supplierName || '').toLowerCase().includes(q) ||
          (d.brand || '').toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [search, stockItems, components])

  const add = (stockItemId) => {
    onChange([...components, { stockItemId, qty: 1 }])
    setSearch('')
  }

  const setQty = (i, qty) => {
    const next = [...components]
    next[i] = { ...next[i], qty: Math.max(1, parseInt(qty) || 1) }
    onChange(next)
  }

  const remove = (i) => onChange(components.filter((_, n) => n !== i))

  const handleCreate = async () => {
    if (!newItem.name.trim() || busy) return
    setBusy(true)
    const created = await onCreateStockItem({ ...newItem, name: newItem.name.trim() })
    setBusy(false)
    if (created?.id) {
      onChange([...components, { stockItemId: created.id, qty: 1 }])
      setNewItem({ name: '', costPrice: '', weightKg: '', supplierName: '', supplierSku: '', brand: '' })
      setCreating(false)
      setSearch('')
    }
  }

  const totalCost = componentCost({ components }, stockItems) || 0
  const totalWeight = componentWeight({ components }, stockItems) || 0
  const totalUnits = components.reduce((s, c) => s + (parseInt(c.qty) || 0), 0)
  const distinct = components.length

  return (
    <div className="p-3 bg-royal-50 border border-royal-100 rounded-[6px]">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-xs font-semibold text-ink/70">
          What's in this listing
        </span>
        {components.length > 0 && (
          <span className="text-xs text-ink/55">
            {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
            {distinct > 1 && ` across ${distinct} products`}
          </span>
        )}
      </div>

      {/* Chosen components */}
      {components.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {components.map((c, i) => {
            const si = stockItems.find(s => s.id === c.stockItemId)
            const d = si?.data || {}
            const unit = parseFloat(d.costPrice) || 0
            const line = unit * (parseInt(c.qty) || 0)
            return (
              <div key={i} className="flex items-center gap-2 bg-white rounded-[5px] px-2.5 py-2 border border-rule">
                <div className="w-8 h-8 rounded border border-rule flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <ProductImage asin={asin} alt="" className="object-contain w-full h-full p-0.5" placeholderSize="text-xs" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {si ? si.name : <span className="text-loss">Missing product</span>}
                  </div>
                  <div className="text-xs text-ink/45">
                    {fmt(unit)} each
                    {d.supplierSku && ` · ${d.supplierSku}`}
                    {(parseFloat(d.weightKg) || 0) > 0 && ` · ${(parseFloat(d.weightKg) || 0).toFixed(3)}kg`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs text-ink/45">×</span>
                  <input
                    type="number" min="1"
                    className="input text-sm text-center py-1"
                    style={{ width: 56 }}
                    value={c.qty}
                    onChange={e => setQty(i, e.target.value)}
                  />
                  <span className="text-sm font-medium text-ink/80 text-right" style={{ minWidth: 58 }}>{fmt(line)}</span>
                  <button className="text-ink/30 hover:text-loss px-1" onClick={() => remove(i)} title="Remove">✕</button>
                </div>
              </div>
            )
          })}

          <div className="flex justify-between items-center px-2.5 pt-1.5 border-t border-royal-200">
            <span className="text-sm font-medium text-ink/80">Total product cost</span>
            <div className="text-right">
              <span className="font-semibold text-ink">{fmt(totalCost)}</span>
              {totalWeight > 0 && <span className="text-xs text-ink/45 ml-2">{totalWeight.toFixed(3)}kg</span>}
            </div>
          </div>
        </div>
      )}

      {/* Search / add */}
      {!creating && (
        <div className="relative">
          <input
            type="text"
            className="input text-sm"
            placeholder={components.length ? 'Add another product…' : 'Search your products…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {search.trim() && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-rule rounded-[6px] shadow-lg overflow-hidden">
              {matches.map(si => {
                const d = si.data || {}
                return (
                  <button
                    key={si.id}
                    className="w-full text-left px-3 py-2 hover:bg-royal-50 border-b border-rule/60 last:border-0"
                    onClick={() => add(si.id)}
                  >
                    <div className="text-sm font-medium text-ink">{si.name}</div>
                    <div className="text-xs text-ink/45">
                      {fmt(parseFloat(d.costPrice) || 0)}
                      {d.supplierName && ` · ${d.supplierName}`}
                      {d.supplierSku && ` · ${d.supplierSku}`}
                    </div>
                  </button>
                )
              })}
              <button
                className="w-full text-left px-3 py-2 bg-paper hover:bg-royal-50 text-sm font-medium text-royal-600"
                onClick={() => { setNewItem(n => ({ ...n, name: search.trim() })); setCreating(true) }}
              >
                + Create "{search.trim()}" as a new product
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inline creation */}
      {creating && (
        <div className="bg-white border border-royal-200 rounded-[6px] p-3">
          <div className="text-xs font-semibold text-ink/70 mb-2">New product</div>
          <div className="space-y-2">
            <input className="input text-sm" placeholder="Product name" autoFocus
              value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Unit cost £</label>
                <input type="number" step="0.0001" className="input text-sm" placeholder="0.00"
                  value={newItem.costPrice} onChange={e => setNewItem(n => ({ ...n, costPrice: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs">Unit weight kg</label>
                <input type="number" step="0.001" className="input text-sm" placeholder="0.000"
                  value={newItem.weightKg} onChange={e => setNewItem(n => ({ ...n, weightKg: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input text-sm" placeholder="Supplier"
                value={newItem.supplierName} onChange={e => setNewItem(n => ({ ...n, supplierName: e.target.value }))} />
              <input className="input text-sm" placeholder="Supplier SKU"
                value={newItem.supplierSku} onChange={e => setNewItem(n => ({ ...n, supplierSku: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm flex-1 justify-center"
                onClick={handleCreate} disabled={!newItem.name.trim() || busy}>
                {busy ? 'Creating…' : 'Create & add'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {components.length === 0 && !creating && (
        <div className="text-xs text-ink/55 mt-2">
          Link this listing to the products you buy, so a supplier price change updates it automatically.
          A single item is one product × 1; a 3-pack is one × 3; a mixed bundle is several.
        </div>
      )}
    </div>
  )
}
