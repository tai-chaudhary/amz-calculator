import React, { useState, useEffect, useMemo } from 'react'
import { FEE_CATEGORIES, findFeeCategory, describeCategory, thresholdsFor, effectiveRate } from '../lib/feeSchedule'
import { calcProduct, getSmartCarrier, effectiveWeight, priceForTargetMargin, fmt, fmtSigned, pct } from '../lib/calc'
import { SERVICE_LABELS } from '../lib/defaults'
import {
  Input, Select, Checkbox, WarnBox, InfoBox, ResultRow, Modal,
  PageHeader, SectionHead, Icon, StatusBadge,
} from './UI'
import ComponentPicker from './ComponentPicker'
import FeeVerifier from './FeeVerifier'
import { fillFromProducts } from '../lib/autofill'
import { ListingConnections } from './Links'

export const EMPTY_CALC = {
  sellPrice: '', costPrice: '', adCost: '', refFee: '15.3',
  vatZero: false, weightKg: '', weightPerItem: '', weightOverride: false, letterbox: false,
  serviceLevel: 'standard', carrierId: '', carrierCatId: '',
  packagingId: '', ownPackaging: false, parcelSplit: false, numParcels: '2',
  parcelWeights: [], parcelWeightsOverride: false,
  asin: '', productUrl: '', brand: '', supplierName: '', supplierSku: '', supplierUrl: '', notes: '',
  bundleQty: '1', costPerItem: '', monthlyVolume: '',
}

export default function CalculatorPage({
  settings, savedProducts, stockItems = [], onCreateStockItem, onSaveProduct, onUpdateProduct,
  calc, setCalc, loadedProductId, setLoadedProductId, loadedProductName, setLoadedProductName,
}) {
  const { carriers, packaging, routingRules } = settings
  const [smartSuggestion, setSmartSuggestion] = useState(null)
  const [saveModal, setSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [advancedShipping, setAdvancedShipping] = useState(false)

  const set = (k) => (e) =>
    setCalc((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const results = useMemo(
    () => calcProduct(calc, carriers, packaging, stockItems),
    [calc, carriers, packaging, stockItems]
  )

  const carrier = calc.carrierId ? carriers[calc.carrierId] : null
  const numP = parseInt(calc.numParcels) || 2
  const weightKg = effectiveWeight(calc, stockItems)

  useEffect(() => {
    if (calc.parcelSplit && numP > 0 && !calc.parcelWeightsOverride && weightKg > 0) {
      const split = (weightKg / numP).toFixed(2)
      setCalc((c) => ({ ...c, parcelWeights: Array(numP).fill(split) }))
    }
  }, [calc.parcelSplit, numP, weightKg, calc.parcelWeightsOverride, setCalc])

  useEffect(() => {
    if (weightKg && calc.serviceLevel) {
      const cid = getSmartCarrier(weightKg, calc.serviceLevel, calc.letterbox, carriers, routingRules)
      setSmartSuggestion(cid)
    } else {
      setSmartSuggestion(null)
    }
  }, [weightKg, calc.serviceLevel, calc.letterbox, carriers, routingRules])

  useEffect(() => {
    if (calc.parcelSplit || calc.letterbox || calc.parcelWeightsOverride) setAdvancedShipping(true)
  }, [calc.parcelSplit, calc.letterbox, calc.parcelWeightsOverride])

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
    setJustSaved(null)
  }

  const clearProduct = () => {
    setCalc(EMPTY_CALC)
    setLoadedProductId(null)
    setLoadedProductName('')
    setJustSaved(null)
  }

  const handleSaveNew = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      const name = saveName.trim()
      const row = await onSaveProduct({ ...calc, name })
      setSaveModal(false)
      setSaveName('')
      if (row?.id) {
        // The calculator is now showing this listing, so treat it as loaded:
        // further edits update it, and it stops flagging its own ASIN.
        setLoadedProductId(row.id)
        setLoadedProductName(name)
        setJustSaved(name)
      }
    } finally {
      setSaving(false)
    }
  }

  // Anything worth warning about before wiping the form?
  const hasInput = !!(calc.sellPrice || calc.costPrice || calc.asin || calc.name ||
    (Array.isArray(calc.components) && calc.components.length) || calc.weightKg)

  const startNew = () => {
    if (!loadedProductId && hasInput &&
        !window.confirm('Clear this calculation? It hasn\'t been saved.')) return
    setCalc(EMPTY_CALC)
    setLoadedProductId(null)
    setLoadedProductName('')
    setJustSaved(null)
    setShowTarget(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

  const [showTarget, setShowTarget] = useState(false)
  const [justSaved, setJustSaved] = useState(null)
  const loadedRow = loadedProductId ? savedProducts.find(r => r.id === loadedProductId) : null
  const blank = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)
  const IGNORE = new Set(['lastEditedBy', 'lastEditedByName', 'name'])
  // Compare with the stored listing as the calculator sees it — with the same defaults filled in
  const storedView = loadedRow ? { ...EMPTY_CALC, ...(loadedRow.data || {}) } : null
  const unchanged = !!loadedRow && [...new Set([...Object.keys(calc), ...Object.keys(storedView)])]
    .filter(k => !IGNORE.has(k))
    .every(k => (blank(calc[k]) && blank(storedView[k])) || JSON.stringify(calc[k]) === JSON.stringify(storedView[k]))
  const listingStatus = !loadedRow ? null
    : loadedRow.data?.reviewStatus === 'approved' ? { tone: 'live', label: 'Approved' }
    : loadedRow.data?.reviewStatus === 'review' ? { tone: 'brand', label: 'In review' } : { tone: 'quiet', label: 'Draft' }
  const [targetMargin, setTargetMargin] = useState('20')

  const r = results
  const monthlyVolume = parseInt(calc.monthlyVolume) || 0
  const marginTone = r.margin >= 20 ? 'text-gain' : r.margin >= 10 ? 'text-warn' : 'text-loss'
  const duplicates = (() => {
    const a = (calc.asin || '').trim().toUpperCase()
    if (a.length < 5) return []
    return savedProducts.filter(row => row.id !== loadedProductId && (row.data?.asin || '').trim().toUpperCase() === a)
  })()

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Listings / model"
        title="Profitability calculator"
        description="Build a listing once and watch the commercial result update as cost, fees, fulfilment and volume change."
        actions={(
          <>
            {savedProducts.length > 0 && (
              <select
                className="input text-sm min-w-[210px]"
                onChange={(e) => {
                  const row = savedProducts.find((x) => x.id === e.target.value)
                  if (row) loadProduct(row)
                }}
                value={loadedProductId || ''}
              >
                <option value="">Load saved listing…</option>
                {savedProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {(loadedProductId || hasInput) && (
              <button className="btn btn-secondary" onClick={startNew}>
                <Icon name="plus" size={15} /> New calculation
              </button>
            )}
          </>
        )}
      />

      {justSaved && (
        <div className="mb-5 p-4 rounded-card border border-gain/30 bg-gain/5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-semibold text-gain">"{justSaved}" saved</div>
            <div className="text-[13px] text-ink/60 mt-0.5">
              Any further changes here will update this listing.
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={startNew}>
              <Icon name="plus" size={15} /> Start a new calculation
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setJustSaved(null)}>
              Keep editing
            </button>
          </div>
        </div>
      )}

      {loadedProductId && !justSaved && (
        <div className="panel-brand mb-5 flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="section-kicker flex items-center gap-2">Editing saved listing {listingStatus && <StatusBadge tone={listingStatus.tone} dot>{listingStatus.label}</StatusBadge>}</div>
            <div className="text-sm font-semibold text-ink mt-1">{loadedProductName}</div>
            <ListingConnections p={calc} stockItems={stockItems} className="mt-2" />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={handleUpdateExisting} disabled={saving || unchanged}>
              <Icon name={unchanged ? 'check' : 'save'} size={14} /> {saving ? 'Saving…' : unchanged ? 'Saved' : 'Save changes'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSaveName(calc.name || ''); setSaveModal(true) }}>
              Save as new
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-5 items-start">
        <div className="surface overflow-hidden">
          {/* Product */}
          <section className="p-5 sm:p-6">
            <SectionHead icon="tag" eyebrow="01" title="Product" description="Identity and source details for this listing." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Brand name" type="text" value={calc.brand || ''} onChange={set('brand')} placeholder="e.g. Fairy" />
              <div>
                <Input label="ASIN" type="text" value={calc.asin || ''} onChange={set('asin')} placeholder="e.g. B08XYZ1234" />
                {duplicates.length > 0 && (
                  <WarnBox title="Possible duplicate ASIN">
                    This ASIN is already used by {duplicates.length} saved listing{duplicates.length !== 1 ? 's' : ''}: <strong>{duplicates.map(d => d.name).join(', ')}</strong>. That can be valid for a different service or variant; this is simply a check.
                  </WarnBox>
                )}
              </div>
              <Input label="Supplier name" type="text" value={calc.supplierName || ''} onChange={set('supplierName')} placeholder="e.g. Pricecheck" />
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
                placeholder="Anything the team should know about this listing…"
                style={{ resize: 'vertical' }}
              />
            </div>
          </section>

          {/* Commercials */}
          <section className="p-5 sm:p-6 border-t border-rule">
            <SectionHead icon="trend" eyebrow="02" title="Commercials" description="Selling price, product cost, Amazon fees and expected volume." />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="Sell price (inc. VAT) £" type="number" value={calc.sellPrice} onChange={set('sellPrice')} placeholder="0.00" />
              <Input label="Ad cost / unit £" type="number" value={calc.adCost} onChange={set('adCost')} placeholder="0.00" />
              <Select
                label="Listing format"
                value={(parseInt(calc.bundleQty) || 1) > 1 ? 'bundle' : 'single'}
                onChange={e => {
                  if (e.target.value === 'single') setCalc(c => ({ ...c, bundleQty: '1', costPerItem: '' }))
                  else setCalc(c => ({ ...c, bundleQty: c.bundleQty && parseInt(c.bundleQty) > 1 ? c.bundleQty : '2' }))
                }}
              >
                <option value="single">Single item</option>
                <option value="bundle">Bundle listing</option>
              </Select>
            </div>

            {calc.useComponents !== false && (Array.isArray(calc.components) || stockItems.length > 0) ? (
              <div className="mt-4">
                <ComponentPicker
                  components={calc.components || []}
                  stockItems={stockItems}
                  asin={calc.asin}
                  onCreateStockItem={onCreateStockItem}
                  onChange={(components) => setCalc(c => ({
                    ...c,
                    components,
                    bundleQty: String(components.reduce((s, x) => s + (parseInt(x.qty) || 0), 0) || 1),
                    // Supplier, codes and brand come from the products chosen
                    ...fillFromProducts(c, components, stockItems),
                  }))}
                />
                <button className="text-xs text-royal-600 hover:text-royal-700 mt-2 font-medium" onClick={() => setCalc(c => ({ ...c, useComponents: false, components: [] }))}>
                  Enter cost manually instead
                </button>
              </div>
            ) : (
              <div className="mt-4">
                {parseInt(calc.bundleQty) > 1 ? (
                  <div className="surface-sky p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="pill pill-brand"><Icon name="layers" size={12} /> Bundle of {calc.bundleQty}</span>
                      <div className="text-xs text-royal-700">Total cost {fmt((parseFloat(calc.costPerItem) || 0) * (parseInt(calc.bundleQty) || 1))}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input label="Cost per item £" type="number" value={calc.costPerItem || ''} onChange={set('costPerItem')} placeholder="0.00" />
                      <Input label="Items in bundle" type="number" min="2" value={calc.bundleQty} onChange={set('bundleQty')} placeholder="2" />
                    </div>
                  </div>
                ) : (
                  <Input label="Cost price £" type="number" value={calc.costPrice} onChange={set('costPrice')} placeholder="0.00" />
                )}
                {stockItems.length > 0 && (
                  <button className="text-xs text-royal-600 hover:text-royal-700 mt-2 font-medium" onClick={() => setCalc(c => ({ ...c, useComponents: true }))}>
                    Link to products instead
                  </button>
                )}
              </div>
            )}

            {/* Referral fee: Amazon's category rules when known, a plain % otherwise */}
            {(() => {
              const cat = calc.feeCategory ? findFeeCategory(calc.feeCategory) : null
              const price = parseFloat(calc.sellPrice) || 0
              const rate = cat && price > 0 ? effectiveRate(cat, price) : null
              const near = cat ? thresholdsFor(cat).find(t => price > 0 && Math.abs(price - t) <= 2) : null
              return (
                <div className="mt-4 p-3.5 rounded-card border border-rule bg-paper">
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_170px] gap-3 items-end">
                    <div>
                      <label className="label">Amazon fee category</label>
                      <select className="input" value={calc.feeCategory || ''}
                        onChange={e => setCalc(c => ({ ...c, feeCategory: e.target.value, feeVerified: false }))}>
                        <option value="">Not set — use a manual percentage</option>
                        {FEE_CATEGORIES.map(f => <option key={f.name} value={f.name}>{f.name} — {describeCategory(f)}</option>)}
                      </select>
                    </div>
                    {cat ? (
                      <div>
                        <label className="label">Fee at this price</label>
                        <div className="input bg-white font-semibold">{rate !== null ? `${rate.toFixed(2)}%` : '—'}</div>
                      </div>
                    ) : (
                      <Input label="Referral fee %" type="number" step="0.01" value={calc.refFee} onChange={set('refFee')} placeholder="15.3" />
                    )}
                  </div>
                  <div className="mt-3">
                    <FeeVerifier asin={(calc.asin || '').trim()} price={price} preferred={calc.feeCategory}
                      hint={`${calc.name || ''} ${calc.brand || ''}`} current={calc.feeCategory}
                      verified={!!calc.feeVerified && !!cat}
                      onVerify={(name) => setCalc(c => name
                        ? { ...c, feeCategory: name, feeVerified: true }
                        : { ...c, feeVerified: false })} />
                  </div>
                  {near && (
                    <div className="text-[13px] text-warn mt-2 font-medium">
                      The rate for {cat.name} changes at £{near}. Check the margin on both sides before settling on a price.
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <Input label="Monthly volume (optional)" type="number" value={calc.monthlyVolume || ''} onChange={set('monthlyVolume')} placeholder="Units / month" />
              <div className="flex items-end pb-2">
                <Checkbox label="0% VAT rated product" checked={calc.vatZero} onChange={set('vatZero')} />
              </div>
            </div>
          </section>

          {/* Fulfilment */}
          <section className="p-5 sm:p-6 border-t border-rule">
            <SectionHead icon="truck" eyebrow="03" title="Fulfilment" description="Weight, packaging and routing. The recommended carrier is based on your configured rules." />

            {parseInt(calc.bundleQty) > 1 && (
              <div className="surface-sky p-4 mb-4">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <span className="pill pill-brand"><Icon name="layers" size={12} /> Bundle of {calc.bundleQty}</span>
                  <Checkbox label="Enter total packed weight manually" checked={!!calc.weightOverride} onChange={set('weightOverride')} />
                </div>
                {calc.weightOverride ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label="Total bundle weight (kg)" type="number" value={calc.weightKg} onChange={set('weightKg')} placeholder="0.00" />
                    <div className="field">
                      <label className="label">Approx. weight per item</label>
                      <div className="input bg-white/70 text-ink/60">{((parseFloat(calc.weightKg) || 0) / (parseInt(calc.bundleQty) || 1)).toFixed(3)} kg</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label="Weight per item (kg)" type="number" value={calc.weightPerItem || ''} onChange={set('weightPerItem')} placeholder="0.00" />
                    <div className="field">
                      <label className="label">Total shipping weight</label>
                      <div className="input bg-white/70 text-ink font-semibold">{weightKg.toFixed(3)} kg <span className="text-xs text-ink/40 font-normal">({calc.bundleQty} items)</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {parseInt(calc.bundleQty) > 1 ? (
                <div className="field">
                  <label className="label">Shipping weight</label>
                  <div className="input bg-paper text-ink/70 font-medium">{weightKg.toFixed(3)} kg</div>
                </div>
              ) : (
                <Input label="Weight (kg)" type="number" value={calc.weightKg} onChange={set('weightKg')} placeholder="0.00" />
              )}
              <Select label="Service level" value={calc.serviceLevel} onChange={set('serviceLevel')}>
                {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select label="Packaging" value={calc.ownPackaging ? 'OWN' : (calc.packagingId || '')}
                onChange={(e) => {
                  if (e.target.value === 'OWN') setCalc(c => ({ ...c, ownPackaging: true, packagingId: '' }))
                  else setCalc(c => ({ ...c, ownPackaging: false, packagingId: e.target.value }))
                }}>
                <option value="OWN">Ships in its own packaging</option>
                <option value="">None</option>
                {packaging.map((p) => <option key={p.id} value={p.id}>{p.name} (£{p.cost.toFixed(2)})</option>)}
              </Select>
            </div>

            {smartSuggestion && !calc.carrierId && (
              <InfoBox title="Recommended route">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span><strong>{carriers[smartSuggestion]?.name}</strong> is the lowest eligible route for the current weight and service.</span>
                  <button className="btn btn-primary btn-xs" onClick={applySmartSuggestion}>Use recommendation</button>
                </div>
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
              {carrier ? (
                <Select label="Weight category" value={calc.carrierCatId || ''} onChange={set('carrierCatId')}>
                  <option value="">Select category</option>
                  {carrier.categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({fmt(c.rates[calc.serviceLevel] || 0)})</option>
                  ))}
                </Select>
              ) : <div />}
            </div>

            <div className="mt-4 border-t border-rule pt-4">
              <button className="flex items-center gap-2 text-sm font-semibold text-ink/65 hover:text-royal-600" onClick={() => setAdvancedShipping(v => !v)}>
                <Icon name={advancedShipping ? 'chevronDown' : 'chevronRight'} size={15} /> Advanced shipping options
              </button>
              {advancedShipping && (
                <div className="mt-4 bg-paper/65 border border-rule rounded-[5px] p-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-3 mb-4">
                    <Checkbox label="Letterbox eligible" checked={calc.letterbox} onChange={set('letterbox')} />
                    <Checkbox label="Split into multiple parcels" checked={calc.parcelSplit} onChange={set('parcelSplit')} />
                  </div>
                  {calc.parcelSplit && (
                    <div>
                      <div className="flex flex-wrap gap-4 items-end mb-3">
                        <div className="w-[150px]">
                          <Input label="Number of parcels" type="number" min={2} max={10} value={calc.numParcels} onChange={set('numParcels')} />
                        </div>
                        <div className="pb-2">
                          <Checkbox label="Override parcel weights" checked={!!calc.parcelWeightsOverride} onChange={(e) => setCalc((c) => ({ ...c, parcelWeightsOverride: e.target.checked }))} />
                        </div>
                      </div>
                      {calc.parcelWeightsOverride && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {Array(numP).fill(0).map((_, i) => (
                            <Input
                              key={i}
                              label={`Parcel ${i + 1} kg`}
                              type="number"
                              value={(calc.parcelWeights || [])[i] || ''}
                              onChange={(e) => {
                                const pw = [...(calc.parcelWeights || [])]
                                pw[i] = e.target.value
                                setCalc((c) => ({ ...c, parcelWeights: pw }))
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {r.shippingWarning && <WarnBox title="Shipping check">{r.shippingWarning}</WarnBox>}
          </section>
        </div>

        {/* Live decision panel */}
        <aside className="xl:sticky xl:top-6 space-y-4">
          <div className="surface overflow-hidden shadow-lift">
            <div className="bg-royal-500 text-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/65">Live result</div>
              <div className="flex items-end justify-between gap-4 mt-4">
                <div>
                  <div className="text-xs text-white/65 mb-1">Net profit / unit</div>
                  <div className="text-[36px] leading-none font-medium tracking-[-0.04em]">
                    {r.incomplete && r.sellPrice > 0 ? '—' : fmtSigned(r.netProfit)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/65 mb-1">Margin</div>
                  <div className="text-[24px] leading-none font-semibold">{r.incomplete && r.sellPrice > 0 ? '—' : pct(r.margin)}</div>
                </div>
              </div>
              {r.incomplete && r.sellPrice > 0 && (
                <div className="mt-3 p-2.5 rounded bg-white/10 text-[13px]">
                  <div className="font-semibold">Can't calculate this yet</div>
                  {r.issues.map((i, k) => <div key={k} className="text-white/80 mt-0.5">• {i.text}</div>)}
                </div>
              )}
              <div className="mt-4 h-[3px] bg-white/15 overflow-hidden">
                <div className={`h-full ${r.margin >= 20 ? 'bg-lime' : r.margin >= 10 ? 'bg-white' : 'bg-coral'}`} style={{ width: `${Math.max(3, Math.min(100, Math.max(0, r.margin) * 2.5))}%` }} />
              </div>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <div className="metric-label">Break-even price</div>
                  <div className="metric-value">{fmt(r.breakEven)}</div>
                </div>
                <div>
                  <div className="metric-label">VAT / unit</div>
                  <div className="metric-value text-royal-600">{fmt(r.vatAmount)}</div>
                </div>
              </div>

              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40 mb-1">Contribution breakdown</div>
              <ResultRow label="Selling price" value={fmt(r.sellPrice)} />
              <ResultRow label="VAT" value={`-${fmt(r.vatAmount)}`} valueClass="text-loss" />
              <ResultRow label={`Amazon fee ${(r.referralRate || 0).toFixed(2)}%${r.feeBasis === 'category' ? (calc.feeVerified ? ' · verified' : ' · estimated') : ''}`} value={`-${fmt(r.referralFee)}`} valueClass="text-loss" />
              <ResultRow label="Product cost" value={`-${fmt(r.costPrice)}`} valueClass="text-loss" />
              <ResultRow label="Shipping" value={`-${fmt(r.shippingCost)}`} valueClass="text-loss" />
              <ResultRow label="Packaging" value={`-${fmt(r.packCost)}`} valueClass="text-loss" />
              <ResultRow label="Advertising" value={`-${fmt(r.adCost)}`} valueClass="text-loss" />

              <div className="flex justify-between items-end pt-4 mt-2 border-t border-rule">
                <div>
                  <div className="text-xs font-semibold text-ink">Net contribution</div>
                  <div className="text-xs text-ink/40 mt-0.5">After VAT and variable costs</div>
                </div>
                <div className={`text-xl font-semibold ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</div>
              </div>

              {monthlyVolume > 0 && (
                <div className="surface-sky p-3.5 mt-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-royal-600">At {monthlyVolume.toLocaleString('en-GB')} units / month</div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div><div className="metric-label">Profit</div><div className={`text-sm font-semibold ${r.netProfit * monthlyVolume >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit * monthlyVolume)}</div></div>
                    <div><div className="metric-label">Revenue</div><div className="text-sm font-semibold">{fmt(r.sellPrice * monthlyVolume)}</div></div>
                    <div><div className="metric-label">VAT</div><div className="text-sm font-semibold text-royal-600">{fmt(r.vatAmount * monthlyVolume)}</div></div>
                  </div>
                </div>
              )}

              {/* Warning only — low margins are sometimes deliberate */}
              {r.sellPrice > 0 && r.margin < 10 && !r.incomplete && (
                <div className={`mt-5 p-3 rounded-card border ${r.netProfit < 0 ? 'border-loss/30 bg-loss/5' : 'border-warn/30 bg-warn/5'}`}>
                  <div className={`text-sm font-semibold ${r.netProfit < 0 ? 'text-loss' : 'text-warn'}`}>
                    {r.netProfit < 0 ? 'This loses money on every sale' : `Thin margin at ${pct(r.margin)}`}
                  </div>
                  <div className="text-[13px] text-ink/60 mt-1">
                    {r.netProfit < 0
                      ? (r.breakEven === null ? "It can't break even at any price — the fees take more than the costs allow." : `You'd need ${fmt(r.breakEven)} to break even.`)
                      : 'Fine if this is deliberate — for volume, or to hold a listing position.'}
                  </div>
                </div>
              )}

              {/* Optional: work backwards from a margin to the price needed */}
              <div className="mt-5">
                {!showTarget ? (
                  <button className="text-[13px] text-royal-500 hover:text-royal-700"
                    onClick={() => setShowTarget(true)}>
                    Work out the price for a target margin
                  </button>
                ) : (
                  <div className="p-3.5 rounded-card border border-rule bg-paper">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-sm font-semibold text-ink">Price for a target margin</span>
                      <button className="text-ink/40 hover:text-ink text-lg leading-none"
                        onClick={() => setShowTarget(false)}>×</button>
                    </div>
                    <div className="flex items-end gap-2 mb-3">
                      <div>
                        <label className="label">Target margin %</label>
                        <input type="number" step="1" className="input w-full sm:w-[100px]"
                          value={targetMargin} onChange={e => setTargetMargin(e.target.value)} />
                      </div>
                      <div className="flex gap-1 pb-1.5">
                        {[0, 10, 20, 30].map(v => (
                          <button key={v} className="btn btn-secondary btn-xs"
                            onClick={() => setTargetMargin(String(v))}>
                            {v === 0 ? 'Break even' : `${v}%`}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(() => {
                      const needed = priceForTargetMargin(calc, carriers, packaging, stockItems, targetMargin)
                      if (needed === null) {
                        return <div className="text-[13px] text-loss">
                          Not reachable at any price — the referral fee and VAT leave less than {targetMargin}% behind.
                        </div>
                      }
                      const diff = needed - r.sellPrice
                      return (
                        <>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[13px] text-ink/60">Sell at</span>
                            <span className="figure text-xl">{fmt(needed)}</span>
                          </div>
                          {r.sellPrice > 0 && (
                            <div className={`text-[13px] mt-1 ${diff > 0 ? 'text-warn' : 'text-gain'}`}>
                              {Math.abs(diff) < 0.005
                                ? 'That is roughly where you are now.'
                                : diff > 0
                                  ? `${fmt(diff)} above your current price.`
                                  : `${fmt(-diff)} below your current price — there is room here.`}
                            </div>
                          )}
                          <button className="btn btn-secondary btn-sm w-full justify-center mt-3"
                            onClick={() => setCalc(c => ({ ...c, sellPrice: needed.toFixed(2) }))}>
                            Use this price
                          </button>
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-2">
                {loadedProductId ? (
                  <button className="btn btn-primary w-full" onClick={handleUpdateExisting} disabled={saving || unchanged}>
                    <Icon name={unchanged ? 'check' : 'save'} size={15} /> {saving ? 'Saving…' : unchanged ? 'All changes saved' : 'Save changes'}
                  </button>
                ) : (
                  <button className="btn btn-primary w-full" onClick={() => { setSaveName(calc.name || ''); setSaveModal(true) }}>
                    <Icon name="bookmark" size={15} /> Save listing
                  </button>
                )}
                <div className={`text-center text-xs ${marginTone}`}>{r.margin < 10 ? 'Margin needs attention before launch.' : 'Result updates instantly as you edit the model.'}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {saveModal && (
        <Modal title="Save listing" description="Keep this calculation in Saved Listings until it is ready for review or launch." onClose={() => setSaveModal(false)}>
          <Input
            label="Listing name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g. Fairy Original 650ml — Pack of 2"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
          />
          <div className="flex gap-2 mt-5">
            <button className="btn btn-primary flex-1" onClick={handleSaveNew} disabled={saving || !saveName.trim()}>
              <Icon name="bookmark" size={15} /> {saving ? 'Saving…' : 'Save listing'}
            </button>
            <button className="btn btn-secondary" onClick={() => setSaveModal(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
