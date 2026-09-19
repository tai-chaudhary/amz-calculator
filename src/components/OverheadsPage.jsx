import React, { useState } from 'react'
import { fmt } from '../lib/calc'
import { EmptyState, Spinner, Modal } from './UI'

export const OVERHEAD_CATEGORIES = [
  { id: 'staff', label: 'Staff & Payroll', icon: '👥' },
  { id: 'software', label: 'Software & Subscriptions', icon: '💻' },
  { id: 'office', label: 'Office & Premises', icon: '🏢' },
  { id: 'marketing', label: 'Marketing & Advertising', icon: '📣' },
  { id: 'professional', label: 'Professional Services', icon: '⚖️' },
  { id: 'other', label: 'Other', icon: '📎' },
]

export default function OverheadsPage({ overheads, onUpdateOverheads, loading }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState({ name: '', amount: '', categoryId: 'staff' })

  if (loading) return <Spinner />

  const items = overheads || []
  const totalMonthly = items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0)

  const handleSave = () => {
    if (!form.name.trim() || !form.amount) return
    if (editItem) {
      onUpdateOverheads(items.map((i) => i.id === editItem.id ? { ...i, ...form, amount: parseFloat(form.amount) } : i))
      setEditItem(null)
    } else {
      onUpdateOverheads([...items, { id: 'oh' + Date.now(), ...form, amount: parseFloat(form.amount) }])
    }
    setForm({ name: '', amount: '', categoryId: 'staff' })
    setShowAdd(false)
  }

  const handleEdit = (item) => {
    setForm({ name: item.name, amount: item.amount, categoryId: item.categoryId })
    setEditItem(item)
    setShowAdd(true)
  }

  const handleDelete = (id) => onUpdateOverheads(items.filter((i) => i.id !== id))

  // Group by category
  const grouped = OVERHEAD_CATEGORIES.map((cat) => ({
    ...cat,
    items: items.filter((i) => i.categoryId === cat.id),
    total: items.filter((i) => i.categoryId === cat.id).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0),
  })).filter((g) => g.items.length > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] leading-tight">Overheads</h1>
          <p className="text-sm text-ink/50 mt-1">Fixed monthly expenses that feed into every month's P&L</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', amount: '', categoryId: 'staff' }); setEditItem(null); setShowAdd(true) }}>
          + Add expense
        </button>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="metric-card">
            <div className="metric-label">Total monthly overheads</div>
            <div className="metric-value text-ink">{fmt(totalMonthly)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Annual overheads</div>
            <div className="metric-value text-ink">{fmt(totalMonthly * 12)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Line items</div>
            <div className="metric-value text-ink">{items.length}</div>
          </div>
        </div>
      )}

      {items.length === 0 && !showAdd && (
        <EmptyState
          icon="💼"
          title="No overheads added yet"
          sub="Add staff salaries, subscriptions, and other fixed costs to include them in your monthly P&L"
        />
      )}

      {grouped.map((cat) => (
        <div key={cat.id} className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span>{cat.icon}</span>
              <span className="font-semibold text-sm text-ink/80">{cat.label}</span>
            </div>
            <span className="text-sm font-medium text-ink/70">{fmt(cat.total)} / mo</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {cat.items.map((item) => (
                <tr key={item.id} className="border-b border-rule/60 last:border-0 hover:bg-paper group">
                  <td className="py-2.5 text-ink/80">{item.name}</td>
                  <td className="py-2.5 text-right font-medium text-ink">{fmt(parseFloat(item.amount) || 0)}</td>
                  <td className="py-2.5 text-right text-ink/45 text-xs pl-4">
                    <button className="btn btn-xs btn-secondary mr-1" onClick={() => handleEdit(item)}>Edit</button>
                    <button className="btn btn-xs btn-danger" onClick={() => handleDelete(item.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {showAdd && (
        <Modal title={editItem ? 'Edit expense' : 'Add expense'} onClose={() => { setShowAdd(false); setEditItem(null) }}>
          <div className="space-y-3">
            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                {OVERHEAD_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. John — Salary, Shopify, Office rent"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
            <div>
              <label className="label">Monthly amount (£)</label>
              <input
                className="input"
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn btn-primary flex-1" onClick={handleSave}>
              {editItem ? 'Save changes' : 'Add expense'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowAdd(false); setEditItem(null) }}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
