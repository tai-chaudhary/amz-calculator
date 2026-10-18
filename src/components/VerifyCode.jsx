import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Icon } from './UI'
import { loadLinkCandidates, linkCode } from '../lib/db'
import { suggestProducts, packOf } from '../lib/inventory'
import { autoMapping, normRef } from '../lib/dispatch'
import { canDo } from '../lib/access'

// The products, loaded once a session (SKU, name, shelves, stock)
let candidatesCache = null
export function useCandidates() {
  const [list, setList] = useState(candidatesCache)
  useEffect(() => {
    if (candidatesCache) return
    loadLinkCandidates().then(r => { candidatesCache = r || []; setList(candidatesCache) }).catch(() => setList([]))
  }, [])
  return list
}
export const forgetCandidates = () => { candidatesCache = null }

/**
 * What a packing-slip code is in our inventory, said once by someone trusted
 * to: which of our products (by SKU), how many of each one of this code is,
 * and whether it's the same product or one we send instead (and what the
 * listing should have been). Every order with this code takes that stock and
 * gets that stamp from then on.
 *   code, slipName: as on the packing slip
 *   suggest: what HELM's product list says it is, if anything
 *   initial: { items: [{ code, qty }], kind, wanted } to start from
 */
export default function VerifyCode({ code, slipName = '', suggest = [], initial = null, me, showToast, onClose, onSaved }) {
  const products = useCandidates()
  const allowed = canDo(me, 'link-codes')
  const bySku = useMemo(() => new Map((products || []).map(p => [normRef(p.code), p])), [products])
  const [items, setItems] = useState(() => (initial?.items || []).map(i => ({ code: i.code, qty: Number(i.qty) || 1 })))
  const [kind, setKind] = useState(initial?.kind || 'same')
  const [wanted, setWanted] = useState(initial?.wanted || slipName || '')
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  const ideas = useMemo(() => (products ? suggestProducts(code, slipName, products, 5) : []), [products, code, slipName])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = products && words.length
    ? products.filter(p => words.every(w => `${p.name} ${p.code}`.toLowerCase().includes(w))).slice(0, 8)
    : ideas.map(x => x.product)
  const helmIdea = (suggest || []).filter(s => s.product_id)

  const add = (p, qty = packOf(code, slipName)) => {
    setItems(x => [...x.filter(i => normRef(i.code) !== normRef(p.code)), { code: p.code, qty }])
    setQ(''); setChecked(false)
  }
  const setQty = (k, n) => { setItems(x => x.map((i, j) => (j === k ? { ...i, qty: Math.max(1, Math.min(99, n)) } : i))); setChecked(false) }

  // What it will mean, as the stamp will say it
  const preview = useMemo(() => {
    if (!items.length) return null
    const info = new Map([[normRef(code), { status: 'verified', kind, wanted_name: wanted,
      items: items.map(i => { const p = bySku.get(normRef(i.code)); return { code: i.code, name: p?.name || i.code, stamp: p?.stamp_name || p?.name || i.code, qty: i.qty } }) }]])
    const one = autoMapping([{ code, qty: 1 }], 1, info).mapping
    const three = autoMapping([{ code, qty: 3 }], 1, info).mapping
    return { one: one?.label_name, three: three?.label_name }
  }, [items, kind, wanted, code, bySku])

  const ready = allowed && items.length > 0 && checked && (kind === 'same' || wanted.trim()) && items.every(i => bySku.has(normRef(i.code)))
  const save = async () => {
    setBusy(true)
    try {
      const res = await linkCode(code, slipName, items.map(i => ({ code: bySku.get(normRef(i.code)).code, qty: i.qty })), kind, kind === 'substitute' ? wanted.trim() : null, me?.name || me?.email)
      showToast?.(`${code} verified${res?.taken ? ` — ${res.taken} that had already gone out came off the shelves` : ''}`)
      onSaved?.()
    } catch (e) { showToast?.(e?.message || 'Couldn\'t save', 'error'); setBusy(false) }
  }

  return (
    <Modal title="What is this code?" maxWidth="max-w-xl" onClose={onClose}
      description="Every order with this code will take this stock and get this stamp from now on — check it against the product itself.">
      <div className="space-y-4">
        <div className="rounded-[6px] bg-paper border border-rule px-3 py-2.5">
          <div className="text-[11px] text-ink/45">On the packing slip</div>
          <div className="font-mono text-sm text-ink break-all">{code}</div>
          {slipName && <div className="text-sm text-ink/70 mt-0.5">{slipName}</div>}
        </div>

        {!allowed && (
          <div className="panel-notice text-sm">Only people trusted to <b>link item codes</b> can say what this is — ask the office. Until then its orders wait in On hold.</div>
        )}

        {allowed && helmIdea.length > 0 && !items.length && (
          <div className="rounded-[6px] border border-royal-200 bg-royal-50/60 px-3 py-2.5 text-sm">
            <div className="text-xs text-royal-700 font-semibold mb-1">HELM's product list says</div>
            <div className="text-ink">{helmIdea.map(s => `${s.qty} × ${s.name}`).join(' + ')}</div>
            <button className="btn btn-secondary btn-xs mt-2" onClick={() => { setItems(helmIdea.map(s => ({ code: s.code, qty: Number(s.qty) || 1 }))); setChecked(false) }}>Start from this</button>
          </div>
        )}

        {allowed && (
          <>
            {items.length > 0 && (
              <div>
                <div className="label">One of this code is</div>
                <div className="space-y-2">
                  {items.map((i, k) => {
                    const p = bySku.get(normRef(i.code))
                    return (
                      <div key={i.code} className="flex items-center gap-2 rounded-[6px] border border-rule bg-white px-2.5 py-2">
                        <div className="flex items-center shrink-0">
                          <button className="icon-btn" aria-label="One fewer" onClick={() => setQty(k, i.qty - 1)}>−</button>
                          <span className="w-8 text-center text-lg font-semibold tabular-nums">{i.qty}</span>
                          <button className="icon-btn" aria-label="One more" onClick={() => setQty(k, i.qty + 1)}><Icon name="plus" size={14} /></button>
                        </div>
                        <span className="text-ink/40">×</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink leading-snug">{p?.name || i.code}</div>
                          <div className="text-[11px] text-ink/45 font-mono truncate">{i.code}{p?.locations ? ` · ${p.locations}` : ''}</div>
                        </div>
                        <button className="icon-btn shrink-0" aria-label="Remove" onClick={() => { setItems(x => x.filter((_, j) => j !== k)); setChecked(false) }}><Icon name="close" size={14} /></button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="label">{items.length ? 'Add another product (a mixed set)' : 'Which of our products is it?'}</div>
              <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or SKU" autoComplete="off" />
              {!products ? <div className="text-xs text-ink/45 mt-2">Loading products…</div> : found.length > 0 && (
                <div className="mt-1.5 border border-rule rounded-[6px] divide-y divide-rule/70 bg-white max-h-[240px] overflow-y-auto overscroll-contain">
                  {!words.length && <div className="px-3 py-1.5 text-[11px] text-ink/45 bg-paper">Closest matches</div>}
                  {found.map(p => (
                    <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-sky/25" onClick={() => add(p)}>
                      <div className="text-sm text-ink leading-snug">{p.name}</div>
                      <div className="text-[11px] text-ink/45"><span className="font-mono">{p.code}</span> · {Number(p.on_hand) || 0} in stock{p.locations ? ` · ${p.locations}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div>
                <div className="label">Is it the product the listing is for?</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button className={`text-left p-3 rounded-[6px] border ${kind === 'same' ? 'border-royal-400 bg-royal-50' : 'border-rule bg-white'}`} onClick={() => { setKind('same'); setChecked(false) }}>
                    <div className="text-sm font-semibold text-ink">Yes, the same product</div>
                    <div className="text-xs text-ink/55 mt-0.5">The listing's code is just different</div>
                  </button>
                  <button className={`text-left p-3 rounded-[6px] border ${kind === 'substitute' ? 'border-warn bg-warn/5' : 'border-rule bg-white'}`} onClick={() => { setKind('substitute'); setChecked(false) }}>
                    <div className="text-sm font-semibold text-ink">No, we send this instead</div>
                    <div className="text-xs text-ink/55 mt-0.5">Flagged so the office can sort the listing</div>
                  </button>
                </div>
                {kind === 'substitute' && (
                  <div className="mt-2">
                    <label className="label" htmlFor="vc-wanted">What the listing should be</label>
                    <input id="vc-wanted" className="input" value={wanted} onChange={e => setWanted(e.target.value)} placeholder="The product the customer ordered" />
                  </div>
                )}
              </div>
            )}

            {preview?.one && (
              <div className="rounded-[6px] border border-rule bg-white px-3 py-2.5 text-sm space-y-1">
                <div className="text-xs font-semibold text-ink/55">From now on</div>
                <div className="text-ink">1 ordered → stamp <b className="font-mono text-[13px]">{preview.one}</b></div>
                <div className="text-ink/70">3 ordered → stamp <b className="font-mono text-[13px]">{preview.three}</b></div>
                {kind === 'substitute' && wanted.trim() && <div className="text-warn text-xs">Flagged: sent instead of {wanted.trim()}</div>}
              </div>
            )}

            {items.length > 0 && (
              <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="w-4 h-4 mt-0.5 accent-royal-500" checked={checked} onChange={e => setChecked(e.target.checked)} />
                I've checked this against the product itself — the right product and the right number
              </label>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1" onClick={onClose}>{allowed ? 'Cancel' : 'Close'}</button>
          {allowed && <button className="btn btn-primary flex-1" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Verify'}</button>}
        </div>
      </div>
    </Modal>
  )
}

/** Codes waiting to be verified, each with a button (or who to ask). */
export function CodesToVerify({ codes, me, showToast, onVerified, prefill = {} }) {
  const [open, setOpen] = useState(null)
  const allowed = canDo(me, 'link-codes')
  if (!codes.length) return null
  return (
    <>
      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {codes.map(c => (
          <div key={c.code} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink leading-snug">{c.name || c.code}</div>
              <div className="text-[11px] text-ink/45 font-mono truncate">{c.code}{c.orders ? ` · ${c.orders} order${c.orders === 1 ? '' : 's'}` : ''}</div>
              {c.status === 'unverified' && c.suggest?.length > 0 && <div className="text-[11px] text-ink/50">HELM: {c.suggest.map(s => `${s.qty} × ${s.name}`).join(' + ')}</div>}
              {c.status === 'broken' && <div className="text-[11px] text-loss">Was verified, but its product has gone — check it again</div>}
            </div>
            {allowed
              ? <button className="btn btn-primary btn-xs shrink-0" onClick={() => setOpen(c)}>Verify</button>
              : <span className="text-[11px] text-ink/45 shrink-0 text-right">Waiting for the office</span>}
          </div>
        ))}
      </div>
      {open && (
        <VerifyCode code={open.code} slipName={open.name} suggest={open.suggest} initial={prefill[normRef(open.code)] || null} me={me} showToast={showToast}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onVerified?.() }} />
      )}
    </>
  )
}
