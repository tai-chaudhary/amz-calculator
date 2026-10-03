import React, { useState, useMemo } from 'react'
import { fmt } from '../lib/calc'
import { PAYMENT_METHODS, ISSUE_KINDS, ISSUE_STATUS, displayStatus, paymentState, awaitingPayment } from '../lib/purchases'
import { PageHeader, Icon, StatusBadge, SegmentedControl, SearchInput, EmptyState } from './UI'
import { SupplierLink } from './Links'

const when = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

/**
 * What needs paying, most urgent first: orders the supplier won't release until
 * they're paid, then account invoices by their due date.
 */
export function PaymentsPage({ orders, onOpen, onMarkPaid, onViewDoc }) {
  const [view, setView] = useState('due')
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState(null)

  const pending = useMemo(() => orders.filter(awaitingPayment).map(o => ({ o, pay: paymentState(o) }))
    .sort((a, b) => {
      const rank = (x) => (x.pay.overdue ? 0 : x.o.terms === 'prepay' ? 1 : 2)
      return rank(a) - rank(b) || (a.pay.days ?? 999) - (b.pay.days ?? 999) || num(b.o.total) - num(a.o.total)
    }), [orders])
  const paid = useMemo(() => orders.filter(o => o.payment_status === 'paid')
    .sort((a, b) => new Date(b.paid_at || 0) - new Date(a.paid_at || 0)), [orders])

  const VIEWS = { due: { label: 'To pay', rows: pending }, paid: { label: 'Paid', rows: paid } }
  const q = search.trim().toLowerCase()
  const rows = (view === 'due' ? pending : paid.map(o => ({ o, pay: paymentState(o) })))
    .filter(({ o }) => !q || o.po_number.toLowerCase().includes(q) || String(o.supplier_name || '').toLowerCase().includes(q))

  const total = pending.reduce((s, { o }) => s + num(o.total), 0)
  const overdue = pending.filter(x => x.pay.overdue)

  return (
    <div>
      <PageHeader
        eyebrow="Purchasing / payments"
        title="Pending payments"
        description="Purchase orders waiting to be paid, with the proforma or the online basket attached. Mark each one paid once the money has gone."
        meta={`${pending.length} to pay · ${fmt(total)}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Waiting to be paid" value={fmt(total)} sub={`${pending.length} order${pending.length !== 1 ? 's' : ''}`} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'text-loss' : ''} sub={overdue.length ? fmt(overdue.reduce((s, x) => s + num(x.o.total), 0)) : 'nothing late'} />
        <Stat label="Needed to release orders" value={fmt(pending.filter(x => x.o.terms === 'prepay').reduce((s, x) => s + num(x.o.total), 0))} sub="supplier holds these until paid" />
        <Stat label="On account" value={fmt(pending.filter(x => x.o.terms === 'credit').reduce((s, x) => s + num(x.o.total), 0))} sub="due by invoice terms" />
      </div>

      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <SegmentedControl label="Show" value={view} onChange={setView}
          items={Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: v.rows.length }))} />
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="PO number or supplier" className="w-full sm:w-64" />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="check" title={view === 'due' ? 'Nothing waiting to be paid' : 'Nothing paid yet'} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ o, pay }) => (
            <div key={o.id} className="surface px-5 py-4">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="font-semibold text-ink hover:text-royal-600" onClick={() => onOpen(o)}>{o.po_number}</button>
                    <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge>
                    {o.terms === 'credit' && <StatusBadge tone="quiet">On account</StatusBadge>}
                    {displayStatus(o) === 'partially_received' && <StatusBadge tone="paused">Part delivered</StatusBadge>}
                    {displayStatus(o) === 'received' && <StatusBadge tone="brand">Already delivered</StatusBadge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <SupplierLink name={o.supplier_name} />
                    <span className="text-xs text-ink/50">{(o.items || []).length} lines · raised {when(o.created_at)}{o.created_by ? ` by ${o.created_by}` : ''}</span>
                  </div>
                  {o.notes && <div className="text-xs text-ink/60 mt-1">{o.notes}</div>}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {o.proforma_path && <button className="btn btn-secondary btn-xs" onClick={() => onViewDoc(o.proforma_path)}><Icon name="download" size={12} /> Proforma</button>}
                    {o.online_url && <a className="btn btn-secondary btn-xs" href={o.online_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={12} /> Open the basket</a>}
                    {o.login_hint && <span className="text-xs text-ink/55 self-center">Use: {o.login_hint}</span>}
                    {view === 'paid' && o.invoice_path && <button className="btn btn-secondary btn-xs" onClick={() => onViewDoc(o.invoice_path)}><Icon name="download" size={12} /> Invoice</button>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-ink">{fmt(o.total)}</div>
                  {view === 'due' ? (
                    <button className="btn btn-primary btn-sm mt-2" onClick={() => setPaying(o)}><Icon name="check" size={14} /> Mark as paid</button>
                  ) : (
                    <div className="text-xs text-ink/50 mt-1">
                      Paid {when(o.paid_at)}{o.paid_by ? ` by ${o.paid_by}` : ''}<br />
                      {PAYMENT_METHODS[o.payment_method] || o.payment_method}{o.payment_reference ? ` · ${o.payment_reference}` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {paying && <PayModal o={paying} onClose={() => setPaying(null)} onSave={async (p) => { await onMarkPaid(paying, p); setPaying(null) }} />}
    </div>
  )
}

function PayModal({ o, onClose, onSave }) {
  const [form, setForm] = useState({ method: o.order_method === 'online' ? 'card' : 'bacs', paid_at: new Date().toISOString().slice(0, 10), reference: '' })
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 bg-ink/35 z-50 flex items-center justify-center p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-paper border border-rule rounded-[7px] w-full max-w-md shadow-modal overflow-hidden">
        <div className="px-5 py-4 bg-white border-b border-rule">
          <div className="font-semibold text-ink">Mark {o.po_number} as paid</div>
          <div className="text-xs text-ink/55 mt-0.5">{o.supplier_name} · {fmt(o.total)}</div>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="label" htmlFor="pay-m">How it was paid</label>
            <select id="pay-m" className="input" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="label" htmlFor="pay-d">Date paid</label>
            <input id="pay-d" type="date" className="input" value={form.paid_at} onChange={e => setForm(f => ({ ...f, paid_at: e.target.value }))} /></div>
          <div><label className="label" htmlFor="pay-r">Reference</label>
            <input id="pay-r" className="input" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Bank reference or card ending" /></div>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(form) } finally { setBusy(false) } }}>
              {busy ? 'Saving…' : `Confirm ${fmt(o.total)} paid`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Everything that arrived missing, damaged or wrong, and where the chase with
 * each supplier has got to — until it's replaced, credited or written off.
 */
export function IssuesPage({ issues, orders, onOpen, onUpdate }) {
  const [view, setView] = useState('open')
  const [search, setSearch] = useState('')
  const rows = useMemo(() => issues.map(i => ({ i, o: orders.find(o => o.id === i.po_id) }))
    .filter(x => x.o).sort((a, b) => new Date(b.i.reported_at) - new Date(a.i.reported_at)), [issues, orders])

  const VIEWS = {
    open: { label: 'Open', test: x => ISSUE_STATUS[x.i.status]?.open },
    stale: { label: 'Not chased in a week', test: x => ISSUE_STATUS[x.i.status]?.open && (Date.now() - new Date(x.i.last_chased_at || x.i.reported_at)) > 7 * 86400000 },
    settled: { label: 'Settled', test: x => !ISSUE_STATUS[x.i.status]?.open },
    all: { label: 'All', test: () => true },
  }
  const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, rows.filter(v.test).length]))
  const q = search.trim().toLowerCase()
  const shown = rows.filter(VIEWS[view].test).filter(x => !q ||
    x.o.po_number.toLowerCase().includes(q) || String(x.o.supplier_name || '').toLowerCase().includes(q) ||
    String(x.i.description || '').toLowerCase().includes(q))

  const openValue = rows.filter(x => ISSUE_STATUS[x.i.status]?.open).reduce((s, x) => s + num(x.i.value), 0)

  return (
    <div>
      <PageHeader
        eyebrow="Purchasing / problems"
        title="Delivery problems"
        description="Items that arrived missing, damaged or wrong — and what the supplier has said about putting it right."
        meta={`${counts.open} open · ${fmt(openValue)} outstanding`}
      />

      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <SegmentedControl label="Show" value={view} onChange={setView}
          items={Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: counts[id] }))} />
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="PO, supplier or description" className="w-full sm:w-64" />
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="check" title={view === 'open' ? 'Nothing outstanding with suppliers' : 'Nothing here'} />
      ) : (
        <div className="space-y-3">
          {shown.map(({ i, o }) => {
            const s = ISSUE_STATUS[i.status] || ISSUE_STATUS.reported
            const item = (o.items || []).find(x => x.id === i.po_item_id)
            const days = Math.floor((Date.now() - new Date(i.last_chased_at || i.reported_at)) / 86400000)
            return (
              <div key={i.id} className="surface px-5 py-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{ISSUE_KINDS[i.kind] || i.kind}</span>
                      {num(i.qty) > 0 && <span className="text-sm text-ink/70">{num(i.qty)} unit{num(i.qty) !== 1 ? 's' : ''}</span>}
                      {num(i.value) > 0 && <span className="text-sm font-medium text-loss">{fmt(i.value)}</span>}
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <button className="link-chip" onClick={() => onOpen(o)}><Icon name="briefcase" size={12} />{o.po_number}</button>
                      <SupplierLink name={o.supplier_name} />
                      <span className="text-xs text-ink/50">{item?.name || 'whole order'}</span>
                    </div>
                    {i.description && <div className="text-sm text-ink/70 mt-1.5">{i.description}</div>}
                    {i.supplier_response && <div className="text-sm text-ink/60 mt-1"><b>They said:</b> {i.supplier_response}</div>}
                    <div className="text-xs text-ink/45 mt-1.5">
                      Reported {when(i.reported_at)}{i.reported_by ? ` by ${i.reported_by}` : ''}
                      {i.last_chased_at ? ` · last chased ${when(i.last_chased_at)}` : ''}
                      {s.open && days >= 7 ? ` · ${days} days without a chase` : ''}
                    </div>
                  </div>
                  {s.open && (
                    <div className="flex flex-col gap-2 items-end">
                      <select className="input w-52" value={i.status} onChange={e => onUpdate(i, { status: e.target.value })} aria-label="Status">
                        {Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => onUpdate(i, { last_chased_at: new Date().toISOString(), status: i.status === 'reported' ? 'chasing' : i.status })}>
                        Chased today
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = '', sub }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink/45 mt-0.5">{sub}</div>}
    </div>
  )
}
