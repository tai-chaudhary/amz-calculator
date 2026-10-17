import React, { useState, useMemo } from 'react'
import { URGENCY, STEPS, requestState, openRequestFor, sortRequests, ago } from '../lib/requests'
import { PageHeader, Icon, StatusBadge, SegmentedControl, SearchInput, EmptyState, Drawer, Modal } from './UI'
import { ProductPicker } from './PoBuilder'
import { PO_STATUS, expectsDelivery } from '../lib/purchases'
import { fmtUnits, fmtDays, STATE_LABEL, requestPrefill } from '../lib/inventory'

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * The warehouse asks for stock and follows it through to the delivery; the
 * office sees what's been asked for and orders it. No prices anywhere here.
 */
export default function StockRequestsPage({
  me, requests = [], products = [], people = [], focusId, canOrder = false,
  purchaseOrders = [], stockItems = [], suppliers = [],
  onRaise, onUpdate, onAcknowledge, onDecline, onRaisePo, onLinkToOrder, onUnlinkOrder,
  onLinkProduct, onCreateProduct, onViewPhoto, onRefresh, onOpenPo,
  restock = [], onOpenStock,
}) {
  const [view, setView] = useState(canOrder ? 'office' : 'open')
  const [search, setSearch] = useState('')
  const [asking, setAsking] = useState(null)        // null | {} | prefill
  const [openId, setOpenId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)

  React.useEffect(() => { if (focusId && requests.some(r => r.id === focusId)) setOpenId(focusId) }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    onRefresh?.()
    const t = setInterval(() => onRefresh?.(), 60000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const VIEWS = {
    ...(canOrder ? { office: { label: 'For the office', test: r => requestState(r).needsOffice || r.status === 'acknowledged' && !r.po_id } } : {}),
    open: { label: 'Open', test: r => requestState(r).open },
    arrived: { label: 'Arrived', test: r => requestState(r).key === 'arrived' },
    all: { label: 'All', test: () => true },
  }
  const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, requests.filter(v.test).length]))
  const q = search.trim().toLowerCase()
  const shown = sortRequests(requests.filter(VIEWS[view]?.test || (() => true)).filter(r => !q ||
    [r.ref, r.product_name, r.raised_by, r.note, r.barcode, r.helm_sku, r.progress?.po_number, r.progress?.supplier_name]
      .some(x => String(x || '').toLowerCase().includes(q))))
  const open = requests.find(r => r.id === openId)
  const chosen = requests.filter(r => selected.has(r.id))
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // One order per supplier: only offer "Raise PO" when the picks agree
  const chosenSuppliers = [...new Set(chosen.map(r => products.find(p => p.id === r.stock_item_id)?.supplier_name).filter(Boolean))]
  const orderable = chosen.filter(r => !r.po_id && requestState(r).open)

  const run = async (fn) => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  return (
    <div className={chosen.length ? 'pb-28' : ''}>
      <PageHeader
        eyebrow="Warehouse / requests"
        title="Stock requests"
        description={canOrder ? 'What the warehouse has asked for, and where each order is up to.' : 'Ask for stock that’s running low, and see when it’s coming.'}
        actions={
          <button className="btn btn-primary w-full sm:w-auto justify-center py-3 sm:py-2" onClick={() => setAsking({})}>
            <Icon name="plus" size={16} /> Ask for stock
          </button>
        }
      />

      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <div className="overflow-x-auto max-w-full -mx-1 px-1">
          <SegmentedControl label="Show" value={view} onChange={(v) => { setView(v); setSelected(new Set()) }}
            items={Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: counts[id] }))} />
        </div>
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Product, SR number, PO or person" className="w-full sm:w-72" />
      </div>

      {restock.length > 0 && (view === 'open' || view === 'office') && !q && (
        <RunningLow list={restock} onAsk={(p) => setAsking(requestPrefill(p))} onOpenStock={onOpenStock} />
      )}

      {shown.length === 0 ? (
        <EmptyState icon="inbox"
          title={view === 'office' ? 'Nothing waiting for the office' : view === 'open' ? 'Nothing asked for right now' : 'Nothing here'}
          sub={requests.length === 0 ? 'When something’s running low, ask for it here and follow it until it arrives.' : ''}
          action={view !== 'office' && <button className="btn btn-primary btn-sm" onClick={() => setAsking({})}><Icon name="plus" size={14} /> Ask for stock</button>} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {shown.map(r => (
            <RequestCard key={r.id} r={r} selectable={canOrder} selected={selected.has(r.id)} onToggle={() => toggle(r.id)}
              onOpen={() => setOpenId(r.id)} focused={focusId === r.id} />
          ))}
        </div>
      )}

      {canOrder && chosen.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 lg:left-[258px] z-20 bg-white border-t border-rule px-4 py-3 shadow-modal">
          <div className="max-w-5xl mx-auto flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink font-medium mr-auto">{chosen.length} selected</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            {chosen.some(r => r.status === 'raised') && (
              <button className="btn btn-secondary btn-sm" disabled={busy}
                onClick={() => run(async () => { await onAcknowledge(chosen.filter(r => r.status === 'raised')); setSelected(new Set()) })}>
                <Icon name="check" size={14} /> Mark as seen
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy || !orderable.length || chosenSuppliers.length > 1}
              title={chosenSuppliers.length > 1 ? `These come from ${chosenSuppliers.join(', ')} — raise one order per supplier`
                : !orderable.length ? 'These are already on an order' : 'Start a purchase order with these on it'}
              onClick={() => { onRaisePo(orderable); setSelected(new Set()) }}>
              <Icon name="receipt" size={14} /> Raise PO{orderable.length !== chosen.length && orderable.length ? ` (${orderable.length})` : ''}
            </button>
          </div>
          {chosenSuppliers.length > 1 && (
            <div className="max-w-5xl mx-auto text-xs text-warn mt-1.5">These come from {chosenSuppliers.join(' and ')} — pick one supplier’s items at a time.</div>
          )}
        </div>
      )}

      {asking && (
        <AskForm me={me} people={people} products={products} requests={requests} canOrder={canOrder} prefill={asking}
          onClose={() => setAsking(null)}
          onShowExisting={(r) => { setAsking(null); setOpenId(r.id) }}
          onSave={async (form) => { const row = await onRaise(form); if (row) { setAsking(null); setView('open') } }} />
      )}

      {open && (
        <RequestDrawer r={open} me={me} people={people} canOrder={canOrder} purchaseOrders={purchaseOrders} stockItems={stockItems}
          suppliers={suppliers}
          onClose={() => setOpenId(null)}
          onUpdate={onUpdate} onAcknowledge={onAcknowledge} onDecline={onDecline} onRaisePo={(r) => { setOpenId(null); onRaisePo([r]) }}
          onLinkToOrder={onLinkToOrder} onUnlinkOrder={onUnlinkOrder} onLinkProduct={onLinkProduct} onCreateProduct={onCreateProduct}
          onViewPhoto={onViewPhoto} onOpenPo={onOpenPo}
          onAskAgain={(r) => { setOpenId(null); setAsking({ stock_item_id: r.stock_item_id, product_name: r.product_name, barcode: r.barcode, helm_sku: r.helm_sku, qty_requested: r.qty_requested }) }} />
      )}
    </div>
  )
}

/**
 * What the stock says is running low: under 15 days left (plus the time it
 * takes to arrive), and not asked for yet. One tap fills in the request.
 */
function RunningLow({ list, onAsk, onOpenStock }) {
  const [all, setAll] = useState(false)
  const shown = all ? list : list.slice(0, 5)
  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-ink/55">Running low, from stock and sales <span className="text-ink/35">{list.length}</span></h2>
        {onOpenStock && <button className="btn btn-ghost btn-xs" onClick={onOpenStock}>See stock</button>}
      </div>
      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {shown.map(p => (
          <div key={p.id} className="px-3 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink leading-snug">{p.name}</div>
              <div className="text-xs text-ink/50 tabular-nums">
                {fmtUnits(p.available)} available{p.on_order > 0 ? ` · ${fmtUnits(p.on_order)} on order` : ''} · lasts {fmtDays(p.st.cover)}
                {p.st.suggest > 0 ? ` · order about ${fmtUnits(p.st.suggest)}` : ''}{p.st.learning ? ' · early estimate' : ''}
              </div>
            </div>
            <StatusBadge tone={STATE_LABEL[p.st.state].tone}>{STATE_LABEL[p.st.state].label}</StatusBadge>
            <button className="btn btn-secondary btn-xs shrink-0" onClick={() => onAsk(p)}><Icon name="plus" size={12} /> Ask</button>
          </div>
        ))}
      </div>
      {list.length > 5 && <button className="btn btn-ghost btn-xs mt-1" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </section>
  )
}

function RequestCard({ r, selectable, selected, onToggle, onOpen, focused }) {
  const st = requestState(r)
  const u = URGENCY[r.urgency] || URGENCY.running_low
  const p = r.progress
  return (
    <div className={`card p-0 overflow-hidden flex ${focused ? 'ring-2 ring-royal-300' : ''} ${selected ? 'border-royal-400 bg-royal-50/30' : ''}`}>
      {selectable && (
        <label className="flex items-start pt-4 pl-3.5 pr-1 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={selected} onChange={onToggle} aria-label={`Select ${r.product_name}`} />
        </label>
      )}
      <button className="flex-1 min-w-0 text-left px-3.5 py-3 hover:bg-sky/15 transition-colors" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-ink leading-snug">{r.product_name}</div>
            <div className="text-xs text-ink/50 mt-0.5">
              {r.ref} · {r.raised_by || 'someone'} · {ago(r.created_at)}
              {r.qty_requested ? ` · asked for ${num(r.qty_requested)}` : ''}
            </div>
          </div>
          {st.open && <StatusBadge tone={u.tone}>{u.short}</StatusBadge>}
        </div>
        <div className="mt-2.5"><Progress step={st.step} tone={st.tone} /></div>
        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <span className={`text-sm font-medium ${st.tone === 'alert' ? 'text-loss' : st.tone === 'live' ? 'text-gain' : 'text-ink/80'}`}>{st.label}</span>
          {p && <span className="text-xs text-ink/55">{p.po_number} · {p.supplier_name}{num(p.qty) ? ` · ${num(p.qty)} ordered` : ''}</span>}
        </div>
        {!r.stock_item_id && <div className="text-[11px] text-warn mt-1.5">Not in Products yet</div>}
      </button>
    </div>
  )
}

/** Raised → Seen → Ordered → Date confirmed → Arrived */
function Progress({ step, tone }) {
  if (step < 0) return <div className="h-1.5 rounded-full bg-ink/10" />
  const fill = tone === 'alert' ? 'bg-loss' : tone === 'live' ? 'bg-gain' : 'bg-royal-500'
  return (
    <div className="flex gap-1" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? fill : 'bg-ink/10'}`} />)}
    </div>
  )
}

/** Asking for stock: what, roughly how many, how urgent, and who's asking. */
export function AskForm({ me, people, products, requests, canOrder, prefill, onClose, onSave, onShowExisting }) {
  const remembered = (() => { try { return localStorage.getItem('sr-who') || '' } catch { return '' } })()
  const asker = canOrder ? me?.name : (people.includes(remembered) ? remembered : people.includes(me?.name) ? me?.name : '')
  const [form, setForm] = useState({
    stock_item_id: prefill.stock_item_id || null, product_name: prefill.product_name || '',
    barcode: prefill.barcode || '', helm_sku: prefill.helm_sku || '',
    qty_requested: prefill.qty_requested ? String(num(prefill.qty_requested)) : '',
    urgency: prefill.urgency || 'running_low', note: prefill.note || '', raised_by: asker || '', photo: null,
  })
  const [q, setQ] = useState('')
  const [manual, setManual] = useState(!!prefill.product_name && !prefill.stock_item_id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photoRef = React.useRef(null)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const query = q.trim().toLowerCase()
  const matches = useMemo(() => !query ? [] : products.filter(p =>
    p.name.toLowerCase().includes(query) || String(p.barcode || '').includes(query) ||
    String(p.supplier_sku || '').toLowerCase().includes(query)).slice(0, 8), [products, query])
  const picked = form.stock_item_id ? products.find(p => p.id === form.stock_item_id) : null
  const already = (form.stock_item_id || (manual && form.product_name.trim()))
    ? openRequestFor(requests, { stockItemId: form.stock_item_id, name: form.product_name }) : null
  const ready = (form.stock_item_id || (manual && form.product_name.trim())) && form.raised_by && !already

  return (
    <Modal title="Ask for stock" description="The office sees it straight away. You’ll see when it’s ordered and when it’s coming." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* What */}
        {picked ? (
          <div className="p-3 rounded-[6px] border border-royal-200 bg-sky/30 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-ink">{picked.name}</div>
              <div className="text-xs text-ink/55">{[picked.supplier_name, picked.barcode].filter(Boolean).join(' · ')}</div>
            </div>
            <button className="btn btn-secondary btn-xs" onClick={() => setForm(f => ({ ...f, stock_item_id: null, product_name: '' }))}>Change</button>
          </div>
        ) : manual ? (
          <div className="space-y-3 p-3 rounded-[6px] border border-rule bg-white">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Not in the list</div>
              <button className="btn btn-ghost btn-xs" onClick={() => setManual(false)}>Search instead</button>
            </div>
            <div><label className="label" htmlFor="sr-name">What is it?</label>
              <input id="sr-name" className="input text-base sm:text-sm" value={form.product_name} onChange={set('product_name')}
                placeholder="Name as it’s written on the box" autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="sr-bar">Barcode</label>
                <input id="sr-bar" inputMode="numeric" className="input text-base sm:text-sm" value={form.barcode} onChange={set('barcode')} placeholder="if you have it" /></div>
              <div><label className="label" htmlFor="sr-helm">HELM SKU</label>
                <input id="sr-helm" className="input text-base sm:text-sm" value={form.helm_sku} onChange={set('helm_sku')} placeholder="if you know it" /></div>
            </div>
            <div>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setForm(x => ({ ...x, photo: f })); e.target.value = '' }} />
              <button className="btn btn-secondary btn-sm" onClick={() => photoRef.current?.click()}>
                <Icon name="camera" size={14} /> {form.photo ? 'Retake photo' : 'Add a photo'}
              </button>
              {form.photo && <span className="text-xs text-gain ml-2">Photo added</span>}
              <div className="text-xs text-ink/45 mt-1">A photo of the product or its label helps the office order the right thing.</div>
            </div>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="sr-search">What’s running low?</label>
            <SearchInput id="sr-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Product name, barcode or code" className="w-full" autoFocus />
            {matches.length > 0 && (
              <div className="mt-2 border border-rule rounded-[6px] bg-white divide-y divide-rule/70 overflow-hidden">
                {matches.map(p => (
                  <button key={p.id} className="w-full text-left px-3 py-3 hover:bg-sky/25" onClick={() => { setForm(f => ({ ...f, stock_item_id: p.id, product_name: p.name })); setQ('') }}>
                    <div className="text-sm text-ink">{p.name}</div>
                    <div className="text-xs text-ink/50">{[p.supplier_name, p.barcode].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
            {query && matches.length === 0 && <div className="text-sm text-ink/55 mt-2">Nothing called that in Products.</div>}
            <button className="btn btn-secondary btn-sm mt-2" onClick={() => { setManual(true); setForm(f => ({ ...f, product_name: q.trim() })) }}>
              <Icon name="plus" size={14} /> Can’t find it? Add it by name
            </button>
          </div>
        )}

        {already && (
          <div className="panel-notice text-sm">
            <b>{already.ref}</b> already asks for this — {requestState(already).label.toLowerCase()}.
            <button className="btn btn-secondary btn-xs ml-2" onClick={() => onShowExisting(already)}>Open it</button>
            <div className="text-xs text-ink/55 mt-1">Add a note or make it more urgent there instead of asking twice.</div>
          </div>
        )}

        {/* How urgent */}
        <div>
          <div className="label">How urgent?</div>
          <div className="grid grid-cols-3 gap-2">
            {['out', 'running_low', 'low'].map(k => (
              <button key={k} onClick={() => setForm(f => ({ ...f, urgency: k }))}
                className={`px-2 py-3 rounded-[6px] border text-sm font-medium transition-colors ${form.urgency === k
                  ? (k === 'out' ? 'border-loss bg-coral/10 text-loss' : 'border-royal-400 bg-sky/40 text-royal-700')
                  : 'border-rule bg-white text-ink/70'}`} aria-pressed={form.urgency === k}>
                {URGENCY[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
          <div><label className="label" htmlFor="sr-qty">How many? <span className="font-normal text-ink/40">optional</span></label>
            <input id="sr-qty" type="number" inputMode="numeric" min="1" className="input text-base sm:text-sm" value={form.qty_requested} onChange={set('qty_requested')} /></div>
          <div><label className="label" htmlFor="sr-note">Note <span className="font-normal text-ink/40">optional</span></label>
            <input id="sr-note" className="input text-base sm:text-sm" value={form.note} onChange={set('note')} placeholder="e.g. 2 boxes left, big order going out Friday" /></div>
        </div>

        {!canOrder && (
          <div>
            <label className="label" htmlFor="sr-who">Who’s asking?</label>
            <select id="sr-who" className="input text-base sm:text-sm" value={form.raised_by} onChange={set('raised_by')}>
              <option value="">Choose your name</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={busy || !ready}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                try { if (!canOrder) localStorage.setItem('sr-who', form.raised_by) } catch { /* fine */ }
                await onSave({ ...form, product_name: form.product_name.trim() })
              } catch (e) { setError(e?.message || 'Could not send it — try again') } finally { setBusy(false) }
            }}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** One request: where it's up to, its order, its history, and what can be done with it. */
function RequestDrawer({
  r, me, people, canOrder, purchaseOrders, stockItems, suppliers, onClose, onUpdate, onAcknowledge, onDecline, onRaisePo,
  onLinkToOrder, onUnlinkOrder, onLinkProduct, onCreateProduct, onViewPhoto, onOpenPo, onAskAgain,
}) {
  const st = requestState(r)
  const p = r.progress
  const u = URGENCY[r.urgency] || URGENCY.running_low
  const [note, setNote] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkingProduct, setLinkingProduct] = useState(null) // 'link' | 'create'
  const [busy, setBusy] = useState(false)
  const run = async (fn) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const who = canOrder ? me?.name : (() => { try { return localStorage.getItem('sr-who') || me?.name } catch { return me?.name } })()
  const editable = ['raised', 'acknowledged'].includes(r.status) && !r.po_id

  // Milestones from the order, alongside what people did
  const timeline = [
    ...r.events.map(e => ({ at: e.at, label: e.action, who: e.by_name, detail: e.detail })),
    ...(p?.delivery_confirmed_at && p.delivery_date ? [{ at: p.delivery_confirmed_at, label: `Delivery date confirmed: ${new Date(p.delivery_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` }] : []),
    ...(p?.received_at && num(p.qty_received) > 0 ? [{ at: p.received_at, label: `${num(p.qty_received)} of ${num(p.qty)} booked in` }] : []),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  return (
    <Drawer title={r.product_name} description={`${r.ref} · asked by ${r.raised_by || 'someone'} ${when(r.created_at)}`} onClose={onClose}
      footer={
        <div className="flex gap-2 flex-wrap justify-end">
          {!st.open && <button className="btn btn-secondary btn-sm" onClick={() => onAskAgain(r)}><Icon name="plus" size={14} /> Ask again</button>}
          {editable && (
            <button className="btn btn-secondary btn-sm" disabled={busy}
              onClick={() => { if (window.confirm(`Cancel ${r.ref}? The office won’t order it.`)) run(() => onUpdate(r, { status: 'cancelled' }, 'Cancelled', null, who)) }}>
              Cancel request
            </button>
          )}
          {canOrder && r.status === 'raised' && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => onAcknowledge([r]))}><Icon name="check" size={14} /> Mark as seen</button>
          )}
          {canOrder && st.open && r.po_id && st.needsOffice && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onRaisePo(r)}><Icon name="receipt" size={14} /> Raise PO</button>
          )}
        </div>
      }>
      <div className="flex gap-2 flex-wrap mb-3">
        <StatusBadge tone={st.tone} dot>{st.label}</StatusBadge>
        {st.open && <StatusBadge tone={u.tone}>{u.label}</StatusBadge>}
        {!r.stock_item_id && <StatusBadge tone="paused">Not in Products</StatusBadge>}
      </div>
      <div className="mb-4"><Progress step={st.step} tone={st.tone} />
        <div className="flex justify-between mt-1.5 text-[10px] text-ink/45">{STEPS.map(s => <span key={s}>{s}</span>)}</div>
      </div>

      {/* The order */}
      {p ? (
        <div className="card mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">{p.po_number}</div>
              <div className="text-xs text-ink/55">{p.supplier_name}{p.po_status && PO_STATUS[p.po_status] && canOrder ? ` · ${PO_STATUS[p.po_status].short}` : ''}</div>
            </div>
            {canOrder && <button className="btn btn-secondary btn-xs" onClick={() => onOpenPo(r.po_id)}>Open PO</button>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Fact label="Ordered" value={num(p.qty) || '—'} />
            <Fact label="Arrived" value={num(p.qty_received)} />
            <Fact label="Delivery" value={p.line_status === 'back_order' ? (p.back_order_date ? new Date(p.back_order_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'TBC') : p.delivery_date ? new Date(p.delivery_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date yet'} />
          </div>
          {p.item_name && p.item_name !== r.product_name && <div className="text-xs text-ink/50 mt-2">On the order as “{p.item_name}”</div>}
          {canOrder && (
            <button className="btn btn-ghost btn-xs mt-2" disabled={busy}
              onClick={() => { if (window.confirm(`Take ${r.ref} off ${p.po_number}? It goes back to waiting to be ordered.`)) run(() => onUnlinkOrder(r)) }}>
              Wrong order? Unlink it
            </button>
          )}
        </div>
      ) : canOrder && st.open ? (
        <div className="card mb-4">
          <div className="text-sm text-ink/70">Not on an order yet.</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <button className="btn btn-primary btn-sm" onClick={() => onRaisePo(r)}><Icon name="receipt" size={14} /> Raise PO</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setLinking(true)}>Already ordered? Link it</button>
            {r.status !== 'declined' && <button className="btn btn-secondary btn-sm" onClick={() => setDeclining(true)}>Not ordering it</button>}
          </div>
        </div>
      ) : null}

      {r.status === 'declined' && r.status_reason && (
        <div className="panel-notice text-sm mb-4"><b>Why it’s not being ordered:</b> {r.status_reason}</div>
      )}

      {/* What was asked */}
      <div className="card mb-4 space-y-1.5 text-sm">
        <Row label="Asked for" value={r.qty_requested ? num(r.qty_requested) : 'No amount given'} />
        <Row label="Urgency" value={
          editable || (st.open && !canOrder) ? (
            <select className="input py-1 text-sm w-auto" value={r.urgency} disabled={busy}
              onChange={e => run(() => onUpdate(r, { urgency: e.target.value }, 'Urgency changed', URGENCY[e.target.value].label, who))}>
              {Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          ) : u.label} />
        {r.barcode && <Row label="Barcode" value={r.barcode} />}
        {r.helm_sku && <Row label="HELM SKU" value={r.helm_sku} />}
        {r.note && <div className="text-ink/75 pt-1">{r.note}</div>}
        {r.photo_path && <button className="btn btn-secondary btn-xs mt-1" onClick={() => onViewPhoto(r.photo_path)}><Icon name="camera" size={12} /> View photo</button>}
        {canOrder && !r.stock_item_id && (
          <div className="flex gap-2 pt-2">
            <button className="btn btn-secondary btn-xs" onClick={() => setLinkingProduct('link')}>Link to a product</button>
            <button className="btn btn-secondary btn-xs" onClick={() => setLinkingProduct('create')}>Add to Products</button>
          </div>
        )}
      </div>

      {declining && (
        <div className="card mb-4 border-warn/50">
          <label className="label" htmlFor="sr-reason">Why not? The warehouse will see this.</label>
          <input id="sr-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. discontinued, enough on the way already" autoFocus />
          <div className="flex gap-2 mt-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setDeclining(false)}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !reason.trim()} onClick={() => run(async () => { await onDecline(r, reason.trim()); setDeclining(false) })}>Not ordering it</button>
          </div>
        </div>
      )}

      {/* History, and a note anyone can add */}
      <div className="text-sm font-semibold text-ink mb-2">History</div>
      <ol className="relative border-l border-rule ml-1.5 space-y-3 mb-4">
        {timeline.map((e, i) => (
          <li key={i} className="pl-3">
            <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-royal-400 mt-1.5" />
            <div className="text-sm text-ink">{e.label}{e.who ? <span className="text-ink/55"> — {e.who}</span> : ''}</div>
            {e.detail && <div className="text-sm text-ink/65">{e.detail}</div>}
            <div className="text-xs text-ink/45">{when(e.at)}</div>
          </li>
        ))}
      </ol>
      {st.open && (
        <div className="flex gap-2">
          <input className="input flex-1 text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" />
          <button className="btn btn-secondary btn-sm" disabled={busy || !note.trim()}
            onClick={() => run(async () => { await onUpdate(r, null, 'Note', note.trim(), who); setNote('') })}>Add</button>
        </div>
      )}

      {linking && (
        <OrderLinePicker r={r} purchaseOrders={purchaseOrders} onClose={() => setLinking(false)}
          onPick={(po, item) => run(async () => { await onLinkToOrder(r, po, item); setLinking(false) })} />
      )}
      {linkingProduct && (
        <ProductPicker
          products={stockItems.filter(si => !si.data?.archived).map(si => ({ si, theirs: false }))}
          supplier={null} startCreating={linkingProduct === 'create'} createLabel="Add to Products"
          initial={{ name: r.product_name, barcode: r.barcode || '' }}
          onClose={() => setLinkingProduct(null)} onCreate={onCreateProduct}
          onPick={(si) => { setLinkingProduct(null); run(() => onLinkProduct(r, si)) }} />
      )}
    </Drawer>
  )
}

/** Something already ordered: find the line on an open order and link to it. */
function OrderLinePicker({ r, purchaseOrders, onClose, onPick }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const lines = purchaseOrders
    .filter(po => expectsDelivery(po) && !['cancelled', 'completed'].includes(po.status))
    .flatMap(po => (po.items || []).map(item => ({ po, item })))
    .filter(({ item }) => num(item.qty_received) < num(item.qty) && item.line_status !== 'cancelled')
    .map(x => ({ ...x, same: !!r.stock_item_id && x.item.stock_item_id === r.stock_item_id }))
    .filter(({ po, item }) => !query || item.name.toLowerCase().includes(query) || po.po_number.toLowerCase().includes(query) || String(po.supplier_name || '').toLowerCase().includes(query))
    .sort((a, b) => (b.same - a.same) || new Date(b.po.created_at) - new Date(a.po.created_at))
    .slice(0, 40)
  return (
    <Modal title="Link to an order" description={`Which line on an open order is ${r.product_name}?`} onClose={onClose} maxWidth="max-w-xl">
      <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Product, PO or supplier" className="w-full mb-3" autoFocus />
      {lines.length === 0 ? <div className="text-sm text-ink/55">No open order lines match.</div> : (
        <div className="border border-rule rounded-[6px] bg-white divide-y divide-rule/70 overflow-hidden">
          {lines.map(({ po, item, same }) => (
            <button key={item.id} className="w-full text-left px-3 py-2.5 hover:bg-sky/25 flex items-center gap-3" onClick={() => onPick(po, item)}>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{item.name}</div>
                <div className="text-xs text-ink/50">{po.po_number} · {po.supplier_name} · {num(item.qty)} ordered</div>
              </div>
              {same && <StatusBadge tone="brand">Same product</StatusBadge>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function Fact({ label, value }) {
  return <div className="metric-card py-2"><div className="metric-label">{label}</div><div className="text-sm font-semibold text-ink">{value}</div></div>
}
function Row({ label, value }) {
  return <div className="flex justify-between items-center gap-3"><span className="text-ink/60">{label}</span><span className="text-ink text-right">{value}</span></div>
}
