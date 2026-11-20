import React, { useState, useMemo } from 'react'
import { Modal, Icon, SuggestInput, SegmentedControl, Spinner, StatusBadge } from './UI'
import { QtyInput } from './CareParts'
import { useInventoryProducts } from './ManualParcel'
import { bulkShipOptions } from '../lib/db'

/**
 * Cheapest way to send a bulk order (v2.77.0) — asked BEFORE any label is made.
 *
 * A big order can go as one parcel per unit (DHL / Evri, each in its packaging) or on a pallet by Farrall's.
 * Amazon, eBay and TikTok need a parcel tracking number, so their pallet orders still send one unit by parcel;
 * Salt 4 U (the website) and direct orders go on the pallet whole.
 *
 * The database works it out (public.bulk_ship_options) from Cost Settings: parcel rates and their multi-parcel
 * rules, the packaging on the product's own listing, Farrall's price for the postcode and weight, and the fuel
 * surcharge. The warehouse sees which way to send it; the £ figures only come back for people who see costs.
 */
const money = (n) => `£${(Number(n) || 0).toFixed(2)}`
const SOURCES = [
  { id: 'market', label: 'Amazon / eBay / TikTok' },
  { id: 'direct', label: 'Salt 4 U / direct' },
]

export default function BulkShipCheck({ onClose }) {
  const picker = useInventoryProducts()
  const products = useMemo(() => picker.filter(p => p.kind !== 'packaging' && p.code).map(p => ({ id: p.id, code: p.code, label: p.name, sub: p.code })), [picker])
  const [product, setProduct] = useState(null)
  const [typed, setTyped] = useState('')
  const [units, setUnits] = useState(20)
  const [postcode, setPostcode] = useState('')
  const [source, setSource] = useState('market')
  const [service, setService] = useState('24hr')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ready = product && units > 0 && postcode.trim().length >= 2

  const check = async () => {
    setBusy(true); setErr(''); setRes(null)
    try { setRes(await bulkShipOptions({ code: product.code, units, postcode: postcode.trim(), tracked: source === 'market', service })) }
    catch (e) { setErr(e?.message || 'Couldn’t work it out — try again') }
    finally { setBusy(false) }
  }
  const stale = () => { setRes(null); setErr('') }
  const best = res?.options?.find(o => o.id === res.best)

  return (
    <Modal title="Cheapest way to send" description="For a big order, before any label is made: parcels, or a pallet by Farrall’s." onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="bsc-product">Product</label>
          <SuggestInput id="bsc-product" value={product ? product.label : typed} options={products} placeholder="Find the product"
            onChange={v => { setTyped(v); setProduct(null); stale() }} onPick={o => { if (o) { setProduct(o); setTyped(o.label); stale() } }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="bsc-units">How many</label>
            <QtyInput id="bsc-units" className="input w-full text-base sm:text-sm" value={units} onChange={n => { setUnits(n); stale() }} /></div>
          <div><label className="label" htmlFor="bsc-pc">Delivery postcode</label>
            <input id="bsc-pc" className="input text-base sm:text-sm uppercase" value={postcode} placeholder="e.g. M14 5AB" autoComplete="off"
              onChange={e => { setPostcode(e.target.value); stale() }} onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) check() }} /></div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <SegmentedControl label="Where the order came from" items={SOURCES} value={source} onChange={v => { setSource(v); stale() }} />
          <SegmentedControl label="Pallet service" items={[{ id: '24hr', label: '24hr' }, { id: '48hr', label: '48hr' }]} value={service} onChange={v => { setService(v); stale() }} />
        </div>
        <div className="text-xs text-ink/55">
          {source === 'market' ? 'One goes by parcel so the tracking number can be uploaded; the rest go on the pallet with no packaging.' : 'The whole order goes on the pallet — no parcel needed.'}
        </div>
        <button className="btn btn-primary w-full justify-center" disabled={!ready || busy} onClick={check}>
          <Icon name="truck" size={14} /> {busy ? 'Working it out…' : 'Find the cheapest way'}
        </button>
        {busy && <Spinner />}
        {err && <div className="text-sm text-loss" role="alert">{err}</div>}
        {res && !res.ok && <div className="text-sm text-loss" role="alert">{res.why || 'Couldn’t price this.'}</div>}

        {res?.ok && best && (
          <div className="space-y-2.5 pt-1" aria-live="polite">
            <div className="rounded-card border border-live/40 bg-live/5 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">Send it this way</div>
              <div className="text-base font-semibold text-ink mt-0.5">{res.best === 'pallet' ? 'By pallet' : 'As parcels'}</div>
              <div className="text-sm text-ink/75 mt-0.5">{best.label}</div>
              {res.money && res.saving != null && res.options.length > 1 && (
                <div className="text-sm text-ink mt-1.5">Saves <b className="tabular-nums">{money(res.saving)}</b> on this order</div>
              )}
              {res.best === 'pallet' && (
                <div className="text-xs text-ink/55 mt-1.5">
                  {best.size} · {Math.round(best.pallet_kg)}kg · {best.service}{best.parcel_units ? ` · make 1 ${best.parcel_carrier} label for ${best.parcel_units} (for the tracking); the other ${best.pallet_units} go on the pallet` : ''}
                </div>
              )}
            </div>
            {[...res.options].sort((x, y) => (x.id === res.best ? -1 : y.id === res.best ? 1 : 0)).map(o => (
              <div key={o.id} className={`card p-3 ${o.id === res.best ? '' : 'opacity-80'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{o.id === 'pallet' ? 'Pallet' : 'All parcels'}{o.id === res.best && <span className="ml-2"><StatusBadge tone="live">Cheapest</StatusBadge></span>}</div>
                    <div className="text-xs text-ink/60 mt-0.5">{o.label}</div>
                  </div>
                  {res.money && <div className="text-base font-semibold text-ink tabular-nums whitespace-nowrap">{money(o.total)}</div>}
                </div>
                {res.money && (
                  <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs text-ink/65 tabular-nums">
                    {o.id === 'parcels' && <><span>{o.parcels} × {o.carrier} (Next Day)</span><span className="text-right">{money(o.shipping)}</span></>}
                    {o.id === 'pallet' && <>
                      <span>{o.carrier} {o.size.toLowerCase()}, {o.service}, band {o.band}</span><span className="text-right">{money(o.pallet_base)}</span>
                      <span>Fuel surcharge {o.fuel_pct}%</span><span className="text-right">{money(o.fuel)}</span>
                      {o.parcel_units > 0 && <><span>1 × {o.parcel_carrier} parcel (tracking)</span><span className="text-right">{money(o.parcel_shipping)}</span></>}
                    </>}
                    <span>Packaging{o.id === 'parcels' && o.packaging_name ? ` — ${o.parcels} × ${o.packaging_name}` : o.id === 'pallet' && !o.parcel_units ? ' — none on a pallet' : ''}</span><span className="text-right">{money(o.packaging)}</span>
                  </div>
                )}
              </div>
            ))}
            <div className="text-xs text-ink/50">
              {res.units} × {res.product} · {res.unit_kg}kg each · {Math.round(res.total_kg * 100) / 100}kg in all · to {res.postcode}
              {(res.notes || []).map((n, i) => <div key={i} className="text-warn mt-0.5">{n}</div>)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
