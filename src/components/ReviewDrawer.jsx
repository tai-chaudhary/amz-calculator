import React, { useState, useMemo } from 'react'
import { calcProduct, carrierOptions, effectiveWeight, fmt, fmtSigned, pct } from '../lib/calc'
import { FEE_CATEGORIES, describeCategory } from '../lib/feeSchedule'
import { SERVICE_LABELS } from '../lib/defaults'
import { Drawer, Icon, StatusBadge, ProductImage } from './UI'
import FeeVerifier from './FeeVerifier'
import { ListingConnections } from './Links'

/**
 * Everything an approver needs to decide, without leaving the queue: the full
 * calculation, where the listing came from, and the figures most likely to be
 * wrong — editable, so a fix and an approval can happen together.
 */
export default function ReviewDrawer({
  row, settings, stockItems, position, onPrev, onNext, onClose,
  onApprove, onSendBack, onSaveChanges, onOpenCalculator,
}) {
  const original = row.data || {}
  const [p, setP] = useState(original)
  // After a save the stored listing catches up; follow it
  React.useEffect(() => { setP(prev => ({ ...row.data, ...Object.fromEntries(Object.entries(prev).filter(([k]) => JSON.stringify(prev[k]) !== JSON.stringify(original[k]))) })) }, [row.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(null)
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const set = (k) => (e) => setP(x => ({ ...x, [k]: e.target.value }))

  const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
  const before = useMemo(() => calcProduct(original, settings.carriers, settings.packaging, stockItems), [original, settings, stockItems])
  // Bookkeeping stamps added on save aren't changes the reviewer made
  const META = ['lastEditedBy', 'lastEditedByName', 'updated_at']
  const changedKeys = [...new Set([...Object.keys(p), ...Object.keys(original)])]
    .filter(k => !META.includes(k) && JSON.stringify(p[k] ?? null) !== JSON.stringify(original[k] ?? null))
  const dirty = changedKeys.length > 0

  const weight = effectiveWeight(p, stockItems)
  const options = carrierOptions(weight, p.serviceLevel || 'nextday', settings.carriers)
  const carrierKey = p.carrierId && p.carrierCatId ? `${p.carrierId}|${p.carrierCatId}` : ''
  const h = p.hunter

  const act = async (kind, fn) => { setBusy(kind); try { return await fn() } finally { setBusy(null) } }

  const footer = (
    <div>
      {returning && (
        <div className="mb-3 p-3 rounded-lg border border-rule bg-paper">
          <label className="label" htmlFor="sendback-note">What needs changing?</label>
          <input id="sendback-note" className="input mb-2" value={note} onChange={e => setNote(e.target.value)} autoFocus
            placeholder="e.g. Check the weight — the 6-pack is heavier than this" />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={!note.trim() || busy}
              onClick={() => act('back', async () => { await onSendBack(row.id, note.trim()); setReturning(false); onNext ? onNext() : onClose() })}>
              Send back with note
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setReturning(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-1.5 items-center">
          <button className="btn btn-secondary btn-sm" disabled={!onPrev} onClick={onPrev}><Icon name="back" size={14} /> Previous</button>
          <button className="btn btn-secondary btn-sm" disabled={!onNext} onClick={onNext}>Next <Icon name="chevronRight" size={14} /></button>
          {position && <span className="text-xs text-ink/45 ml-1">{position.at} of {position.of}</span>}
        </div>
        {!returning && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button className="btn btn-secondary btn-sm" onClick={() => onOpenCalculator(row)} title="Open in the full calculator">
              <Icon name="calculator" size={14} /> Calculator
            </button>
            <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setReturning(true)}>Send back…</button>
            {dirty && (
              <button className="btn btn-secondary btn-sm" disabled={!!busy}
                onClick={() => act('save', () => onSaveChanges(row.id, p))}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
            )}
            <button className="btn btn-primary btn-sm" disabled={!!busy || r.incomplete}
              title={r.incomplete ? 'This listing can’t be calculated yet' : ''}
              onClick={() => act('approve', async () => {
                const ok = await onApprove(row.id, row.name, dirty ? p : null)
                if (ok) onNext ? onNext() : onClose()
              })}>
              <Icon name="check" size={14} /> {busy === 'approve' ? 'Approving…' : dirty ? 'Save changes & approve' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <Drawer title={row.name} description={`In review${p.submittedByName ? ` · sent by ${p.submittedByName}` : ''}${p.submittedAt ? ` · ${new Date(p.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`}
      onClose={onClose} footer={footer} width="max-w-2xl">
      <div className="flex gap-4 mb-4">
        <div className="w-20 h-20 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
          <ProductImage asin={p.asin} manualImage={p.productImage} alt="" className="object-contain w-full h-full p-1.5" placeholderSize="text-2xl" />
        </div>
        <div className="min-w-0 space-y-2">
          <ListingConnections p={p} stockItems={stockItems} />
          <div className="flex flex-wrap gap-1.5">
            {p.feeVerified ? <StatusBadge tone="live">Fee verified</StatusBadge> : <StatusBadge tone="paused">Fee not verified</StatusBadge>}
            {r.incomplete && <StatusBadge tone="alert">Can’t calculate</StatusBadge>}
            {h && <StatusBadge tone="brand">From hunt{h.huntName ? `: ${h.huntName}` : ''}</StatusBadge>}
          </div>
        </div>
      </div>

      {h && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Fact label="Market sales" value={h.sales != null ? `${Number(h.sales).toLocaleString()}/mo` : '—'} />
          <Fact label="Sellers" value={h.sellers ?? '—'} />
          <Fact label="Amazon selling" value={h.amazonSelling ? 'Yes' : 'No'} tone={h.amazonSelling ? 'text-loss' : ''} />
          <Fact label="Market price" value={h.marketPrice != null ? fmt(h.marketPrice) : '—'} />
        </div>
      )}

      {/* The answer */}
      <div className="card-flush overflow-hidden mb-4">
        <div className="px-5 py-4 bg-ink text-white flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-white/60">Net profit per sale</div>
            <div className={`text-3xl font-semibold ${r.incomplete ? '' : r.netProfit >= 0 ? 'text-white' : 'text-red-300'}`}>{r.incomplete ? '—' : fmtSigned(r.netProfit)}</div>
          </div>
          <div className="text-right text-sm">
            <div><span className="text-white/60">Margin</span> <b>{r.incomplete ? '—' : pct(r.margin)}</b></div>
            <div><span className="text-white/60">Break-even</span> <b>{fmt(r.breakEven)}</b></div>
          </div>
        </div>
        {dirty && !r.incomplete && !before.incomplete && (
          <div className="px-5 py-2 bg-warn/10 text-[13px] text-warn font-medium">
            Your changes move this from {fmtSigned(before.netProfit)} ({pct(before.margin)}) to {fmtSigned(r.netProfit)} ({pct(r.margin)}).
          </div>
        )}
        {r.incomplete && (
          <div className="px-5 py-2 bg-loss/10 text-[13px] text-loss">{r.issues.map(i => i.text).join(' · ')}</div>
        )}
        <dl className="px-5 py-3 text-sm">
          <Line label="Sell price (inc. VAT)" value={fmt(r.sellPrice)} />
          <Line label="VAT" value={`−${fmt(r.vatAmount)}`} neg />
          <Line label="Product cost" value={`−${fmt(r.costPrice)}`} neg />
          <Line label={`Amazon fee ${(r.referralRate || 0).toFixed(2)}%`} value={`−${fmt(r.referralFee)}`} neg />
          <Line label={`Shipping · ${weight ? weight.toFixed(2) + 'kg' : 'no weight'}`} value={`−${fmt(r.shippingCost)}`} neg />
          <Line label="Packaging" value={`−${fmt(r.packCost)}`} neg />
          {r.adCost > 0 && <Line label="Advertising" value={`−${fmt(r.adCost)}`} neg />}
        </dl>
      </div>

      {/* The figures most worth checking — editable in place */}
      <div className="card mb-3">
        <div className="font-semibold text-ink mb-3">Price and fee</div>
        <div className="grid grid-cols-1 sm:grid-cols-[130px_120px_minmax(0,1fr)] gap-3">
          <div><label className="label" htmlFor="rv-price">Sell price £</label>
            <input id="rv-price" type="number" step="0.01" className="input" value={p.sellPrice || ''} onChange={set('sellPrice')} /></div>
          <div><label className="label" htmlFor="rv-vol">Monthly volume</label>
            <input id="rv-vol" type="number" className="input" value={p.monthlyVolume || ''} onChange={set('monthlyVolume')} /></div>
          <div><label className="label" htmlFor="rv-fee">Amazon fee category</label>
            <select id="rv-fee" className="input" value={p.feeCategory || ''}
              onChange={e => setP(x => ({ ...x, feeCategory: e.target.value, feeVerified: false }))}>
              <option value="">Not set — {p.refFee || '15.3'}%</option>
              {FEE_CATEGORIES.map(f => <option key={f.name} value={f.name}>{f.name} — {describeCategory(f)}</option>)}
            </select></div>
        </div>
        <div className="mt-3">
          <FeeVerifier asin={(p.asin || '').trim()} price={parseFloat(p.sellPrice) || 0} preferred={p.feeCategory}
            hint={`${row.name} ${p.brand || ''}`} current={p.feeCategory} verified={!!p.feeVerified && !!p.feeCategory}
            onVerify={(name) => setP(x => name ? { ...x, feeCategory: name, feeVerified: true } : { ...x, feeVerified: false })} />
        </div>
      </div>

      <div className="card mb-3">
        <div className="font-semibold text-ink mb-3">Fulfilment</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label" htmlFor="rv-svc">Service</label>
            <select id="rv-svc" className="input" value={p.serviceLevel || 'nextday'} onChange={set('serviceLevel')}>
              {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="label" htmlFor="rv-car">Carrier</label>
            <select id="rv-car" className="input" value={carrierKey}
              onChange={e => { const [c, b] = e.target.value.split('|'); setP(x => ({ ...x, carrierId: c, carrierCatId: b })) }}>
              {!options.some(o => `${o.carrierId}|${o.catId}` === carrierKey) && <option value={carrierKey}>{carrierKey ? 'Current (not valid for this weight)' : 'Choose…'}</option>}
              {options.map(o => <option key={`${o.carrierId}|${o.catId}`} value={`${o.carrierId}|${o.catId}`}>{o.carrierName} {o.catName} — {fmt(o.rate)}</option>)}
            </select></div>
          <div><label className="label" htmlFor="rv-pack">Packaging</label>
            <select id="rv-pack" className="input" value={p.ownPackaging ? 'OWN' : (p.packagingId || '')}
              onChange={e => setP(x => e.target.value === 'OWN' ? { ...x, ownPackaging: true, packagingId: '' } : { ...x, ownPackaging: false, packagingId: e.target.value })}>
              <option value="">None</option>
              <option value="OWN">Ships in its own packaging</option>
              {settings.packaging.map(pk => <option key={pk.id} value={pk.id}>{pk.name} — {fmt(pk.cost)}</option>)}
            </select></div>
        </div>
        <div className="text-xs text-ink/50 mt-2">To change what the listing is made of, open it in the calculator.</div>
      </div>
    </Drawer>
  )
}

function Line({ label, value, neg }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-ink/70">{label}</dt>
      <dd className={`font-medium ${neg ? 'text-loss' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

function Fact({ label, value, tone = '' }) {
  return (
    <div className="metric-card py-2">
      <div className="metric-label">{label}</div>
      <div className={`text-sm font-semibold ${tone || 'text-ink'}`}>{value}</div>
    </div>
  )
}
