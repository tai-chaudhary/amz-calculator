import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Icon, Modal, Drawer, Spinner } from './UI'
import { loadPickList, loadProductPicker, setSubstitute } from '../lib/db'
import { byLocation, parseLocation } from '../lib/inventory'

const fmt = (n) => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 1 })
const plural = (n, word) => `${fmt(n)} ${word}${Number(n) !== 1 ? 's' : ''}`
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
}
const keyOf = (ids) => [...ids].sort().join(',').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36)
// Who picked last on this phone, offered first next time
let lastWho = ''

/**
 * What to pick for a line: the units still needed once substitutes are
 * taken off, then shelf by shelf — pick shelves first, then overflow, the
 * same order stock comes off when the parcel is dispatched.
 */
export function planLine(item) {
  const subs = item.substitutes || []
  const subbed = subs.reduce((s, x) => s + (Number(x.ordered_units) || 0), 0)
  const need = Math.max(0, (Number(item.units) || 0) - subbed)
  let left = need
  const stops = []
  for (const l of item.locations || []) {
    if (left <= 0) break
    const take = Math.min(left, Number(l.qty) || 0)
    if (take > 0) { stops.push({ code: l.code, qty: take, pickable: l.pickable }); left -= take }
  }
  return { need, stops, short: item.product_id ? Math.max(0, left) : 0, subs, onHand: Number(item.on_hand) || 0 }
}

// ── Pick list ───────────────────────────────────────────────────────────────

/**
 * Walk the warehouse once: every product for these batches, in shelf order,
 * with how many to take from where. Tap a line when it's in the tote. Ticks
 * stay on this phone, so it can be put down and picked up again.
 */
export function PickList({ title, subtitle, batchIds, people = [], me, showToast, onClose }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const storeKey = `pick:${keyOf(batchIds)}`
  const [done, setDone] = useState(() => new Set(store.get(storeKey, [])))
  const [hideDone, setHideDone] = useState(false)
  const [subFor, setSubFor] = useState(null)

  const load = useCallback(() => loadPickList(batchIds).then(setItems).catch(e => setError(e?.message || 'Couldn’t load the pick list')),
    [batchIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const toggle = (k) => setDone(s => {
    const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); store.set(storeKey, [...n]); return n
  })

  const { lines, unlinked, totals } = useMemo(() => {
    const all = (items || []).map(it => ({ ...it, key: it.product_id || `code:${it.code}`, plan: planLine(it) }))
    const lines = all.filter(it => it.product_id && (it.plan.need > 0 || it.plan.subs.length))
      .sort((a, b) => {
        const x = a.plan.stops[0]?.code, y = b.plan.stops[0]?.code
        if (!x || !y) return (x ? -1 : 1) - (y ? -1 : 1) || a.name.localeCompare(b.name)
        return byLocation(x, y) || a.name.localeCompare(b.name)
      })
    const unlinked = all.filter(it => !it.product_id)
    const units = lines.reduce((s, l) => s + l.plan.need, 0)
    return { lines, unlinked, totals: { lines: lines.length, units, short: lines.filter(l => l.plan.short > 0).length } }
  }, [items])

  const doneCount = lines.filter(l => done.has(l.key)).length
  const pct = lines.length ? Math.round((doneCount / lines.length) * 100) : 0
  const shown = hideDone ? lines.filter(l => !done.has(l.key)) : lines
  // A heading each time the walk moves to a new aisle
  let lastAisle = null

  return (
    <Drawer title={title} description={subtitle} onClose={onClose} width="max-w-xl"
      footer={items && lines.length > 0 && (
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={() => setHideDone(v => !v)}>
            {hideDone ? 'Show picked' : 'Hide picked'}
          </button>
          {doneCount > 0 && (
            <button className="btn btn-ghost justify-center py-3 sm:py-2" onClick={() => { setDone(new Set()); store.set(storeKey, []) }}>Start again</button>
          )}
        </div>
      )}>
      {error && <div className="panel-alert text-sm text-loss mb-3">{error}</div>}
      {!items && !error ? <Spinner /> : items && (
        <>
          <div className="sticky -top-5 z-[1] -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 mb-3 bg-paper/95 backdrop-blur-sm border-b border-rule">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm text-ink"><b className="tabular-nums">{doneCount}</b> of {plural(totals.lines, 'line')} picked</div>
              <div className="text-xs text-ink/55 tabular-nums">{plural(totals.units, 'unit')}{totals.short ? <span className="text-loss font-medium"> · {totals.short} short</span> : null}</div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ink/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full transition-all ${pct === 100 ? 'bg-gain' : 'bg-royal-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {lines.length === 0 && !unlinked.length && (
            <div className="text-center text-sm text-ink/50 py-12">Nothing left to pick — every label here has gone.</div>
          )}
          {pct === 100 && lines.length > 0 && (
            <div className="surface-sky px-4 py-3 mb-3 text-sm text-royal-800 flex items-center gap-2"><Icon name="check" size={16} /> All picked.</div>
          )}

          <ul className="space-y-2">
            {shown.map(l => {
              const first = l.plan.stops[0]
              const aisle = parseLocation(first?.code)?.aisle || null
              const heading = aisle !== lastAisle ? (lastAisle = aisle, aisle) : undefined
              const isDone = done.has(l.key)
              return (
                <React.Fragment key={l.key}>
                  {heading !== undefined && (
                    <li className="pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">{heading ? `Aisle ${heading}` : 'No shelf recorded'}</li>
                  )}
                  <li>
                    <div role="button" tabIndex={0} aria-pressed={isDone}
                      onClick={() => toggle(l.key)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(l.key))}
                      className={`card p-0 flex items-stretch cursor-pointer select-none transition-opacity ${isDone ? 'opacity-50' : ''} ${l.plan.short ? 'border-l-2 border-l-coral' : ''}`}>
                      <div className="w-[92px] shrink-0 px-3 py-3 border-r border-rule bg-paper/60 flex flex-col justify-center">
                        <div className={`font-mono font-semibold text-[15px] leading-tight ${first ? 'text-royal-700' : 'text-ink/35'}`}>{first?.code || '—'}</div>
                        <div className="text-[10px] uppercase tracking-wide text-ink/40 mt-0.5">{first ? (first.pickable ? 'Pick shelf' : 'Overflow') : 'Not on a shelf'}</div>
                      </div>
                      <div className="flex-1 min-w-0 px-3 py-3">
                        <div className={`text-sm font-medium text-ink leading-snug ${isDone ? 'line-through' : ''}`}>{l.name}</div>
                        <div className="text-[11px] text-ink/40 tabular-nums truncate">{l.code} · {plural(l.orders, 'order')}</div>
                        {(l.instead || []).length > 0 && (
                          <div className="text-[11px] text-warn mt-0.5">Sent instead of {l.instead.join(', ')}</div>
                        )}
                        {l.plan.stops.slice(1).map(s => (
                          <div key={s.code} className="text-xs text-ink/65 mt-1">then <b className="tabular-nums">{fmt(s.qty)}</b> from <b className="font-mono">{s.code}</b>{s.pickable ? '' : ' (overflow)'}</div>
                        ))}
                        {l.plan.short > 0 && (
                          <div className="text-xs text-loss mt-1 font-medium">
                            <Icon name="alert" size={11} className="inline -mt-0.5 mr-1" />
                            {l.plan.onHand > 0 ? `Only ${fmt(l.plan.onHand)} on the shelves` : 'None on the shelves'} — {fmt(l.plan.short)} short
                          </div>
                        )}
                        {l.plan.subs.length > 0 && (
                          <div className="text-xs text-royal-700 mt-1">
                            {plural(l.plan.subs.length, 'order')} get{l.plan.subs.length === 1 ? 's' : ''} <b>{[...new Set(l.plan.subs.map(s => s.sub_name))].join(', ')}</b> instead
                            ({fmt(l.plan.subs.reduce((t, s) => t + Number(s.units), 0))} units) — pick that for them
                          </div>
                        )}
                        <button className="mt-1.5 text-xs font-medium text-royal-600 hover:underline py-1"
                          onClick={(e) => { e.stopPropagation(); setSubFor(l) }}>
                          {l.plan.short > 0 ? 'Sending something else?' : 'Substitute…'}
                        </button>
                      </div>
                      <div className="shrink-0 px-3 py-3 flex flex-col items-end justify-between">
                        <div className="text-2xl font-semibold tabular-nums leading-none text-ink">×{fmt(l.plan.need)}</div>
                        <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${isDone ? 'bg-gain border-gain text-white' : 'border-rule text-transparent'}`}>
                          <Icon name="check" size={15} />
                        </span>
                      </div>
                    </div>
                  </li>
                </React.Fragment>
              )
            })}
          </ul>

          {unlinked.length > 0 && (
            <div className="panel-notice mt-4">
              <div className="text-sm font-semibold text-ink">Not linked to our products ({unlinked.length})</div>
              <div className="text-xs text-ink/55 mb-2">These codes aren’t one of our SKUs and nobody has verified them, so there’s no shelf to show and no stock comes off. Ask someone who can link item codes to verify them (Inventory → Item codes).</div>
              {unlinked.map(u => (
                <div key={u.key} className="flex items-baseline justify-between gap-3 py-1.5 border-t border-rule/70 text-sm">
                  <span className="min-w-0"><span className="block text-ink leading-snug">{u.name}</span><span className="block text-[11px] text-ink/40 font-mono truncate">{u.code}</span></span>
                  <b className="tabular-nums shrink-0">×{fmt(u.units)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {subFor && (
        <SubstituteModal item={subFor} people={people} me={me} showToast={showToast}
          onClose={() => setSubFor(null)} onDone={() => { setSubFor(null); load() }} />
      )}
    </Drawer>
  )
}

// ── What was sent instead ───────────────────────────────────────────────────

let pickerCache = null
const loadPicker = () => (pickerCache ||= loadProductPicker().catch(e => { pickerCache = null; throw e }))

/**
 * "We sent X instead of Y". Saves against each order, so the substitute's
 * stock comes off when it's dispatched (or straight away if it already has)
 * and every substitute is logged.
 */
export function SubstituteModal({ item, people = [], me, showToast, onClose, onDone }) {
  const [products, setProducts] = useState(null)
  const [q, setQ] = useState('')
  const [sub, setSub] = useState(null)
  const [ratio, setRatio] = useState(1)
  const orders = item.order_list || []
  const [chosen, setChosen] = useState(() => new Set(orders.map(o => `${o.upload_id}|${o.order_key}`)))
  const names = [...new Set([...people, me?.name].filter(Boolean))]
  const [who, setWho] = useState(lastWho && names.includes(lastWho) ? lastWho : (names.length === 1 ? names[0] : ''))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadPicker().then(setProducts).catch(() => setProducts([])) }, [])
  const existing = (item.substitutes || []).filter(s => chosen.has(`${s.upload_id}|${s.order_key}`))
  useEffect(() => {
    // Changing an existing substitute starts from what was recorded
    const s = item.substitutes?.[0]
    if (s && products) {
      const p = products.find(x => x.id === s.sub_product_id)
      if (p) setSub(p)
      if (s.ordered_units > 0) setRatio(Math.round((s.units / s.ordered_units) * 100) / 100)
    }
  }, [products]) // eslint-disable-line react-hooks/exhaustive-deps

  // Before anything's typed, the likeliest swaps come first: products sharing the most words with the one ordered
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = (products || []).filter(p => p.id !== item.product_id
      && words.every(w => `${p.name} ${p.code}`.toLowerCase().includes(w)))
    if (words.length) return list.slice(0, 8)
    const mine = new Set(String(item.name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2))
    const score = (p) => String(p.name).toLowerCase().split(/[^a-z0-9]+/).filter(w => mine.has(w)).length
    return list.map(p => ({ p, n: score(p) })).filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n || (b.p.on_hand > 0) - (a.p.on_hand > 0)).slice(0, 8).map(x => x.p)
  }, [products, q, item.product_id, item.name])

  const picked = orders.filter(o => chosen.has(`${o.upload_id}|${o.order_key}`))
  const orderedUnits = picked.reduce((s, o) => s + (Number(o.units) || 0), 0)
  const save = async (take = false) => {
    setBusy(true)
    try {
      lastWho = who
      const list = picked.map(o => ({ upload_id: o.upload_id, order_key: o.order_key }))
      const n = await setSubstitute(list, item.product_id, take ? null : sub.id, take ? null : ratio, who, note.trim() || null)
      showToast?.(take ? `Substitute taken off ${plural(n, 'order')}` : `${sub.name} recorded for ${plural(n, 'order')}`)
      onDone?.()
    } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error'); setBusy(false) }
  }

  return (
    <Modal title="Sent something else" description={`Instead of ${item.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="sub-search">What went instead?{!q.trim() && !sub ? <span className="font-normal text-ink/40"> · closest matches first</span> : null}</label>
          {sub ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[5px] border border-royal-300 bg-royal-50">
              <span className="min-w-0"><span className="block text-sm font-medium text-ink leading-snug">{sub.name}</span>
                <span className="block text-[11px] text-ink/50">{sub.code} · {fmt(sub.on_hand)} on the shelves</span></span>
              <button className="text-xs font-medium text-royal-600 hover:underline shrink-0" onClick={() => setSub(null)}>Change</button>
            </div>
          ) : (
            <>
              <input id="sub-search" className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Product name or code"
                autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
              <div className="mt-1.5 max-h-60 overflow-y-auto overscroll-contain divide-y divide-rule/70 border border-rule rounded-[5px] bg-white">
                {!products ? <div className="px-3 py-3 text-sm text-ink/45">Loading products…</div>
                  : !matches.length ? <div className="px-3 py-3 text-sm text-ink/45">{q.trim() ? 'No product matches.' : 'Type a product name or code.'}</div>
                  : matches.map(p => (
                    <button key={p.id} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-sky/30" onClick={() => setSub(p)}>
                      <span className="min-w-0"><span className="block text-sm text-ink leading-snug">{p.name}</span><span className="block text-[11px] text-ink/45 truncate">{p.code}</span></span>
                      <span className={`text-xs tabular-nums shrink-0 ${p.on_hand > 0 ? 'text-ink/55' : 'text-loss'}`}>{fmt(p.on_hand)} in stock</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        <div>
          <div className="label">How many went, for each one ordered?</div>
          <div className="flex items-center gap-3">
            <button className="btn btn-secondary w-11 h-11 p-0 text-lg" aria-label="Fewer" onClick={() => setRatio(r => Math.max(0.5, Math.round((r - (r > 1 ? 1 : 0.5)) * 2) / 2))}>−</button>
            <span className="text-xl font-semibold tabular-nums w-10 text-center">{fmt(ratio)}</span>
            <button className="btn btn-secondary w-11 h-11 p-0 text-lg" aria-label="More" onClick={() => setRatio(r => Math.round((r + (r >= 1 ? 1 : 0.5)) * 2) / 2)}>+</button>
            <span className="text-xs text-ink/55">{orderedUnits ? `${fmt(orderedUnits * ratio)} of the substitute in total` : ''}</span>
          </div>
        </div>

        {orders.length > 1 && (
          <div>
            <div className="label">Which orders? ({picked.length} of {orders.length})</div>
            <div className="max-h-44 overflow-y-auto overscroll-contain border border-rule rounded-[5px] bg-white divide-y divide-rule/70">
              {orders.map(o => {
                const k = `${o.upload_id}|${o.order_key}`
                const has = (item.substitutes || []).find(s => `${s.upload_id}|${s.order_key}` === k)
                return (
                  <label key={k} className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer">
                    <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={chosen.has(k)}
                      onChange={() => setChosen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })} />
                    <span className="flex-1 min-w-0 truncate tabular-nums">{o.ref || o.order_key}</span>
                    <span className="text-xs text-ink/50 shrink-0">×{fmt(o.units)}{o.gone ? ' · gone' : ''}{has ? ` · ${has.sub_name}` : ''}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="sub-who">Who sent it?</label>
            <select id="sub-who" className="input" value={who} onChange={e => setWho(e.target.value)}>
              <option value="">Choose…</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sub-note">Note (optional)</label>
            <input id="sub-note" className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. customer agreed" />
          </div>
        </div>

        {picked.some(o => o.gone) && <div className="text-xs text-ink/55">Some of these have already gone — their stock is put right as soon as you save.</div>}

        <div className="flex gap-2 pt-1">
          {existing.length > 0 && (
            <button className="btn btn-danger justify-center py-3 sm:py-2" disabled={busy || !who} onClick={() => save(true)}>Take it off</button>
          )}
          <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={busy || !sub || !who || !picked.length} onClick={() => save(false)}>
            {busy ? 'Saving…' : `Save for ${plural(picked.length, 'order')}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Choosing which product was swapped ──────────────────────────────────────

/** From a batch: pick the product that was swapped, then say what went instead. Works before or after dispatch. */
export function SubstituteFlow({ batchIds, people, me, showToast, onClose, onDone }) {
  const [items, setItems] = useState(null)
  const [item, setItem] = useState(null)
  const load = useCallback(() => loadPickList(batchIds, { includeDispatched: true })
    .then(list => { const linked = list.filter(i => i.product_id); setItems(linked); if (linked.length === 1) setItem(linked[0]) })
    .catch(() => setItems([])), [batchIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  if (item) {
    return <SubstituteModal item={item} people={people} me={me} showToast={showToast}
      onClose={() => (items?.length > 1 ? setItem(null) : onClose())} onDone={() => { onDone?.(); onClose() }} />
  }
  return (
    <Modal title="Sent something else" description="Which product was swapped?" onClose={onClose}>
      {!items ? <Spinner /> : !items.length ? <div className="text-sm text-ink/55">No products from inventory on these labels.</div> : (
        <div className="divide-y divide-rule/70 border border-rule rounded-[5px] bg-white">
          {items.map(i => (
            <button key={i.product_id} className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left hover:bg-sky/30" onClick={() => setItem(i)}>
              <span className="min-w-0"><span className="block text-sm text-ink leading-snug">{i.name}</span>
                <span className="block text-[11px] text-ink/45">{plural(i.orders, 'order')} · ×{fmt(i.units)}{i.substitutes?.length ? ` · ${i.substitutes.length} substituted` : ''}</span></span>
              <Icon name="arrowRight" size={14} className="text-ink/30 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Short at Ready / Dispatch ───────────────────────────────────────────────

/**
 * Before labels are marked ready or dispatched: anything with more going
 * out than there is on the shelves has to be answered — sent as ordered (the
 * count was off) or something else went instead. Nothing short slips through
 * unrecorded. Reports whether everything's answered through onReady.
 */
export function ShortCheck({ batchIds, people, me, showToast, onReady }) {
  const [items, setItems] = useState(null)
  const [asIs, setAsIs] = useState(() => new Set(store.get('short-as-ordered', [])))
  const [subFor, setSubFor] = useState(null)
  const [other, setOther] = useState(false)
  const load = useCallback(() => loadPickList(batchIds).then(setItems).catch(() => setItems([])),
    [batchIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  // "Sent as ordered" is remembered for that product and those orders, so Dispatch doesn't ask again after Ready
  const answerKey = (it) => `${it.product_id}:${keyOf((it.order_list || []).map(o => `${o.upload_id}|${o.order_key}`))}`
  const short = (items || []).map(it => ({ ...it, plan: planLine(it) })).filter(it => it.plan.short > 0)
  const open = short.filter(it => !asIs.has(answerKey(it)))
  useEffect(() => { onReady?.(items !== null && open.length === 0) }, [items, open.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const markAsIs = (it) => setAsIs(s => { const n = new Set(s); n.add(answerKey(it)); store.set('short-as-ordered', [...n].slice(-300)); return n })

  if (!items) return <div className="text-xs text-ink/45 mb-3">Checking stock…</div>
  return (
    <div className="mb-4">
      {short.length > 0 && (
        <div className="panel-alert mb-2">
          <div className="text-sm font-semibold text-ink">Short on the shelves — what went?</div>
          <div className="text-xs text-ink/55 mb-1">More of these are going than inventory has. Say if they went as ordered or something else went instead.</div>
          {short.map(it => {
            const answered = asIs.has(answerKey(it))
            return (
              <div key={it.product_id} className="py-2.5 border-t border-rule/70">
                <div className="text-sm text-ink font-medium leading-snug">{it.name}</div>
                <div className="text-xs text-ink/55">{fmt(it.plan.need)} going · {fmt(it.plan.onHand)} on the shelves · {plural(it.orders, 'order')}</div>
                {answered ? (
                  <div className="text-xs text-gain mt-1 flex items-center gap-1"><Icon name="check" size={12} /> Sent as ordered</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button className="btn btn-secondary btn-sm justify-center py-2.5" onClick={() => markAsIs(it)}>Sent as ordered</button>
                    <button className="btn btn-primary btn-sm justify-center py-2.5" onClick={() => setSubFor(it)}>Something else</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <button className="text-xs font-medium text-royal-600 hover:underline py-1" onClick={() => setOther(true)}>Sent a substitute for something else?</button>
      {subFor && <SubstituteModal item={subFor} people={people} me={me} showToast={showToast} onClose={() => setSubFor(null)} onDone={() => { setSubFor(null); load() }} />}
      {other && <SubstituteFlow batchIds={batchIds} people={people} me={me} showToast={showToast} onClose={() => setOther(false)} onDone={load} />}
    </div>
  )
}
