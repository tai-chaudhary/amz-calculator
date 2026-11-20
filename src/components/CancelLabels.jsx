import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Icon, Spinner, WarnBox } from './UI'
import { cancelDispatchLabels } from '../lib/db'

const REASONS = ['Uploaded by mistake', 'Customer cancelled', 'Label made again', 'Something else']
const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`

/**
 * Cancel labels: one order, a few, or a whole batch. Nothing is deleted — the labels stay on
 * record with who and why, stop holding stock, and the order can be uploaded again. An order with
 * any label already dispatched is left alone (its stock has come off). The database checks who's
 * allowed (public.can_cancel_labels()); this sheet is only shown to them.
 *
 * Give it `labels` (rows from dispatch_labels) or `loadLabels` (async, for a whole batch).
 */
export default function CancelLabels({ title, description, labels: given = null, loadLabels = null, me, showToast, onLog, onClose, onDone }) {
  const [labels, setLabels] = useState(given)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (given || !loadLabels) return
    loadLabels().then(setLabels).catch(() => setLabels([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Whole orders: an order is never half cancelled
  const orders = useMemo(() => {
    const m = new Map()
    for (const l of labels || []) {
      if (l.status === 'cancelled') continue
      const k = `${l.upload_id}|${l.order_key || l.id}`
      if (!m.has(k)) m.set(k, { key: k, ref: l.channel_ref || l.helm_order || l.label_ref || '—', labels: [] })
      m.get(k).labels.push(l)
    }
    return [...m.values()].map(o => ({
      ...o,
      gone: o.labels.some(l => l.status === 'dispatched'),
      printed: o.labels.some(l => l.printed_at || l.batch?.printed_at),
    }))
  }, [labels])
  const toCancel = orders.filter(o => !o.gone)
  const gone = orders.length - toCancel.length
  const printed = toCancel.filter(o => o.printed).length
  const why = reason === 'Something else' ? note.trim() : reason
  const who = me?.name || me?.display_name || ''

  const run = async () => {
    setBusy(true)
    try {
      const r = await cancelDispatchLabels(toCancel.flatMap(o => o.labels.map(l => l.id)), why, who)
      onLog?.({ entity_type: 'dispatch', entity_name: `${plural(r?.orders ?? toCancel.length, 'order')} cancelled`, action: 'Cancelled',
        detail: `${why} · ${toCancel.map(o => o.ref).slice(0, 30).join(', ')}${toCancel.length > 30 ? '…' : ''}`, source: 'dispatch' })
      showToast?.(`${plural(r?.orders ?? toCancel.length, 'order')} cancelled${r?.skipped ? ` · ${r.skipped} already dispatched, left as they are` : ''}`)
      onDone?.()
    } catch (e) {
      showToast?.(`Couldn't cancel — ${e?.message || 'try again'}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <Modal title={title} description={description} onClose={onClose}>
      {labels === null ? <Spinner /> : toCancel.length === 0 ? (
        <>
          <div className="text-sm text-ink/70">
            {gone ? 'Everything here has already been dispatched, so it can’t be cancelled.' : 'Nothing left to cancel here.'}
          </div>
          <button className="btn btn-secondary w-full justify-center mt-4" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <div className="text-sm text-ink">
            <b>{plural(toCancel.length, 'order')}</b> ({plural(toCancel.reduce((s, o) => s + o.labels.length, 0), 'label')}) will come out of
            {' '}{toCancel.length === 1 ? 'its batch' : 'their batches'}. {toCancel.length === 1 ? 'It stops' : 'They stop'} holding stock, and can be uploaded again.
          </div>
          {toCancel.length <= 6 && (
            <div className="text-xs text-ink/50 mt-1.5 tabular-nums">{toCancel.map(o => o.ref).join(', ')}</div>
          )}
          {gone > 0 && (
            <div className="text-xs text-ink/55 mt-2">{plural(gone, 'order')} already dispatched — left as {gone === 1 ? 'it is' : 'they are'}.</div>
          )}
          {printed > 0 && (
            <WarnBox title={`${plural(printed, 'label')} already printed`}>Bin the printed {printed === 1 ? 'label' : 'labels'} so {printed === 1 ? 'it isn’t' : 'they aren’t'} sent by mistake.</WarnBox>
          )}

          <div className="label mt-4">Why?</div>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`btn btn-sm justify-center py-2.5 sm:py-2 ${reason === r ? 'btn-primary' : 'btn-secondary'}`}>{r}</button>
            ))}
          </div>
          {reason === 'Something else' && (
            <input className="input text-base sm:text-sm mt-2" autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="Say what happened" />
          )}
          <div className="text-xs text-ink/50 mt-3">
            This doesn’t change anything in HELM or Amazon. If the carrier label was bought, cancel it there too.
          </div>

          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Keep</button>
            <button className="btn btn-danger flex-1 justify-center py-3 sm:py-2" disabled={busy || !why || !who} onClick={run}>
              <Icon name="close" size={14} /> {busy ? 'Cancelling…' : `Cancel ${plural(toCancel.length, 'order')}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
