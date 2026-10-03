import React, { useState, useMemo } from 'react'
import { fmt } from '../lib/calc'
import { poTotals, dueDateFor, PO_CATEGORIES, ORDER_METHODS, payeesFor, REPEATS, CREDIT_REASONS, isCredit } from '../lib/purchases'
import { Drawer, Icon, StatusBadge, SearchInput } from './UI'
import { pdfToText, canReadFile } from '../lib/pdfText'
import { parseInvoice } from '../lib/invoiceParse'
import { SupplierLink } from './Links'

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

/**
 * Raising an order: who it's with, what's on it, what it'll cost, and how it
 * gets paid. Prices start from what the portal holds for each product, so a
 * difference is visible rather than silently accepted.
 */
export default function PoBuilder({
  po, suppliers, stockItems, me, onClose, onSave, onSend, onCreateProduct, onUploadDoc, onCreatePayee,
}) {
  const [addingPayee, setAddingPayee] = useState(false)
  const [read, setRead] = useState(null)        // what a document told us
  const [reading, setReading] = useState(false)
  const credit = isCredit(po)
  const [form, setForm] = useState(() => ({
    category: po?.category || 'stock',
    supplier_id: po?.supplier_id || '', supplier_name: po?.supplier_name || '',
    terms: po?.terms || 'prepay', payment_due_at: po?.payment_due_at || '',
    creditDays: po?.data?.creditDays || 30,
    order_method: po?.order_method || 'proforma',
    repeat: po?.data?.repeat || 'none',
    invoice_path: po?.invoice_path || '',
    online_url: po?.online_url || '', login_hint: po?.login_hint || '',
    proforma_path: po?.proforma_path || '',
    delivery: po?.delivery ?? '', vatApplies: po?.data?.vatApplies !== false, vatRate: po?.data?.vatRate ?? 20,
    notes: po?.notes || '',
    credit_reason: po?.credit_reason || 'refund',
  }))
  const [items, setItems] = useState(() => (po?.items || []).map(i => ({ ...i, key: i.id || Math.random().toString(36).slice(2) })))
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const supplier = suppliers.find(s => s.id === form.supplier_id)
  const cat = PO_CATEGORIES[form.category] || PO_CATEGORIES.stock
  const buyingGoods = cat.goods
  const payees = payeesFor(form.category, suppliers)
  const methods = cat.methods.map(m => [m, ORDER_METHODS[m]])
  const invoiceFirst = form.order_method === 'invoice'

  // Switching what the order is for changes who can be paid and how
  const chooseCategory = (id) => {
    const next = PO_CATEGORIES[id]
    setForm(f => {
      const stillValid = payeesFor(id, suppliers).some(s => s.id === f.supplier_id)
      return {
        ...f, category: id,
        supplier_id: stillValid ? f.supplier_id : '',
        order_method: next.methods.includes(f.order_method) ? f.order_method : next.defaultMethod,
        terms: po ? f.terms : next.defaultTerms,
        payment_due_at: (po ? f.terms : next.defaultTerms) === 'credit' ? (f.payment_due_at || dueDateFor('credit', f.creditDays)) : '',
        repeat: f.repeat === 'none' && next.recurring ? next.recurring : f.repeat,
      }
    })
    if (!PO_CATEGORIES[id].goods) setItems(list => list.filter(i => !i.stock_item_id))
  }
  const totals = poTotals(items, { vatRate: form.vatRate, vatApplies: form.vatApplies, delivery: form.delivery })

  // If a document was read, the order must agree with it — a quiet difference
  // here means lines were missed, and the order would be paid short or over
  const docGoods = read && !read.unreadable && read.net != null ? read.net - (read.delivery || 0) : null
  const docTotal = read && !read.unreadable ? read.total : null
  const goodsGap = docGoods != null ? +(totals.subtotal - docGoods).toFixed(2) : null
  const totalGap = docTotal != null ? +(totals.total - docTotal).toFixed(2) : null
  const disagreesWithDocument = read?.applied && ((goodsGap != null && Math.abs(goodsGap) >= 0.02) || (totalGap != null && Math.abs(totalGap) >= 0.02))

  /** Products this supplier sells, so the obvious ones come first. */
  const theirProducts = useMemo(() => {
    const chosen = new Set(items.map(i => i.stock_item_id))
    return stockItems.filter(si => !si.data?.archived && !chosen.has(si.id))
      .map(si => ({ si, theirs: supplier && String(si.data?.supplierName || '').toLowerCase() === supplier.name.toLowerCase() }))
      .sort((a, b) => (b.theirs - a.theirs) || a.si.name.localeCompare(b.si.name))
  }, [stockItems, items, supplier])

  const addProduct = (si) => setItems(list => [...list, {
    key: Math.random().toString(36).slice(2),
    stock_item_id: si.id, name: si.name, supplier_sku: si.data?.supplierSku || '',
    qty: 1, unit_cost: num(si.data?.costPrice), qty_received: 0,
    data: { systemCost: num(si.data?.costPrice) },
  }])
  const patch = (key, p) => setItems(list => list.map(i => (i.key === key ? { ...i, ...p } : i)))
  const remove = (key) => setItems(list => list.filter(i => i.key !== key))

  const payload = () => ({
    ...po,
    category: form.category,
    supplier_id: form.supplier_id || null,
    supplier_name: supplier?.name || form.supplier_name || '',
    terms: form.terms,
    payment_due_at: form.terms === 'credit' ? (form.payment_due_at || dueDateFor('credit', form.creditDays)) : null,
    order_method: form.order_method,
    online_url: form.order_method === 'online' ? form.online_url.trim() : null,
    login_hint: form.order_method === 'online' ? form.login_hint.trim() : null,
    proforma_path: form.proforma_path || null,
    invoice_path: form.invoice_path || po?.invoice_path || null,
    subtotal: totals.subtotal, vat: totals.vat, delivery: totals.delivery, total: totals.total,
    notes: form.notes,
    kind: po?.kind || 'order',
    credit_for: po?.credit_for || null,
    credit_reason: credit ? form.credit_reason : null,
    // A credit is money coming back, so it carries negative amounts
    ...(credit ? { subtotal: -totals.subtotal, vat: -totals.vat, delivery: -totals.delivery, total: -totals.total } : {}),
    data: { ...(po?.data || {}), vatApplies: form.vatApplies, vatRate: num(form.vatRate), creditDays: num(form.creditDays), repeat: form.repeat },
  })

  const lines = () => items.map(({ key: _k, ...i }) => ({
    stock_item_id: i.stock_item_id || null, name: i.name, supplier_sku: i.supplier_sku || null,
    qty: num(i.qty), unit_cost: num(i.unit_cost), qty_received: num(i.qty_received), line_note: i.line_note || null,
    data: i.data || {},
  }))

  const problems = []
  if (!form.supplier_id) problems.push(buyingGoods ? 'Choose a supplier' : 'Choose who’s being paid')
  if (!items.length) problems.push(buyingGoods ? 'Add at least one product' : 'Add at least one line')
  if (items.some(i => !String(i.name || '').trim())) problems.push('Every line needs a description')
  if (items.some(i => num(i.qty) <= 0)) problems.push('Every line needs a quantity')
  if (items.some(i => num(i.unit_cost) <= 0)) problems.push('Every line needs a price')
  if (form.order_method === 'online' && !form.online_url.trim()) problems.push('Add the basket or checkout link')
  if (!credit && form.order_method === 'proforma' && !form.proforma_path) problems.push('Attach the proforma or quote')
  if (!credit && invoiceFirst && !form.invoice_path) problems.push('Attach their invoice')
  if (disagreesWithDocument) problems.push(`The total doesn’t match the document (${fmt(Math.abs(totalGap || goodsGap))} out)`)


  /** Read what's on the document, and offer it — never apply it silently. */
  const readDocument = async (file) => {
    if (!canReadFile(file)) {
      setRead({ unreadable: true, warnings: ['Only PDFs can be read — a photo or scan has to be typed in.'] })
      return
    }
    setReading(true)
    try {
      setRead(parseInvoice(await pdfToText(file)))
    } catch {
      setRead({ unreadable: true, warnings: ['That PDF couldn’t be read — type the details in instead.'] })
    } finally { setReading(false) }
  }

  /** Put what was read into the order, matching lines to products where we can. */
  const useReadDetails = () => {
    if (!read) return
    const matched = (read.lines || []).map(l => {
      const si = stockItems.find(s => !s.data?.archived && (
        (l.barcode && s.data?.barcode === l.barcode) ||
        (l.sku && String(s.data?.supplierSku || '').toLowerCase() === String(l.sku).toLowerCase())))
      return {
        key: Math.random().toString(36).slice(2),
        stock_item_id: si?.id || null,
        name: si?.name || l.name,
        supplier_sku: l.sku || si?.data?.supplierSku || '',
        qty: l.qty, unit_cost: l.unitCost, qty_received: 0,
        data: { systemCost: si ? num(si.data?.costPrice) : null, fromDocument: true },
      }
    })
    if (matched.length) setItems(matched)
    setForm(f => ({
      ...f,
      delivery: read.delivery != null ? String(read.delivery) : f.delivery,
      vatApplies: read.vat != null ? read.vat > 0 : f.vatApplies,
      // Match the document's VAT exactly rather than assuming 20%
      vatRate: read.vat && read.net ? +((read.vat / (read.net - (read.delivery || 0) + (read.delivery || 0))) * 100).toFixed(2) : f.vatRate,
      invoice_path: f.invoice_path,
    }))
    setRead({ ...read, applied: true })
  }

  const run = async (kind, fn) => { setBusy(kind); setError(''); try { await fn() } catch (e) { setError(e?.message || 'That didn’t work') } finally { setBusy(null) } }

  return (
    <Drawer title={po?.po_number ? `${credit ? 'Credit note' : 'Edit'} ${po.po_number}` : 'New purchase order'}
      description={credit
        ? `Money coming back${supplier ? ` from ${supplier.name}` : ''}${po?.data?.creditForNumber ? ` against ${po.data.creditForNumber}` : ''}`
        : (supplier ? supplier.name : 'Choose a supplier, then add what you’re ordering')}
      onClose={onClose} width="max-w-3xl"
      footer={
        <div>
          {problems.length > 0 && <div className="text-xs text-warn mb-2">{problems.join(' · ')}</div>}
          {error && <div className="text-sm text-loss mb-2">{error}</div>}
          <div className="flex gap-2 justify-between flex-wrap">
            <div className="text-sm"><span className="text-ink/55">Total</span> <b className="text-ink text-lg">{fmt(totals.total)}</b></div>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" disabled={!!busy || !form.supplier_id}
                onClick={() => run('draft', () => onSave(payload(), lines()))}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
              <button className="btn btn-primary btn-sm" disabled={!!busy || problems.length > 0}
                onClick={() => run('send', () => onSend(payload(), lines()))}>
                <Icon name="send" size={14} /> {busy === 'send' ? 'Saving…' : credit ? 'Record the credit' : 'Send for payment'}
              </button>
            </div>
          </div>
        </div>
      }>

      <div className="mb-4">
        <div className="label">What is this order for?</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(PO_CATEGORIES).map(([id, c]) => (
            <button key={id} type="button" onClick={() => chooseCategory(id)}
              className={`p-2.5 rounded-lg border text-left transition-colors ${form.category === id ? 'border-royal-400 bg-royal-50' : 'border-rule bg-white hover:border-royal-200'}`}>
              <Icon name={c.icon} size={15} className="text-royal-500" />
              <div className="text-sm font-medium text-ink mt-1">{c.label}</div>
              <div className="text-xs text-ink/50">{c.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label" htmlFor="po-supplier">{cat.payee}</label>
          <div className="flex gap-2">
            <select id="po-supplier" className="input flex-1" value={form.supplier_id}
              onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">Choose…</option>
              {payees.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingPayee(true)} title={`Add a new ${cat.payee.toLowerCase()}`}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {payees.length === 0 && <div className="text-xs text-warn mt-1">No {cat.payee.toLowerCase()}s yet — add one.</div>}
          {buyingGoods && supplier?.data?.moq > 0 && (
            <div className={`text-xs mt-1 ${totals.subtotal >= supplier.data.moq ? 'text-gain' : 'text-warn'}`}>
              Minimum order {fmt(supplier.data.moq)} — {totals.subtotal >= supplier.data.moq ? 'met' : `${fmt(supplier.data.moq - totals.subtotal)} short`}
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="po-terms">Payment terms</label>
          <select id="po-terms" className="input" value={form.terms} onChange={set('terms')}>
            <option value="prepay">Pay before they release it</option>
            <option value="credit">On account — pay later</option>
          </select>
        </div>
        {form.terms === 'credit' && (
          <>
            <div>
              <label className="label" htmlFor="po-days">Days to pay</label>
              <input id="po-days" type="number" className="input" value={form.creditDays}
                onChange={e => setForm(f => ({ ...f, creditDays: e.target.value, payment_due_at: dueDateFor('credit', e.target.value) }))} />
            </div>
            <div>
              <label className="label" htmlFor="po-due">Payment due</label>
              <input id="po-due" type="date" className="input" value={form.payment_due_at || dueDateFor('credit', form.creditDays)} onChange={set('payment_due_at')} />
            </div>
          </>
        )}
      </div>

      {credit && (
        <div className="card mb-4">
          <div className="font-semibold text-ink mb-3">Why they're crediting you</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="cr-reason">Reason</label>
              <select id="cr-reason" className="input" value={form.credit_reason} onChange={set('credit_reason')}>
                {Object.entries(CREDIT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <DocField label="Their credit note" path={form.proforma_path} busy={busy === 'proforma'}
              onUpload={(file) => run('proforma', async () => {
                const path = await onUploadDoc(file, 'proforma')
                setForm(f => ({ ...f, proforma_path: path }))
              })}
              onClear={() => setForm(f => ({ ...f, proforma_path: '' }))} />
          </div>
        </div>
      )}

      {!credit && (
      <div className="card mb-4">
        <div className="font-semibold text-ink mb-3">How it’s being ordered</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {methods.map(([id, m]) => (
            <button key={id} type="button" onClick={() => setForm(f => ({ ...f, order_method: id }))}
              className={`p-3 rounded-lg border text-left transition-colors ${form.order_method === id ? 'border-royal-400 bg-royal-50' : 'border-rule bg-white hover:border-royal-200'}`}>
              <Icon name={m.icon} size={15} className="text-royal-500" />
              <div className="text-sm font-medium text-ink mt-1">{m.label}</div>
            </button>
          ))}
        </div>

        {form.order_method === 'online' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="po-url">{buyingGoods ? 'Basket or checkout link' : 'Payment link'}</label>
              <input id="po-url" className="input" value={form.online_url} onChange={set('online_url')} placeholder="https://…" />
            </div>
            <div>
              <label className="label" htmlFor="po-login">Which login to use</label>
              <input id="po-login" className="input" value={form.login_hint} onChange={set('login_hint')} placeholder="e.g. MX Wholesale — office account" />
              <div className="text-xs text-ink/50 mt-1">Never put a password here — send that separately.</div>
            </div>
          </div>
        )}

        {form.order_method === 'proforma' && (
          <DocField label="Proforma or quote" path={form.proforma_path} busy={busy === 'proforma'}
            onUpload={(file) => run('proforma', async () => {
              const path = await onUploadDoc(file, 'proforma')
              setForm(f => ({ ...f, proforma_path: path }))
              await readDocument(file)
            })}
            onClear={() => setForm(f => ({ ...f, proforma_path: '' }))} />
        )}

        {invoiceFirst && (
          <div>
            <DocField label="Their invoice" path={form.invoice_path} busy={busy === 'invoice'}
              onUpload={(file) => run('invoice', async () => {
                const path = await onUploadDoc(file, 'invoice')
                setForm(f => ({ ...f, invoice_path: path }))
                await readDocument(file)
              })}
              onClear={() => setForm(f => ({ ...f, invoice_path: '' }))} />
            <div className="text-xs text-ink/50 mt-1">They’ve already billed you, so the invoice is the paperwork — nothing else needed.</div>
          </div>
        )}

        {form.order_method === 'phone' && (
          <div className="text-sm text-ink/60">Attach their paperwork later — you can still send this for payment.</div>
        )}

        {!credit && (cat.recurring || form.repeat !== 'none') ? (
          <div className="mt-3 max-w-xs">
            <label className="label" htmlFor="po-repeat">Does this repeat?</label>
            <select id="po-repeat" className="input" value={form.repeat} onChange={set('repeat')}>
              {Object.entries(REPEATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="text-xs text-ink/50 mt-1">You’ll be offered a copy for the next period once this one is paid.</div>
          </div>
        ) : null}
      </div>
      )}

      {(reading || read) && (
        <div className={`card mb-4 ${read?.unreadable ? 'border-warn/40' : 'border-royal-200'}`}>
          {reading ? (
            <div className="text-sm text-ink/60">Reading the document…</div>
          ) : read.unreadable ? (
            <div className="text-sm text-warn">{read.warnings[0]}</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-ink">Read from this document</div>
                  <div className="text-xs text-ink/55 mt-0.5">
                    {read.supplierName || 'Supplier not recognised'}
                    {read.invoiceNumber ? ` · ${read.invoiceNumber}` : ''}
                    {read.invoiceDate ? ` · ${new Date(read.invoiceDate).toLocaleDateString('en-GB')}` : ''}
                  </div>
                </div>
                {!read.applied
                  ? <button className="btn btn-primary btn-sm" onClick={useReadDetails}>
                      <Icon name="check" size={14} /> Use these details
                    </button>
                  : <StatusBadge tone="live">Used</StatusBadge>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Mini label="Goods" value={read.net != null ? fmt(read.net - (read.delivery || 0)) : '—'} />
                <Mini label="Delivery" value={read.delivery != null ? fmt(read.delivery) : '—'} />
                <Mini label="VAT" value={read.vat != null ? fmt(read.vat) : '—'} />
                <Mini label="Total" value={read.total != null ? fmt(read.total) : '—'} />
              </div>
              {read.lines?.length > 0 && (
                <div className="text-xs text-ink/55 mt-2">{read.lines.length} line{read.lines.length !== 1 ? 's' : ''} read — they’ll replace what’s on the order below.</div>
              )}
              {read.warnings.map((w, i) => <div key={i} className="text-xs text-warn mt-1">{w}</div>)}
            </>
          )}
        </div>
      )}

      {/* What's being ordered */}
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-ink">{credit ? 'What they’re crediting' : buyingGoods ? 'What you’re ordering' : 'What you’re paying for'}</div>
        <div className="flex gap-2">
          {buyingGoods && (
            <button className="btn btn-secondary btn-sm" onClick={() => setPicking(true)} disabled={!form.supplier_id}>
              <Icon name="plus" size={14} /> Add products
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setItems(list => [...list, {
            key: Math.random().toString(36).slice(2), stock_item_id: null, name: '', supplier_sku: '',
            qty: 1, unit_cost: 0, qty_received: 0, data: {},
          }])}>
            <Icon name="plus" size={14} /> Add a line
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-ink/50 border border-dashed border-rule rounded-card mb-4">
          {form.supplier_id ? (buyingGoods ? 'Nothing on this order yet.' : 'Add a line describing what’s being paid for.') : 'Choose who’s being paid first.'}
        </div>
      ) : (
        <div className="card-flush overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-paper border-b border-rule">
                <th className="th text-left px-4">Product</th><th className="th text-right px-2 w-24">Qty</th>
                <th className="th text-right px-2 w-28">Unit cost</th><th className="th text-right px-3 w-24">Line</th><th className="th w-10"></th>
              </tr></thead>
              <tbody>
                {items.map(i => {
                  const systemCost = num(i.data?.systemCost)
                  const differs = systemCost > 0 && Math.abs(num(i.unit_cost) - systemCost) >= 0.005
                  return (
                    <tr key={i.key} className="border-b border-rule/60">
                      <td className="td px-4">
                        {i.stock_item_id ? <div className="text-ink">{i.name}</div> : (
                          <input className="input" value={i.name} onChange={e => patch(i.key, { name: e.target.value })}
                            placeholder={buyingGoods ? 'What is it?' : 'e.g. Evri September invoice, trademark filing'} aria-label="Description" />
                        )}
                        <div className="text-xs text-ink/50">
                          {i.stock_item_id ? (i.supplier_sku ? `SKU ${i.supplier_sku}` : 'no SKU') : 'typed in'}
                          {differs && <span className="text-warn"> · portal has {fmt(systemCost)} — approve the change after the invoice</span>}
                        </div>
                      </td>
                      <td className="td px-2"><input type="number" min="1" className="input text-right" value={i.qty} onChange={e => patch(i.key, { qty: e.target.value })} aria-label={`Quantity of ${i.name}`} /></td>
                      <td className="td px-2"><input type="number" step="0.01" className="input text-right" value={i.unit_cost} onChange={e => patch(i.key, { unit_cost: e.target.value })} aria-label={`Unit cost of ${i.name}`} /></td>
                      <td className="td px-3 text-right font-medium">{fmt(num(i.qty) * num(i.unit_cost))}</td>
                      <td className="td px-2 text-right">
                        <button className="btn btn-xs btn-secondary" aria-label={`Remove ${i.name}`} onClick={() => remove(i.key)}><Icon name="trash" size={12} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="space-y-2">
          <div>
            <label className="label" htmlFor="po-del">Delivery charge £</label>
            <input id="po-del" type="number" step="0.01" className="input" value={form.delivery} onChange={set('delivery')}
              placeholder={supplier?.data?.delivery ? String(supplier.data.delivery) : '0.00'} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={form.vatApplies}
              onChange={e => setForm(f => ({ ...f, vatApplies: e.target.checked }))} />
            Add VAT at {form.vatRate}%
          </label>
          <div>
            <label className="label" htmlFor="po-notes">Notes for this order</label>
            <input id="po-notes" className="input" value={form.notes} onChange={set('notes')} placeholder="Anything Vanessa or the warehouse should know" />
          </div>
        </div>
        <div className={`card ${disagreesWithDocument ? 'border-loss/50' : ''}`}>
          {disagreesWithDocument && (
            <div className="text-sm text-loss mb-2">
              This doesn’t match the document: it says {docGoods != null ? `goods ${fmt(docGoods)}` : ''}
              {docTotal != null ? `${docGoods != null ? ' and ' : ''}total ${fmt(docTotal)}` : ''}.
              {goodsGap < 0 ? ' Lines are missing from this order.' : ' There is more on this order than on the document.'}
            </div>
          )}
          <Row label="Goods" value={fmt(totals.subtotal)} />
          <Row label="Delivery" value={fmt(totals.delivery)} />
          <Row label={`VAT${form.vatApplies ? ` (${form.vatRate}%)` : ''}`} value={fmt(totals.vat)} />
          <div className="flex justify-between pt-2 mt-1 border-t border-rule">
            <span className="font-semibold text-ink">Total to pay</span>
            <span className="font-semibold text-ink text-lg">{fmt(totals.total)}</span>
          </div>
          <div className="text-xs text-ink/50 mt-2">This should match the supplier’s proforma.</div>
        </div>
      </div>

      {addingPayee && (
        <PayeeForm cat={cat} onClose={() => setAddingPayee(false)}
          onSave={async (payee) => {
            const created = await onCreatePayee(payee, cat.kind)
            if (created) setForm(f => ({ ...f, supplier_id: created.id }))
            setAddingPayee(false)
          }} />
      )}

      {picking && (
        <ProductPicker products={theirProducts} supplier={supplier} onClose={() => setPicking(false)}
          onPick={(si) => { addProduct(si); }} onCreate={onCreateProduct} />
      )}
    </Drawer>
  )
}

function Mini({ label, value }) {
  return <div className="metric-card py-2"><div className="metric-label">{label}</div><div className="text-sm font-semibold text-ink">{value}</div></div>
}

function Row({ label, value }) {
  return <div className="flex justify-between py-1 text-sm"><span className="text-ink/65">{label}</span><span className="text-ink">{value}</span></div>
}

export function DocField({ label, path, onUpload, onClear, busy, onView }) {
  const ref = React.useRef(null)
  return (
    <div>
      <div className="label">{label}</div>
      {path ? (
        <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-lg border border-rule bg-paper">
          <Icon name="check" size={14} className="text-gain" />
          <span className="text-sm text-ink truncate flex-1 min-w-0">{String(path).split('/').pop()}</span>
          {onView && <button className="btn btn-secondary btn-xs" onClick={() => onView(path)}>View</button>}
          {onClear && <button className="btn btn-secondary btn-xs" onClick={onClear}>Replace</button>}
        </div>
      ) : (
        <>
          <input ref={ref} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.xls,.csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
          <button className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()} disabled={busy}>
            <Icon name="upload" size={14} /> {busy ? 'Uploading…' : 'Choose a file'}
          </button>
          <span className="text-xs text-ink/50 ml-2">PDF, photo or spreadsheet</span>
        </>
      )}
    </div>
  )
}

/** Pick from what you stock, or add something the portal doesn't know yet. */
function ProductPicker({ products, supplier, onClose, onPick, onCreate }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', supplierSku: '', costPrice: '', weightKg: '', barcode: '' })
  const [busy, setBusy] = useState(false)
  const query = q.trim().toLowerCase()
  const shown = products.filter(({ si }) => !query || si.name.toLowerCase().includes(query) ||
    String(si.data?.supplierSku || '').toLowerCase().includes(query) || String(si.data?.barcode || '').includes(query)).slice(0, 60)

  return (
    <div className="fixed inset-0 bg-ink/35 z-[60] flex items-start justify-center p-4 pt-16" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-paper border border-rule rounded-[7px] w-full max-w-2xl shadow-modal overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 bg-white border-b border-rule flex items-center gap-3">
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search your products" className="flex-1" autoFocus />
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Done</button>
        </div>
        <div className="overflow-y-auto">
          {creating ? (
            <div className="p-4 space-y-3">
              <div className="text-sm font-semibold text-ink">New product{supplier ? ` from ${supplier.name}` : ''}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="label" htmlFor="np-name">Name</label>
                  <input id="np-name" className="input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} autoFocus /></div>
                <div><label className="label" htmlFor="np-sku">Supplier code</label>
                  <input id="np-sku" className="input" value={draft.supplierSku} onChange={e => setDraft(d => ({ ...d, supplierSku: e.target.value }))} /></div>
                <div><label className="label" htmlFor="np-cost">Unit cost £</label>
                  <input id="np-cost" type="number" step="0.01" className="input" value={draft.costPrice} onChange={e => setDraft(d => ({ ...d, costPrice: e.target.value }))} /></div>
                <div><label className="label" htmlFor="np-w">Weight (kg)</label>
                  <input id="np-w" type="number" step="0.001" className="input" value={draft.weightKg} onChange={e => setDraft(d => ({ ...d, weightKg: e.target.value }))} /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="np-bar">Barcode</label>
                  <input id="np-bar" className="input" value={draft.barcode} onChange={e => setDraft(d => ({ ...d, barcode: e.target.value }))} /></div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>Back</button>
                <button className="btn btn-primary btn-sm" disabled={busy || !draft.name.trim() || !(parseFloat(draft.costPrice) > 0)}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const si = await onCreate({ ...draft, supplierName: supplier?.name || '' })
                      if (si) { onPick(si); setCreating(false); setDraft({ name: '', supplierSku: '', costPrice: '', weightKg: '', barcode: '' }) }
                    } finally { setBusy(false) }
                  }}>{busy ? 'Adding…' : 'Add to the order'}</button>
              </div>
            </div>
          ) : (
            <>
              {shown.map(({ si, theirs }) => (
                <button key={si.id} className="w-full text-left px-4 py-2.5 border-b border-rule/60 hover:bg-royal-50/50 flex items-center gap-3"
                  onClick={() => onPick(si)}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{si.name}</div>
                    <div className="text-xs text-ink/50">{si.data?.supplierName || 'no supplier'}{si.data?.supplierSku ? ` · ${si.data.supplierSku}` : ''}</div>
                  </div>
                  {theirs && <StatusBadge tone="brand">Theirs</StatusBadge>}
                  <span className="text-sm text-ink/70">{fmt(num(si.data?.costPrice))}</span>
                </button>
              ))}
              <button className="w-full text-left px-4 py-3 text-sm font-medium text-royal-600 hover:bg-royal-50/50" onClick={() => { setCreating(true); setDraft(d => ({ ...d, name: q })) }}>
                <Icon name="plus" size={14} /> Add a product the portal doesn’t have yet{q ? ` — “${q}”` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


/** Adding a company to pay, without leaving the order. */
function PayeeForm({ cat, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', website: '', accountRef: '', creditDays: cat.defaultTerms === 'credit' ? 30 : '', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  return (
    <div className="fixed inset-0 bg-ink/35 z-[70] flex items-center justify-center p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-paper border border-rule rounded-[7px] w-full max-w-md shadow-modal overflow-hidden">
        <div className="px-5 py-4 bg-white border-b border-rule">
          <div className="font-semibold text-ink">New {cat.payee.toLowerCase()}</div>
          <div className="text-xs text-ink/55 mt-0.5">They’ll be available for {cat.label.toLowerCase()} orders from now on.</div>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="label" htmlFor="py-name">Name</label>
            <input id="py-name" className="input" value={form.name} onChange={set('name')} autoFocus placeholder={cat.kind === 'carrier' ? 'e.g. Evri' : 'Company name'} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="py-ref">Your account reference</label>
              <input id="py-ref" className="input" value={form.accountRef} onChange={set('accountRef')} placeholder="optional" /></div>
            <div><label className="label" htmlFor="py-days">Days to pay</label>
              <input id="py-days" type="number" className="input" value={form.creditDays} onChange={set('creditDays')} placeholder="e.g. 30" /></div>
          </div>
          <div><label className="label" htmlFor="py-web">Website</label>
            <input id="py-web" className="input" value={form.website} onChange={set('website')} placeholder="optional" /></div>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={busy || !form.name.trim()}
              onClick={async () => { setBusy(true); try { await onSave(form) } finally { setBusy(false) } }}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
