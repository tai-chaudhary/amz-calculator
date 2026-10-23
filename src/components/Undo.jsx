import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Icon, Spinner, EmptyState } from './UI'
import { loadUndoable, undoAction } from '../lib/db'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const THING = {
  dispatch_labels: 'label', dispatch_batches: 'batch', dispatch_uploads: 'upload', dispatch_substitutes: 'substitute',
  dispatch_collections: 'collection', inv_movements: 'stock movement', inv_damages: 'damage', inv_tasks: 'task',
  inv_products: 'inventory product', goods_in_deliveries: 'delivery', stock_requests: 'stock request',
  purchase_orders: 'purchase order', purchase_order_items: 'order line', claims: 'claim', complaints: 'complaint',
  returns: 'return', stock_items: 'product', saved_products: 'listing', live_products: 'live listing', suppliers: 'supplier',
}
const STATUS_WORD = { dispatched: 'Dispatched', ready: 'Back to waiting', held: 'Put on hold', cancelled: 'Cancelled / removed', printed: 'Printed' }

/** One action in plain words: "Dispatched 40 labels", "Logged 1 substitute", "Moved stock (2 movements)". */
export function describeAction(a) {
  const parts = (a.parts || []).filter(p => !(p.tbl === 'inv_movements' && a.parts.some(q => q.tbl === 'dispatch_labels')))
  const main = parts.find(p => p.tbl === 'dispatch_labels') || parts.find(p => p.tbl !== 'purchase_order_items' && p.tbl !== 'inv_movements') || parts[0]
  if (!main) return 'A change'
  const thing = THING[main.tbl] || main.tbl.replace(/_/g, ' ')
  let text
  if (main.tbl === 'dispatch_labels' && main.op === 'UPDATE' && main.to && main.from !== main.to) text = `${STATUS_WORD[main.to] || `Marked ${main.to}`}: ${plural(main.n, 'label')}`
  else if (main.tbl === 'dispatch_labels' && main.op === 'UPDATE') text = `Changed ${plural(main.n, 'label')} (printed / ready / kept back)`
  else if (main.op === 'INSERT') text = `Added ${plural(main.n, thing)}`
  else if (main.op === 'DELETE') text = `Deleted ${plural(main.n, thing)}`
  else text = main.to && main.from !== main.to ? `${thing[0].toUpperCase() + thing.slice(1)} → ${main.to.replace(/_/g, ' ')}` : `Changed ${plural(main.n, thing)}`
  const extra = parts.filter(p => p !== main && p.tbl === 'inv_movements').reduce((t, p) => t + p.n, 0)
  return `${text}${main.name ? ` · ${main.name}` : ''}${extra ? ` · ${plural(extra, 'stock movement')}` : ''}`
}

/** Everything I've done in the last 5 minutes, each with Undo. */
export function UndoPanel({ onClose, showToast, onUndone }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [, tick] = useState(0)
  const load = useCallback(() => loadUndoable().then(l => setList(Array.isArray(l) ? l : [])).catch(() => setList([])), [])
  useEffect(() => { load(); const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [load])
  const leftOf = (a) => Math.max(0, 300 - Math.floor((Date.now() - Date.parse(a.at)) / 1000))
  const shown = (list || []).filter(a => leftOf(a) > 0)
  return (
    <Modal title="Undo" description="What you've done in the last 5 minutes. Undo puts it back exactly as it was — stock included." onClose={onClose}>
      {!list ? <Spinner /> : !shown.length ? <EmptyState icon="check" title="Nothing to undo" sub="Actions can be undone for 5 minutes." /> : (
        <div className="space-y-2">
          {shown.map(a => {
            const left = leftOf(a)
            return (
              <div key={a.txid} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink font-medium">{describeAction(a)}</div>
                  <div className="text-[11px] text-ink/45">{new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</div>
                </div>
                <button className="btn btn-secondary btn-sm shrink-0" disabled={busy === a.txid} onClick={async () => {
                  setBusy(a.txid)
                  try { await undoAction(a.txid); showToast?.('Undone'); onUndone?.() }
                  catch (e) { showToast?.(e?.message || 'Couldn’t undo', 'error'); setBusy(null); load() }
                }}><Icon name="back" size={13} /> {busy === a.txid ? 'Undoing…' : 'Undo'}</button>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

/**
 * The Undo button: bottom left of every page (the right is for messages and Back to top), only while there's something to undo — with how many and the
 * time left on the latest. Ctrl/⌘+Z (outside a text box) opens it too.
 */
export function UndoPill({ ping = 0, lifted = false, railHidden = false, onOpen }) {
  const [list, setList] = useState([])
  const [, tick] = useState(0)
  const load = useCallback(() => loadUndoable().then(l => setList(Array.isArray(l) ? l : [])).catch(() => {}), [])
  useEffect(() => { const t = setTimeout(load, 400); return () => clearTimeout(t) }, [ping, load])
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const el = document.activeElement
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      e.preventDefault(); onOpen?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])
  const live = list.map(a => ({ a, left: Math.max(0, 300 - Math.floor((Date.now() - Date.parse(a.at)) / 1000)) })).filter(x => x.left > 0)
  if (!live.length) return null
  const { left } = live[0]
  return (
    <button onClick={onOpen} title={describeAction(live[0].a)}
      className={`fixed left-4 ${railHidden ? '' : 'lg:left-[calc(258px+1.25rem)]'} z-40 flex items-center gap-2 pl-3 pr-3.5 h-10 rounded-full bg-ink text-white shadow-lg text-sm font-semibold hover:bg-royal-700 transition-colors ${lifted ? 'bottom-[calc(env(safe-area-inset-bottom)+84px)] lg:bottom-5' : 'bottom-5'}`}>
      <Icon name="back" size={15} /> Undo{live.length > 1 ? ` (${live.length})` : ''}
      <span className="text-white/60 font-normal tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
    </button>
  )
}
