import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { InfoBox, Modal, Spinner, StatusBadge } from './UI'
import { loadChannelFees, setChannelFee, removeChannelFee } from '../lib/db'
import { setChannelFees, groupChannelFees, ruleStates, channelFeeFor, describeChannelFee, feeName } from '../lib/channelFees'
import { CHANNELS, channelOf } from '../lib/listing'
import { londonToday, fmtDate } from '../lib/dates'

/**
 * Cost Settings → Channel fees (v2.103.0): what eBay, TikTok and the websites charge, dated like every other cost.
 * Amazon is not here: its fee is a category on each listing. Each channel has one rule (a percentage and a fixed
 * amount an order) and, where a listing's percentage differs, one for that listing. A change applies from a date and
 * earlier days keep what they had. Orders not yet in the channel's own report are estimated from these.
 */
const others = CHANNELS.filter(c => c.id !== 'Amazon')
const labelOf = (id) => feeName({ channel: id }).replace(/ fee$/, '')
const pctText = (n) => `${Number(Number(n).toFixed(2))}%`

export default function ChannelFeesSettings({ me, listings = [] }) {
  const isAdmin = me?.role === 'admin'
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)       // { channel, listing?: { id, name, sku }, current? }
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState({})         // listing id → its history shown

  const load = useCallback(async () => {
    try { const d = await loadChannelFees(); setChannelFees(d.rules); setData(d); setError(null) }
    catch (e) { setError(e?.message || 'Could not load the channel fees') }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupChannelFees(data?.rules), [data])
  const today = data?.today || londonToday()
  const unset = others.filter(c => !groups.some(g => g.channel === c.id))

  const save = async (v) => {
    setBusy(true); setError(null)
    try { await setChannelFee(v); setForm(null); await load() }
    catch (e) { setError(e?.message || 'Could not save') } finally { setBusy(false) }
  }
  const remove = async (row) => {
    if (!window.confirm(`Remove ${pctText(row.pct)} from ${fmtDate(row.from_date)}?\n\nOnly do this if it was entered by mistake. Orders not yet in a report are estimated again without it.`)) return
    setBusy(true); setError(null)
    try { await removeChannelFee(row.id); await load() }
    catch (e) { setError(e?.message || 'Could not remove it') } finally { setBusy(false) }
  }

  if (!data && !error) return <Spinner />
  return (
    <div data-channel-fees>
      <InfoBox title="How these are used">
        A channel’s own report always decides what an order really paid. These rules are for the days before that
        report arrives, and for the Calculator. Amazon is not here: its fee is the fee category on each listing.
      </InfoBox>
      {error && <div className="mt-3 p-3 rounded-card border border-loss/30 bg-loss/5 text-sm text-loss" role="alert">{error}</div>}

      {groups.map(g => {
        const states = ruleStates(g.base, today)
        const cur = channelFeeFor({ channel: g.channel }, { rules: data.rules, day: today })
        const mine = listings.filter(r => channelOf(r.data) === g.channel && !r.data?.archived)
        const without = mine.filter(r => !g.listings.some(l => l.listing_id === r.id))
        return (
          <div key={g.channel} className="card mt-4" data-fee-channel={g.channel}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-base font-semibold text-ink">{labelOf(g.channel)}</div>
                <div className="text-sm text-ink/70 mt-0.5" data-fee-now>{cur ? `Now: ${describeChannelFee(cur)}` : 'No fee in force yet'}</div>
              </div>
              {isAdmin && <button className="btn btn-secondary btn-sm" data-fee-change onClick={() => setForm({ channel: g.channel, current: g.base[0] })}>Change</button>}
            </div>

            <div className="divide-y divide-rule/70 mt-3">
              {g.base.map(r => (
                <div key={r.id} className="py-2.5 flex items-start gap-3 flex-wrap" data-fee-row>
                  <div className="min-w-[128px]">
                    <div className="text-sm font-semibold text-ink tabular-nums">From {fmtDate(r.from_date)}</div>
                    <div className="text-[11px] text-ink/45">{r.by ? `Set by ${r.by}` : 'Set'} on {fmtDate(r.at)}</div>
                  </div>
                  <div className="flex-1 min-w-[220px] text-sm text-ink/75">
                    <span className="font-medium text-ink">{describeChannelFee(channelFeeFor({ channel: g.channel }, { rules: [r], day: r.from_date }))}</span>
                    {r.note ? <div className="text-xs text-ink/50 mt-0.5">{r.note}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {states.get(r.id) === 'current' && <StatusBadge tone="live">Current</StatusBadge>}
                    {states.get(r.id) === 'to come' && <StatusBadge tone="info">To come</StatusBadge>}
                    {isAdmin && g.base.length > 1 && <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => remove(r)}>Remove</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-rule">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-ink">Listings with their own percentage</div>
                  <div className="text-xs text-ink/55 mt-0.5">{g.listings.length
                    ? `${g.listings.length} of ${mine.length || g.listings.length} listings. The rest use the channel’s ${cur ? pctText(channelFeeFor({ channel: g.channel }, { rules: g.base, day: today })?.pct ?? cur.pct) : 'percentage'}.`
                    : 'None. Every listing uses the channel’s percentage.'}</div>
                </div>
                {isAdmin && without.length > 0 && (
                  <select className="input w-auto max-w-full text-sm" value="" aria-label="Give a listing its own percentage"
                    onChange={e => { const r = without.find(x => x.id === e.target.value); if (r) setForm({ channel: g.channel, listing: { id: r.id, name: r.name, sku: r.data?.listingSku || '' } }) }}>
                    <option value="">Give a listing its own percentage…</option>
                    {without.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
              </div>
              {g.listings.length > 0 && (
                <div className="divide-y divide-rule/70 mt-2">
                  {g.listings.map(l => {
                    const st = ruleStates(l.rows, today)
                    const now = l.rows.find(r => st.get(r.id) === 'current')
                    return (
                      <div key={l.listing_id} className="py-2" data-fee-listing>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-ink break-words">{l.name || 'Listing removed'}</div>
                            <div className="text-[11px] text-ink/45 break-all">{l.sku}{now ? ` · from ${fmtDate(now.from_date)}` : ''}</div>
                          </div>
                          <div className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">{now ? pctText(now.pct) : '—'}</div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button className="btn btn-secondary btn-xs" onClick={() => setOpen(o => ({ ...o, [l.listing_id]: !o[l.listing_id] }))}>{open[l.listing_id] ? 'Hide' : 'Dates'}</button>
                            {isAdmin && <button className="btn btn-secondary btn-xs" onClick={() => setForm({ channel: g.channel, listing: { id: l.listing_id, name: l.name, sku: l.sku }, current: l.rows[0] })}>Change</button>}
                          </div>
                        </div>
                        {open[l.listing_id] && (
                          <div className="mt-1.5 pl-3 border-l-2 border-rule space-y-1.5">
                            {l.rows.map(r => (
                              <div key={r.id} className="flex items-start gap-2 flex-wrap text-xs text-ink/70">
                                <span className="font-semibold text-ink tabular-nums">{pctText(r.pct)}</span>
                                <span>from {fmtDate(r.from_date)}</span>
                                {st.get(r.id) === 'current' && <StatusBadge tone="live">Current</StatusBadge>}
                                {st.get(r.id) === 'to come' && <StatusBadge tone="info">To come</StatusBadge>}
                                {r.note ? <span className="text-ink/50 basis-full sm:basis-auto">{r.note}</span> : null}
                                {isAdmin && <button className="underline text-ink/55 hover:text-loss ml-auto" disabled={busy} onClick={() => remove(r)}>Remove</button>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {isAdmin && unset.length > 0 && (
        <div className="card mt-4">
          <div className="text-sm font-semibold text-ink">Channels with no fee set</div>
          <div className="text-xs text-ink/55 mt-0.5 mb-3">Their orders carry no fee until one is set here.</div>
          <div className="flex gap-2 flex-wrap">
            {unset.map(c => <button key={c.id} className="btn btn-secondary btn-sm" style={{ textTransform: 'none' }} onClick={() => setForm({ channel: c.id })}>Set {labelOf(c.id)}’s fee</button>)}
          </div>
        </div>
      )}

      {form && <FeeForm form={form} today={today} busy={busy} onCancel={() => setForm(null)} onSave={save} />}
    </div>
  )
}

function FeeForm({ form, today, busy, onCancel, onSave }) {
  const cur = form.current
  const [pct, setPct] = useState(cur ? String(cur.pct) : '')
  const [perOrder, setPerOrder] = useState(cur?.per_order != null ? String(cur.per_order) : '')
  const [small, setSmall] = useState(cur?.per_order_small != null ? String(cur.per_order_small) : '')
  const [smallMax, setSmallMax] = useState(cur?.small_order_max != null ? String(cur.small_order_max) : '')
  const [from, setFrom] = useState(today)
  const [note, setNote] = useState('')
  const who = labelOf(form.channel)
  const p = parseFloat(pct)
  const okPct = Number.isFinite(p) && p >= 0 && p <= 100
  const stepHalf = (small.trim() === '') !== (smallMax.trim() === '')
  const past = from < today
  return (
    <Modal title={<span style={{ textTransform: 'none' }}>{form.listing ? `${who}: this listing’s percentage` : `${who}’s fee`}</span>} onClose={onCancel}
      description={form.listing ? form.listing.name : 'The percentage every listing uses unless it has its own, and the fixed amount an order.'}>
      <div className="grid grid-cols-2 gap-3">
        <div className={form.listing ? 'col-span-2' : ''}>
          <label className="label" htmlFor="cf-pct">Percentage</label>
          <input id="cf-pct" className="input text-base sm:text-sm" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} placeholder="e.g. 12.25" />
        </div>
        {!form.listing && (
          <div>
            <label className="label" htmlFor="cf-order">Fixed, an order (£)</label>
            <input id="cf-order" className="input text-base sm:text-sm" type="number" step="0.01" min="0" inputMode="decimal" value={perOrder} onChange={e => setPerOrder(e.target.value)} placeholder="e.g. 0.40" />
          </div>
        )}
      </div>
      <div className="text-xs text-ink/50 mt-1">Of what the customer paid, with the fee before VAT.</div>
      {!form.listing && (
        <>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="label" htmlFor="cf-small">On a small order (£)</label>
              <input id="cf-small" className="input text-base sm:text-sm" type="number" step="0.01" min="0" inputMode="decimal" value={small} onChange={e => setSmall(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label className="label" htmlFor="cf-max">Small means up to (£)</label>
              <input id="cf-max" className="input text-base sm:text-sm" type="number" step="0.01" min="0" inputMode="decimal" value={smallMax} onChange={e => setSmallMax(e.target.value)} placeholder="optional" />
            </div>
          </div>
          {stepHalf && <div className="text-xs text-warn mt-1">Fill in both, or leave both empty.</div>}
        </>
      )}
      <label className="label mt-3" htmlFor="cf-from">Applies from</label>
      <input id="cf-from" type="date" className="input text-base sm:text-sm" value={from} onChange={e => setFrom(e.target.value || today)} />
      <div className={`text-xs mt-1 ${past ? 'text-warn' : 'text-ink/50'}`}>
        {past ? `Orders from ${fmtDate(from)} that are not yet in ${who}’s report are estimated again at this.` : 'Earlier days keep the fee they had.'}
      </div>
      <label className="label mt-3" htmlFor="cf-note">Note (optional)</label>
      <input id="cf-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. eBay fee change letter" />
      <div className="flex gap-2 pt-4">
        <button className="btn btn-secondary flex-1 justify-center" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1 justify-center" data-fee-save disabled={busy || !okPct || stepHalf}
          onClick={() => onSave({ channel: form.channel, listingId: form.listing?.id || null, from, pct: p,
            perOrder: perOrder.trim() === '' ? null : parseFloat(perOrder), perOrderSmall: small.trim() === '' ? null : parseFloat(small),
            smallMax: smallMax.trim() === '' ? null : parseFloat(smallMax), note: note.trim() })}>
          {busy ? 'Saving…' : `Save, from ${fmtDate(from)}`}
        </button>
      </div>
    </Modal>
  )
}
