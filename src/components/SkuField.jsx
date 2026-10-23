import React, { useEffect, useMemo, useRef, useState } from 'react'
import { learnSkus, suggestSku } from '../lib/skuSuggest'
import { useInventoryProducts } from './ManualParcel'
import { itemSkuOwner } from '../lib/db'

/**
 * Our SKU, suggested in the house style (BRAND-TYPE-VARIANT-SIZE-PACK, codes reused from SKUs we already
 * have) and kept following the name until someone types their own. With check, it also says straight
 * away if another product already has that SKU (office only — the database checks again on save).
 * suggest = false keeps the SKU it was given (a product that already has one) and only offers the suggestion.
 * extra: more SKUs to learn from, e.g. [{ code, name }] from Products entries not stocked yet.
 */
const NONE = []

export default function SkuField({ id = 'sku', label = 'SKU', name, brand = '', value, onChange, check = false, stockItemId = null, extra = NONE, disabled = false, suggest = true }) {
  const products = useInventoryProducts()
  const learned = useMemo(() => learnSkus([...products, ...extra]), [products, extra])
  const { sku: suggested, notes } = useMemo(() => suggestSku(name, { brand, learned }), [name, brand, learned])
  // Only fills itself in when there's no real SKU yet (suggest); otherwise it just offers the suggestion
  const touched = useRef(!suggest)
  useEffect(() => { if (!touched.current && suggested !== value) onChange(suggested) }, [suggested]) // eslint-disable-line react-hooks/exhaustive-deps

  const [owner, setOwner] = useState(null)
  useEffect(() => {
    if (!check || !value?.trim()) { setOwner(null); return }
    const t = setTimeout(() => itemSkuOwner(value.trim(), stockItemId).then(setOwner).catch(() => setOwner(null)), 350)
    return () => clearTimeout(t)
  }, [value, check, stockItemId])

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} className={`input text-base sm:text-sm uppercase font-mono flex-1 ${owner ? 'border-loss' : ''}`} value={value || ''} disabled={disabled}
          autoComplete="off" onChange={e => { touched.current = true; onChange(e.target.value.toUpperCase()) }} />
        {touched.current && value !== suggested && suggested && !disabled && (
          <button type="button" className="btn btn-ghost btn-sm" title={suggested} onClick={() => { touched.current = false; onChange(suggested) }}>Suggest</button>
        )}
      </div>
      {owner && <div className="text-xs text-loss mt-1">Already the SKU of {owner}</div>}
      {!owner && notes.map(n => <div key={n} className="text-xs text-warn mt-1">{n}</div>)}
    </div>
  )
}
