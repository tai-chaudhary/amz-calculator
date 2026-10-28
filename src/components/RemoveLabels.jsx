import React, { useState, useEffect } from 'react'
import { Modal, Icon, SearchInput, EmptyState, Spinner, Flag, SegmentedControl } from './UI'
import { removeHeldLabels, loadRemovedLabels } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'

export const REMOVE_KINDS = [
  { id: 'packing_slip', label: 'Packing slip', hint: 'Not a label — e.g. Amazon’s own packing slip uploaded with it' },
  { id: 'customer_cancelled', label: 'Customer cancelled' },
  { id: 'wrong_label', label: 'Wrong label' },
  { id: 'other', label: 'Other' },
]
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * Remove labels from On hold, with a reason. Nothing is deleted: each one is marked removed with who, when
 * and why, and can be seen (page included) in Removed labels.
 */
export function RemoveHeld({ labels = [], preset = '', me, showToast, onLog, onClose, onDone }) {
  const [kind, setKind] = useState(preset)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const orders = new Set(labels.map(l => `${l.upload_id}|${l.order_key || l.id}`)).size
  const chosen = REMOVE_KINDS.find(k => k.id === kind)
  const why = kind === 'other' ? note.trim() : [chosen?.label, note.trim()].filter(Boolean).join(' — ')
  return (
    <Modal title={`Remove ${plural(labels.length, 'page')} from On hold?`} onClose={onClose}
      description={`${plural(orders, 'order')}. Nothing is deleted — they're kept in Removed labels with who removed them and why.`}>
      <div className="space-y-3">
        <div className="label">Why?</div>
        <div className="grid grid-cols-2 gap-2">
          {REMOVE_KINDS.map(k => (
            <button key={k.id} className={`btn btn-sm justify-center py-2.5 ${kind === k.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        {chosen?.hint && <div className="text-xs text-ink/55">{chosen.hint}</div>}
        <div>
          <label className="label" htmlFor="rm-note">{kind === 'other' ? 'Say why' : 'Anything to add (optional)'}</label>
          <input id="rm-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)}
            placeholder={kind === 'other' ? 'e.g. duplicate of a label already sent' : ''} />
        </div>
        <button className="btn btn-danger w-full justify-center" disabled={busy || !kind || !why} onClick={async () => {
          setBusy(true)
          try {
            const n = await removeHeldLabels(labels.map(l => l.id), kind, why, me?.name || me?.display_name || 'Someone')
            onLog?.({ entity_type: 'dispatch', entity_name: `${plural(n || labels.length, 'label')} removed from hold`, action: 'Removed', detail: why, source: 'dispatch' })
            showToast?.(`${plural(n || labels.length, 'page')} removed — ${chosen?.label}`)
            onDone?.()
          } catch (e) { showToast?.(`Couldn't remove — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
        }}>{busy ? 'Removing…' : `Remove ${plural(labels.length, 'page')}`}</button>
      </div>
    </Modal>
  )
}

/** What's been removed or cancelled: who, when, why, and the page itself. */
export function RemovedLog({ onClose, renderPreview }) {
  const [rows, setRows] = useState(null)
  const [days, setDays] = useState('30')
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => { setRows(null); loadRemovedLabels(Number(days)).then(setRows).catch(() => setRows([])) }, [days])
  const kindOf = (l) => l.removed_kind || 'cancelled'
  const labelOf = (k) => REMOVE_KINDS.find(x => x.id === k)?.label || 'Cancelled'
  const list = smartFilter((rows || []).filter(l => kind === 'all' || kindOf(l) === kind), q,
    l => hay(l.customer, l.postcode, l.channel_ref, l.helm_order, l.tracking, l.label_name, l.hold_reason, l.cancelled_by_name, l.batch?.code), { keepOrder: true })
  const exportCsv = () => exportRowsToCsv(stampedName('removed-labels'), list, [
    { header: 'Removed', value: l => l.cancelled_at?.slice(0, 16).replace('T', ' ') }, { header: 'By', value: l => l.cancelled_by_name || '' },
    { header: 'Type', value: l => labelOf(kindOf(l)) }, { header: 'Reason', value: l => l.hold_reason || '' },
    { header: 'Was', value: l => l.removed_from || '' }, { header: 'Batch', value: l => l.batch?.code || '' },
    { header: 'Order', value: l => l.channel_ref || l.helm_order || '' }, { header: 'Page', value: l => (l.page_index ?? 0) + 1 },
  ])
  return (
    <Modal title="Removed labels" description="Everything taken off On hold or cancelled, with who, when and why." onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <SegmentedControl value={days} onChange={setDays} label="Period" items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />
          <select className="input text-sm sm:w-[170px]" value={kind} onChange={e => setKind(e.target.value)} aria-label="Type">
            <option value="all">All types</option>
            {REMOVE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            <option value="cancelled">Cancelled (not from hold)</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} /> Export</button>
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Order, customer, reason, who…" className="w-full sm:w-56 sm:ml-auto" />
        </div>
        {!rows ? <Spinner /> : !list.length ? <EmptyState icon="check" title="Nothing removed" sub="Nothing in this period." /> : (
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 max-h-[60vh] overflow-y-auto bg-white">
            {list.map(l => (
              <div key={l.id}>
                <button className="w-full text-left px-3 py-2.5 hover:bg-paper" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm text-ink font-medium">{l.channel_ref || l.helm_order || l.customer || 'No reference'}
                      <span className="text-xs text-ink/45 font-normal"> · {l.batch?.code || '—'} · page {(l.page_index ?? 0) + 1}</span></span>
                    <Flag tone={kindOf(l) === 'packing_slip' ? 'blue' : kindOf(l) === 'cancelled' ? 'grey' : 'amber'}>{labelOf(kindOf(l))}</Flag>
                  </div>
                  <div className="text-xs text-ink/60 mt-0.5">{l.hold_reason || '—'}</div>
                  <div className="text-[11px] text-ink/40">{l.cancelled_by_name || 'Someone'} · {new Date(l.cancelled_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{l.removed_from ? ` · was ${l.removed_from === 'held' ? 'on hold' : l.removed_from}` : ''}</div>
                </button>
                {open === l.id && renderPreview && <div className="px-3 pb-3">{renderPreview(l)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
