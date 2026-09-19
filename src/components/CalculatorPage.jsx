import React, { useState, useEffect, useMemo } from 'react'
import { calcProduct, getSmartCarrier, effectiveWeight, fmt, fmtSigned, pct } from '../lib/calc'
import { REF_FEE_OPTIONS, SERVICE_LABELS } from '../lib/defaults'
import { Input, Select, Checkbox, MetricCard, WarnBox, InfoBox, ResultRow, Modal } from './UI'
import ComponentPicker from './ComponentPicker'

export const EMPTY_CALC = {
  sellPrice: '', costPrice: '', adCost: '', refFee: '15.3',
  vatZero: false, weightKg: '', weightPerItem: '', weightOverride: false, letterbox: false,
  serviceLevel: 'standard', carrierId: '', carrierCatId: '',
  packagingId: '', parcelSplit: false, numParcels: '2',
  parcelWeights: [], parcelWeightsOverride: false,
  asin: '', productUrl: '', brand: '', supplierName: '', supplierSku: '', supplierUrl: '', notes: '',
  bundleQty: '1', costPerItem: '', monthlyVolume: '',
}

export default function CalculatorPage({ settings, savedProducts, stockItems = [], onCreateStockItem, onSaveProduct, onUpdateProduct, calc, setCalc, loadedProductId, setLoadedProductId, loadedProductName, setLoadedProductName }) {
  const { carriers, packaging, routingRules } = settings
  const [customRef, setCustomRef] = useState(false)
  const [smartSuggestion, setSmartSuggestion] = useState(null)
  const [saveModal, setSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) =>
    setCalc((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const results = useMemo(() => calcProduct(calc, carriers, packaging, stockItems), [calc, carriers, packaging])

  const carrier = calc.carrierId ? carriers[calc.carrierId] : null
  const numP = parseInt(calc.numParcels) || 2
  const weightKg = effectiveWeight(calc, stockItems)

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
          <h1 className="text-[28px] leading-tight">Calculator</h1>
          <p className="text-sm text-ink/50 mt-1">Calculate profit, VAT, and break-even for any product</p>
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
        <div className="bg-royal-50 border border-royal-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-royal-700">
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
        <div className="text-sm font-semibold text-ink/80 mb-4 flex items-center gap-2">
          <span>🏷️</span> Product Info
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Input label="Brand name" type="text" value={calc.brand || ''} onChange={set('brand')} placeholder="e.g. Fairy" />
          <div>
            <Input label="ASIN" type="text" value={calc.asin || ''} onChange={set('asin')} placeholder="e.g. B08XYZ1234" />
            {(() => {
              const a = (calc.asin || '').trim().toUpperCase()
              if (a.length < 5) return null
              const dupes = savedProducts.filter(row =>
                row.id !== loadedProductId &&
                (row.data?.asin || '').trim().toUpperCase() === a
              )
              if (!dupes.length) return null
              return (
                <div className="text-xs text-warn bg-warn/5 border border-warn/25 rounded-lg px-2.5 py-1.5 mt-1.5">
                  ⚠ This ASIN is already on {dupes.length} saved product{dupes.length !== 1 ? 's' : ''}:
                  {' '}<span className="font-medium">{dupes.map(d => d.name).join(', ')}</span>
                  <div className="text-warn mt-0.5">Fine if this is a different service or listing variant — just checking you meant to.</div>
                </div>
              )
            })()}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Supplier name" type="text" value={calc.supplierName || ''} onChange={set('supplierName')} placeholder="e.g. Alibaba Supplier Co." />
          <Input label="Supplier SKU" type="text" value={calc.supplierSku || ''} onChange={set('supplierSku')} placeholder="e.g. SKU-12345" />
        </div>
        <div className="mt-4">
          <Input label="Amazon product URL" type="text" value={calc.productUrl || ''} onChange={set('productUrl')} placeholder="https://www.amazon.co.uk/dp/..." />
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
        <div className="text-sm font-semibold text-ink/80 mb-4 flex items-center gap-2">
          <span>💰</span> Pricing
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Sell price (inc. VAT) £" type="number" value={calc.sellPrice} onChange={set('sellPrice')} placeholder="0.00" />
          <Input label="Ad cost £" type="number" value={calc.adCost} onChange={set('adCost')} placeholder="0.00" />
          <div className="field">
            <label className="label">Bundle listing?</label>
            <select className="input" value={(parseInt(calc.bundleQty) || 1) > 1 ? 'bundle' : 'single'} onChange={e => {
              if (e.target.value === 'single') setCalc(c => ({...c, bundleQty: '1', costPerItem: ''}))
              else setCalc(c => ({...c, bundleQty: c.bundleQty && parseInt(c.bundleQty) > 1 ? c.bundleQty : '2'}))
            }}>
              <option value="single">Single item</option>
              <option value="bundle">Bundle listing</option>
            </select>
          </div>
        </div>
        {/* Cost — linked to stock items, or entered manually */}
        {calc.useComponents !== false && (Array.isArray(calc.components) || stockItems.length > 0) ? (
          <div className="mt-3">
            <ComponentPicker
              components={calc.components || []}
              stockItems={stockItems}
              asin={calc.asin}
              onCreateStockItem={onCreateStockItem}
              onChange={(components) => setCalc(c => ({
                ...c,
                components,
                bundleQty: String(components.reduce((s, x) => s + (parseInt(x.qty) || 0), 0) || 1),
              }))}
            />
            <button
              className="text-xs text-ink/45 hover:text-royal-500 mt-2"
              onClick={() => setCalc(c => ({ ...c, useComponents: false, components: [] }))}
            >
              Enter cost manually instead
            </button>
          </div>
        ) : (
        <>
        {parseInt(calc.bundleQty) > 1 ? (
          <div className="mt-3 p-3 bg-royal-50 border border-royal-100 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="pill pill-brand">📦 Bundle listing</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Input label="Cost per item £" type="number" value={calc.costPerItem || ''} onChange={set('costPerItem')} placeholder="0.00" />
              <Input label="Items in bundle" type="number" min="2" value={calc.bundleQty} onChange={set('bundleQty')} placeholder="2" />
              <div className="field">
                <label className="label">Total product cost</label>
                <div className="input bg-paper text-ink/70 font-medium">
                  {fmt((parseFloat(calc.costPerItem)||0) * (parseInt(calc.bundleQty)||1))}
                  {calc.costPerItem && calc.bundleQty && parseInt(calc.bundleQty) > 1 && (
                    <span className="text-xs text-ink/45 ml-1">({calc.bundleQty} × {fmt(parseFloat(calc.costPerItem)||0)})</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Input label="Cost price £" type="number" value={calc.costPrice} onChange={set('costPrice')} placeholder="0.00" />
          </div>
        )}
        {stockItems.length > 0 && (
          <button
            className="text-xs text-ink/45 hover:text-royal-500 mt-2"
            onClick={() => setCalc(c => ({ ...c, useComponents: true }))}
          >
            Link to stock items instead
          </button>
        )}
        </>
        )}
        {/* Monthly volume */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div className="field">
            <label className="label">Monthly volume (optional)</label>
            <input type="number" className="input" value={calc.monthlyVolume||''} onChange={set('monthlyVolume')} placeholder="units / mo" />
          </div>
          {parseInt(calc.monthlyVolume) > 0 && (() => {
            const r2 = results
            const v = parseInt(calc.monthlyVolume)
            return (<>
              <div className="metric-card">
                <div className="metric-label">Monthly profit</div>
                <div className={`metric-value text-sm ${r2.netProfit*v >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r2.netProfit*v)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Monthly revenue</div>
                <div className="metric-value text-sm">{fmt(r2.sellPrice*v)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Monthly VAT</div>
                <div className="metric-value text-sm text-blue-600">{fmt(r2.vatAmount*v)}</div>
              </div>
            </>)
          })()}
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div style={{ width: 140 }}>
            <label className="label">Amazon referral fee %</label>
            <input
              type="number"
              step="0.1"
              className="input"
              value={calc.refFee}
              onChange={set('refFee')}
              placeholder="15.3"
            />
          </div>
          <div className="pb-1">
            <Checkbox label="0% VAT rated product" checked={calc.vatZero} onChange={set('vatZero')} />
          </div>
        </div>
      </div>

      {/* Shipping */}
      <div className="card mb-4">
        <div className="text-sm font-semibold text-ink/80 mb-4 flex items-center gap-2">
          <span>📦</span> Shipping & Weight
        </div>
        {/* Bundle-aware weight */}
        {parseInt(calc.bundleQty) > 1 ? (
          <div className="p-3 bg-royal-50 border border-royal-100 rounded-xl mb-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="pill pill-brand">📦 Bundle of {calc.bundleQty}</span>
              <Checkbox
                label="Enter total weight manually instead"
                checked={!!calc.weightOverride}
                onChange={set('weightOverride')}
              />
            </div>
            {calc.weightOverride ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Total bundle weight (kg)" type="number" value={calc.weightKg} onChange={set('weightKg')} placeholder="0.00" />
                <div className="field">
                  <label className="label">Per item (approx.)</label>
                  <div className="input bg-paper text-ink/55">
                    {((parseFloat(calc.weightKg) || 0) / (parseInt(calc.bundleQty) || 1)).toFixed(3)} kg
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Weight per item (kg)" type="number" value={calc.weightPerItem || ''} onChange={set('weightPerItem')} placeholder="0.00" />
                <div className="field">
                  <label className="label">Total shipping weight</label>
                  <div className="input bg-white text-ink/80 font-semibold">
                    {weightKg.toFixed(3)} kg
                    <span className="text-xs text-ink/45 font-normal ml-1">
                      ({calc.bundleQty} × {(parseFloat(calc.weightPerItem) || 0).toFixed(3)})
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="text-xs text-royal-600 mt-2">
              Shipping is priced on the total weight. Tick the box above if the packed bundle weighs more than the items alone.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {parseInt(calc.bundleQty) > 1 ? (
            <div className="field">
              <label className="label">Shipping weight (kg)</label>
              <div className="input bg-paper text-ink/70 font-medium">{weightKg.toFixed(3)} kg</div>
            </div>
          ) : (
            <Input label="Weight (kg)" type="number" value={calc.weightKg} onChange={set('weightKg')} placeholder="0.00" />
          )}
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
          <div className="bg-paper rounded-lg p-4 mb-4">
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
        <div className="text-sm font-semibold text-ink/80 mb-4 flex items-center gap-2">
          <span>📊</span> Results
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <MetricCard label="Net Profit" value={fmtSigned(r.netProfit)} color={r.netProfit >= 0 ? 'text-gain' : 'text-loss'} />
          <MetricCard label="Margin" value={pct(r.margin)} color={r.margin >= 0 ? 'text-gain' : 'text-loss'} />
          <MetricCard label="VAT Liability" value={fmt(r.vatAmount)} color="text-blue-600" />
          <MetricCard label="Break-even" value={fmt(r.breakEven)} />
        </div>
        <ResultRow label="Sell price (inc. VAT)" value={fmt(r.sellPrice)} />
        <ResultRow label="VAT deducted" value={`-${fmt(r.vatAmount)}`} valueClass="text-loss" />
        <ResultRow label="Ex-VAT revenue" value={fmt(r.exVatRevenue)} />
        <div className="border-t border-rule my-2" />
        <ResultRow label={`Amazon referral fee (${calc.refFee}% on sell price)`} value={`-${fmt(r.referralFee)}`} valueClass="text-loss" />
        <ResultRow label="Cost of goods" value={`-${fmt(r.costPrice)}`} valueClass="text-loss" />
        <ResultRow label="Shipping cost" value={`-${fmt(r.shippingCost)}`} valueClass="text-loss" />
        <ResultRow label="Packaging cost" value={`-${fmt(r.packCost)}`} valueClass="text-loss" />
        <ResultRow label="Ad cost" value={`-${fmt(r.adCost)}`} valueClass="text-loss" />
        <div className="border-t border-rule my-2" />
        <div className="flex justify-between items-center pt-1">
          <span className="font-semibold text-ink">Net profit</span>
          <span className={`text-lg font-bold ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>
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
