import React, { useState, useMemo } from 'react'
import { calcProduct, carrierOptions, fmt, fmtSigned, pct } from '../lib/calc'
import { FEE_CATEGORIES, findFeeCategory, describeCategory } from '../lib/feeSchedule'
import { SERVICE_LABELS } from '../lib/defaults'
import { SKIP_REASONS, sentStatus } from '../lib/hunts'
import { Drawer, Icon, StatusBadge, ProductImage } from './UI'
import { AmazonLink, BrandLink, ListingLink } from './Links'
import FeeVerifier from './FeeVerifier'

const TIER_LABEL = {
  confirmed: 'Confirmed by you', barcode: 'Matched by barcode',
  likely: 'Likely match by name', possible: 'Possible match by name',
}

/**
 * Everything behind a hunter result, laid out so each figure can be checked —
 * and changed — before the listing goes to review.
 */
export default function HuntDetail({
  r, hunt, index, settings, position, checks = [], onPrev, onNext, onClose,
  onDecideMatch, onSendToReview, onSkip, onLater, onUndo, onNavigate,
}) {
  const { l, m, ev } = r
  const d = l.data || {}
  const comp = m.components[0]
  const needsConfirm = m.tier === 'likely' || m.tier === 'possible'
  const item = r.item || { disposition: 'pending' }
  const pending = item.disposition === 'pending' || item.disposition === 'later'
  const existing = checks.find(c => c.existingId)
  const canSend = (m.tier === 'barcode' || m.tier === 'confirmed') && !existing && pending

  // Everything below starts from the hunter's choices and can be overridden
  const [offerIdx, setOfferIdx] = useState(0)
  const [qty, setQty] = useState(String(comp?.qty || 1))
  const [price, setPrice] = useState(String(d.price ?? ''))
  const [weight, setWeight] = useState(String(ev?.weightKg ?? ''))
  const [service, setService] = useState(ev?.product?.serviceLevel || 'nextday')
  const [carrierKey, setCarrierKey] = useState(ev?.carrier ? `${ev.carrier.carrierId}|${ev.carrier.catId}` : '')
  const [packKey, setPackKey] = useState(ev?.pack?.ownPackaging ? 'OWN' : (ev?.pack?.packagingId || ''))
  const [feeCat, setFeeCat] = useState(ev?.feeSource === 'confirmed' ? ev.feeCategory : '')
  const [refFee, setRefFee] = useState(ev?.product?.refFee || '15.3')
  const [feeVerified, setFeeVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [skipReason, setSkipReason] = useState('')
  const [skipNote, setSkipNote] = useState('')

  const offers = comp?.offers?.length ? comp.offers : comp ? [comp.sp] : []
  const offer = offers[offerIdx] || comp?.sp
  const weightKg = parseFloat(weight) || 0
  const options = useMemo(() => carrierOptions(weightKg, service, settings.carriers), [weightKg, service, settings.carriers])

  // If the weight or service changes, the chosen carrier may no longer apply
  const carrierValid = options.some(o => `${o.carrierId}|${o.catId}` === carrierKey)
  const effectiveCarrier = carrierValid ? carrierKey : (options[0] ? `${options[0].carrierId}|${options[0].catId}` : '')
  const [carrierId, carrierCatId] = effectiveCarrier.split('|')

  const q = parseInt(qty) || 1
  const product = {
    sellPrice: price, costPrice: String((offer?.unit_cost || 0) * q), bundleQty: '1',
    weightKg: String(weightKg), serviceLevel: service,
    carrierId: carrierId || '', carrierCatId: carrierCatId || '',
    packagingId: packKey === 'OWN' ? '' : packKey, ownPackaging: packKey === 'OWN',
    feeCategory: feeCat, refFee: feeCat ? '' : refFee, vatZero: false,
  }
  const res = calcProduct(product, settings.carriers, settings.packaging, [])
  const changed = res.netProfit !== undefined && ev && Math.abs(res.netProfit - ev.netProfit) > 0.005

  const carrier = carrierId ? settings.carriers[carrierId] : null
  const band = carrier?.categories?.find(c => c.id === carrierCatId)
  const packItem = settings.packaging.find(p => p.id === packKey)
  const cat = feeCat ? findFeeCategory(feeCat) : null
  const dims = d.dimsCm ? d.dimsCm.map(v => v.toFixed(1)).join(' × ') + ' cm' : null

  const act = async (fn) => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  const footer = (
    <div>
      {skipping && (
        <div className="mb-3 p-3 rounded-lg border border-rule bg-paper">
          <div className="text-sm font-medium text-ink mb-2">Why are you skipping this?</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SKIP_REASONS.map(x => (
              <button key={x} onClick={() => setSkipReason(x)}
                className={`px-2.5 py-1 rounded-md border text-[13px] ${skipReason === x ? 'border-royal-400 bg-royal-50 text-royal-600 font-medium' : 'border-rule bg-white text-ink/70 hover:border-royal-300'}`}>{x}</button>
            ))}
          </div>
          <input className="input text-sm mb-2" placeholder={skipReason === 'Other' ? 'Say why (required)' : 'Add a note (optional)'}
            value={skipNote} onChange={e => setSkipNote(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !skipReason || (skipReason === 'Other' && !skipNote.trim())}
              onClick={() => act(async () => { await onSkip(skipReason, skipNote.trim() || null); setSkipping(false) })}>Skip and go to next</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSkipping(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-1.5 items-center">
          <button className="btn btn-secondary btn-sm" disabled={!onPrev} onClick={onPrev}><Icon name="back" size={14} /> Previous</button>
          <button className="btn btn-secondary btn-sm" disabled={!onNext} onClick={onNext}>Next <Icon name="chevronRight" size={14} /></button>
          {position && <span className="text-[12px] text-ink/45 ml-1">{position.at} of {position.of}</span>}
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {needsConfirm && pending && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={busy}
                onClick={() => act(() => onDecideMatch(l.asin, 'rejected', []))}>Not a match</button>
              <button className="btn btn-primary btn-sm" disabled={busy}
                onClick={() => act(() => onDecideMatch(l.asin, 'confirmed', [{ barcode: offer.barcode, qty: q, sku: offer.supplier_sku }]))}>
                <Icon name="check" size={14} /> {busy ? 'Confirming…' : 'Confirm match'}
              </button>
            </>
          )}
          {pending && !skipping && (
            <>
              {item.disposition !== 'later' && (
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(onLater)}>Save for later</button>
              )}
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSkipping(true)}>Skip…</button>
            </>
          )}
          {canSend && (
            <button className="btn btn-primary btn-sm" disabled={busy || !offer || !(parseFloat(price) > 0) || !feeVerified}
              title={feeVerified ? '' : 'Verify the Amazon fee first'}
              onClick={() => act(() => onSendToReview(r, { product: { ...product, feeVerified }, qty: q, offer, feeConfirmed: !!feeCat }))}>
              <Icon name="send" size={14} /> {busy ? 'Sending…' : 'Send to review'}
            </button>
          )}
          {item?.disposition === 'sent' && (
            <>
              {item.saved_product_id && <ListingLink id={item.saved_product_id} name="Open the listing" />}
              <button className="btn btn-secondary btn-sm" disabled><Icon name="check" size={14} /> Sent for review{item.decided_by ? ` by ${item.decided_by}` : ''}</button>
            </>
          )}
          {item?.disposition === 'later' && <StatusBadge tone="paused">Saved for later</StatusBadge>}
        </div>
      </div>
      {canSend && !feeVerified && (
        <div className="text-[12px] text-warn mt-2 text-right">Verify the Amazon fee above before sending — it's the figure most likely to be wrong.</div>
      )}
    </div>
  )

  return (
    <Drawer title={hunt ? hunt.name : 'Check before sending'} description={`${l.brand || ''} · ${l.asin}${position ? ` · ${position.at} of ${position.of}` : ''}`} onClose={onClose} footer={footer} width="max-w-2xl">
      {/* Where this listing stands */}
      {item.disposition === 'sent' && (() => {
        const st = r.status
        return (
          <div className="panel-brand mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-ink">Sent to review{item.decided_by ? ` by ${item.decided_by}` : ''}</div>
              <div className="text-[13px] text-ink/60 mt-0.5">Now: <b>{st?.label || 'unknown'}</b>{st?.note ? ` — "${st.note}"` : ''}</div>
            </div>
            {item.saved_product_id && <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('saved', item.saved_product_id)}>Open listing</button>}
          </div>
        )
      })()}
      {item.disposition === 'skipped' && (
        <div className="p-3 rounded-lg border border-rule bg-paper mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm"><b>Skipped</b> — {item.reason}{item.note ? `: ${item.note}` : ''}{item.decided_by ? <span className="text-ink/45"> · {item.decided_by}</span> : ''}</div>
          <button className="btn btn-secondary btn-sm" onClick={onUndo}>Undo</button>
        </div>
      )}
      {item.disposition === 'later' && (
        <div className="p-3 rounded-lg border border-warn/30 bg-warn/5 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm"><b>Saved for later</b>{item.decided_by ? <span className="text-ink/45"> · {item.decided_by}</span> : ''}</div>
          <button className="btn btn-secondary btn-sm" onClick={onUndo}>Move back to "to decide"</button>
        </div>
      )}
      {r.prevSkips?.length > 0 && (
        <div className="p-3 rounded-lg border border-warn/30 bg-warn/5 mb-4 text-sm">
          <b>Skipped in an earlier hunt</b>
          {r.prevSkips.slice(0, 3).map(s => (
            <div key={s.id} className="text-[13px] text-ink/70 mt-1">
              {s.huntName}: {s.reason}{s.note ? ` — ${s.note}` : ''}{s.decided_by ? ` (${s.decided_by}, ${new Date(s.decided_at).toLocaleDateString('en-GB')})` : ''}
            </div>
          ))}
          <div className="text-[12px] text-ink/45 mt-1">Prices and sellers may have changed since — worth a fresh look.</div>
        </div>
      )}
      {checks.filter(c => !c.existingId || item.disposition !== 'sent').length > 0 && (
        <div className="space-y-1.5 mb-4">
          {checks.filter(c => !c.existingId || item.disposition !== 'sent').map((c, i) => (
            <div key={i} className={`text-[13px] px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${c.tone === 'alert' ? 'border-loss/30 bg-loss/5 text-loss' : c.tone === 'brand' ? 'border-royal-200 bg-royal-50 text-royal-700' : 'border-warn/30 bg-warn/5 text-warn'}`}>
              <span>{c.text}</span>
              {c.existingId && <button className="underline flex-shrink-0" onClick={() => onNavigate?.('saved', c.existingId)}>Open</button>}
            </div>
          ))}
        </div>
      )}

      {/* The listing */}
      <div className="flex gap-4 mb-5">
        <a href={`https://www.amazon.co.uk/dp/${l.asin}`} target="_blank" rel="noopener noreferrer"
          className="w-24 h-24 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
          <ProductImage asin={l.asin} alt="" className="object-contain w-full h-full p-1.5" placeholderSize="text-2xl" />
        </a>
        <div className="min-w-0">
          <div className="font-semibold text-ink">{l.title}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <AmazonLink asin={l.asin} />
            {l.brand && <BrandLink name={l.brand} />}
            <StatusBadge tone={needsConfirm ? 'brand' : 'live'}>{TIER_LABEL[m.tier] || m.tier}</StatusBadge>
            {r.flags.map((f, i) => <StatusBadge key={i} tone={f.tone}>{f.text}</StatusBadge>)}
          </div>
        </div>
      </div>

      {/* The answer, kept in view */}
      <div className="card-flush overflow-hidden mb-5">
        <div className="px-5 py-4 bg-ink text-white flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[13px] text-white/60">Net profit per sale</div>
            <div className={`text-3xl font-semibold ${res.netProfit >= 0 ? 'text-white' : 'text-red-300'}`}>{fmtSigned(res.netProfit)}</div>
          </div>
          <div className="text-right text-[15px]">
            <div><span className="text-white/60">Margin</span> <b>{pct(res.margin)}</b></div>
            <div><span className="text-white/60">Break-even</span> <b>{fmt(res.breakEven)}</b></div>
          </div>
        </div>
        {changed && (
          <div className="px-5 py-2 bg-warn/10 text-[13px] text-warn font-medium">
            Your changes move this from {fmtSigned(ev.netProfit)} to {fmtSigned(res.netProfit)}.
          </div>
        )}
        <dl className="px-5 py-3">
          <Line label="Sell price (inc. VAT)" value={fmt(res.sellPrice)} />
          <Line label="VAT" value={`−${fmt(res.vatAmount)}`} neg />
          <Line label="Revenue after VAT" value={fmt(res.exVatRevenue)} strong rule />
          <div className="pt-3 pb-1 text-[13px] font-semibold text-ink/55">Costs</div>
          <Line label="Product" detail={`${q} × ${fmt(offer?.unit_cost || 0)} from ${index.nameOf(offer?.supplier_id)}`} value={`−${fmt(res.costPrice)}`} neg />
          <Line label="Amazon fee" detail={`${res.referralRate.toFixed(2)}% — ${cat ? `${cat.name}${feeVerified ? ', verified' : ''}` : 'assumed, category not confirmed'}`} value={`−${fmt(res.referralFee)}`} neg />
          <Line label="Shipping" detail={carrier ? `${carrier.name} ${band?.name || ''}, ${SERVICE_LABELS[service]}, ${weightKg.toFixed(2)}kg` : 'no carrier can take this'} value={`−${fmt(res.shippingCost)}`} neg />
          <Line label="Packaging" detail={packKey === 'OWN' ? 'ships in its own packaging' : packItem?.name || 'none'} value={`−${fmt(res.packCost)}`} neg />
          <Line label="Total costs" value={`−${fmt(res.totalCosts)}`} strong rule />
        </dl>
      </div>

      {/* Adjust */}
      <Section title="Product and supplier" note={m.tier === 'barcode' ? 'Same barcode as the listing' : m.tier === 'confirmed' ? 'You confirmed this match' : `Matched on name — check it's the same product, size and count`}>
        <div className="text-sm text-ink mb-3">
          "{offer?.name}"
          <div className="text-[13px] text-ink/50 mt-0.5">
            SKU {offer?.supplier_sku}{offer?.barcode ? ` · barcode ${offer.barcode}` : ''}
            {offer?.data?.caseSize ? ` · case of ${offer.data.caseSize}` : ''}
            {offer?.data?.stock !== undefined && offer?.data?.stock !== null ? ` · ${Number(offer.data.stock).toLocaleString()} in stock` : ''}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px] gap-3">
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={offerIdx} onChange={e => setOfferIdx(+e.target.value)}>
              {offers.map((o, i) => (
                <option key={i} value={i}>{index.nameOf(o.supplier_id)} — {fmt(o.unit_cost)} each{i === 0 ? ' (cheapest)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Units in listing</label>
            <input type="number" min="1" className="input" value={qty} onChange={e => setQty(e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title="Price and fee" note="The Helium price is what the listing sells for today">
        <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)] gap-3">
          <div>
            <label className="label">Sell price £</label>
            <input type="number" step="0.01" className="input" value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Amazon fee category</label>
            <select className="input" value={feeCat} onChange={e => { setFeeCat(e.target.value); setFeeVerified(false) }}>
              <option value="">Not confirmed — use {refFee}%</option>
              {FEE_CATEGORIES.map(f => <option key={f.name} value={f.name}>{f.name} — {describeCategory(f)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <FeeVerifier asin={l.asin} price={parseFloat(price) || 0} preferred={ev?.guessedCategory}
            hint={`${l.title} ${d.category || ''} ${d.subcategory || ''}`} current={feeCat}
            verified={feeVerified}
            onVerify={(name) => { if (name) { setFeeCat(name); setFeeVerified(true) } else setFeeVerified(false) }} />
        </div>
        {!feeVerified && (
          <div className="text-[12px] text-ink/45 mt-2">
            Helium lists this under "{d.category || 'unknown'}", but Helium's categories don't reliably match Amazon's fee categories.
          </div>
        )}
      </Section>

      <Section title="Shipping" note={d.weightKg ? `Weight from Helium, converted from ${(d.weightKg / 0.45359237).toFixed(2)}lb` : 'Helium had no weight for this — enter one'}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Weight (kg)</label>
            <input type="number" step="0.001" className="input" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>
          <div>
            <label className="label">Service</label>
            <select className="input" value={service} onChange={e => setService(e.target.value)}>
              {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Carrier</label>
            <select className="input" value={effectiveCarrier} onChange={e => setCarrierKey(e.target.value)}>
              {options.length === 0 && <option value="">None can take this</option>}
              {options.map(o => <option key={`${o.carrierId}|${o.catId}`} value={`${o.carrierId}|${o.catId}`}>{o.carrierName} {o.catName} — {fmt(o.rate)}</option>)}
            </select>
          </div>
        </div>
        {dims && <div className="text-[13px] text-ink/50 mt-2">Dimensions from Helium: {dims}</div>}
      </Section>

      <Section title="Packaging" note={ev?.pack?.reason ? `Suggested: ${ev.pack.reason}` : null}>
        <select className="input" value={packKey} onChange={e => setPackKey(e.target.value)}>
          <option value="">None</option>
          <option value="OWN">Ships in its own packaging</option>
          {settings.packaging.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(p.cost)}</option>)}
        </select>
        {ev?.pack?.confidence === 'estimate' && (
          <div className="text-[13px] text-warn mt-2">This was a guess from weight alone — worth checking.</div>
        )}
      </Section>

      <Section title="The market" note="Helium's estimates for the whole listing, not what you'd sell">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Fact label="Sales / month" value={(d.sales || 0).toLocaleString()} />
          <Fact label="Sellers" value={d.sellers ?? '—'} />
          <Fact label="Amazon selling" value={d.amazonSelling ? 'Yes' : 'No'} tone={d.amazonSelling ? 'text-loss' : ''} />
          <Fact label="Best sellers rank" value={d.bsr ? d.bsr.toLocaleString() : '—'} />
          <Fact label="Rating" value={d.rating ? `${d.rating} (${(d.reviews || 0).toLocaleString()})` : '—'} />
          <Fact label="Your share at 10%" value={d.sales ? `${Math.round(d.sales * 0.1).toLocaleString()} × ${fmt(res.netProfit)}` : '—'} />
        </div>
      </Section>
    </Drawer>
  )
}

function Section({ title, note, children }) {
  return (
    <div className="card mb-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div className="font-semibold text-ink">{title}</div>
        {note && <div className="text-[12px] text-ink/45">{note}</div>}
      </div>
      {children}
    </div>
  )
}

function Line({ label, detail, value, neg, strong, rule }) {
  return (
    <div className={`flex justify-between items-baseline gap-3 py-1.5 ${rule ? 'border-t border-rule mt-1 pt-2' : ''}`}>
      <dt className={`${strong ? 'font-medium text-ink' : 'text-ink/75'} min-w-0`}>
        {label}{detail && <span className="block text-[12px] text-ink/45 truncate">{detail}</span>}
      </dt>
      <dd className={`flex-shrink-0 ${strong ? 'font-semibold' : 'font-medium'} ${neg ? 'text-loss' : 'text-ink'}`}>{value}</dd>
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
