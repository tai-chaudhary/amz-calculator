import React, { useState } from 'react'
import { SegmentedControl } from './UI'
import { useLinks } from './Links'
import { PERIODS, START } from '../lib/pnlScreen'
import { SALES_CHANNELS, CHANNEL_IDS, channelDisplayName } from '../lib/channels'

/**
 * Shared by the Finance pages (v2.84.0): Profit & Loss, Sales, Stock value and Uploads. They were one Reports page
 * with tabs until the owner asked for a page each, every one answering one question.
 */
const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
// (a nought that is a hair below zero is shown as £0.00, never -£0.00)
export const money = (v) => (v == null ? '—' : GBP.format(Math.abs(v) < 0.005 ? 0 : v))
/** Whole pounds, for headline figures */
export const money0 = (v) => (v == null ? '—' : `${v < -0.5 ? '−' : ''}£${Math.abs(Math.round(v)).toLocaleString('en-GB')}`)
export const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d)
export { START }
export const CHANNELS = CHANNEL_IDS
/** The name people know a channel by (WooCommerce is the Salt 4 U shop; Shopify is the Plenty&More shop, v2.103.0) */
export const channelName = channelDisplayName
export const monthName = (k) => new Date(`${k}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
export const dayName = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
export const pct1 = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`)
export const int = (v) => Math.round(Number(v) || 0).toLocaleString('en-GB')

// "Other charges and credits" are what a channel bills outside any one order. Named for the channel tab chosen; under
// All channels they are every channel's, so no channel is named (v2.83.3: it used to say Amazon on every tab).
const CHARGES = {
  '': { name: 'Other charges & credits', whose: 'The channels’ other charges and credits', hint: 'subscriptions, promoted listings, claims' },
  ...Object.fromEntries(SALES_CHANNELS.map(c => [c.id, c.charges
    ? { name: `${c.name} other charges & credits`, whose: `${c.name}’s other charges and credits`, hint: c.charges }
    : { name: 'Other charges & credits', whose: 'Other charges and credits', hint: `none for ${c.name.toLowerCase()}` }])),
}
export const chargesOf = (channel) => CHARGES[channel || ''] || CHARGES['']

/** A white panel with a small heading — the Finance pages' building block (same look as the Overheads page) */
/**
 * `tone="gross"` (v2.93.0): a card whose figures are GROSS profit — before overheads — wears a different colour from the
 * rest, so it is never read as net profit: a pale blue ground with a dark band along the top and a "Gross" mark.
 */
export const GROSS_HERO = 'bg-ink'          // the big card when it shows gross profit (net profit is royal blue)
export function Tile({ label, right, children, className = '', tone = null }) {
  const gross = tone === 'gross'
  return (
    <div className={`${gross ? 'bg-royal-50 border-royal-200 border-t-4 border-t-ink' : 'bg-white border-rule'} border rounded-card px-5 py-4 flex flex-col min-w-0 ${className}`} data-tone={tone || undefined}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">
          {gross && !/^gross/i.test(String(label)) && <span className="inline-block bg-ink text-white rounded-[3px] px-1.5 py-px mr-2 tracking-[0.06em]">Gross</span>}{label}
        </span>
        {right && <span className="text-[11px] text-ink/45 text-right">{right}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Dates, as the Finance pages write them ───────────────────────────────────────────────────────────────────────────
export const short = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
/** "Sat, 14 Nov" for one day, "9 – 15 Nov" inside a month, "27 Oct – 2 Nov" across two */
export const spanText = (from, to) => (from === to ? dayName(from) : from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8))} – ${short(to)}` : `${short(from)} – ${short(to)}`)
export const pctChange = (now, was) => (was ? ((now - was) / Math.abs(was)) * 100 : null)

/** A change against the period before: ▲ or ▼ with the amount, green when it is the good direction */
export function Delta({ now, was, fmt = money0, goodUp = true, light = false, flat = 'level', eps = 0.5 }) {
  if (now == null || was == null) return null
  const diff = now - was
  if (Math.abs(diff) < eps) return <span className={light ? 'text-sky' : 'text-ink/45'}>{flat}</span>
  const good = diff > 0 === goodUp
  const tone = light ? (good ? 'text-lime' : 'text-[#FFC2B8]') : good ? 'text-gain' : 'text-loss'
  return <span className={`font-semibold tabular-nums whitespace-nowrap ${tone}`}>{diff > 0 ? '▲' : '▼'} {fmt(Math.abs(diff))}</span>
}
/** The small ▲ 12% / ▼ 8% label in the corner of a figure. `goodUp` false for things that are better lower. */
export function ChangeChip({ now, was, goodUp = true }) {
  const c = now == null || was == null ? null : pctChange(now, was)
  if (c == null) return null
  if (Math.abs(c) < 0.5) return <span className="font-bold text-ink/55 bg-ink/5 rounded-[4px] px-2 py-0.5">level</span>
  const good = c > 0 === goodUp
  return <span className={`font-bold rounded-[4px] px-2 py-0.5 whitespace-nowrap ${good ? 'text-gain bg-[#EEF7F2]' : 'text-loss bg-[#FCEFED]'}`}>{c > 0 ? '▲' : '▼'} {Math.abs(c) >= 1000 ? '999+' : Math.abs(c).toFixed(0)}%</span>
}

/** All channels, then one tab each. A channel is a view of the same page, never a page of its own. */
export function ChannelTabs({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 mb-3" role="tablist" aria-label="Channel">
      {[['', 'All channels'], ...CHANNELS.map(c => [c, channelName(c)])].map(([id, name]) => (
        <button key={id || 'all'} role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`px-3.5 py-2 rounded-[6px] text-sm font-medium border transition-colors ${value === id ? 'bg-royal-500 border-royal-500 text-white' : 'bg-white border-rule text-ink/70 hover:border-royal-200'}`}>{name}</button>
      ))}
    </div>
  )
}

/** Today … Last quarter, Custom — with the two date boxes when Custom is chosen */
export function PeriodPicker({ periodId, onPeriod, custom, onCustom, today }) {
  return (
    <div className="filter-bar mb-4 flex-wrap gap-3">
      <SegmentedControl label="Period" items={PERIODS} value={periodId} onChange={onPeriod} />
      {periodId === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" className="input text-sm w-auto" value={custom.from} min={START} max={custom.to} onChange={e => onCustom({ ...custom, from: e.target.value || START })} aria-label="From" />
          <span className="text-ink/40 text-sm">to</span>
          <input type="date" className="input text-sm w-auto" value={custom.to} min={custom.from} max={today} onChange={e => onCustom({ ...custom, to: e.target.value || today })} aria-label="To" />
        </div>
      )}
    </div>
  )
}

const WD = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa']
/**
 * One bar for each day (or week): above the line for a profit, below it for a loss. Point at a bar and its figures
 * show above the chart; click it and that day (or week) opens. `rows` are { d, to? } with the value under `k`.
 */
export function Bars({ rows, k, by = 'day', from, caption, onPick, height = 190 }) {
  const [hover, setHover] = useState(null)
  const vals = rows.map(r => r[k] || 0)
  const up = Math.max(0, ...vals), down = Math.max(0, ...vals.map(v => -v))
  const all = up + down || 1
  const upH = down ? Math.round((up / all) * height) : height, downH = height - upH
  const cols = { gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }
  const pad = rows.length > 20 ? 'px-px' : 'px-[3px]'
  const every = rows.length > 16 ? Math.ceil(rows.length / 10) : 1
  const name = (r) => (by === 'week' ? `Week of ${dayName(r.d)}` : dayName(r.d))
  const shown = hover != null ? rows[hover] : null
  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="min-h-[36px] text-[13px] leading-snug mb-2" aria-live="polite">
        {shown ? <><b className="text-ink">{name(shown)}</b> <span className="text-ink/70">· {caption(shown)}</span></>
          : <span className="text-ink/45">Point at a bar for its figures{onPick ? `; click it to open that ${by}` : ''}.</span>}
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 h-px bg-ink" style={{ top: upH }} />
        <div className="absolute inset-0 grid" style={cols}>
          {rows.map((r, i) => {
            const v = r[k] || 0, h = v ? Math.max(2, Math.round((Math.abs(v) / all) * height)) : 0
            const on = r.d >= from
            return (
              <button key={r.d} type="button" disabled={!onPick} onClick={() => onPick?.(r)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${name(r)}: ${caption(r)}`} className={`relative ${pad} ${hover === i ? 'bg-royal-50' : ''} ${onPick ? 'cursor-pointer' : 'cursor-default'} focus:outline-none focus-visible:ring-2 focus-visible:ring-royal-500 rounded-[2px]`}>
                <span className={`absolute inset-x-0 ${pad} block`} style={v >= 0 ? { top: upH - h, height: h } : { top: upH + 1, height: h }}>
                  <span className={`block h-full ${v >= 0 ? `rounded-t-[2px] ${on ? 'bg-royal-500' : 'bg-muted/70'}` : `rounded-b-[2px] ${on ? 'bg-loss' : 'bg-loss/45'}`} ${hover === i ? 'opacity-80' : ''}`} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid text-[11px] text-ink/50 text-center mt-1.5 leading-tight" style={cols}>
        {rows.map((r, i) => <span key={r.d} className="overflow-visible whitespace-nowrap">{i % every === 0 ? (by === 'week' || rows.length > 16 ? short(r.d) : <>{WD[new Date(`${r.d}T12:00:00Z`).getUTCDay()]}<br /><b className="text-ink">{Number(r.d.slice(8))}</b></>) : ''}</span>)}
      </div>
    </div>
  )
}

/**
 * A listing's or product's name, shown IN FULL (the owner, 15 Nov 2026: names must never be cut short in a Finance
 * list), opening it in place the way the link chips do everywhere else.
 */
export function NameLink({ kind, id, name, className = '' }) {
  const { openListing, openProduct } = useLinks()
  const open = kind === 'product' ? openProduct : openListing
  if (!name) return null
  if (!id || !open) return <span className={className}>{name}</span>
  return <button type="button" className={`text-left underline decoration-rule underline-offset-2 hover:decoration-royal-500 hover:text-royal-500 ${className}`} title={`Open ${kind === 'product' ? 'product' : 'listing'} ${name}`} onClick={(e) => { e.stopPropagation(); open(id) }}>{name}</button>
}
