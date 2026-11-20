import React, { useEffect, useState } from 'react'
import { Icon } from './UI'
import { ProductSearch } from './InventoryParts'
import { loadProductPicker } from '../lib/db'

export const MANUAL_REASONS = [['replacement', 'Replacement'], ['manual', 'Manual order'], ['other', 'Other']]
// 'order' (v2.94.0): the parcel IS an order — confirmed from HELM or Amazon's slip — so it is a sale, not a replacement
export const reasonLabel = (r) => (r === 'order' ? 'Order' : (MANUAL_REASONS.find(([v]) => v === r) || MANUAL_REASONS[0])[1])

// Inventory's products, loaded once per visit (every live product: SKU, name, stock)
let cache = null
export function useInventoryProducts() {
  const [products, setProducts] = useState([])
  useEffect(() => {
    let live = true
    ;(cache ||= loadProductPicker().catch(e => { cache = null; throw e }))
      .then(rows => live && setProducts(rows || [])).catch(() => {})
    return () => { live = false }
  }, [])
  return products
}

/**
 * What a label with no packing slip is: one or more products from Inventory, how many of each, and why
 * it's going out. Products are chosen by our own SKU, so the stamp and the stock come from Inventory —
 * never typed. value: { items: [{ code, name, qty }], reason, note, originalRef }
 */
/** `ask` (v2.94.0, Dispatch's upload review only): why it is going out is not assumed — the person must choose. */
export function ManualPicker({ value, onChange, products, id = 'mp', ask = false }) {
  const v = value || {}
  const items = v.items || []
  const set = (patch) => onChange({ ...(ask ? {} : { reason: 'replacement' }), ...v, ...patch, mapping: null })
  const setQty = (k, qty) => set({ items: items.map((it, j) => (j === k ? { ...it, qty } : it)) })
  const add = (p) => {
    const at = items.findIndex(it => it.code === p.code)
    if (at >= 0) setQty(at, String((parseInt(items[at].qty, 10) || 0) + 1))
    else set({ items: [...items, { code: p.code, name: p.name, qty: '1' }] })
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="border border-rule rounded-[6px] bg-white divide-y divide-rule/70">
          {items.map((it, k) => {
            const bad = !(parseInt(it.qty, 10) > 0) || String(parseInt(it.qty, 10)) !== String(it.qty).trim()
            return (
              <div key={`${it.code}-${k}`} className="flex items-center gap-2 px-3 py-2">
                <input type="number" min="1" step="1" inputMode="numeric" aria-label={`How many ${it.name || it.code}`}
                  className={`input text-base sm:text-sm w-[64px] tabular-nums ${bad ? 'border-loss' : ''}`}
                  value={it.qty} onChange={e => setQty(k, e.target.value)} />
                <span className="text-ink/45 text-sm">×</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink leading-snug">{it.name || it.code}</div>
                  <div className="text-[11px] text-ink/45 tabular-nums">{it.code}</div>
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${it.name || it.code}`}
                  onClick={() => set({ items: items.filter((_, j) => j !== k) })}><Icon name="close" size={15} /></button>
              </div>
            )
          })}
        </div>
      )}
      <ProductSearch products={products} onPick={add} id={`${id}-search`}
        placeholder={items.length ? 'Add another product in the same parcel' : 'Which product? Name or Product SKU'} />
      <div className="flex gap-2 flex-wrap">
        <select className={`input text-base sm:text-sm w-auto ${ask && !v.reason && items.length ? 'border-loss' : ''}`} value={ask ? (v.reason || '') : (v.reason || 'replacement')} aria-label="Why it's going out"
          onChange={e => set({ reason: e.target.value })}>
          {ask && <option value="" disabled>Why is it going out? Choose…</option>}
          {ask && <option value="order">An order (give its number)</option>}
          {MANUAL_REASONS.map(([r, l]) => <option key={r} value={r}>{ask && r === 'manual' ? 'Manual order (a sample, a gift…)' : l}</option>)}
        </select>
      </div>
    </div>
  )
}
