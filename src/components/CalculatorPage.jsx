import React, { useState, useEffect, useMemo } from 'react'
import { calcProduct, getSmartCarrier, fmt, fmtSigned, pct } from '../lib/calc'
import { REF_FEE_OPTIONS, SERVICE_LABELS } from '../lib/defaults'
import { Input, Select, Checkbox, MetricCard, WarnBox, InfoBox, ResultRow, Modal } from './UI'

export const EMPTY_CALC = {
  sellPrice: '', costPrice: '', adCost: '', refFee: '15.3',
  vatZero: false, weightKg: '', letterbox: false,
  serviceLevel: 'standard', carrierId: '', carrierCatId: '',
  packagingId: '', parcelSplit: false, numParcels: '2',
  parcelWeights: [], parcelWeightsOverride: false,
  asin: '', productUrl: '', supplierName: '', supplierUrl: '', notes: '',
}

export default function CalculatorPage({ settings, savedProducts, onSaveProduct, onUpdateProduct, calc, setCalc, loadedProductId, setLoadedProductId, loadedProductName, setLoadedProductName }) {
  const { carriers, packaging, routingRules } = settings
  const [customRef, setCustomRef] = useState(false)
  const [smartSuggestion, setSmartSuggestion] = useState(null)
  const [saveModal, setSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) =>
    setCalc((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const results = useMemo(() => calcProduct(calc, carriers, packaging), [calc, carriers, packaging])

  const carrier = calc.carrierId ? carriers[calc.carrierId] : null
  const numP = parseInt(calc.numParcels) || 2
  const weightKg = parseFloat(calc.weightKg) || 0

  useEffect(() => {
    if (calc.parcelSplit && numP > 0 && !calc.parcelWeightsOverride && weightKg > 0) {
      const split = (weightKg / numP).toFixed(2)
      setCalc((c) => ({ ...c, parcelWeights: Array(numP).fill(split) }))
    }
  }, [calc.parcelSplit, numP, weightKg, calc.parcelWeightsOverride])

  useEffect(() => {
    if (weightKg && calc.serviceLevel) {
      const cid = getSmartCarrier(weightKg, calc.serviceLevel, calc.letterbox, carriers, routingRules)
      setSmartSuggestion(cid)
    }
  }, [weightKg, calc.serviceLevel, calc.letterbox, carriers, routingRules])

  const applySmartSuggestion = () => {
    if (!smartSuggestion) return
    const c = carriers[smartSuggestion]
    const cat = c.categories.find((x) => weightKg <= x.maxKg) || c.categories[c.categories.length - 1]
    setCalc((prev) => ({ ...prev, carrierId: smartSuggestion, carrierCatId: cat?.id || '' }))
  }

  const loadProduct = (productRow) => {
    setCalc({ ...EMPTY_CALC, ...productRow.data })
    setLoadedProductId(productRow.id)
    setLoadedProductName(productRow.name)
  }

  const clearProduct = () => {
    setCalc(EMPTY_CALC)
    setLoadedProductId(null)
    setLoadedProductName('')
  }

  const handleSaveNew = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      await onSaveProduct({ ...calc, name: saveName.trim() })
      setSaveModal(false)
      setSaveName('')
      setLoadedProductId(null)
      setLoadedProductName('')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateExisting = async () => {
    if (!loadedProductId) return
    setSaving(true)
    try {
      await onUpdateProduct(loadedProductId, { ...calc, name: loadedProductName })
    } finally {
      setSaving(false)
    }
  }

  const r = results

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Calculator</h1>
          <p className="text-sm text-slate-400 mt-0.5">Calculate profit, VAT, and break-even for any product</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {savedProducts.length > 0 && (
            <select
              className="input text-sm"
              style={{ width: 180 }}
              onChange={(e) => {
                const row = savedProducts.find((x) => x.id === e.target.value)
                if (row) loadProduct(row)
              }}
              value={loadedProductId || ''}
            >
              <option value="">Load saved product…</option>
              {savedProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {loadedProductId && (
            <button className="btn btn-secondary btn-sm" onClick={clearProduct}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Loaded product banner */}
      {loadedProductId && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-indigo-700">
            Editing: <span className="font-semibold">{loadedProductName}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={handleUpdateExisting} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save changes'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSaveName(''); setSaveModal(true) }}>
              Save as new
            </button>
          </div>
        </div>
      )}

      {/* Product Info */}
      <div className="card mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span>🏷️</span> Product Info
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="ASIN" type="text" value={calc.asin || ''} onChange={set('asin')} placeholder="e.g. B08XYZ1234" />
          <Input label="Supplier name" type="text" value={calc.supplierName || ''} onChange={set('supplierName')} placeholder="e.g. Alibaba Supplier Co." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Input label="Amazon product URL" type="text" value={calc.productUrl || ''} onChange={set('productUrl')} placeholder="https://www.amazon.co.uk/dp/..." />
          <Input label="Supplier URL" type="text" value={calc.supplierUrl || ''} onChange={set('supplierUrl')} placeholder="https://supplier-website.com/product..." />
        </div>
        <div className="mt-4">
          <label className="label">Notes</label>
          <textarea
            className="input"
            rows={2}
            value={calc.notes || ''}
            onChange={(e) => setCalc((c) => ({ ...c, notes: e.target.value }))}
            placeholder="Any notes about this product…"
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>

      {/* Pricing */}
      <div className="card mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span>💰</span> Pricing
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Sell price (inc. VAT) £" type="number" value={calc.sellPrice} onChange={set('sellPrice')} placeholder="0.00" />
          <Input label="Cost price £" type="number" value={calc.costPrice} onChange={set('costPrice')} placeholder="0.00" />
          <Input label="Ad cost £" type="number" value={calc.adCost} onChange={set('adCost')} placeholder="0.00" />
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div style={{ minWidth: 200 }}>
            <Select
              label="Amazon referral fee"
              value={customRef ? 'custom' : calc.refFee}
              onChange={(e) => {
                if (e.target.value === 'custom') { setCustomRef(true) }
                else { setCustomRef(false); setCalc((c) => ({ ...c, refFee: e.target.value })) }
              }}
            >
              {REF_FEE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          {customRef && (
            <div style={{ width: 120 }}>
              <Input label="Custom %" type="number" value={calc.refFee} onChange={set('refFee')} placeholder="0.0" />
            </div>
          )}
          <div className="pb-1">
            <Checkbox label="0% VAT rated product" checked={calc.vatZero} onChange={set('vatZero')} />
          </div>
        </div>
      </div>

      {/* Shipping */}
      <div className="card mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span>📦</span> Shipping & Weight
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Input label="Weight (kg)" type="number" value={calc.weightKg} onChange={set('weightKg')} placeholder="0.00" />
          <Select label="Service level" value={calc.serviceLevel} onChange={set('serviceLevel')}>
            {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select label="Packaging" value={calc.packagingId || ''} onChange={set('packagingId')}>
            <option value="">None</option>
            {packaging.map((p) => <option key={p.id} value={p.id}>{p.name} (£{p.cost.toFixed(2)})</option>)}
          </Select>
        </div>

        <div className="flex flex-wrap gap-4 mb-4">
          <Checkbox label="Letterbox eligible" checked={calc.letterbox} onChange={set('letterbox')} />
          <Checkbox label="Split into multiple parcels" checked={calc.parcelSplit} onChange={set('parcelSplit')} />
        </div>

        {calc.parcelSplit && (
          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <div className="flex flex-wrap gap-4 items-end mb-3">
              <div style={{ width: 140 }}>
                <Input label="Number of parcels" type="number" min={2} max={10} value={calc.numParcels} onChange={set('numParcels')} />
              </div>
              <div className="pb-1">
                <Checkbox
                  label="Override parcel weights manually"
                  checked={!!calc.parcelWeightsOverride}
                  onChange={(e) => setCalc((c) => ({ ...c, parcelWeightsOverride: e.target.checked }))}
                />
              </div>
            </div>
            {calc.parcelWeightsOverride && (
              <div className="flex flex-wrap gap-3">
                {Array(numP).fill(0).map((_, i) => (
                  <div key={i} style={{ width: 100 }}>
                    <Input
                      label={`Parcel ${i + 1} kg`}
                      type="number"
                      value={(calc.parcelWeights || [])[i] || ''}
                      onChange={(e) => {
                        const pw = [...(calc.parcelWeights || [])]
                        pw[i] = e.target.value
                        setCalc((c) => ({ ...c, parcelWeights: pw }))
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {smartSuggestion && !calc.carrierId && (
          <InfoBox>
            Smart routing suggests: <strong>{carriers[smartSuggestion]?.name}</strong>
            <button className="btn btn-xs btn-primary ml-2" onClick={applySmartSuggestion}>Apply</button>
          </InfoBox>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Select
            label="Carrier"
            value={calc.carrierId || ''}
            onChange={(e) => setCalc((c) => ({ ...c, carrierId: e.target.value, carrierCatId: '' }))}
          >
            <option value="">Select carrier</option>
            {Object.entries(carriers).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
          </Select>
          {carrier && (
            <Select label="Weight category" value={calc.carrierCatId || ''} onChange={set('carrierCatId')}>
              <option value="">Select category</option>
              {carrier.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({fmt(c.rates[calc.serviceLevel] || 0)})
                </option>
              ))}
            </Select>
          )}
        </div>
        {r.shippingWarning && <WarnBox>{r.shippingWarning}</WarnBox>}
      </div>

      {/* Results */}
      <div className="card">
        <div className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span>📊</span> Results
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <MetricCard label="Net Profit" value={fmtSigned(r.netProfit)} color={r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'} />
          <MetricCard label="Margin" value={pct(r.margin)} color={r.margin >= 0 ? 'text-green-600' : 'text-red-500'} />
          <MetricCard label="VAT Liability" value={fmt(r.vatAmount)} color="text-blue-600" />
          <MetricCard label="Break-even" value={fmt(r.breakEven)} />
        </div>
        <ResultRow label="Sell price (inc. VAT)" value={fmt(r.sellPrice)} />
        <ResultRow label="VAT deducted" value={`-${fmt(r.vatAmount)}`} valueClass="text-red-500" />
        <ResultRow label="Ex-VAT revenue" value={fmt(r.exVatRevenue)} />
        <div className="border-t border-slate-100 my-2" />
        <ResultRow label={`Amazon referral fee (${calc.refFee}% on sell price)`} value={`-${fmt(r.referralFee)}`} valueClass="text-red-500" />
        <ResultRow label="Cost of goods" value={`-${fmt(r.costPrice)}`} valueClass="text-red-500" />
        <ResultRow label="Shipping cost" value={`-${fmt(r.shippingCost)}`} valueClass="text-red-500" />
        <ResultRow label="Packaging cost" value={`-${fmt(r.packCost)}`} valueClass="text-red-500" />
        <ResultRow label="Ad cost" value={`-${fmt(r.adCost)}`} valueClass="text-red-500" />
        <div className="border-t border-slate-200 my-2" />
        <div className="flex justify-between items-center pt-1">
          <span className="font-semibold text-slate-800">Net profit</span>
          <span className={`text-lg font-bold ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {fmtSigned(r.netProfit)}
          </span>
        </div>
      </div>

      {!loadedProductId && (
        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary" onClick={() => { setSaveName(''); setSaveModal(true) }}>
            💾 Save product
          </button>
        </div>
      )}

      {saveModal && (
        <Modal title="Save as new product" onClose={() => setSaveModal(false)}>
          <Input
            label="Product name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g. Blue Widget 500g"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
          />
          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary flex-1" onClick={handleSaveNew} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={() => setSaveModal(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
