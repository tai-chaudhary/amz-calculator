import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Icon } from './UI'
import { loadHelmNewOrders, clearHelmOrder, setHelmCutoffs } from '../lib/db'
import { orderStamp, helmStockCheck, sortKey } from '../lib/dispatch'

const CARRIER_ORDER = ['Evri', 'DHL']
const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`
const fmt = (n) => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 1 })

/** "4 min", "2 h", "3 days" since a time */
function ago(iso, now = Date.now()) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return plural(d, 'day')
}
const minsSince = (iso, now = Date.now()) => (iso ? (now - Date.parse(iso)) / 60000 : 0)
// Cut-off for the day's orders: Monday to Friday, and Saturday
const CUTOFFS = [['default', 'Mon–Fri', '15:00'], ['saturday', 'Saturday', '13:00']]

// Stamps that read the same are one line, whatever HELM calls the listing
function linesOf(orders, stampOf) {
  const byStamp = new Map()
  for (const o of orders) {
    const s = stampOf(o)
    if (!byStamp.has(s)) byStamp.set(s, { stamp: s, orders: [], items: o.items })
    byStamp.get(s).orders.push(o)
  }
  return [...byStamp.values()].sort((a, b) =>
    sortKey({ carrier: a.orders[0].carrier, label_name: a.stamp, items: a.items })
      .localeCompare(sortKey({ carrier: b.orders[0].carrier, label_name: b.stamp, items: b.items })))
}

function byCarrier(orders) {
  const map = new Map()
  for (const o of orders) {
    const c = o.carrier || 'No courier set'
    if (!map.has(c)) map.set(c, [])
    map.get(c).push(o)
  }
  const rank = (c) => { const i = CARRIER_ORDER.indexOf(c); return i < 0 ? 9 : i }
  return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * New Orders: everything in HELM without a label yet, as the warehouse will
 * pack it — "Qty x Product" lines with how many orders each, Evri first —
 * plus orders HELM has labelled that haven't been uploaded here yet. Stock
 * is checked against the lot. Back orders and holds are for the office.
 * HELM is read every minute; this refreshes itself while it's on screen.
 */
export default function NewOrdersCard({ me, mappings = [], names = new Map(), focus = null, showToast, onLog }) {
  const office = me?.role === 'admin'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('newOrdersOpen') !== '0' } catch { return true } })
  const [expanded, setExpanded] = useState(() => new Set())
  const [view, setView] = useState(null)        // which list is showing; null = the first with anything in it
  const [q, setQ] = useState('')
  const [now, setNow] = useState(Date.now())
  const focusRef = useRef(null)

  const load = useCallback(() => loadHelmNewOrders().then(d => { setData(d); setError('') })
    .catch(e => setError(e?.message || 'Couldn’t load New Orders')), [])

  useEffect(() => {
    load()
    const t = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') load() }, 60000)
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); load() } }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const toggleOpen = () => setOpen(v => { try { localStorage.setItem('newOrdersOpen', v ? '0' : '1') } catch { /* fine */ } return !v })
  const toggle = (key) => setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const byKey = useMemo(() => new Map(mappings.map(m => [m.item_key, m])), [mappings])
  const stampOf = useCallback((o) => orderStamp(o.items || [], byKey, names), [byKey, names])

  const orders = data?.orders || []
  const today = data?.today || new Date().toISOString().slice(0, 10)
  // Ordered after the cut-off: ship-by is the next working day, so it's not on today's list (still holds stock)
  const allNew = orders.filter(o => o.phase === 'new')
  const fresh = allNew.filter(o => !o.ship_day || o.ship_day <= today)
  const late = fresh.filter(o => o.ship_day && o.ship_day < today)
  const laterDays = [...new Set(allNew.filter(o => o.ship_day > today).map(o => o.ship_day))].sort()
  const [cutEdit, setCutEdit] = useState(null)
  const labelled = orders.filter(o => o.phase === 'labelled')
  const attention = orders.filter(o => o.phase === 'backorder' || o.phase === 'hold')
  const check = useMemo(() => helmStockCheck(orders, data?.stock || {}), [orders, data])
  const units = (list) => list.reduce((s, o) => s + (o.units || []).reduce((t, u) => t + (Number(u.qty) || 0), 0), 0)
  const viewOf = (o) => (o.phase === 'labelled' ? 'labelled' : o.phase === 'backorder' || o.phase === 'hold' ? 'attention'
    : o.ship_day && o.ship_day < today ? 'late' : o.ship_day && o.ship_day > today ? `day:${o.ship_day}` : 'today')

  // Arriving from ⌘K: open the card on the order's list, with its line open
  useEffect(() => {
    if (!focus || !orders.length) return
    const o = orders.find(x => String(x.id) === String(focus))
    if (!o) return
    setOpen(true)
    const v = viewOf(o)
    setView(v)
    setQ('')
    setExpanded(s => new Set([...s, `${v}|${stampOf(o)}`]))
    setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250)
  }, [focus, orders.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = data?.sync || {}
  const staleMins = minsSince(sync.last_ok, now)
  const stale = data && (!sync.last_ok || staleMins > 5)
  const oldest = fresh.reduce((m, o) => (!m || Date.parse(o.order_date) < Date.parse(m) ? o.order_date : m), null)
  const oldestHrs = minsSince(oldest, now) / 60
  const oldestLabel = labelled.reduce((m, o) => (!m || Date.parse(o.labelled_at) < Date.parse(m) ? o.labelled_at : m), null)
  const labelLate = labelled.length > 0 && minsSince(oldestLabel, now) > 30
  const shortCount = [...check.values()].filter(c => c.level === 'short').length
  // Item codes HELM sends that inventory doesn't know: no stock check and nothing held for them
  const missingCount = [...check.values()].filter(c => c.level === 'missing').length

  const saveCutoffs = async () => {
    try {
      const clean = Object.fromEntries(Object.entries(cutEdit).filter(([, v]) => v))
      await setHelmCutoffs(clean, me?.name || me?.email)
      onLog?.({ entity_type: 'dispatch', entity_name: 'Order cut-off', action: 'Changed', detail: Object.entries(clean).map(([k, v]) => `${k === 'default' ? 'Mon–Fri' : k === 'saturday' ? 'Saturday' : k} ${v}`).join(', '), source: 'dispatch' })
      setCutEdit(null); showToast?.('Cut-off saved'); load()
    } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') }
  }

  // Orders that went another way (an Amazon label from the old portal, say) sit in HELM for good.
  // Clearing them all at once stops them holding stock and showing as late.
  const clearMany = async (list, why) => {
    if (!list.length) return
    if (!window.confirm(`Clear ${plural(list.length, 'order')}? ${why}\n\nThey stop counting as open orders and won't show here again. HELM itself isn't changed.`)) return
    let n = 0
    try {
      for (const o of list) { await clearHelmOrder(o.id, me?.name || me?.email); n++ }
      onLog?.({ entity_type: 'dispatch', entity_name: `${plural(n, 'HELM order')}`, action: 'Cleared HELM orders',
        detail: `${why} — ${list.slice(0, 12).map(o => o.ref || o.order_number).join(', ')}${list.length > 12 ? '…' : ''}`, source: 'dispatch' })
      showToast?.(`${plural(n, 'order')} cleared`)
    } catch (e) { showToast?.(`${n} cleared, then: ${e?.message || 'couldn’t clear the rest'}`, 'error') }
    load()
  }

  const clear = async (o) => {
    if (!window.confirm(`Clear ${o.ref || o.order_number}? It stops counting as an open order and won't be shown here again.`)) return
    try {
      await clearHelmOrder(o.id, me?.name || me?.email)
      onLog?.({ entity_type: 'dispatch', entity_name: o.ref || o.order_number, action: 'Cleared HELM order',
        detail: `${o.order_number || ''} — won't come through Dispatch, no longer counted as an open order`, source: 'dispatch' })
      showToast?.('Cleared'); load()
    } catch (e) { showToast?.(e?.message || 'Couldn’t clear it', 'error') }
  }

  // The lists, one showing at a time
  const todays = fresh.filter(o => !late.includes(o))
  const VIEWS = [
    { id: 'today', label: 'Today', list: todays, tone: 'brand' },
    ...laterDays.map(d => ({ id: `day:${d}`, label: shortDay(d), list: allNew.filter(o => o.ship_day === d), tone: 'quiet',
      note: 'Ordered after the cut-off — label these on the day. Their stock is held already.' })),
    { id: 'late', label: 'Past ship-by', list: late, tone: 'alert',
      note: office ? 'Should have gone already. Orders that went another way (an Amazon label from the old portal, say) can be cleared.' : 'Should have gone already — label these first.' },
    { id: 'labelled', label: 'Labelled', list: labelled, tone: labelLate ? 'warn' : 'quiet',
      note: labelLate ? `Labelled in HELM, not uploaded here — the oldest ${ago(oldestLabel, now)} ago. Upload the labels.` : 'Labelled in HELM, not uploaded here yet.' },
    ...(office ? [{ id: 'attention', label: 'Needs attention', list: attention, tone: 'alert', note: 'Back orders and holds in HELM — office only.' }] : []),
  ].filter(v => v.list.length || v.id === 'today')
  const current = VIEWS.find(v => v.id === view) || VIEWS.find(v => v.list.length) || VIEWS[0]
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shownOrders = (current?.list || []).filter(o => !words.length
    || words.every(w => `${stampOf(o)} ${o.ref || ''} ${o.order_number || ''} ${(o.items || []).map(i => i.code).join(' ')}`.toLowerCase().includes(w)))
  const groups = current?.id === 'labelled' || current?.id === 'attention' ? [['', shownOrders]] : byCarrier(shownOrders)
  const clearable = office && (current?.id === 'late' ? late
    : current?.id === 'labelled' ? labelled.filter(o => minsSince(o.labelled_at, now) > 24 * 60) : [])

  const flagsOf = (line) => {
    const flags = new Map()
    for (const o of line.orders) for (const u of o.units || []) {
      const c = check.get(u.product_id || `code:${u.code}`)
      if (c && c.level !== 'ok') flags.set(u.product_id || u.code, c)
    }
    return [...flags.values()].sort((a, b) => RANK.indexOf(a.level) - RANK.indexOf(b.level))
  }

  return (
    <section className="card-flush mb-4 overflow-hidden flex flex-col xl:max-h-[calc(100dvh-3rem)]" aria-label="New orders from HELM">
      {/* Always in view: what's waiting and whether HELM is being read */}
      <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-rule">
        <button className="w-full flex items-center gap-2 text-left" onClick={toggleOpen} aria-expanded={open}>
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-500">New orders · HELM</span>
            <span className="block text-lg font-semibold text-ink tabular-nums leading-tight mt-0.5">
              {!data ? (error ? 'Couldn’t load' : 'Loading…') : fresh.length ? `${plural(fresh.length, 'order')} · ${fmt(units(fresh))} units` : 'Nothing waiting for today'}
            </span>
          </span>
          <span className={`inline-flex items-center gap-1.5 text-[11px] shrink-0 ${stale ? 'text-loss font-medium' : 'text-ink/45'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-coral' : 'bg-gain'}`} />
            {!data ? '' : stale ? `Not read for ${ago(sync.last_ok, now) || 'a while'}` : `Live · ${ago(sync.last_ok, now)}${ago(sync.last_ok, now) === 'just now' ? '' : ' ago'}`}
          </span>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} className="text-ink/40 shrink-0" />
        </button>
        {data && (late.length > 0 || shortCount > 0 || missingCount > 0 || (fresh.length > 0 && oldestHrs >= 24)) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {late.length > 0 && <button className="pill pill-alert" onClick={() => { setOpen(true); setView('late') }}>{late.length} past ship-by</button>}
            {shortCount > 0 && <span className="pill pill-alert">{plural(shortCount, 'product')} short</span>}
            {missingCount > 0 && (
              <span className="pill bg-warn/10 text-warn border-warn/25" title="HELM sent item codes that aren't linked to an inventory product — fix the link in HELM. Until then there's no stock check for them">
                {missingCount} not linked in HELM
              </span>
            )}
            {fresh.length > 0 && oldestHrs >= 24 && <span className={`pill ${oldestHrs >= 48 ? 'pill-alert' : 'bg-warn/10 text-warn border-warn/25'}`}>oldest {ago(oldest, now)}</span>}
          </div>
        )}
      </div>

      {open && (
        <>
          {error && <div className="shrink-0 px-4 py-3 text-sm text-loss">{error}</div>}
          {stale && sync.last_error && office && (
            <div className="shrink-0 px-4 py-2 text-xs text-loss bg-coral/5 border-b border-rule">Last try: {sync.last_error}</div>
          )}

          {data && (
            <>
              {/* One list at a time */}
              <div className="shrink-0 flex gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-rule bg-paper/50" role="tablist">
                {VIEWS.map(v => {
                  const on = current?.id === v.id
                  return (
                    <button key={v.id} role="tab" aria-selected={on} onClick={() => { setView(v.id); setQ('') }}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${on
                        ? 'bg-royal-500 border-royal-500 text-white'
                        : v.tone === 'alert' && v.list.length ? 'bg-white border-coral/40 text-loss hover:border-coral'
                          : v.tone === 'warn' ? 'bg-white border-warn/30 text-warn hover:border-warn'
                            : 'bg-white border-rule text-ink/70 hover:border-royal-300'}`}>
                      {v.label}
                      <span className={`tabular-nums text-xs ${on ? 'text-white/75' : 'text-ink/40'}`}>{v.list.length}</span>
                    </button>
                  )
                })}
              </div>

              {(current?.note || clearable?.length > 0 || (current?.list.length || 0) > 8) && (
                <div className="shrink-0 px-4 py-2.5 border-b border-rule space-y-2">
                  {current?.note && <div className={`text-xs ${current.tone === 'alert' ? 'text-loss' : current.tone === 'warn' ? 'text-warn' : 'text-ink/55'}`}>{current.note}</div>}
                  <div className="flex items-center gap-2">
                    {(current?.list.length || 0) > 8 && (
                      <div className="relative flex-1">
                        <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none" />
                        <input className="input py-1.5 pl-8 text-sm" value={q} onChange={e => setQ(e.target.value)} placeholder="Product or order ref"
                          type="search" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Search these orders" />
                      </div>
                    )}
                    {clearable?.length > 0 && (
                      <button className="btn btn-secondary btn-sm shrink-0" onClick={() => clearMany(clearable, current.id === 'late'
                        ? 'Past their ship-by day — shipped another way.' : 'Labelled over a day ago and never uploaded here — shipped another way.')}>
                        Clear {current.id === 'late' ? 'all' : `${clearable.length} over a day old`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* The list scrolls on its own on a wide screen, so the page stays put */}
              <div className="xl:flex-1 xl:min-h-0 xl:overflow-y-auto overscroll-contain">
                {!shownOrders.length ? (
                  <div className="px-4 py-8 text-center text-sm text-ink/50">
                    {words.length ? 'Nothing matches.' : current?.id === 'today' ? (laterDays.length ? 'Nothing for today — the rest ship on a later day.' : 'No new orders for today.') : 'Nothing here.'}
                  </div>
                ) : groups.map(([carrier, list]) => (
                  <div key={carrier || 'all'}>
                    {carrier && (
                      <div className="sticky top-0 z-[1] flex items-baseline justify-between px-4 py-1.5 bg-paper/95 backdrop-blur-sm border-b border-rule/70">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-royal-700">{carrier}</span>
                        <span className="text-[11px] text-ink/45 tabular-nums">{plural(list.length, 'order')} · {fmt(units(list))} units</span>
                      </div>
                    )}
                    <ul className="divide-y divide-rule/60">
                      {linesOf(list, stampOf).map(line => {
                        const k = `${current.id}|${line.stamp}`
                        return (
                          <OrderLine key={k} line={line} isOpen={expanded.has(k)} onToggle={() => toggle(k)} flags={flagsOf(line)}
                            focus={focus} focusRef={focusRef} now={now} today={today} labelled={current.id === 'labelled'}
                            canClear={office && current.id !== 'today' && !current.id.startsWith('day:')} onClear={clear} />
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              {office && (
                <div className="shrink-0 border-t border-rule px-4 py-2 text-xs text-ink/50 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {!cutEdit ? (
                    <>
                      <span>Cut-off: {CUTOFFS.map(([k, label, d]) => `${label} ${(data?.cutoffs || {})[k] || d}`).join(' · ')}</span>
                      <button className="text-royal-600 hover:underline" onClick={() => setCutEdit({ default: '15:00', saturday: '13:00', ...(data?.cutoffs || {}) })}>Change</button>
                    </>
                  ) : (
                    <>
                      {CUTOFFS.map(([c, label]) => (
                        <label key={c} className="flex items-center gap-1">
                          {label}
                          <input type="time" className="input py-1 px-1.5 w-[6.5rem]" value={cutEdit[c] || ''}
                            onChange={(e) => setCutEdit(v => ({ ...v, [c]: e.target.value }))} />
                        </label>
                      ))}
                      <button className="btn btn-primary btn-sm" onClick={saveCutoffs}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setCutEdit(null)}>Cancel</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

const RANK = ['short', 'missing', 'topup']
const shortDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

// "3 X 151 CHALKY FURNITURE PAINT 400ML" → 3 and "151 Chalky Furniture Paint 400ml".
// Short all-capital words without vowels (PVA, DHL) stay as they are.
function splitStamp(stamp) {
  const m = String(stamp).match(/^\s*(\d+)\s*[X×]\s+(.*)$/i)
  const qty = m ? Number(m[1]) : 1
  const name = (m ? m[2] : String(stamp)).split(/(\s+)/).map(w => {
    if (!/[A-Z]/.test(w) || /[a-z]/.test(w)) return w
    if (/^[\d.]+L$/.test(w)) return w                                   // 5L stays 5L
    if (/^[\d.]+[A-Z]+$/.test(w)) return w.toLowerCase()            // 400ML → 400ml, 25KG → 25kg
    if (w.length <= 4 && !/[AEIOU]/.test(w)) return w                  // PVA, DHL, XL
    return w.charAt(0) + w.slice(1).toLowerCase()
  }).join('')
  return { qty, name }
}

/** A line: quantity in each parcel, the product, how many orders; tap for the orders on it. */
function OrderLine({ line, isOpen, onToggle, flags, focus, focusRef, now, today, labelled, canClear, onClear }) {
  const { qty, name } = splitStamp(line.stamp)
  const worst = flags[0]
  const hasFocus = focus && line.orders.some(o => String(o.id) === String(focus))
  return (
    <li ref={hasFocus ? focusRef : null} className={hasFocus ? 'bg-royal-50/60' : ''}>
      <button className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-paper/70 transition-colors" onClick={onToggle} aria-expanded={isOpen}>
        <span className={`shrink-0 min-w-[2.25rem] h-7 px-1.5 rounded-[5px] flex items-center justify-center text-sm font-semibold tabular-nums ${qty > 1 ? 'bg-royal-500 text-white' : 'bg-sky/70 text-royal-700'}`}>
          {qty}×
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-ink leading-snug">{name}</span>
          {worst && <StockFlag c={worst} more={flags.length - 1} />}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-ink">{line.orders.length}</span>
          <span className="block text-[10px] text-ink/40">order{line.orders.length !== 1 ? 's' : ''}</span>
        </span>
        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} className="text-ink/30 shrink-0" />
      </button>
      {isOpen && (
        <div className="pl-[4.25rem] pr-4 pb-3 space-y-1.5">
          {flags.length > 1 && flags.map((c, i) => <StockFlag key={i} c={c} named />)}
          {line.orders.map(o => (
            <div key={o.id} className={`flex items-center gap-2 text-xs ${String(o.id) === String(focus) ? 'font-semibold text-royal-700' : 'text-ink/65'}`}>
              <span className="tabular-nums truncate">{o.ref || o.order_number}</span>
              {o.channel && <span className="text-ink/35 shrink-0">{o.channel}</span>}
              {o.phase === 'new' && o.ship_day && o.ship_day < today && <span className="text-loss shrink-0">due {shortDay(o.ship_day)}</span>}
              <span className="ml-auto tabular-nums text-ink/40 shrink-0">{labelled ? `labelled ${ago(o.labelled_at, now)} ago` : ago(o.order_date, now)}</span>
              {canClear && (
                <button className="text-ink/40 hover:text-loss shrink-0 py-1" title="Won't come through Dispatch: stop counting it" onClick={() => onClear(o)}>Clear</button>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

function StockFlag({ c, more = 0, named = false }) {
  const who = named && c.name ? `${c.name}: ` : ''
  const text = c.level === 'short'
    ? `${who}short — need ${fmt(c.need)}, ${fmt(c.free)} in stock`
    : c.level === 'topup'
      ? `${who}top up the pick shelf — need ${fmt(c.need)}, ${fmt(c.pickFree)} on it`
      : `${named ? `${c.code}: ` : ''}not linked in HELM — no stock check`
  const tone = c.level === 'short' ? 'text-loss' : 'text-warn'
  return (
    <span className={`block text-xs mt-0.5 ${tone}`}>
      <Icon name="alert" size={11} className="inline -mt-0.5 mr-1" />
      {text}{more > 0 ? ` (+${more} more)` : ''}
    </span>
  )
}
