import React, { useMemo, useState } from 'react'
import { Modal, Icon } from './UI'
import SkuField from './SkuField'
import { itemSetSku } from '../lib/db'

/**
 * Approving a listing means we're going to order its products, so any product without our SKU gets one
 * now — suggested in the house style, always editable. Products never approved never get a SKU.
 */
export default function SkuPrompt({ items, listingName, stockItems = [], me, onCancel, onDone }) {
  const [codes, setCodes] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  // SKUs given to products not stocked yet count too, so two new products can't share one
  const extra = useMemo(() => stockItems.filter(si => (si.data?.sku || '').trim()).map(si => ({ code: si.data.sku, name: si.name })), [stockItems])
  const all = items.every(si => (codes[si.id] || '').trim())

  const save = async () => {
    setBusy(true); const errs = {}
    for (const si of items) {
      try { await itemSetSku(si.id, codes[si.id].trim(), me?.name) } catch (e) { errs[si.id] = e.message }
    }
    setErrors(errs); setBusy(false)
    if (!Object.keys(errs).length) onDone()
  }

  return (
    <Modal title={items.length === 1 ? 'Give it its SKU' : `Give ${items.length} products their SKUs`}
      description={`Approving ${listingName} means it’ll be ordered, so ${items.length === 1 ? 'its product needs' : 'its products need'} our SKU.`}
      onClose={onCancel} maxWidth="max-w-lg">
      <div className="space-y-4">
        {items.map(si => (
          <div key={si.id}>
            <div className="text-sm text-ink font-medium leading-snug mb-1">{si.name}</div>
            <SkuField id={`sp-${si.id}`} label="SKU — brand, type, scent or colour, size, pack" name={si.name} brand={si.data?.brand || ''}
              value={codes[si.id] || ''} onChange={(v) => setCodes(x => ({ ...x, [si.id]: v }))} check stockItemId={si.id} extra={extra} />
            {errors[si.id] && <div className="text-xs text-loss mt-1">{errors[si.id]}</div>}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1 justify-center" onClick={onCancel}>Not now</button>
          <button className="btn btn-primary flex-1 justify-center" disabled={busy || !all} onClick={save}>
            <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save and approve'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
