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
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
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

  // Arriving from ⌘K: open the card and the line the order's on
  useEffect(() => {
    if (!focus || !orders.length) return
    const o = orders.find(x => String(x.id) === String(focus))
    if (!o) return
    setOpen(true)
    const later = o.phase === 'new' && o.ship_day > today
    const lineKey = later ? `day-${o.ship_day}||${stampOf(o)}` : o.phase === 'new' ? `new|${o.carrier || 'No courier set'}|${stampOf(o)}`
      : o.phase === 'labelled' ? `labelled||${stampOf(o)}` : `attention||${stampOf(o)}`
    setExpanded(s => new Set([...s, lineKey, later ? `day-${o.ship_day}-section` : o.phase === 'labelled' ? 'labelled-section' : 'backorder-section']))
    setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
  }, [focus, orders.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = data?.sync || {}
  const staleMins = minsSince(sync.last_ok, now)
  const stale = data && (!sync.last_ok || staleMins > 5)
  const oldest = fresh.reduce((m, o) => (!m || Date.parse(o.order_date) < Date.parse(m) ? o.order_date : m), null)
  const oldestHrs = minsSince(oldest, now) / 60
  const oldestLabel = labelled.reduce((m, o) => (!m || Date.parse(o.labelled_at) < Date.parse(m) ? o.labelled_at : m), null)
  const labelLate = labelled.length > 0 && minsSince(oldestLabel, now) > 30
  const shortCount = [...check.values()].filter(c => c.level === 'short').length

  const saveCutoffs = async () => {
    try {
      const clean = Object.fromEntries(Object.entries(cutEdit).filter(([, v]) => v))
      await setHelmCutoffs(clean, me?.display_name || me?.email)
      onLog?.({ entity_type: 'dispatch', entity_name: 'Order cut-off', action: 'Changed', detail: Object.entries(clean).map(([k, v]) => `${k === 'default' ? 'Mon–Fri' : k === 'saturday' ? 'Saturday' : k} ${v}`).join(', '), source: 'dispatch' })
      setCutEdit(null); showToast?.('Cut-off saved'); load()
    } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') }
  }

  const clear = async (o) => {
    if (!window.confirm(`Clear ${o.ref || o.order_number}? It stops counting as an open order and won't be shown here again.`)) return
    try {
      await clearHelmOrder(o.id, me?.display_name || me?.email)
      onLog?.({ entity_type: 'dispatch', entity_name: o.ref || o.order_number, action: 'Cleared HELM order',
        detail: `${o.order_number || ''} — won't come through Dispatch, no longer counted as an open order`, source: 'dispatch' })
      showToast?.('Cleared'); load()
    } catch (e) { showToast?.(e?.message || 'Couldn’t clear it', 'error') }
  }

  // One line: "3 X SANMEX FLY & WASP KILLER 300ML ....... 12 orders", tap to see the orders
  const Line = ({ line, k, phase }) => {
    const isOpen = expanded.has(k)
    const flags = new Map()
    for (const o of line.orders) for (const u of o.units || []) {
      const c = check.get(u.product_id || `code:${u.code}`)
      if (c && c.level !== 'ok') flags.set(u.product_id || u.code, c)
    }
    const worst = [...flags.values()].sort((a, b) => ['short', 'missing', 'topup'].indexOf(a.level) - ['short', 'missing', 'topup'].indexOf(b.level))[0]
    const hasFocus = focus && line.orders.some(o => String(o.id) === String(focus))
    return (
      <div ref={hasFocus ? focusRef : null} className={hasFocus ? 'bg-royal-50/60' : ''}>
        <button className="w-full flex items-start gap-2 px-3 py-2.5 sm:py-2 text-left hover:bg-paper/70 transition-colors" onClick={() => toggle(k)}>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} className="mt-0.5 text-ink/40 shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-ink leading-snug break-words">{line.stamp}</span>
            {worst && <StockFlag c={worst} more={flags.size - 1} />}
          </span>
          <span className="text-sm tabular-nums font-semibold text-ink shrink-0">{plural(line.orders.length, 'order')}</span>
        </button>
        {isOpen && (
          <div className="pl-9 pr-3 pb-2.5 space-y-1">
            {[...flags.values()].length > 1 && [...flags.values()].map((c, i) => <StockFlag key={i} c={c} named />)}
            {line.orders.map(o => (
              <div key={o.id} className={`flex items-center gap-2 text-xs ${String(o.id) === String(focus) ? 'font-semibold text-royal-700' : 'text-ink/65'}`}>
                <span className="tabular-nums truncate">{o.ref || o.order_number}</span>
                <span className="text-ink/40 shrink-0">{[o.channel, phase === 'new' ? null : o.carrier].filter(Boolean).join(' · ')}</span>
                {o.phase === 'new' && o.ship_day && o.ship_day < today && <span className="text-loss shrink-0">ship-by {dayName(o.ship_day)}</span>}
                <span className="ml-auto tabular-nums text-ink/45 shrink-0">
                  {phase === 'labelled' ? `labelled ${ago(o.labelled_at, now)} ago` : ago(o.order_date, now)}
                </span>
                {office && phase !== 'new' && (
                  <button className="text-ink/40 hover:text-loss shrink-0" title="Won't come through Dispatch: stop counting it" onClick={() => clear(o)}>Clear</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="card-flush mb-4 overflow-hidden">
      <button className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left" onClick={toggleOpen}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} className="text-ink/40" />
        <span className="font-semibold text-ink">New Orders</span>
        {data && (
          <span className="text-sm text-ink/70 tabular-nums">
            {fresh.length ? `${plural(fresh.length, 'order')} · ${fmt(units(fresh))} units` : 'none waiting'}
          </span>
        )}
        {late.length > 0 && <span className="badge badge-red">{late.length} past ship-by</span>}
        {fresh.length > 0 && oldest && (
          <span className={`text-xs tabular-nums ${oldestHrs >= 48 ? 'text-loss font-medium' : oldestHrs >= 24 ? 'text-warn font-medium' : 'text-ink/45'}`}>
            oldest {ago(oldest, now)}
          </span>
        )}
        {shortCount > 0 && <span className="badge badge-red">{plural(shortCount, 'product')} short</span>}
        {labelled.length > 0 && <span className={`badge ${labelLate ? 'badge-amber' : 'badge-blue'}`}>{labelled.length} labelled, awaiting upload</span>}
        <span className={`ml-auto text-xs ${stale ? 'text-loss font-medium' : 'text-ink/40'}`}>
          {!data ? (error ? '' : 'loading…') : stale ? `HELM not read for ${ago(sync.last_ok, now) || 'a while'}` : `updated ${ago(sync.last_ok, now)}${ago(sync.last_ok, now) === 'just now' ? '' : ' ago'}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-rule">
          {error && <div className="px-4 py-3 text-sm text-loss">{error}</div>}
          {stale && sync.last_error && office && (
            <div className="px-4 py-2 text-xs text-loss bg-coral/5 border-b border-rule">Last try: {sync.last_error}</div>
          )}

          {data && !fresh.length && <div className="px-4 py-3 text-sm text-ink/50">No new orders for today{laterDays.length ? ' — the rest ship on a later day' : ''}.</div>}

          {byCarrier(fresh).map(([carrier, list]) => (
            <div key={carrier} className="border-b border-rule last:border-b-0">
              <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-royal-700">{carrier}</span>
                <span className="text-xs text-ink/45 tabular-nums">{plural(list.length, 'order')} · {fmt(units(list))} units</span>
              </div>
              <div className="divide-y divide-rule/60 px-1 pb-1">
                {linesOf(list, stampOf).map(line => <Line key={line.stamp} line={line} k={`new|${carrier}|${line.stamp}`} phase="new" />)}
              </div>
            </div>
          ))}

          {laterDays.map(day => {
            const list = allNew.filter(o => o.ship_day === day)
            return (
              <Section key={day} k={`day-${day}-section`} expanded={expanded} toggle={toggle} tone="brand"
                title={`For ${dayName(day)}: ${plural(list.length, 'order')} · ${fmt(units(list))} units`}
                sub="ordered after the cut-off — label these that day, not today (stock is already held)">
                {linesOf(list, stampOf).map(line => <Line key={line.stamp} line={{ ...line, stamp: line.stamp }} k={`day-${day}||${line.stamp}`} phase="later" />)}
              </Section>
            )
          })}

          {labelled.length > 0 && (
            <Section k="labelled-section" expanded={expanded} toggle={toggle} tone={labelLate ? 'warn' : 'brand'}
              title={`Labelled – awaiting upload: ${plural(labelled.length, 'order')}`}
              sub={labelLate ? `oldest labelled ${ago(oldestLabel, now)} ago — upload the labels` : 'labels made in HELM, not uploaded here yet'}>
              {linesOf(labelled, stampOf).map(line => <Line key={line.stamp} line={line} k={`labelled||${line.stamp}`} phase="labelled" />)}
            </Section>
          )}

          {office && attention.length > 0 && (
            <Section k="backorder-section" expanded={expanded} toggle={toggle} tone="alert"
              title={`Needs attention in HELM: ${plural(attention.length, 'order')}`}
              sub={[
                attention.filter(o => o.phase === 'backorder').length && plural(attention.filter(o => o.phase === 'backorder').length, 'back order'),
                attention.filter(o => o.phase === 'hold').length && `${attention.filter(o => o.phase === 'hold').length} on hold`,
              ].filter(Boolean).join(' · ') + ' — office only'}>
              {linesOf(attention, stampOf).map(line => <Line key={line.stamp} line={line} k={`attention||${line.stamp}`} phase="attention" />)}
            </Section>
          )}
          {office && (
            <div className="border-t border-rule px-4 py-2 text-xs text-ink/50 flex flex-wrap items-center gap-x-3 gap-y-1">
              {!cutEdit ? (
                <>
                  <span>Order cut-off (later orders ship the next working day): {CUTOFFS.map(([k, label, d]) => `${label} ${(data?.cutoffs || {})[k] || d}`).join(' · ')}</span>
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
        </div>
      )}
    </section>
  )
}

function Section({ k, title, sub, tone, expanded, toggle, children }) {
  const isOpen = expanded.has(k)
  const bar = tone === 'alert' ? 'border-l-coral' : tone === 'warn' ? 'border-l-warn' : 'border-l-royal-500'
  return (
    <div className={`border-t border-rule border-l-2 ${bar}`}>
      <button className="w-full flex items-start gap-2 px-4 py-2.5 text-left hover:bg-paper/70" onClick={() => toggle(k)}>
        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} className="mt-0.5 text-ink/40 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {sub && <span className={`block text-xs ${tone === 'warn' ? 'text-warn' : 'text-ink/50'}`}>{sub}</span>}
        </span>
      </button>
      {isOpen && <div className="divide-y divide-rule/60 px-1 pb-1">{children}</div>}
    </div>
  )
}

function StockFlag({ c, more = 0, named = false }) {
  const who = named && c.name ? `${c.name}: ` : ''
  const text = c.level === 'short'
    ? `${who}short — need ${fmt(c.need)}, ${fmt(c.free)} in stock`
    : c.level === 'topup'
      ? `${who}top up the pick shelf — need ${fmt(c.need)}, ${fmt(c.pickFree)} on it`
      : `${named ? `${c.code}: ` : ''}not in inventory`
  const tone = c.level === 'short' ? 'text-loss' : c.level === 'topup' ? 'text-warn' : 'text-ink/45'
  return (
    <span className={`block text-xs mt-0.5 ${tone}`}>
      {c.level !== 'missing' && <Icon name="alert" size={11} className="inline -mt-0.5 mr-1" />}
      {text}{more > 0 ? ` (+${more} more)` : ''}
    </span>
  )
}
