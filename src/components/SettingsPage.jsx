import React, { useState } from 'react'
import { SERVICE_LABELS } from '../lib/defaults'
import { Spinner } from './UI'

export default function SettingsPage({ settings, onUpdateSettings, loading }) {
  const [tab, setTab] = useState('carriers')
  const tabs = [
    { id: 'carriers', label: 'Carriers' },
    { id: 'packaging', label: 'Packaging' },
    { id: 'routing', label: 'Smart Routing' },
  ]

  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-400 mt-0.5">Configure carriers, packaging, and smart routing rules</p>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'carriers' && <CarriersSettings settings={settings} onUpdateSettings={onUpdateSettings} />}
      {tab === 'packaging' && <PackagingSettings settings={settings} onUpdateSettings={onUpdateSettings} />}
      {tab === 'routing' && <RoutingSettings settings={settings} onUpdateSettings={onUpdateSettings} />}
    </div>
  )
}

function CarriersSettings({ settings, onUpdateSettings }) {
  const { carriers } = settings
  const [selCarrier, setSelCarrier] = useState(Object.keys(carriers)[0])
  const [editingName, setEditingName] = useState(false)
  const carrier = carriers[selCarrier]

  const updateCarrier = (c) => onUpdateSettings({ ...settings, carriers: { ...carriers, [selCarrier]: c } })
  const toggleService = (sl) => updateCarrier({ ...carrier, services: { ...carrier.services, [sl]: !carrier.services[sl] } })
  const updateRate = (catId, sl, val) => updateCarrier({
    ...carrier,
    categories: carrier.categories.map((c) => c.id === catId ? { ...c, rates: { ...c.rates, [sl]: parseFloat(val) || 0 } } : c),
  })
  const updateCatField = (catId, field, val) => updateCarrier({
    ...carrier,
    categories: carrier.categories.map((c) => c.id === catId ? { ...c, [field]: field === 'maxKg' ? parseFloat(val) || 0 : val } : c),
  })
  const addCat = () => updateCarrier({
    ...carrier,
    categories: [...carrier.categories, { id: 'c' + Date.now(), name: 'New category', maxKg: 0, rates: { standard: 0, nextday: 0, prime: 0 } }],
  })
  const delCat = (id) => updateCarrier({ ...carrier, categories: carrier.categories.filter((c) => c.id !== id) })

  const addCarrier = () => {
    const id = 'carrier_' + Date.now()
    const newCarrier = { name: 'New Carrier', maxWeight: 30, services: { standard: true, nextday: false, prime: false }, categories: [] }
    onUpdateSettings({ ...settings, carriers: { ...carriers, [id]: newCarrier } })
    setSelCarrier(id)
    setEditingName(true)
  }

  const deleteCarrier = () => {
    if (!window.confirm(`Delete ${carrier.name}? This cannot be undone.`)) return
    const updated = { ...carriers }
    delete updated[selCarrier]
    onUpdateSettings({ ...settings, carriers: updated })
    setSelCarrier(Object.keys(updated)[0] || '')
  }

  const enabledServices = Object.entries(SERVICE_LABELS).filter(([sl]) => carrier && carrier.services[sl])

  if (!carrier) return null

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {Object.entries(carriers).map(([id, c]) => (
          <button key={id} className={`btn ${selCarrier === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSelCarrier(id); setEditingName(false) }}>
            {c.name}
          </button>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={addCarrier}>+ Add carrier</button>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                autoFocus
                value={carrier.name}
                onChange={(e) => updateCarrier({ ...carrier, name: e.target.value })}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                className="input font-semibold text-base"
                style={{ width: 180 }}
              />
            ) : (
              <div
                className="font-semibold text-base text-slate-800 cursor-pointer hover:text-indigo-600"
                onClick={() => setEditingName(true)}
                title="Click to rename"
              >
                {carrier.name} ✏️
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500">Max weight (kg)</label>
            <input
              type="number"
              value={carrier.maxWeight}
              onChange={(e) => updateCarrier({ ...carrier, maxWeight: parseFloat(e.target.value) || 0 })}
              className="input text-sm"
              style={{ width: 80 }}
            />
            <button className="btn btn-danger btn-sm" onClick={deleteCarrier}>🗑 Delete carrier</button>
          </div>
        </div>

        <div className="mb-5">
          <div className="text-xs font-medium text-slate-500 mb-2">Enabled services</div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(SERVICE_LABELS).map(([sl, label]) => (
              <label key={sl} className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                <input type="checkbox" checked={!!carrier.services[sl]} onChange={() => toggleService(sl)} className="w-4 h-4 accent-indigo-500" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide pr-3">Category name</th>
                <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide pr-3">Max kg</th>
                {enabledServices.map(([sl, label]) => (
                  <th key={sl} className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide pr-3">{label} £</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carrier.categories.map((cat) => (
                <tr key={cat.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <input value={cat.name} onChange={(e) => updateCatField(cat.id, 'name', e.target.value)} className="input text-sm" style={{ width: 160 }} />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="number" value={cat.maxKg} onChange={(e) => updateCatField(cat.id, 'maxKg', e.target.value)} className="input text-sm" style={{ width: 70 }} />
                  </td>
                  {enabledServices.map(([sl]) => (
                    <td key={sl} className="py-2 pr-3">
                      <input type="number" value={cat.rates[sl] || 0} onChange={(e) => updateRate(cat.id, sl, e.target.value)} className="input text-sm" style={{ width: 80 }} />
                    </td>
                  ))}
                  <td className="py-2">
                    <button className="btn btn-danger btn-xs" onClick={() => delCat(cat.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary btn-sm mt-4" onClick={addCat}>+ Add weight category</button>
      </div>
    </div>
  )
}

function PackagingSettings({ settings, onUpdateSettings }) {
  const { packaging } = settings
  const addPkg = () => onUpdateSettings({ ...settings, packaging: [...packaging, { id: 'p' + Date.now(), name: 'New packaging', cost: 0 }] })
  const updatePkg = (id, k, v) => onUpdateSettings({ ...settings, packaging: packaging.map((p) => p.id === id ? { ...p, [k]: v } : p) })
  const delPkg = (id) => onUpdateSettings({ ...settings, packaging: packaging.filter((p) => p.id !== id) })

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold">Packaging types</div>
        <button className="btn btn-secondary btn-sm" onClick={addPkg}>+ Add packaging</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Cost (£)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packaging.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  <input value={p.name} onChange={(e) => updatePkg(p.id, 'name', e.target.value)} className="input text-sm" style={{ width: 200 }} />
                </td>
                <td className="py-2 pr-4">
                  <input type="number" value={p.cost} onChange={(e) => updatePkg(p.id, 'cost', parseFloat(e.target.value) || 0)} className="input text-sm" style={{ width: 100 }} />
                </td>
                <td className="py-2">
                  <button className="btn btn-danger btn-xs" onClick={() => delPkg(p.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RoutingSettings({ settings, onUpdateSettings }) {
  const { routingRules, carriers } = settings
  const svcLabels = { standard: 'Standard', nextday: 'Next Day', prime: 'Prime' }

  const updateRules = (rules) => onUpdateSettings({ ...settings, routingRules: rules })
  const addRule = () => updateRules([...routingRules, {
    id: 'r' + Date.now(), priority: routingRules.length + 1,
    serviceLevel: 'standard', letterbox: false, weightMax: 2, carrierId: Object.keys(carriers)[0],
  }])
  const updateRule = (id, k, v) => updateRules(routingRules.map((r) => r.id === id ? { ...r, [k]: v } : r))
  const delRule = (id) => updateRules(routingRules.filter((r) => r.id !== id).map((r, i) => ({ ...r, priority: i + 1 })))
  const moveUp = (id) => {
    const idx = routingRules.findIndex((r) => r.id === id)
    if (idx === 0) return
    const arr = [...routingRules];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
    updateRules(arr.map((r, i) => ({ ...r, priority: i + 1 })))
  }
  const moveDown = (id) => {
    const idx = routingRules.findIndex((r) => r.id === id)
    if (idx === routingRules.length - 1) return
    const arr = [...routingRules];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
    updateRules(arr.map((r, i) => ({ ...r, priority: i + 1 })))
  }

  return (
    <div>
      <div className="card mb-4">
        <div className="text-xs text-slate-500 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-4">
          🤖 Rules are applied in priority order. The tool always selects the cheapest carrier that matches. You can override in the calculator.
        </div>
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold">Routing rules</div>
          <button className="btn btn-secondary btn-sm" onClick={addRule}>+ Add rule</button>
        </div>

        <div className="space-y-3">
          {routingRules.map((rule) => (
            <div key={rule.id} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-indigo-500">Priority {rule.priority}</span>
                <div className="flex gap-1">
                  <button className="btn btn-xs btn-secondary" onClick={() => moveUp(rule.id)}>↑</button>
                  <button className="btn btn-xs btn-secondary" onClick={() => moveDown(rule.id)}>↓</button>
                  <button className="btn btn-danger btn-xs" onClick={() => delRule(rule.id)}>✕</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-end">
                <div style={{ minWidth: 120 }}>
                  <label className="label">Service level</label>
                  <select value={rule.serviceLevel} onChange={(e) => updateRule(rule.id, 'serviceLevel', e.target.value)} className="input text-sm">
                    {Object.entries(svcLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <label className="label">Max weight (kg)</label>
                  <input type="number" value={rule.weightMax} onChange={(e) => updateRule(rule.id, 'weightMax', parseFloat(e.target.value) || 0)} className="input text-sm" />
                </div>
                <div style={{ minWidth: 140 }}>
                  <label className="label">Use carrier</label>
                  <select value={rule.carrierId} onChange={(e) => updateRule(rule.id, 'carrierId', e.target.value)} className="input text-sm">
                    {Object.entries(carriers).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="pb-1">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                    <input type="checkbox" checked={!!rule.letterbox} onChange={(e) => updateRule(rule.id, 'letterbox', e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                    Letterbox only
                  </label>
                </div>
              </div>
            </div>
          ))}
          {routingRules.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">No rules yet — add one to enable smart carrier selection</div>
          )}
        </div>
      </div>
    </div>
  )
}
