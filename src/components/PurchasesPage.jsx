import React, { useState, useMemo } from 'react'
import { fmt } from '../lib/calc'
import {
  PO_STATUS, CREDIT_STATUS, PO_CATEGORIES, ISSUE_STATUS, isCredit, categoryOf, expectsDelivery, displayStatus,
  received, paymentState, awaitingPayment, spendSummary, spendByCategory, missingPaperwork, dueSoon, nextStep,
} from '../lib/purchases'
import { PageHeader, Icon, StatusBadge, SegmentedControl, SearchInput, EmptyState } from './UI'
import { SupplierLink } from './Links'
import { exportRowsToCsv, stampedName } from '../lib/csv'

const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—')
const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

/**
 * Everything bought, whether it's stock or a carrier bill: what's waiting to be
 * paid, what's on its way, what's missing paperwork, and what it all cost.
 */
export default function PurchasesPage({ orders, issues, suppliers, me, focusId, onNavigate, onNew, onNewCredit, onOpen, onAttachDocs, onNewFromDocument }) {
  const docInput = React.useRef(null)
  const [view, setView] = useState('open')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [report, setReport] = useState(false)

  const spend = useMemo(() => spendSummary(orders), [orders])
  const openIssuesBy = useMemo(() => {
    const m = {}
    issues.filter(i => ISSUE_STATUS[i.status]?.open).forEach(i => { m[i.po_id] = (m[i.po_id] || 0) + 1 })
    return m
  }, [issues])
  const noPaperwork = useMemo(() => missingPaperwork(orders).filter(o => !o.data?.noDocumentNeeded), [orders])
  const soon = useMemo(() => dueSoon(orders, 30), [orders])

  const VIEWS = {
    open: { label: 'Needs action', test: o => o.status === 'draft' || awaitingPayment(o) || ['awaiting_delivery', 'partially_received', 'received'].includes(displayStatus(o)) || openIssuesBy[o.id] },
    payment: { label: 'To pay', test: o => awaitingPayment(o) },
    delivery: { label: 'Awaiting delivery', test: o => expectsDelivery(o) && ['awaiting_delivery', 'partially_received'].includes(displayStatus(o)) },
    paperwork: { label: 'No invoice yet', test: o => noPaperwork.includes(o) },
    problems: { label: 'Problems', test: o => !!openIssuesBy[o.id] },
    credits: { label: 'Credit notes', test: o => isCredit(o) },
    completed: { label: 'Completed', test: o => o.status === 'completed' },
    all: { label: 'All', test: () => true },
  }
  const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, orders.filter(v.test).length]))
  const q = search.trim().toLowerCase()
  const shown = orders
    .filter(VIEWS[view].test)
    .filter(o => category === 'all' || (o.category || 'stock') === category)
    .filter(o => !q ||
      o.po_number.toLowerCase().includes(q) ||
      String(o.supplier_name || '').toLowerCase().includes(q) ||
      String(o.invoice_number || '').toLowerCase().includes(q) ||
      String(o.payment_reference || '').toLowerCase().includes(q) ||
      (o.items || []).some(i => String(i.name || '').toLowerCase().includes(q)))

  const exportCsv = () => exportRowsToCsv(stampedName('purchase-orders'), shown, [
    { header: 'PO number', value: o => o.po_number },
    { header: 'Raised', value: o => (o.created_at || '').slice(0, 10) },
    { header: 'Supplier', value: o => o.supplier_name || '' },
    { header: 'For', value: o => categoryOf(o).label },
    { header: 'Status', value: o => (PO_STATUS[displayStatus(o)] || {}).label || o.status },
    { header: 'Goods', value: o => num(o.subtotal).toFixed(2) },
    { header: 'Delivery', value: o => num(o.delivery).toFixed(2) },
    { header: 'VAT', value: o => num(o.vat).toFixed(2) },
    { header: 'Total', value: o => num(o.total).toFixed(2) },
    { header: 'Invoice number', value: o => o.invoice_number || '' },
    { header: 'Invoice total', value: o => (o.invoice_total == null ? '' : num(o.invoice_total).toFixed(2)) },
    { header: 'Paid', value: o => (o.paid_at || '').slice(0, 10) },
    { header: 'Paid by', value: o => o.paid_by || '' },
    { header: 'Method', value: o => o.payment_method || '' },
    { header: 'Reference', value: o => o.payment_reference || '' },
    { header: 'Terms', value: o => (o.terms === 'credit' ? `On account, due ${o.payment_due_at || ''}` : 'Paid up front') },
  ])

  return (
    <div>
      <PageHeader
        eyebrow="Purchasing / orders"
        title="Purchase orders"
        description="Everything you buy — stock, carriers, services — raised, paid, delivered and filed."
        meta={`${orders.filter(o => !['completed', 'cancelled'].includes(o.status)).length} open · ${orders.length} in total`}
        actions={
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setReport(r => !r)}>
              <Icon name="trend" size={14} /> {report ? 'Hide' : 'Spend'} breakdown
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}>
              <Icon name="download" size={14} /> Export
            </button>
            {onAttachDocs && noPaperwork.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={onAttachDocs}>
                <Icon name="upload" size={14} /> Attach invoices ({noPaperwork.length})
              </button>
            )}
            {onNewCredit && <button className="btn btn-secondary btn-sm" onClick={onNewCredit}><Icon name="pound" size={14} /> Credit note</button>}
            {onNewFromDocument && (
              <>
                <input ref={docInput} type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onNewFromDocument(f); e.target.value = '' }} />
                <button className="btn btn-primary btn-sm" onClick={() => docInput.current?.click()}
                  title="Read a supplier's invoice or proforma and fill the order in from it">
                  <Icon name="upload" size={14} /> New from invoice
                </button>
              </>
            )}
            <button className="btn btn-secondary btn-sm" onClick={onNew}><Icon name="plus" size={14} /> New, by hand</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Spent this week" value={fmt(spend.week)} sub={`${fmt(spend.month)} this month`} />
        <Stat label="Due in the next 30 days" value={fmt(soon.reduce((s, o) => s + num(o.total), 0))}
          sub={`${soon.length} order${soon.length !== 1 ? 's' : ''}${spend.overdue ? ` · ${spend.overdue} overdue` : ''}`}
          tone={spend.overdue ? 'text-loss' : ''} onClick={() => onNavigate?.('payments')} />
        <Stat label="Awaiting delivery" value={spend.awaitingDelivery} sub={`${Object.keys(openIssuesBy).length} with problems`}
          onClick={() => { setView('delivery'); setCategory('all') }} />
        <Stat label="Missing an invoice" value={noPaperwork.length} tone={noPaperwork.length ? 'text-warn' : ''}
          sub={noPaperwork.length ? 'click to attach them' : 'all filed'}
          onClick={() => (onAttachDocs && noPaperwork.length ? onAttachDocs() : (setView('paperwork'), setCategory('all')))} />
      </div>

      {report && <SpendBreakdown orders={orders} />}

      <div className="flex gap-3 flex-wrap items-center justify-between mb-3">
        <SegmentedControl label="Show" value={view} onChange={setView}
          items={Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: counts[id] }))} />
        <SearchInput value={search} onChange={e => setSearch(e.target.value)}
          placeholder="PO, supplier, invoice number or product" className="w-full sm:w-80" />
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4">
        <CatChip id="all" label="Everything" active={category === 'all'} onClick={setCategory} count={orders.length} />
        {Object.entries(PO_CATEGORIES).map(([id, c]) => {
          const n = orders.filter(o => (o.category || 'stock') === id).length
          return n ? <CatChip key={id} id={id} label={c.label} icon={c.icon} active={category === id} onClick={setCategory} count={n} /> : null
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="receipt" title={view === 'open' ? 'Nothing needs you right now' : 'Nothing here'}
          sub={orders.length === 0 ? 'Raise your first purchase order to get started.' : ''} />
      ) : (
        <div className="card-flush overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-b border-rule">
                  <th className="th text-left px-4">Order</th>
                  <th className="th text-left px-3">Supplier</th>
                  <th className="th text-left px-3">For</th>
                  <th className="th text-center px-3">Delivery</th>
                  <th className="th text-left px-3">Payment</th>
                  <th className="th text-right px-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(o => {
                  const r = received(o.items)
                  const pay = paymentState(o)
                  const credit = isCredit(o)
                  const st = (credit ? CREDIT_STATUS[o.status] : PO_STATUS[displayStatus(o)]) || PO_STATUS.draft
                  const cat = categoryOf(o)
                  const problems = openIssuesBy[o.id] || 0
                  return (
                    <tr key={o.id} tabIndex={0} onClick={() => onOpen(o)} onKeyDown={e => e.key === 'Enter' && onOpen(o)}
                      className={`border-b border-rule/60 cursor-pointer hover:bg-royal-50/40 ${focusId === o.id ? 'bg-royal-50' : ''}`}>
                      <td className="td px-4">
                        <div className="font-medium text-ink">{o.po_number}{credit ? ' · credit' : ''}</div>
                        <div className="text-xs text-ink/50 mt-0.5">
                          {shortDate(o.created_at)}{o.created_by ? ` · ${o.created_by}` : ''} · {(o.items || []).length} line{(o.items || []).length !== 1 ? 's' : ''}
                          {o.invoice_number ? <> · inv <span className="text-ink/70">{o.invoice_number}</span></> : ''}
                        </div>
                      </td>
                      <td className="td px-3"><SupplierLink name={o.supplier_name} /></td>
                      <td className="td px-3">
                        <div className="flex items-center gap-1.5 text-xs text-ink/65"><Icon name={cat.icon} size={13} />{cat.label}</div>
                        <div className="mt-1 flex gap-1 flex-wrap">
                          <StatusBadge tone={st.tone}>{st.short}</StatusBadge>
                          {problems > 0 && <StatusBadge tone="alert">{problems}</StatusBadge>}
                        </div>
                      </td>
                      <td className="td px-3 text-center">
                        {!expectsDelivery(o) ? <span className="text-xs text-ink/35">—</span>
                          : o.status === 'draft' ? <span className="text-xs text-ink/35">not sent</span>
                          : (
                            <div className="inline-flex flex-col items-center gap-1 w-24">
                              <div className="h-1.5 w-full bg-ink/10 rounded-full overflow-hidden">
                                <div className={`h-full ${r.complete ? 'bg-gain' : 'bg-warn'}`} style={{ width: `${r.percent}%` }} />
                              </div>
                              <span className={`text-xs ${r.complete ? 'text-gain' : 'text-ink/55'}`}>
                                {r.complete ? 'All arrived' : `${r.received}/${r.ordered}`}
                              </span>
                            </div>
                          )}
                      </td>
                      <td className="td px-3">
                        <StatusBadge tone={pay.tone}>{credit ? (o.payment_status === 'paid' ? 'Received back' : 'Due back') : pay.label}</StatusBadge>
                        {!credit && !o.invoice_path && !['draft', 'cancelled'].includes(o.status) && (
                          <div className="text-xs text-warn mt-1">no invoice</div>
                        )}
                      </td>
                      <td className="td px-4 text-right">
                        <div className={`font-semibold ${credit ? 'text-gain' : 'text-ink'}`}>{credit ? '−' : ''}{fmt(o.total)}</div>
                        <div className="text-xs text-ink/45 mt-0.5 max-w-[160px] ml-auto truncate" title={nextStep(o, o.items, issues.filter(i => i.po_id === o.id))}>
                          {nextStep(o, o.items, issues.filter(i => i.po_id === o.id))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-paper border-t border-rule">
                  <td className="td px-4 text-xs text-ink/55" colSpan={5}>{shown.length} order{shown.length !== 1 ? 's' : ''} shown</td>
                  <td className="td px-4 text-right font-semibold text-ink">{fmt(shown.reduce((s, o) => s + num(o.total), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CatChip({ id, label, icon, active, count, onClick }) {
  return (
    <button className={`link-chip ${active ? 'border-royal-400 text-royal-600 bg-royal-50' : ''}`} onClick={() => onClick(id)}>
      {icon && <Icon name={icon} size={12} />}{label}<span className="opacity-50 ml-0.5">{count}</span>
    </button>
  )
}

function Stat({ label, value, tone = '', sub, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left ${onClick ? 'hover:border-royal-300 transition-colors' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink/45 mt-0.5">{sub}</div>}
    </Tag>
  )
}

/** What you spent, split by what it was for — the view an accountant asks for. */
function SpendBreakdown({ orders }) {
  const [period, setPeriod] = useState('month')
  const now = new Date()
  const from = period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
    : period === 'quarter' ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
    : new Date(now.getFullYear(), 0, 1)
  const byCat = spendByCategory(orders, from)
  const bySupplier = {}
  orders.filter(o => !['draft', 'cancelled'].includes(o.status) && new Date(o.sent_at || o.created_at) >= from)
    .forEach(o => { const k = o.supplier_name || 'Unknown'; bySupplier[k] = (bySupplier[k] || 0) + num(o.total) })
  const top = Object.entries(bySupplier).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const total = Object.values(byCat).reduce((s, c) => s + c.total, 0)
  const vat = Object.values(byCat).reduce((s, c) => s + c.vat, 0)

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-semibold text-ink">Spend breakdown</div>
          <div className="text-xs text-ink/55">{fmt(total)} in total, including {fmt(vat)} VAT</div>
        </div>
        <SegmentedControl label="Period" value={period} onChange={setPeriod} className="mb-0"
          items={[{ id: 'month', label: 'This month' }, { id: 'quarter', label: 'This quarter' }, { id: 'year', label: 'This year' }]} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="text-xs font-semibold text-ink/55 mb-2">By what it was for</div>
          {Object.keys(byCat).length === 0 ? <div className="text-sm text-ink/50">Nothing in this period.</div> :
            Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).map(([k, c]) => (
              <div key={k} className="flex items-center gap-3 text-sm py-1">
                <span className="w-40 flex items-center gap-1.5 text-ink/70 flex-shrink-0">
                  <Icon name={(PO_CATEGORIES[k] || PO_CATEGORIES.other).icon} size={13} />{(PO_CATEGORIES[k] || PO_CATEGORIES.other).label}
                </span>
                <div className="flex-1 h-4 bg-ink/5 rounded overflow-hidden">
                  <div className="h-full bg-royal-500/80" style={{ width: `${total ? (c.total / total) * 100 : 0}%` }} />
                </div>
                <span className="w-24 text-right font-medium text-ink">{fmt(c.total)}</span>
                <span className="w-8 text-right text-xs text-ink/45">{c.count}</span>
              </div>
            ))}
        </div>
        <div>
          <div className="text-xs font-semibold text-ink/55 mb-2">Who you paid most</div>
          {top.length === 0 ? <div className="text-sm text-ink/50">Nothing in this period.</div> : top.map(([name, v]) => (
            <div key={name} className="flex items-center gap-3 text-sm py-1">
              <span className="w-40 truncate text-ink/70 flex-shrink-0">{name}</span>
              <div className="flex-1 h-4 bg-ink/5 rounded overflow-hidden">
                <div className="h-full bg-royal-400/70" style={{ width: `${top[0][1] ? (v / top[0][1]) * 100 : 0}%` }} />
              </div>
              <span className="w-24 text-right font-medium text-ink">{fmt(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
