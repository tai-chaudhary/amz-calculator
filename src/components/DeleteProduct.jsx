import React, { useEffect, useState } from 'react'
import { Modal, Icon, Spinner, WarnBox } from './UI'
import { invDeleteProduct } from '../lib/db'
import { forgetCandidates } from './VerifyCode'
import { fmtUnits } from '../lib/inventory'

const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`

/**
 * Admins only (the database checks too). Asks the database first what deleting would do, says it plainly,
 * then does it: gone completely (no history), out of Inventory with its history kept (it had stock
 * before), or refused while stock is still on a shelf.
 */
export default function DeleteProduct({ p, me, showToast, onClose, onDone }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { invDeleteProduct(p.id, me?.name, true).then(setPlan).catch(e => setError(e.message)) }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true)
    try {
      const r = await invDeleteProduct(p.id, me?.name)
      forgetCandidates()
      showToast?.(r.outcome === 'deleted' ? `${p.name} deleted` : `${p.name} taken out of Inventory — its history is kept`)
      onDone?.()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal title="Delete this product?" description={`${p.name} · ${p.code}`} onClose={onClose}>
      {!plan && !error ? <Spinner /> : (
        <div className="space-y-3 text-sm text-ink">
          {plan?.outcome === 'blocked' && (
            <div>It still has <b>{fmtUnits(plan.on_hand)}</b> in stock, so it can’t be deleted. Move the stock to the right product, or count it to 0, first.</div>
          )}
          {plan?.outcome === 'deleted' && <div>It has never had any stock, so it’ll be <b>deleted completely</b>.</div>}
          {plan?.outcome === 'archived' && (
            <div>It’s had stock before, so it’ll be <b>taken out of Inventory</b> and its history kept. Its SKU ({plan.code}) is freed, so that code can be linked to the right product.</div>
          )}
          {plan && plan.outcome !== 'blocked' && (plan.links > 0 || plan.open_orders > 0) && (
            <WarnBox title="Orders will wait">
              {plan.links > 0 && <>{plural(plan.links, 'item code')} verified as this product will need verifying again. </>}
              {plan.open_orders > 0 && <>{plural(plan.open_orders, 'open order')} with its code {plan.open_orders === 1 ? 'is' : 'are'} already in a batch: the stamp stays, but no stock comes off until the code is linked.</>}
            </WarnBox>
          )}
          {error && <div className="text-loss">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Keep it</button>
            {plan?.outcome !== 'blocked' && (
              <button className="btn btn-danger flex-1 justify-center py-3 sm:py-2" disabled={busy || !plan} onClick={run}>
                <Icon name="trash" size={14} /> {busy ? 'Deleting…' : 'Delete product'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
