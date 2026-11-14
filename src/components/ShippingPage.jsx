import React, { useState, useMemo } from 'react'
import { calcProduct, shippingSaving, fmt, fmtSigned, pct } from '../lib/calc'
import { ProductImage, PageHeader, Icon } from './UI'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { SERVICE_LABELS } from '../lib/defaults'

/**
 * Checks every live listing is on the cheapest carrier that can carry its
 * weight. Carriers get chosen once and rarely revisited, so rates drift.
 */
export default function ShippingPage({
  savedProducts, liveProducts, stockItems, settings, onNavigate, onProposeCarrier, pendingCarrier = new Set(),
}) {
  const [onlySavings, setOnlySavings] = useState(true)
  const [applying, setApplying] = useState(null)

  const rows = useMemo(() => liveProducts
    .map(lp => {
      const saved = savedProducts.find(s => s.id === lp.saved_product_id)
      if (!saved) return null
      const p = saved.data || saved
      const s = shippingSaving(p, settings.carriers, stockItems)
      if (!s) return null
      const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
      return { lp, saved, p, r, s }
    })
    .filter(Boolean), [liveProducts, savedProducts, stockItems, settings])

  const savers = rows.filter(x => !x.s.rateMissing && x.s.saving > 0.001).sort((a, b) => b.s.saving - a.s.saving)
  const missing = rows.filter(x => x.s.rateMissing)
  const shown = onlySavings
    ? [...missing, ...savers]
    : [...rows].sort((a, b) => (b.s.rateMissing ? 1 : 0) - (a.s.rateMissing ? 1 : 0) || b.s.saving - a.s.saving)

  const totalPerUnit = savers.reduce((sum, x) => sum + x.s.saving, 0)
  const serviceSavers = rows.filter(x => x.s.cheaperService)
  const serviceSaving = serviceSavers.reduce((sum, x) => sum + x.s.cheaperService.saving, 0)
  const unconfigured = Object.values(settings.carriers || {}).filter(c =>
    (c.categories || []).every(cat => Object.values(cat.rates || {}).every(v => !v))
  )

  return (
    <div>
      <PageHeader
        eyebrow="Optimise / shipping"
        title="Shipping"
        description="Whether each listing is on the cheapest carrier that can take its weight. Switches are proposed for your approval, never made directly."
        meta={`${rows.length} listings checked`}
        actions={
          <button className="btn btn-secondary btn-sm" disabled={!rows.length}
          onClick={() => exportRowsToCsv(stampedName('shipping-review'), shown, [
            { header: 'Listing', value: x => x.saved.name },
            { header: 'ASIN', value: x => x.p.asin || '' },
            { header: 'Weight kg', value: x => x.s.weightKg.toFixed(3) },
            { header: 'Service', value: x => SERVICE_LABELS[x.s.service] || x.s.service },
            { header: 'Current carrier', value: x => x.s.currentName },
            { header: 'Current rate', value: x => x.s.currentRate.toFixed(2) },
            { header: 'Cheapest carrier', value: x => `${x.s.best.carrierName} — ${x.s.best.catName}` },
            { header: 'Cheapest rate', value: x => x.s.best.rate.toFixed(2) },
            { header: 'Saving per unit', value: x => x.s.saving.toFixed(2) },
            { header: 'Margin now %', value: x => x.r.margin.toFixed(1) },
          ])}
        ><Icon name="download" size={14} /> Export CSV</button>
        }
      />

      {unconfigured.length > 0 && (
        <div className="panel-notice mb-4">
          <div className="font-semibold text-ink">
            {unconfigured.map(c => c.name).join(', ')} {unconfigured.length === 1 ? 'has' : 'have'} no rates set
          </div>
          <div className="text-sm text-ink/60 mt-1">
            Carriers with no rates are skipped entirely rather than treated as free, so this review
            can only compare what's in Settings. Adding your negotiated rates would likely change these results.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="metric-card">
          <div className="metric-label">Listings reviewed</div>
          <div className="figure text-[26px] mt-0.5">{rows.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">On the cheapest option</div>
          <div className="figure text-[26px] mt-0.5 text-gain">{rows.length - savers.length - missing.length}</div>
          {missing.length > 0 && (
            <div className="text-[13px] text-warn mt-0.5">{missing.length} with no rate set</div>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-label">Could move</div>
          <div className={`figure text-[26px] mt-0.5 ${savers.length ? 'text-warn' : ''}`}>{savers.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Saving per unit sold</div>
          <div className={`figure text-[26px] mt-0.5 ${totalPerUnit > 0 ? 'text-gain' : ''}`}>{fmt(totalPerUnit)}</div>
          <div className="text-[13px] text-ink/45 mt-0.5">across all of them</div>
        </div>
      </div>

      {serviceSavers.length > 0 && (
        <div className="panel-brand mb-4">
          <div className="font-semibold text-ink">
            {serviceSavers.length} listing{serviceSavers.length !== 1 ? 's' : ''} could move to a cheaper service level
          </div>
          <div className="text-sm text-ink/60 mt-1">
            Worth {fmt(serviceSaving)} per unit in total. This changes what the customer is
            promised, so it's a commercial decision rather than a straight saving — but if any of
            these don't need the faster service, the money is there.
          </div>
        </div>
      )}

      {savers.filter(x => !pendingCarrier.has(x.saved.id)).length > 1 && onProposeCarrier && (
        <div className="mb-4">
          <button className="btn btn-primary btn-sm"
            onClick={() => onProposeCarrier(savers.filter(x => !pendingCarrier.has(x.saved.id)))}>
            Propose all {savers.filter(x => !pendingCarrier.has(x.saved.id)).length} switches
          </button>
          <span className="text-[13px] text-ink/50 ml-3">They go to Approvals — nothing changes until you approve.</span>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer text-sm text-ink/70 mb-4">
        <input type="checkbox" className="w-4 h-4 accent-royal-500"
          checked={onlySavings} onChange={e => setOnlySavings(e.target.checked)} />
        Only show listings that could move, or have no rate set
      </label>

      {shown.length === 0 ? (
        <div className="card text-center py-12">
          <div className="font-medium text-ink mb-1">Everything is on its cheapest carrier</div>
          <div className="text-sm text-ink/50">
            Based on the rates currently in Settings
          </div>
        </div>
      ) : (
        <div className="card-flush overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-b border-rule">
                  <th className="th text-left px-5">Listing</th>
                  <th className="th text-right px-3">Weight</th>
                  <th className="th text-left px-3">Service</th>
                  <th className="th text-left px-3">Paying now</th>
                  <th className="th text-left px-3">Cheapest option</th>
                  <th className="th text-right px-3">Saving</th>
                  <th className="th px-5"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ lp, saved, p, r, s }) => (
                  <tr key={lp.id} className="border-b border-rule/60 hover:bg-royal-50/50">
                    <td className="td px-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                          <ProductImage asin={p.asin} manualImage={p.productImage} alt={saved.name}
                            className="object-contain w-full h-full p-0.5" placeholderSize="text-sm" />
                        </div>
                        <div className="min-w-0">
                          <button className="text-ink hover:text-royal-600 text-left truncate block"
                            style={{ maxWidth: "min(100%, 260px)" }}
                            onClick={() => onNavigate?.('live', saved.id)}>{saved.name}</button>
                          <div className="text-xs text-ink/45">margin {pct(r.margin)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="td px-3 text-right text-ink/60">{s.weightKg.toFixed(2)}kg</td>
                    <td className="td px-3">
                      <span className="pill pill-quiet">{SERVICE_LABELS[s.service] || s.service}</span>
                    </td>
                    <td className="td px-3">
                      <div className="text-ink/70 text-[13px]">{s.currentName}</div>
                      {s.rateMissing
                        ? <div className="text-warn text-xs font-medium">No rate set</div>
                        : <div className="text-ink/50 text-xs">{fmt(s.currentRate)}</div>}
                    </td>
                    <td className="td px-3">
                      <div className={`text-[13px] ${s.isBest ? 'text-ink/50' : 'text-ink font-medium'}`}>
                        {s.best.carrierName} — {s.best.catName}
                      </div>
                      <div className="text-xs text-ink/50">{fmt(s.best.rate)}</div>
                      {s.cheaperService && (
                        <div className="text-xs text-royal-500 mt-0.5">
                          {SERVICE_LABELS[s.cheaperService.service] || s.cheaperService.service} would be {fmt(s.cheaperService.rate)}
                        </div>
                      )}
                    </td>
                    <td className="td px-3 text-right">
                      {s.rateMissing
                        ? <span className="pill pill-paused">Unknown</span>
                        : s.saving > 0.001
                          ? <span className="font-semibold text-gain">{fmt(s.saving)}</span>
                          : <span className="pill pill-live">Cheapest</span>}
                    </td>
                    <td className="td px-5 text-right">
                      {!s.rateMissing && s.saving > 0.001 && onProposeCarrier && (
                        pendingCarrier.has(saved.id)
                          ? <span className="pill pill-brand">Proposed</span>
                          : <button className="btn btn-secondary btn-xs"
                              disabled={applying === saved.id}
                              onClick={async () => {
                                setApplying(saved.id)
                                await onProposeCarrier([{ saved, s }])
                                setApplying(null)
                              }}>
                              {applying === saved.id ? '…' : 'Propose switch'}
                            </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {savers.length > 0 && (
        <div className="text-[13px] text-ink/50 mt-4">
          Savings are per unit sold. Whether a move is worth making depends on volume, and on
          service factors this can't see — tracking, claims, collection times.
        </div>
      )}
    </div>
  )
}
