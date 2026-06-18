import React, { useState } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { EmptyState, Spinner, PLRow, SectionHead } from './UI'
import { OVERHEAD_CATEGORIES } from './OverheadsPage'

export default function BuildMonthPage({ months, settings, savedProducts, overheads, onSaveMonth, onUpdateMonth, onDeleteMonth, onRenameMonth, loading }) {
  const [selId, setSelId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('products')

  if (loading) return <Spinner />

  const createMonth = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      // Pre-populate month overheads from fixed overheads
      const monthOverheads = (overheads || []).map((o) => ({ ...o, overrideAmount: null, excluded: false }))
      const m = { name: newName.trim(), items: [], monthOverheads, oneOffExpenses: [] }
      const created = await onSaveMonth(m)
      setSelId(created.id)
      setShowNew(false)
      setNewName('')
    } finally {
      setSaving(false)
    }
  }

  const month = months.find((m) => m.id === selId)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Build a Month</h1>
          <p className="text-sm text-slate-400 mt-0.5">Forecast monthly revenue, costs, and full P&L</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New month</button>
      </div>

      {showNew && (
        <div className="card mb-4">
          <div className="font-medium text-sm mb-3">New month</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createMonth()}
              placeholder="e.g. June 2026"
              className="input flex-1"
            />
            <button className="btn btn-primary" onClick={createMonth} disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {months.length === 0 && !showNew && (
        <EmptyState icon="📅" title="No months yet" sub="Create a month to start building your forecast" />
      )}

      {months.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {months.map((m) => (
            <button
              key={m.id}
              className={`btn ${selId === m.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelId(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {month && (
        <MonthEditor
          month={month.data || month}
          monthId={month.id}
          monthName={month.name}
          settings={settings}
          savedProducts={savedProducts}
          fixedOverheads={overheads || []}
          onUpdate={(updated) => onUpdateMonth(month.id, updated)}
          onDelete={() => { if(window.confirm('Delete this month? This cannot be undone.')) { onDeleteMonth(month.id); setSelId(null) } }}
          onRename={(newName) => onRenameMonth && onRenameMonth(month.id, newName)}
          tab={tab}
          setTab={setTab}
        />
      )}
    </div>
  )
}

function MonthEditor({ month, monthName, settings, savedProducts, fixedOverheads, onUpdate, onDelete, onRename, tab, setTab }) {
  const [renamingMonth, setRenamingMonth] = React.useState(false)
  const [renameVal, setRenameVal] = React.useState('')
  const [drillProduct, setDrillProduct] = React.useState(null)
  const [tableSort, setTableSort] = React.useState({ col: 'margin', dir: 'desc' })

  const sortTable = (col) => setTableSort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))
  const sortIcon = (col) => tableSort.col === col ? (tableSort.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕'
  const { carriers, packaging } = settings

  const addItem = () => {
    const item = {
      id: 'i' + Date.now(), productId: '', customName: '', units: '',
      sellPrice: '', costPrice: '', adCost: '', refFee: '15.3',
      vatZero: false, weightKg: '', serviceLevel: 'standard',
      carrierId: '', carrierCatId: '', packagingId: '',
      parcelSplit: false, numParcels: '1', parcelWeights: [],
    }
    onUpdate({ ...month, items: [...(month.items || []), item] })
  }

  const updateItem = (id, k, v) =>
    onUpdate({ ...month, items: month.items.map((i) => i.id === id ? { ...i, [k]: v } : i) })

  const loadSavedIntoItem = (itemId, productId) => {
    const prod = savedProducts.find((p) => p.id === productId)
    if (!prod) return
    onUpdate({
      ...month,
      items: month.items.map((i) =>
        i.id === itemId ? { ...prod.data, id: itemId, units: i.units, productId } : i
      ),
    })
  }

  const delItem = (id) => onUpdate({ ...month, items: month.items.filter((i) => i.id !== id) })

  // Sync fixed overheads into month if new ones were added since month creation
  const monthOverheads = (() => {
    const existing = month.monthOverheads || []
    const existingIds = new Set(existing.map((o) => o.id))
    const newFixed = fixedOverheads.filter((o) => !existingIds.has(o.id)).map((o) => ({ ...o, overrideAmount: null, excluded: false }))
    return [...existing, ...newFixed]
  })()

  const updateMonthOverhead = (id, field, value) => {
    const updated = monthOverheads.map((o) => o.id === id ? { ...o, [field]: value } : o)
    onUpdate({ ...month, monthOverheads: updated })
  }

  const oneOffExpenses = month.oneOffExpenses || []

  const addOneOff = () => {
    onUpdate({
      ...month,
      oneOffExpenses: [...oneOffExpenses, { id: 'oo' + Date.now(), name: '', amount: '', categoryId: 'other' }],
    })
  }

  const updateOneOff = (id, k, v) =>
    onUpdate({ ...month, oneOffExpenses: oneOffExpenses.map((e) => e.id === id ? { ...e, [k]: v } : e) })

  const delOneOff = (id) =>
    onUpdate({ ...month, oneOffExpenses: oneOffExpenses.filter((e) => e.id !== id) })

  const items = month.items || []

  const rows = items.map((item) => {
    const r = calcProduct(item, carriers, packaging)
    const u = parseFloat(item.units) || 0
    const linkedProduct = item.productId ? savedProducts.find((p) => p.id === item.productId) : null
    const name = linkedProduct?.name
      || item.name
      || item.customName
      || (item.productId ? `Deleted product (was linked)` : 'Unnamed product')
    return { item, r, u, name }
  })

  const salesTotals = rows.reduce((acc, { r, u }) => ({
    revenue: acc.revenue + r.sellPrice * u,
    exVatRevenue: acc.exVatRevenue + r.exVatRevenue * u,
    vatLiability: acc.vatLiability + r.vatAmount * u,
    cogs: acc.cogs + r.costPrice * u,
    referralFees: acc.referralFees + r.referralFee * u,
    shipping: acc.shipping + r.shippingCost * u,
    packaging: acc.packaging + r.packCost * u,
    adSpend: acc.adSpend + r.adCost * u,
    grossProfit: acc.grossProfit + r.netProfit * u,
  }), { revenue: 0, exVatRevenue: 0, vatLiability: 0, cogs: 0, referralFees: 0, shipping: 0, packaging: 0, adSpend: 0, grossProfit: 0 })

  const costOfSales = salesTotals.cogs + salesTotals.referralFees + salesTotals.shipping + salesTotals.packaging + salesTotals.adSpend
  const grossMargin = salesTotals.revenue > 0 ? (salesTotals.grossProfit / salesTotals.revenue) * 100 : 0

  // Overheads totals
  const activeOverheads = monthOverheads.filter((o) => !o.excluded)
  const totalFixedOverheads = activeOverheads.reduce((s, o) => s + (parseFloat(o.overrideAmount ?? o.amount) || 0), 0)
  const totalOneOffs = oneOffExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalOverheads = totalFixedOverheads + totalOneOffs

  // Per-category overhead totals
  const overheadByCategory = OVERHEAD_CATEGORIES.map((cat) => ({
    ...cat,
    items: activeOverheads.filter((o) => o.categoryId === cat.id),
    total: activeOverheads.filter((o) => o.categoryId === cat.id).reduce((s, o) => s + (parseFloat(o.overrideAmount ?? o.amount) || 0), 0),
  })).filter((g) => g.items.length > 0)

  const oneOffByCategory = OVERHEAD_CATEGORIES.map((cat) => ({
    ...cat,
    items: oneOffExpenses.filter((e) => e.categoryId === cat.id),
    total: oneOffExpenses.filter((e) => e.categoryId === cat.id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0),
  })).filter((g) => g.items.length > 0)

  const netProfit = salesTotals.grossProfit - totalOverheads
  const netMargin = salesTotals.revenue > 0 ? (netProfit / salesTotals.revenue) * 100 : 0

  const printPL = (name) => {
    const el = document.getElementById('pl-printable')
    if (!el) return
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head>
<title>${name} P&L</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 15mm 12mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a2e; background: white; }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
  .sub { color: #64748b; font-size: 10px; margin-bottom: 16px; }
  .header { border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .company { font-size: 10px; color: #64748b; text-align: right; }
  .metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 16px; }
  .metric { background: #f8fafc; border-radius: 6px; padding: 10px; text-align: center; }
  .metric-label { font-size: 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .metric-value { font-size: 14px; font-weight: 700; }
  .section { font-size: 8px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .8px; margin: 12px 0 4px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .row { display: flex; justify-content: space-between; padding: 3.5px 0; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
  .row.subtotal { font-weight: 600; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; padding: 4px 0; margin-top: 2px; }
  .row.highlight { background: #f8fafc; padding: 7px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; border: none; margin: 6px 0; }
  .row.net { background: #1a1a2e; color: white; padding: 8px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; border: none; margin: 6px 0; }
  .red { color: #ef4444; } .green { color: #22c55e; } .blue { color: #3b82f6; }
  .amber { background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; padding: 6px 10px; margin: 6px 0; font-size: 10px; display: flex; justify-content: space-between; }
  .breakdown-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1a1a2e; padding-bottom: 6px; margin: 16px 0 6px; }
  .breakdown-head strong { font-size: 12px; font-weight: 700; }
  .pills { display: flex; gap: 6px; }
  .pill { background: #e0e7ff; color: #3730a3; font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .table { width: 100%; border-collapse: collapse; }
  .table th { text-align: left; padding: 5px 6px; font-size: 8px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .4px; border-bottom: 2px solid #e2e8f0; background: #f8fafc; }
  .table th.r { text-align: right; }
  .table td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; font-size: 10px; }
  .table td.r { text-align: right; }
  .table tr:nth-child(even) td { background: #fafafa; }
  .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .table tr { page-break-inside: avoid; }
    .breakdown-head { page-break-before: auto; }
  }
</style>
</head><body>`)
    win.document.write(el.innerHTML)
    win.document.write(`<div class="footer"><span>Adrian Marsh Ltd — Homey International</span><span>Generated ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}</span></div>`)
    win.document.write('</body></html>')
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 600)
  }

  const tabs = [
    { id: 'products', label: '📦 Products' },
    { id: 'overheads', label: '💼 Overheads' },
    { id: 'pl', label: '📊 P&L' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {renamingMonth ? (
            <div className="flex gap-2 items-center">
              <input autoFocus className="input text-sm font-semibold" style={{maxWidth:200}} value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if(e.key==='Enter'&&renameVal.trim()){onRename(renameVal.trim());setRenamingMonth(false)} if(e.key==='Escape')setRenamingMonth(false) }} />
              <button className="btn btn-primary btn-xs" onClick={()=>{if(renameVal.trim())onRename(renameVal.trim());setRenamingMonth(false)}}>Save</button>
              <button className="btn btn-secondary btn-xs" onClick={()=>setRenamingMonth(false)}>Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="font-semibold text-base text-slate-800">{monthName || month.name}</div>
              <button className="text-slate-300 hover:text-slate-500 text-xs" onClick={()=>{setRenamingMonth(true);setRenameVal(monthName||month.name)}} title="Rename">✏️</button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button className={`btn btn-sm ${tab === 'pl' ? 'btn-secondary opacity-40 cursor-not-allowed' : 'btn-secondary'}`} onClick={tab !== 'pl' ? addItem : undefined} disabled={tab === 'pl'}>+ Add product</button>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑 Delete month</button>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Products tab */}
      {tab === 'products' && (
        <div>
          <div className="space-y-3 mb-4">
            {items.map((item) => {
              const r = calcProduct(item, carriers, packaging)
              return (
                <div key={item.id} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        value={item.productId || ''}
                        onChange={(e) => {
                          if (e.target.value) loadSavedIntoItem(item.id, e.target.value)
                          else updateItem(item.id, 'productId', '')
                        }}
                        className="input text-sm"
                        style={{ width: 180 }}
                      >
                        <option value="">— Custom product —</option>
                        {savedProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {!item.productId && (
                        <input
                          value={item.customName || ''}
                          onChange={(e) => updateItem(item.id, 'customName', e.target.value)}
                          placeholder="Product name"
                          className="input text-sm"
                          style={{ width: 160 }}
                        />
                      )}
                    </div>
                    <button className="btn btn-danger btn-xs" onClick={() => { if(window.confirm('Remove this product from the month?')) delItem(item.id) }}>✕</button>
                  </div>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div style={{ width: 90 }}>
                      <label className="label">Units / mo</label>
                      <input type="number" value={item.units || ''} onChange={(e) => updateItem(item.id, 'units', e.target.value)} className="input text-sm" />
                    </div>
                    {!item.productId && (
                      <>
                        <div style={{ width: 90 }}>
                          <label className="label">Sell £</label>
                          <input type="number" value={item.sellPrice || ''} onChange={(e) => updateItem(item.id, 'sellPrice', e.target.value)} className="input text-sm" />
                        </div>
                        <div style={{ width: 90 }}>
                          <label className="label">Cost £</label>
                          <input type="number" value={item.costPrice || ''} onChange={(e) => updateItem(item.id, 'costPrice', e.target.value)} className="input text-sm" />
                        </div>
                        <div style={{ width: 80 }}>
                          <label className="label">Ad £</label>
                          <input type="number" value={item.adCost || ''} onChange={(e) => updateItem(item.id, 'adCost', e.target.value)} className="input text-sm" />
                        </div>
                        <div style={{ width: 100 }}>
                          <label className="label">Ref fee %</label>
                          <input type="number" value={item.refFee || '15.3'} onChange={(e) => updateItem(item.id, 'refFee', e.target.value)} className="input text-sm" />
                        </div>
                      </>
                    )}
                    <div className="ml-auto text-right">
                      <div className="text-xs text-slate-400">Profit / unit</div>
                      <div className={`font-semibold text-sm ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {fmtSigned(r.netProfit)}
                      </div>
                      {parseFloat(item.units) > 0 && (
                        <div className={`text-xs ${r.netProfit * (parseFloat(item.units) || 0) >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                          {fmtSigned(r.netProfit * (parseFloat(item.units) || 0))} / mo
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {items.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
                No products added yet — click "Add product" to start
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overheads tab */}
      {tab === 'overheads' && (
        <div>
          {/* Fixed overheads */}
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-sm text-slate-700">Fixed monthly overheads</div>
                <div className="text-xs text-slate-400 mt-0.5">From your Overheads page — edit amounts or exclude for this month</div>
              </div>
              <span className="text-sm font-medium text-slate-600">{fmt(totalFixedOverheads)} / mo</span>
            </div>

            {monthOverheads.length === 0 && (
              <div className="text-sm text-slate-400 py-4 text-center">
                No fixed overheads set up yet — add them in the Overheads page
              </div>
            )}

            {OVERHEAD_CATEGORIES.map((cat) => {
              const catItems = monthOverheads.filter((o) => o.categoryId === cat.id)
              if (!catItems.length) return null
              return (
                <div key={cat.id} className="mb-4">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <span>{cat.icon}</span> {cat.label}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {catItems.map((o) => (
                        <tr key={o.id} className={`border-b border-slate-50 last:border-0 ${o.excluded ? 'opacity-40' : ''}`}>
                          <td className="py-2 text-slate-700">{o.name}</td>
                          <td className="py-2 w-28">
                            <input
                              type="number"
                              value={o.overrideAmount ?? o.amount}
                              onChange={(e) => updateMonthOverhead(o.id, 'overrideAmount', e.target.value)}
                              className="input text-sm"
                              disabled={o.excluded}
                            />
                          </td>
                          <td className="py-2 pl-3">
                            {o.overrideAmount !== null && o.overrideAmount !== undefined && (
                              <span className="badge badge-amber text-xs mr-2">edited</span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <label className="flex items-center justify-end gap-1.5 cursor-pointer text-xs text-slate-500">
                              <input
                                type="checkbox"
                                checked={!!o.excluded}
                                onChange={(e) => updateMonthOverhead(o.id, 'excluded', e.target.checked)}
                                className="accent-indigo-500"
                              />
                              Exclude
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>

          {/* One-off expenses */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-sm text-slate-700">One-off expenses this month</div>
                <div className="text-xs text-slate-400 mt-0.5">Equipment, trade shows, ad campaigns, anything non-recurring</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={addOneOff}>+ Add</button>
            </div>

            {oneOffExpenses.length === 0 && (
              <div className="text-sm text-slate-400 py-3 text-center">No one-off expenses this month</div>
            )}

            <div className="space-y-2">
              {oneOffExpenses.map((e) => (
                <div key={e.id} className="flex flex-wrap gap-2 items-end">
                  <div style={{ minWidth: 140, flex: 1 }}>
                    <label className="label">Description</label>
                    <input value={e.name || ''} onChange={(ev) => updateOneOff(e.id, 'name', ev.target.value)} placeholder="e.g. New printer" className="input text-sm" />
                  </div>
                  <div style={{ width: 130 }}>
                    <label className="label">Category</label>
                    <select value={e.categoryId || 'other'} onChange={(ev) => updateOneOff(e.id, 'categoryId', ev.target.value)} className="input text-sm">
                      {OVERHEAD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 110 }}>
                    <label className="label">Amount £</label>
                    <input type="number" value={e.amount || ''} onChange={(ev) => updateOneOff(e.id, 'amount', ev.target.value)} className="input text-sm" />
                  </div>
                  <button className="btn btn-danger btn-xs mb-0.5" onClick={() => { if(window.confirm('Remove this expense?')) delOneOff(e.id) }}>✕</button>
                </div>
              ))}
            </div>

            {oneOffExpenses.length > 0 && (
              <div className="flex justify-between text-sm font-medium mt-4 pt-3 border-t border-slate-100">
                <span className="text-slate-600">Total one-offs</span>
                <span>{fmt(totalOneOffs)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden printable P&L */}
      <div id="pl-printable" style={{display:'none'}}>
        <div className="header">
          <div>
            <h1>{monthName || month.name} — P&L</h1>
            <div className="sub">Profit &amp; Loss Statement</div>
          </div>
          <div className="company">Adrian Marsh Ltd<br/>Homey International</div>
        </div>
        <div className="metrics">
          <div className="metric"><div className="metric-label">Gross Revenue</div><div className="metric-value">{fmt(salesTotals.revenue)}</div></div>
          <div className="metric"><div className="metric-label">Gross Profit</div><div className="metric-value" style={{color:salesTotals.grossProfit>=0?'#22c55e':'#ef4444'}}>{fmtSigned(salesTotals.grossProfit)}</div></div>
          <div className="metric"><div className="metric-label">Net Profit</div><div className="metric-value" style={{color:netProfit>=0?'#22c55e':'#ef4444'}}>{fmtSigned(netProfit)}</div></div>
          <div className="metric"><div className="metric-label">VAT Liability</div><div className="metric-value" style={{color:'#3b82f6'}}>{fmt(salesTotals.vatLiability)}</div></div>
        </div>
        <div className="section">Revenue</div>
        <div className="row"><span>Gross revenue (inc. VAT)</span><span>{fmt(salesTotals.revenue)}</span></div>
        <div className="row"><span>VAT liability</span><span className="red">-{fmt(salesTotals.vatLiability)}</span></div>
        <div className="row"><span>Ex-VAT revenue</span><span>{fmt(salesTotals.exVatRevenue)}</span></div>
        <div className="section">Cost of Sales</div>
        <div className="row"><span>Cost of goods</span><span className="red">-{fmt(salesTotals.cogs)}</span></div>
        <div className="row"><span>Amazon referral fees</span><span className="red">-{fmt(salesTotals.referralFees)}</span></div>
        <div className="row"><span>Shipping costs</span><span className="red">-{fmt(salesTotals.shipping)}</span></div>
        <div className="row"><span>Packaging costs</span><span className="red">-{fmt(salesTotals.packaging)}</span></div>
        <div className="row"><span>Ad spend</span><span className="red">-{fmt(salesTotals.adSpend)}</span></div>
        <div className="row total"><span>Total cost of sales</span><span>-{fmt(costOfSales)}</span></div>
        <div className="amber"><strong>Upfront cost (stock + packaging):</strong> {fmt(salesTotals.cogs + salesTotals.packaging)}</div>
        <div className="row highlight"><span>Gross profit</span><span style={{color:salesTotals.grossProfit>=0?'#22c55e':'#ef4444'}}>{fmtSigned(salesTotals.grossProfit)} ({pct(grossMargin)})</span></div>
        <div className="section">Overheads</div>
        {overheadByCategory.map(cat=>(
          <div key={cat.id}>{cat.items.map(o=>(
            <div key={o.id} className="row"><span>{o.name}</span><span className="red">-{fmt(parseFloat(o.overrideAmount??o.amount)||0)}</span></div>
          ))}</div>
        ))}
        {oneOffByCategory.map(cat=>(
          <div key={cat.id+'_oo'}>{cat.items.filter(e=>e.name&&e.amount).map(e=>(
            <div key={e.id} className="row"><span>{e.name} (one-off)</span><span className="red">-{fmt(parseFloat(e.amount)||0)}</span></div>
          ))}</div>
        ))}
        <div className="row total"><span>Total overheads</span><span>-{fmt(totalOverheads)}</span></div>
        <div className="row net"><span>Net profit</span><span style={{color:netProfit>=0?'#86efac':'#fca5a5'}}>{fmtSigned(netProfit)} ({pct(netMargin)})</span></div>
        {rows.length > 0 && (<>
          <div className="breakdown-head">
            <strong>Product Breakdown</strong>
            <div className="pills">
              <span className="pill">{rows.filter(r=>r.u>0).length} products</span>
              <span className="pill">{rows.reduce((s,{u})=>s+u,0).toLocaleString()} units</span>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Product</th><th className="r">Units</th><th className="r">Cost of Sales</th><th className="r">Revenue</th><th className="r">Gross Profit</th><th className="r">Margin</th></tr></thead>
            <tbody>{[...rows].sort((a,b)=>b.r.margin-a.r.margin).map(({item,r,u,name})=>(
              <tr key={item.id}><td>{name}</td><td className="r">{u}</td><td className="r">{fmt((r.costPrice+r.referralFee+r.shippingCost+r.packCost+r.adCost)*u)}</td><td className="r">{fmt(r.sellPrice*u)}</td><td className="r" style={{color:r.netProfit*u>=0?'#22c55e':'#ef4444'}}>{fmtSigned(r.netProfit*u)}</td><td className="r">{pct(r.margin)}</td></tr>
            ))}</tbody>
          </table>
        </>)}
      </div>

      {/* P&L tab */}
      {tab === 'pl' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <span>📊</span> {month.name} — Full P&L
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => printPL(month.name)}>🖨️ Save as PDF</button>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="metric-card">
              <div className="metric-label">Gross Revenue</div>
              <div className="metric-value">{fmt(salesTotals.revenue)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Gross Profit</div>
              <div className={`metric-value ${salesTotals.grossProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {fmtSigned(salesTotals.grossProfit)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Net Profit</div>
              <div className={`metric-value ${netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {fmtSigned(netProfit)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">VAT Liability</div>
              <div className="metric-value text-blue-600">{fmt(salesTotals.vatLiability)}</div>
            </div>
          </div>

          {/* Revenue section */}
          <SectionHead>Revenue</SectionHead>
          <PLRow label="Gross revenue (inc. VAT)" value={fmt(salesTotals.revenue)} />
          <PLRow label="VAT liability" value={`-${fmt(salesTotals.vatLiability)}`} valueClass="text-red-500" />
          <PLRow label="Ex-VAT revenue" value={fmt(salesTotals.exVatRevenue)} valueClass="font-medium" />

          {/* Cost of sales */}
          <SectionHead>Cost of sales</SectionHead>
          <PLRow label="Cost of goods" value={`-${fmt(salesTotals.cogs)}`} valueClass="text-red-500" />
          <PLRow label="Amazon referral fees" value={`-${fmt(salesTotals.referralFees)}`} valueClass="text-red-500" />
          <PLRow label="Shipping costs" value={`-${fmt(salesTotals.shipping)}`} valueClass="text-red-500" />
          <PLRow label="Packaging costs" value={`-${fmt(salesTotals.packaging)}`} valueClass="text-red-500" />
          <PLRow label="Ad spend" value={`-${fmt(salesTotals.adSpend)}`} valueClass="text-red-500" />
          <PLRow label="Total cost of sales" value={`-${fmt(costOfSales)}`} valueClass="font-medium" />
          <div className="flex justify-between items-center py-2 px-3 bg-amber-50 border border-amber-100 rounded-lg mt-2">
            <div>
              <span className="text-sm font-medium text-amber-800">Upfront cost</span>
              <span className="text-xs text-amber-600 ml-2">(stock + packaging — cash needed before selling)</span>
            </div>
            <span className="font-semibold text-amber-800">{fmt(salesTotals.cogs + salesTotals.packaging)}</span>
          </div>

          {/* Gross profit line */}
          <div className="flex justify-between items-center py-3 my-1 bg-slate-50 rounded-lg px-3">
            <span className="font-semibold text-slate-700">Gross profit</span>
            <div className="text-right">
              <span className={`font-bold text-base ${salesTotals.grossProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {fmtSigned(salesTotals.grossProfit)}
              </span>
              <span className={`text-xs ml-2 ${grossMargin >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                {pct(grossMargin)} margin
              </span>
            </div>
          </div>

          {/* Overheads section */}
          <SectionHead>Overheads</SectionHead>

          {overheadByCategory.map((cat) => (
            <div key={cat.id}>
              <div className="text-xs text-slate-400 mt-2 mb-1 flex items-center gap-1">
                <span>{cat.icon}</span> {cat.label}
              </div>
              {cat.items.map((o) => (
                <PLRow key={o.id} label={o.name} value={`-${fmt(parseFloat(o.overrideAmount ?? o.amount) || 0)}`} valueClass="text-orange-500" />
              ))}
            </div>
          ))}

          {oneOffByCategory.map((cat) => (
            <div key={cat.id + '_oo'}>
              <div className="text-xs text-slate-400 mt-2 mb-1 flex items-center gap-1">
                <span>{cat.icon}</span> {cat.label} <span className="badge badge-amber ml-1">one-off</span>
              </div>
              {cat.items.filter(e => e.name && e.amount).map((e) => (
                <PLRow key={e.id} label={e.name} value={`-${fmt(parseFloat(e.amount) || 0)}`} valueClass="text-orange-500" />
              ))}
            </div>
          ))}

          {totalOverheads === 0 && (
            <div className="text-xs text-slate-400 py-2 italic">No overheads added for this month</div>
          )}

          <PLRow label="Total overheads" value={`-${fmt(totalOverheads)}`} valueClass="font-medium text-orange-600" />

          {/* Net profit line */}
          <div className="flex justify-between items-center py-3 mt-2 bg-slate-50 rounded-lg px-3">
            <span className="font-bold text-slate-800">Net profit</span>
            <div className="text-right">
              <span className={`font-bold text-lg ${netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {fmtSigned(netProfit)}
              </span>
              <span className={`text-xs ml-2 ${netMargin >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                {pct(netMargin)} margin
              </span>
            </div>
          </div>

          {/* Product breakdown */}
          {rows.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-6 mb-3 pb-2 border-b-2 border-slate-200">
                <div className="font-bold text-base text-slate-800">Product Breakdown</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Products</span>
                  <span className="bg-slate-100 text-slate-700 font-bold text-sm px-3 py-1 rounded-full">{rows.filter(r=>r.u>0).length}</span>
                  <span className="text-xs text-slate-500">Total units</span>
                  <span className="bg-indigo-100 text-indigo-700 font-bold text-sm px-3 py-1 rounded-full">{rows.reduce((s,{u})=>s+u,0).toLocaleString()}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('name')}>Product{sortIcon('name')}</th>
                      <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('units')}>Units{sortIcon('units')}</th>
                      <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('cos')}>Cost of sales{sortIcon('cos')}</th>
                      <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('revenue')}>Revenue{sortIcon('revenue')}</th>
                      <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('profit')}>Gross profit{sortIcon('profit')}</th>
                      <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={()=>sortTable('margin')}>Margin{sortIcon('margin')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].sort((a,b) => {
                        const dir = tableSort.dir === 'desc' ? -1 : 1
                        switch(tableSort.col) {
                          case 'name': return dir * a.name.localeCompare(b.name)
                          case 'units': return dir * (a.u - b.u)
                          case 'revenue': return dir * (a.r.sellPrice * a.u - b.r.sellPrice * b.u)
                          case 'cos': return dir * ((a.r.costPrice+a.r.referralFee+a.r.shippingCost+a.r.packCost+a.r.adCost)*a.u - (b.r.costPrice+b.r.referralFee+b.r.shippingCost+b.r.packCost+b.r.adCost)*b.u)
                          case 'profit': return dir * (a.r.netProfit * a.u - b.r.netProfit * b.u)
                          default: return dir * (a.r.margin - b.r.margin)
                        }
                      }).map(({ item, r, u, name }) => (
                      <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2.5"><button className="text-indigo-600 hover:underline font-medium text-left" onClick={()=>setDrillProduct({item,r,u,name})}>{name}</button></td>
                        <td className="py-2.5 text-right text-slate-600">{u}</td>
                        <td className="py-2.5 text-right text-slate-600">{fmt((r.costPrice + r.referralFee + r.shippingCost + r.packCost + r.adCost) * u)}</td>
                        <td className="py-2.5 text-right text-slate-600">{fmt(r.sellPrice * u)}</td>
                        <td className={`py-2.5 text-right font-medium ${r.netProfit * u >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit * u)}</td>
                        <td className="py-2.5 text-right text-slate-600">{pct(r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Product drill-down modal */}
      {drillProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-md my-8 shadow-2xl">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <div className="font-bold text-lg text-slate-800">{drillProduct.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">Revenue &amp; cost breakdown · {drillProduct.u} units forecasted · Sell price/unit {fmt(drillProduct.r.sellPrice)} · Cost price/unit {fmt(drillProduct.r.costPrice)}</div>
              </div>
              <button onClick={()=>setDrillProduct(null)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>
            <div className="px-6 py-4">
              {/* Summary metrics */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="metric-card">
                  <div className="metric-label">Revenue</div>
                  <div className="metric-value text-slate-800">{fmt(drillProduct.r.sellPrice * drillProduct.u)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Gross Profit</div>
                  <div className={`metric-value ${drillProduct.r.netProfit * drillProduct.u >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(drillProduct.r.netProfit * drillProduct.u)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Margin</div>
                  <div className={`metric-value ${drillProduct.r.margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>{pct(drillProduct.r.margin)}</div>
                </div>
              </div>

              {/* Revenue */}
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Revenue</div>
              <div className="result-row"><span className="text-slate-500">Gross revenue (inc. VAT)</span><span className="font-medium">{fmt(drillProduct.r.sellPrice * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-500">VAT liability</span><span className="text-red-500">-{fmt(drillProduct.r.vatAmount * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-600 font-medium">Ex-VAT revenue</span><span className="font-medium">{fmt(drillProduct.r.exVatRevenue * drillProduct.u)}</span></div>

              {/* Cost of sales */}
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Cost of sales</div>
              <div className="result-row"><span className="text-slate-500">Product cost</span><span className="text-red-500">-{fmt(drillProduct.r.costPrice * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-500">Amazon referral fee</span><span className="text-red-500">-{fmt(drillProduct.r.referralFee * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-500">Shipping cost</span><span className="text-red-500">-{fmt(drillProduct.r.shippingCost * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-500">Packaging cost</span><span className="text-red-500">-{fmt(drillProduct.r.packCost * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-500">Ad spend</span><span className="text-red-500">-{fmt(drillProduct.r.adCost * drillProduct.u)}</span></div>
              <div className="result-row"><span className="text-slate-600 font-medium">Total cost of sales</span><span className="font-medium text-red-500">-{fmt(drillProduct.r.totalCosts * drillProduct.u)}</span></div>

              {/* Upfront cost */}
              <div className="flex justify-between items-center py-2 px-3 bg-amber-50 border border-amber-100 rounded-lg mt-2 mb-3">
                <div>
                  <span className="text-sm font-medium text-amber-800">Upfront cost</span>
                  <span className="text-xs text-amber-600 ml-2">(stock + packaging)</span>
                </div>
                <span className="font-semibold text-amber-800">{fmt((drillProduct.r.costPrice + drillProduct.r.packCost) * drillProduct.u)}</span>
              </div>

              {/* Gross profit */}
              <div className="flex justify-between items-center py-3 bg-slate-50 rounded-lg px-3 mt-1">
                <span className="font-bold text-slate-800">Gross profit</span>
                <div className="text-right">
                  <span className={`font-bold text-lg ${drillProduct.r.netProfit * drillProduct.u >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(drillProduct.r.netProfit * drillProduct.u)}</span>
                  <span className="text-xs text-slate-400 ml-2">({pct(drillProduct.r.margin)} margin)</span>
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-3 italic">Net profit not shown — overheads are not allocated per product</div>
            </div>
            <div className="px-6 pb-5">
              <button className="btn btn-secondary w-full justify-center" onClick={()=>setDrillProduct(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
