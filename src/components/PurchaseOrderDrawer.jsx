import React, { useState } from 'react'
import { fmt } from '../lib/calc'
import { PO_STATUS, CREDIT_STATUS, ISSUE_KINDS, ISSUE_STATUS, PAYMENT_METHODS, PO_CATEGORIES, CREDIT_REASONS, LINE_STATUS, isCredit, categoryOf, expectsDelivery, displayStatus, received, paymentState, nextStep, completionChecks, duplicateInvoice, creditsFor, deliveryState, lineExpected, dayLabel, leadDaysOf, toDateInput } from '../lib/purchases'
import { Drawer, Icon, StatusBadge } from './UI'
import { SupplierLink, ProductLink } from './Links'
import { DocField, ProductPicker } from './PoBuilder'

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * One order, from raised to closed: what's on it, what's arrived, what it cost,
 * and anything that went wrong with the delivery.
 */
export default function PurchaseOrderDrawer({
  po, issues = [], orders = [], me, canPay, onClose, onEdit, onReceive, onMarkPaid, onUploadDoc, onViewDoc,
  onRaiseIssue, onUpdateIssue, onComplete, onCancel, onLoadActivity, onRepeat, onRaiseCredit,
  supplier = null, stockItems = [], onConfirmDelivery, onLineStatus, onLinkLine, onCreateProduct,
  requests = [], onOpenRequest, deliveries = [], onOpenDelivery, onViewDeliveryPhoto,
}) {
  const credit = isCredit(po)
  const [invoice, setInvoice] = useState({ number: po.invoice_number || '', total: po.invoice_total ?? '' })
  const [activity, setActivity] = useState([])
  const goods = expectsDelivery(po)
  const cat = categoryOf(po)
  const duplicate = duplicateInvoice(orders, { ...po, invoice_number: invoice.number })
  const [tab, setTab] = useState('items')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  React.useEffect(() => { setInvoice({ number: po.invoice_number || '', total: po.invoice_total ?? '' }) }, [po.invoice_number, po.invoice_total])
  React.useEffect(() => {
    if (tab !== 'history' || !onLoadActivity) return
    let live = true
    onLoadActivity({ entityId: po.id, limit: 80 }).then(r => live && setActivity(r || []))
    return () => { live = false }
  }, [tab, po.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [receipt, setReceipt] = useState(() => Object.fromEntries((po.items || []).map(i => [i.id, String(i.qty_received ?? 0)])))
  const [issueFor, setIssueFor] = useState(null)
  const [linking, setLinking] = useState(null)   // { item, create }
  const live = !['draft', 'cancelled'].includes(po.status)
  const [payment, setPayment] = useState({ method: 'bacs', reference: '', paid_at: new Date().toISOString().slice(0, 10) })

  const r = received(po.items)
  const pay = paymentState(po)
  const status = (credit ? CREDIT_STATUS[po.status] : PO_STATUS[displayStatus(po)]) || PO_STATUS.draft
  const checks = completionChecks(po, po.items, issues)
  const openIssues = issues.filter(i => ISSUE_STATUS[i.status]?.open)
  const run = async (kind, fn) => { setBusy(kind); setError(''); try { await fn() } catch (e) { setError(e?.message || 'That didn’t work') } finally { setBusy(null) } }

  return (
    <Drawer title={po.po_number} description={`${po.supplier_name || 'No supplier'} · raised ${when(po.created_at)}${po.created_by ? ` by ${po.created_by}` : ''}`}
      onClose={onClose} width="max-w-3xl"
      footer={
        <div>
          {error && <div className="text-sm text-loss mb-2">{error}</div>}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-ink/60"><b className="text-ink">Next:</b> {nextStep(po, po.items, issues, supplier)}</div>
            <div className="flex gap-2 flex-wrap">
              {po.status === 'draft' && <button className="btn btn-secondary btn-sm" onClick={() => onEdit(po)}><Icon name="edit" size={14} /> Edit</button>}
              {onRaiseCredit && !credit && po.status !== 'draft' && (
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => onRaiseCredit(po)}
                  title="They've refunded or credited something on this order">
                  <Icon name="pound" size={14} /> Credit note
                </button>
              )}
              {onRepeat && !credit && po.status !== 'draft' && (
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => onRepeat(po)}
                  title={po.data?.repeat && po.data.repeat !== 'none' ? `Raise the next ${po.data.repeat} one` : 'Start a new order with the same lines'}>
                  <Icon name="plus" size={14} /> {po.data?.repeat && po.data.repeat !== 'none' ? 'Raise the next one' : 'Order again'}
                </button>
              )}
              {!['completed', 'cancelled'].includes(po.status) && (
                <button className="btn btn-secondary btn-sm" disabled={!!busy}
                  onClick={() => { if (window.confirm(`Cancel ${po.po_number}? It stays on record but stops appearing as outstanding.`)) run('cancel', () => onCancel(po)) }}>
                  Cancel order
                </button>
              )}
              {po.status !== 'completed' && po.status !== 'draft' && po.status !== 'cancelled' && (
                <button className="btn btn-primary btn-sm" disabled={!!busy || (goods && !checks.find(c => c.key === 'received')?.done)}
                  title={!goods || checks.find(c => c.key === 'received')?.done ? '' : 'Record what’s arrived first'}
                  onClick={() => run('complete', () => onComplete(po))}>
                  <Icon name="check" size={14} /> {busy === 'complete' ? 'Closing…' : 'Mark completed'}
                </button>
              )}
            </div>
          </div>
        </div>
      }>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <StatusBadge tone={status.tone} dot>{status.label}</StatusBadge>
        <StatusBadge tone="quiet">{cat.label}</StatusBadge>
        <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge>
        {po.terms === 'credit' && <StatusBadge tone="quiet">On account</StatusBadge>}
        {openIssues.length > 0 && <StatusBadge tone="alert">{openIssues.length} open issue{openIssues.length !== 1 ? 's' : ''}</StatusBadge>}
        {po.data?.repeat && po.data.repeat !== 'none' && !credit && <StatusBadge tone="quiet">Repeats {po.data.repeat}</StatusBadge>}
        {credit && <StatusBadge tone="live">Credit note{po.credit_reason ? ` — ${(CREDIT_REASONS[po.credit_reason] || '').toLowerCase()}` : ''}</StatusBadge>}
        <SupplierLink name={po.supplier_name} />
      </div>

      {!credit && creditsFor(orders, po).list.length > 0 && (
        <div className="panel-notice mb-4 text-sm">
          {fmt(creditsFor(orders, po).total)} credited back on this order
          ({creditsFor(orders, po).list.map(c => c.po_number).join(', ')}).
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Fact label={credit ? 'Credit' : 'Total'} value={fmt(po.total)} />
        <Fact label="Lines" value={(po.items || []).length} />
        <Fact label="Received" value={`${r.received} of ${r.ordered}`} tone={r.complete ? 'text-gain' : r.started ? 'text-warn' : ''} />
        <Fact label={po.terms === 'credit' ? 'Payment due' : 'Payment'} value={po.payment_status === 'paid' ? 'Paid' : (po.payment_due_at ? new Date(po.payment_due_at).toLocaleDateString('en-GB') : 'Before release')} />
      </div>

      {goods && live && po.status !== 'completed' && onConfirmDelivery && (
        <DeliveryCard po={po} supplier={supplier} onConfirm={(v) => run('delivery', () => onConfirmDelivery(po, v))} busy={busy === 'delivery'} />
      )}

      {goods && deliveries.length > 0 && (
        <div className="card mb-4">
          <div className="text-sm font-semibold text-ink mb-2">Booked in at goods in</div>
          <div className="space-y-2">
            {deliveries.map(d => (
              <div key={d.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <button className="text-royal-600 hover:underline font-medium" onClick={() => onOpenDelivery?.(d.id)}>{d.ref}</button>
                  <span className="text-ink/60"> · {d.received_by || 'someone'} · {new Date(d.received_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <div className="text-xs text-ink/50">
                    {[(d.lines || []).reduce((t, l) => t + num(l.arrived ?? l.qty), 0) + ' units', d.cartons && `${d.cartons} cartons`, d.pallets && `${d.pallets} pallets`,
                      d.signed_unchecked && 'signed unchecked', d.delivery_note_no && `note ${d.delivery_note_no}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-1.5 items-center flex-shrink-0">
                  {d.has_problems && <StatusBadge tone="alert">Problems</StatusBadge>}
                  {d.note_photo_path && <button className="btn btn-secondary btn-xs" onClick={() => onViewDeliveryPhoto?.(d.note_photo_path)}><Icon name="camera" size={12} /> Note</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Where it's up to */}
      <div className="card mb-4">
        <div className="text-sm font-semibold text-ink mb-2">To close this off</div>
        <ul className="space-y-1.5">
          {checks.map(c => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${c.done ? 'bg-gain text-white' : 'border border-ink/25'}`}>
                {c.done && <Icon name="check" size={10} />}
              </span>
              <span><span className={c.done ? 'text-ink' : 'text-ink/60'}>{c.label}</span>
                {!c.done && <span className="block text-xs text-ink/45">{c.hint}</span>}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="tab-row mb-4" role="tablist">
        {[['items', goods ? 'Order & delivery' : 'What’s being paid for'], ['docs', 'Paperwork'],
          ...(goods ? [['issues', `Problems${issues.length ? ` (${issues.length})` : ''}`]] : []), ['history', 'History']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'items' && (
        <div>
          <div className="card-flush overflow-hidden mb-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-paper border-b border-rule">
                  <th className="th text-left px-4">Product</th><th className="th text-right px-2">Ordered</th>
                  <th className="th text-right px-2">Unit</th><th className="th text-right px-2">Line</th>
                  {goods && <th className="th text-right px-3 w-32">Received</th>}
                </tr></thead>
                <tbody>
                  {(po.items || []).map(i => {
                    const short = num(receipt[i.id]) < num(i.qty)
                    return (
                      <tr key={i.id} className="border-b border-rule/60">
                        <td className="td px-4">
                          <div className={`text-ink ${i.line_status === 'cancelled' ? 'line-through text-ink/45' : ''}`}>{i.name}</div>
                          <div className="flex gap-1.5 items-center mt-0.5 flex-wrap">
                            {i.stock_item_id && <ProductLink id={i.stock_item_id} name="Product" />}
                            {i.supplier_sku && <span className="text-xs text-ink/45">SKU {i.supplier_sku}</span>}
                            {goods && !i.stock_item_id && (
                              <>
                                <StatusBadge tone="paused">Not in Products</StatusBadge>
                                {onLinkLine && <button className="btn btn-xs btn-secondary" onClick={() => setLinking({ item: i, create: false })}>Link</button>}
                                {onCreateProduct && <button className="btn btn-xs btn-secondary" onClick={() => setLinking({ item: i, create: true })}>Add to Products</button>}
                              </>
                            )}
                          </div>
                          {(i.data?.requestIds || []).map(id => requests.find(x => x.id === id)).filter(Boolean).map(rq => (
                            <button key={rq.id} className="text-xs text-royal-600 hover:underline mt-1 mr-2" onClick={() => onOpenRequest?.(rq.id)}
                              title="The warehouse asked for this">
                              <Icon name="inbox" size={11} /> {rq.ref} · asked by {rq.raised_by || 'warehouse'}
                            </button>
                          ))}
                          {goods && live && onLineStatus && (
                            <LineStatus item={i} disabled={!!busy} onChange={(patch) => run('line', () => onLineStatus(po, i, patch))} />
                          )}
                        </td>
                        <td className="td px-2 text-right">{num(i.qty)}</td>
                        <td className="td px-2 text-right">{fmt(i.unit_cost)}</td>
                        <td className="td px-2 text-right font-medium">{fmt(num(i.qty) * num(i.unit_cost))}</td>
                        {goods && <td className="td px-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            <input type="number" min="0" className="input text-right w-20" value={receipt[i.id] ?? 0}
                              aria-label={`Received quantity of ${i.name}`}
                              disabled={po.status === 'draft' || po.status === 'cancelled' || i.line_status === 'cancelled'}
                              onChange={e => setReceipt(s => ({ ...s, [i.id]: e.target.value }))} />
                            <button className="btn btn-xs btn-secondary" title="Report a problem with this line" onClick={() => setIssueFor(i)}>
                              <Icon name="alert" size={12} />
                            </button>
                          </div>
                          {short && num(receipt[i.id]) > 0 && <div className="text-xs text-warn text-right mt-0.5">{num(i.qty) - num(receipt[i.id])} short</div>}
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center gap-3 flex-wrap mb-4">
            <div className="text-sm text-ink/60">
              {!goods ? 'No delivery to check — this isn’t a stock order.' : r.complete ? `Everything ordered has arrived${r.cancelled ? ` (${r.cancelled} line${r.cancelled !== 1 ? 's' : ''} cancelled by the supplier — check they’re not on the invoice)` : ''}.` : `${r.outstanding} item${r.outstanding !== 1 ? 's' : ''} still to come.`}
            </div>
            {goods && po.status !== 'draft' && po.status !== 'cancelled' && (
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" disabled={!!busy}
                  onClick={() => setReceipt(Object.fromEntries((po.items || []).map(i => [i.id,
                    String(!i.line_status || i.line_status === 'due' ? num(i.qty) : num(i.qty_received))])))}>
                  {(po.items || []).some(i => i.line_status && i.line_status !== 'due') ? 'Everything due arrived' : 'Everything arrived'}
                </button>
                <button className="btn btn-primary btn-sm" disabled={!!busy}
                  onClick={() => run('receive', () => onReceive(po, Object.entries(receipt).map(([id, qty]) => ({ id, qty_received: num(qty) }))))}>
                  {busy === 'receive' ? 'Saving…' : 'Save what’s arrived'}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <Row label="Goods" value={fmt(po.subtotal)} />
            <Row label="Delivery" value={fmt(po.delivery)} />
            <Row label="VAT" value={fmt(po.vat)} />
            <div className="flex justify-between pt-2 mt-1 border-t border-rule">
              <span className="font-semibold text-ink">Total</span><span className="font-semibold text-ink">{fmt(po.total)}</span>
            </div>
            {po.invoice_total != null && Math.abs(num(po.invoice_total) - num(po.total)) >= 0.01 && (
              <div className="text-xs text-warn mt-2">The invoice says {fmt(po.invoice_total)} — {fmt(Math.abs(num(po.invoice_total) - num(po.total)))} {num(po.invoice_total) > num(po.total) ? 'more' : 'less'} than this order.</div>
            )}
            {po.notes && <div className="text-sm text-ink/70 mt-3 pt-3 border-t border-rule">{po.notes}</div>}
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div className="space-y-4">
          <DocField label={po.order_method === 'online' ? 'Order confirmation or proforma' : 'Proforma'} path={po.proforma_path} busy={busy === 'proforma'} onView={onViewDoc}
            onUpload={(file) => run('proforma', () => onUploadDoc(po, file, 'proforma'))}
            onClear={() => run('proforma-clear', () => onUploadDoc(po, null, 'proforma'))} />

          <div className="card">
            <DocField label="Final invoice" path={po.invoice_path} busy={busy === 'invoice'} onView={onViewDoc}
              onUpload={(file) => run('invoice', () => onUploadDoc(po, file, 'invoice'))}
              onClear={() => run('invoice-clear', () => onUploadDoc(po, null, 'invoice'))} />

            {!po.invoice_path && po.proforma_path && (
              <button className="btn btn-secondary btn-sm mt-2" disabled={!!busy}
                onClick={() => run('same', () => onUploadDoc(po, null, 'invoice_is_proforma'))}>
                <Icon name="check" size={14} /> {busy === 'same' ? 'Saving…' : 'The document above is the final invoice'}
              </button>
            )}
            {!po.invoice_path && !po.proforma_path && (
              <div className="text-xs text-ink/55 mt-2">Upload the final invoice when the supplier sends it.</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 mt-4 items-end">
              <div><label className="label" htmlFor="inv-no">Invoice number</label>
                <input id="inv-no" className="input" value={invoice.number} onChange={e => setInvoice(v => ({ ...v, number: e.target.value }))} /></div>
              <div><label className="label" htmlFor="inv-total">Invoice total £</label>
                <input id="inv-total" type="number" step="0.01" className="input" value={invoice.total} onChange={e => setInvoice(v => ({ ...v, total: e.target.value }))} /></div>
              <button className="btn btn-primary btn-sm" disabled={!!busy ||
                  (invoice.number === (po.invoice_number || '') && String(invoice.total) === String(po.invoice_total ?? ''))}
                onClick={() => run('invdetails', () => onUploadDoc(po, null, 'invoice_details', invoice))}>
                {busy === 'invdetails' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {duplicate && (
              <div className="text-sm text-loss mt-2">
                {duplicate.po_number} already has invoice {duplicate.invoice_number} from {duplicate.supplier_name} — check you’re not paying it twice.
              </div>
            )}
            {po.invoice_total != null && Math.abs(num(po.invoice_total) - num(po.total)) >= 0.01 && (
              <div className="text-sm text-warn mt-2">
                The invoice is {fmt(Math.abs(num(po.invoice_total) - num(po.total)))} {num(po.invoice_total) > num(po.total) ? 'more' : 'less'} than this order.
              </div>
            )}
          </div>

          {po.online_url && (
            <div className="card">
              <div className="label">Online order</div>
              <a className="text-sm text-royal-600 hover:underline break-all" href={po.online_url} target="_blank" rel="noopener noreferrer">{po.online_url}</a>
              {po.login_hint && <div className="text-sm text-ink/60 mt-1">Use: {po.login_hint} <span className="text-xs text-ink/45">(password sent separately)</span></div>}
            </div>
          )}
        </div>
      )}

      {tab === 'issues' && (
        <div className="space-y-3">
          <button className="btn btn-secondary btn-sm" onClick={() => setIssueFor((po.items || [])[0] || {})}>
            <Icon name="alert" size={14} /> Report a problem
          </button>
          {issues.length === 0 ? (
            <div className="text-sm text-ink/55">Nothing reported against this order.</div>
          ) : issues.map(is => (
            <IssueCard key={is.id} issue={is} items={po.items} onUpdate={onUpdateIssue} />
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div>
          <ol className="relative border-l border-rule ml-1.5 space-y-3">
            {[
              ['Raised', po.created_at, po.created_by],
              ['Sent for payment', po.sent_at, po.sent_by],
              [`Paid${po.payment_method ? ` by ${PAYMENT_METHODS[po.payment_method] || po.payment_method}` : ''}${po.payment_reference ? ` · ${po.payment_reference}` : ''}`, po.paid_at, po.paid_by],
              [`Delivery date confirmed${po.delivery_date ? ` for ${new Date(po.delivery_date + 'T00:00:00').toLocaleDateString('en-GB')}` : ''}`, po.delivery_confirmed_at, po.delivery_confirmed_by],
              ['Delivery recorded', po.received_at, null],
              ['Completed', po.completed_at, po.completed_by],
            ].filter(([, at]) => at).map(([label, at, who], i) => (
              <li key={i} className="pl-3">
                <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-royal-400 mt-1.5" />
                <div className="text-sm text-ink">{label}{who ? <span className="text-ink/55"> by {who}</span> : ''}</div>
                <div className="text-xs text-ink/45">{when(at)}</div>
              </li>
            ))}
          </ol>
          {activity.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-semibold text-ink/55 mb-2">Everything recorded against this order</div>
              <div className="card-flush overflow-hidden">
                {activity.map(a => (
                  <div key={a.id} className="px-4 py-2 border-b border-rule/60 last:border-0 text-sm flex gap-3">
                    <span className="text-xs text-ink/45 w-28 flex-shrink-0">{when(a.at)}</span>
                    <span className="min-w-0"><b className="font-medium text-ink">{a.user_name || 'Someone'}</b>
                      <span className="text-ink/70"> — {a.action.toLowerCase()}</span>
                      {a.detail && <span className="block text-xs text-ink/55">{a.detail}</span>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paying it, for whoever handles payments */}
      {canPay && po.payment_status !== 'paid' && !['draft', 'cancelled'].includes(po.status) && (
        <div className="card mt-5 border-royal-200">
          <div className="font-semibold text-ink mb-2">{credit ? 'Record the money coming back' : 'Record the payment'}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="label" htmlFor="pm">How it was paid</label>
              <select id="pm" className="input" value={payment.method} onChange={e => setPayment(p => ({ ...p, method: e.target.value }))}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label" htmlFor="pd">Date paid</label>
              <input id="pd" type="date" className="input" value={payment.paid_at} onChange={e => setPayment(p => ({ ...p, paid_at: e.target.value }))} /></div>
            <div><label className="label" htmlFor="pr">Reference</label>
              <input id="pr" className="input" value={payment.reference} onChange={e => setPayment(p => ({ ...p, reference: e.target.value }))} placeholder="optional" /></div>
          </div>
          <button className="btn btn-primary btn-sm mt-3" disabled={!!busy}
            onClick={() => run('paid', () => onMarkPaid(po, payment))}>
            <Icon name="check" size={14} /> {busy === 'paid' ? 'Saving…' : `Mark ${fmt(po.total)} as paid`}
          </button>
        </div>
      )}

      {linking && (
        <ProductPicker
          products={stockItems.filter(si => !si.data?.archived).map(si => ({ si,
            theirs: !!supplier && String(si.data?.supplierName || '').toLowerCase() === supplier.name.toLowerCase() }))
            .sort((a, b) => (b.theirs - a.theirs) || a.si.name.localeCompare(b.si.name))}
          supplier={supplier}
          startCreating={linking.create}
          createLabel="Add to Products"
          initial={{ name: linking.item.name || '', supplierSku: linking.item.supplier_sku || '', costPrice: num(linking.item.unit_cost) ? String(num(linking.item.unit_cost)) : '' }}
          onClose={() => setLinking(null)}
          onCreate={onCreateProduct}
          onPick={(si) => { const item = linking.item; setLinking(null); run('link', () => onLinkLine(po, item, si)) }} />
      )}

      {issueFor && (
        <IssueForm po={po} item={issueFor.id ? issueFor : null} items={po.items || []} onClose={() => setIssueFor(null)}
          onSave={async (payload) => { await onRaiseIssue(po, payload); setIssueFor(null) }} />
      )}
    </Drawer>
  )
}

function Fact({ label, value, tone = '' }) {
  return <div className="metric-card py-2"><div className="metric-label">{label}</div><div className={`text-sm font-semibold ${tone || 'text-ink'}`}>{value}</div></div>
}
function Row({ label, value }) {
  return <div className="flex justify-between py-1 text-sm"><span className="text-ink/65">{label}</span><span className="text-ink">{value}</span></div>
}

function IssueCard({ issue, items, onUpdate }) {
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState(issue.supplier_response || '')
  const s = ISSUE_STATUS[issue.status] || ISSUE_STATUS.reported
  const item = items?.find(i => i.id === issue.po_item_id)
  const set = async (patch) => { setBusy(true); try { await onUpdate(issue, patch) } finally { setBusy(false) } }
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-ink text-sm">{ISSUE_KINDS[issue.kind] || issue.kind}{issue.qty ? ` — ${num(issue.qty)} unit${num(issue.qty) !== 1 ? 's' : ''}` : ''}</div>
          <div className="text-xs text-ink/50 mt-0.5">{item?.name || 'Whole order'} · reported {when(issue.reported_at)}{issue.reported_by ? ` by ${issue.reported_by}` : ''}</div>
          {issue.description && <div className="text-sm text-ink/70 mt-1">{issue.description}</div>}
        </div>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="label" htmlFor={`resp-${issue.id}`}>What the supplier said</label>
          <input id={`resp-${issue.id}`} className="input" value={response} onChange={e => setResponse(e.target.value)}
            onBlur={() => response !== (issue.supplier_response || '') && set({ supplier_response: response })} placeholder="e.g. credit note promised by Friday" />
        </div>
        <select className="input w-full sm:w-48" value={issue.status} onChange={e => set({ status: e.target.value })} disabled={busy} aria-label="Issue status">
          {Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => set({ last_chased_at: new Date().toISOString(), status: issue.status === 'reported' ? 'chasing' : issue.status })}>
          Chased today
        </button>
      </div>
      {issue.last_chased_at && <div className="text-xs text-ink/45 mt-2">Last chased {when(issue.last_chased_at)}</div>}
    </div>
  )
}

function IssueForm({ item, items, onClose, onSave }) {
  const [form, setForm] = useState({ po_item_id: item?.id || '', kind: 'missing', qty: '', description: '' })
  const [busy, setBusy] = useState(false)
  const chosen = items.find(i => i.id === form.po_item_id)
  const value = chosen ? num(form.qty) * num(chosen.unit_cost) : 0
  return (
    <div className="fixed inset-0 bg-ink/35 z-[60] flex items-center justify-center p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-paper border border-rule rounded-[7px] w-full max-w-lg shadow-modal overflow-hidden">
        <div className="px-5 py-4 bg-white border-b border-rule font-semibold text-ink">Report a problem</div>
        <div className="p-5 space-y-3">
          <div><label className="label" htmlFor="is-item">Which line</label>
            <select id="is-item" className="input" value={form.po_item_id} onChange={e => setForm(f => ({ ...f, po_item_id: e.target.value }))}>
              <option value="">The whole order</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="is-kind">What’s wrong</label>
              <select id="is-kind" className="input" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                {Object.entries(ISSUE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label" htmlFor="is-qty">How many units</label>
              <input id="is-qty" type="number" min="0" className="input" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} /></div>
          </div>
          <div><label className="label" htmlFor="is-desc">What happened</label>
            <input id="is-desc" className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. 3 bottles leaked in transit" /></div>
          {value > 0 && <div className="text-sm text-ink/60">Worth about {fmt(value)} — that’s what to chase them for.</div>}
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={busy}
              onClick={async () => { setBusy(true); try { await onSave({ ...form, value }) } finally { setBusy(false) } }}>
              {busy ? 'Saving…' : 'Report it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


/** Invoice number and total, saved deliberately rather than as you type. */
function InvoiceDetails({ po, busy, onSave }) {
  const [form, setForm] = useState({ invoice_number: po.invoice_number || '', invoice_total: po.invoice_total ?? '' })
  React.useEffect(() => setForm({ invoice_number: po.invoice_number || '', invoice_total: po.invoice_total ?? '' }),
    [po.invoice_number, po.invoice_total])
  const dirty = form.invoice_number !== (po.invoice_number || '') || String(form.invoice_total) !== String(po.invoice_total ?? '')
  const diff = form.invoice_total !== '' ? num(form.invoice_total) - num(po.total) : 0
  return (
    <div className="mt-4 pt-3 border-t border-rule">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="inv-no">Invoice number</label>
          <input id="inv-no" className="input" value={form.invoice_number}
            onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="As printed on their invoice" /></div>
        <div><label className="label" htmlFor="inv-total">Invoice total £</label>
          <input id="inv-total" type="number" step="0.01" className="input" value={form.invoice_total}
            onChange={e => setForm(f => ({ ...f, invoice_total: e.target.value }))} /></div>
      </div>
      {form.invoice_total !== '' && Math.abs(diff) >= 0.01 && (
        <div className="text-xs text-warn mt-2">
          {fmt(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than this order’s {fmt(po.total)}.
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-primary btn-sm" disabled={!dirty || busy}
          onClick={() => onSave({ invoice_number: form.invoice_number.trim() || null, invoice_total: form.invoice_total === '' ? null : num(form.invoice_total) })}>
          {busy ? 'Saving…' : dirty ? 'Save invoice details' : 'Saved'}
        </button>
        {dirty && <button className="btn btn-secondary btn-sm" onClick={() => setForm({ invoice_number: po.invoice_number || '', invoice_total: po.invoice_total ?? '' })}>Discard</button>}
      </div>
    </div>
  )
}


/**
 * When it's coming. The estimate from the supplier's lead time is a guide for
 * chasing; the warehouse only ever sees a date once it's been confirmed.
 */
function DeliveryCard({ po, supplier, onConfirm, busy }) {
  const d = deliveryState(po, po.items, supplier)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ date: po.delivery_date || '', note: po.delivery_note || '' })
  React.useEffect(() => { setForm({ date: po.delivery_date || '', note: po.delivery_note || '' }); setEditing(false) },
    [po.delivery_date, po.delivery_note])
  if (!d) return null
  const confirmed = !!po.delivery_date
  const tone = d.overdue ? 'alert' : d.chase ? 'paused' : confirmed || (d.kind === 'back_order' && d.date) ? 'live' : 'quiet'
  const lead = leadDaysOf(supplier)
  const showForm = !confirmed || editing
  const today = toDateInput(new Date())
  return (
    <div className={`card mb-4 ${d.overdue ? 'border-loss/40' : d.chase ? 'border-warn/50' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">Delivery</div>
          {confirmed && !editing && (
            <div className="text-sm text-ink/70 mt-0.5">
              {new Date(po.delivery_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {po.delivery_confirmed_by ? <span className="text-ink/50"> · confirmed by {po.delivery_confirmed_by}{po.delivery_confirmed_at ? ` ${when(po.delivery_confirmed_at)}` : ''}</span> : ''}
              {po.delivery_note && <span className="block text-xs text-ink/55 mt-0.5">{po.delivery_note}</span>}
            </div>
          )}
          {!confirmed && d.kind === 'estimated' && (
            <div className="text-xs text-ink/55 mt-0.5">
              {supplier?.name || 'Supplier'}’s lead time is {lead} working day{lead !== 1 ? 's' : ''}, so roughly {dayLabel(d.date)}.
              Only a guide — the warehouse sees “awaiting a date” until you confirm one.
            </div>
          )}
          {!confirmed && d.kind === 'no_date' && (
            <div className="text-xs text-ink/55 mt-0.5">No lead time on {supplier?.name || 'this supplier'}’s record, so there’s no estimate. Confirm a date when they give you one.</div>
          )}
          {d.kind === 'not_placed' && (
            <div className="text-xs text-ink/55 mt-0.5">The supplier releases it once it’s paid. You can still record a date if they’ve given one.</div>
          )}
        </div>
        <StatusBadge tone={tone} dot>{d.label}</StatusBadge>
      </div>

      {showForm ? (
        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_auto] gap-2 mt-3 items-end">
          <div><label className="label" htmlFor={`dd-${po.id}`}>Delivery date</label>
            <input id={`dd-${po.id}`} type="date" className="input" value={form.date} min={confirmed ? undefined : today}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
          <div><label className="label" htmlFor={`dn-${po.id}`}>Note</label>
            <input id={`dn-${po.id}`} className="input" value={form.note} placeholder="e.g. on the pro forma, AM delivery, 2 pallets"
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
          <div className="flex gap-2">
            {editing && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>}
            <button className="btn btn-primary btn-sm" disabled={busy || !form.date}
              onClick={() => onConfirm({ date: form.date, note: form.note.trim() || null })}>
              {busy ? 'Saving…' : editing ? 'Save new date' : 'Confirm date'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Change date</button>
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={() => { if (window.confirm('Take the confirmed date off? The warehouse will see “awaiting a date” again.')) onConfirm({ date: null, note: null }) }}>
            Not confirmed any more
          </button>
        </div>
      )}
    </div>
  )
}

/** A line that isn't coming with the rest: on back order, or cancelled by the supplier. */
function LineStatus({ item, onChange, disabled }) {
  const status = item.line_status || 'due'
  const exp = lineExpected(null, item)
  const [date, setDate] = useState(item.back_order_date || '')
  React.useEffect(() => setDate(item.back_order_date || ''), [item.back_order_date])
  const done = num(item.qty_received) >= num(item.qty)
  if (done && status === 'due') return null
  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
      <select className="input py-0.5 text-xs h-7 w-auto" value={status} disabled={disabled}
        aria-label={`Is ${item.name} coming with the order?`}
        onChange={e => {
          const next = e.target.value
          if (next === 'cancelled' && !window.confirm(`Mark ${item.name} as cancelled by the supplier? It stops counting as still to come.`)) return
          onChange({ line_status: next, back_order_date: next === 'back_order' ? (item.back_order_date || null) : null })
        }}>
        {Object.entries(LINE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {status === 'back_order' && (
        <input type="date" className="input py-0.5 text-xs h-7 w-auto" value={date} disabled={disabled}
          aria-label={`Back order date for ${item.name}`} title="Leave empty if the supplier hasn't given a date"
          onChange={e => setDate(e.target.value)}
          onBlur={() => date !== (item.back_order_date || '') && onChange({ line_status: 'back_order', back_order_date: date || null })} />
      )}
      {exp && <span className={`text-xs ${exp.tone === 'alert' ? 'text-loss' : 'text-warn'}`}>{exp.label}</span>}
    </div>
  )
}
