import React from 'react'
import { Icon, ProductImage } from './UI'

/**
 * The Returns page's building blocks (v2.111.0, redesigned): the same control-room look as the Profit & Loss page —
 * white tiles with a small capital heading, big tabular figures, colour only where it means something
 * (coral = act now, amber = warning, lime/green = fine, royal = information).
 */

const ACCENT = { red: 'border-t-loss', amber: 'border-t-warn', green: 'border-t-gain', blue: 'border-t-royal-500', ink: 'border-t-ink', none: 'border-t-transparent' }
const FIG = { red: 'text-loss', amber: 'text-warn', green: 'text-gain', blue: 'text-royal-600', ink: 'text-ink', none: 'text-ink' }

/** A figure tile: label, big number, a line under it. Click to filter the list below. */
export function StatTile({ label, value, sub, tone = 'none', active = false, onClick, right }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} data-stat-tile
      className={`text-left bg-white border border-rule border-t-4 ${ACCENT[tone]} rounded-card px-4 py-3.5 flex flex-col min-w-0 transition ${onClick ? 'hover:border-royal-200 hover:shadow-card cursor-pointer' : ''} ${active ? 'ring-2 ring-royal-500/60' : ''}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted">{label}</span>
        {right && <span className="text-[11px] text-ink/45">{right}</span>}
      </span>
      <span className={`text-[28px] leading-tight font-bold tabular-nums mt-1 ${FIG[tone]}`}>{value}</span>
      {sub && <span className="text-[12px] text-ink/60 mt-0.5 leading-snug">{sub}</span>}
    </Tag>
  )
}

/** A band of figure tiles across the top of a tab */
export function StatBand({ children }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">{children}</div>
}

const DOT = { red: 'bg-loss', amber: 'bg-warn', green: 'bg-gain', blue: 'bg-royal-500', grey: 'bg-muted' }
/** The heading strip of a group in a list: a coloured dot, the name, how many, a short hint */
export function GroupHead({ tone = 'grey', title, count, hint, action }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-paper border-b border-rule" data-group-head>
      <span className={`w-2 h-2 rounded-full ${DOT[tone]}`} />
      <span className="text-[11px] uppercase tracking-[0.08em] font-bold text-ink">{title}</span>
      {count != null && <span className="text-[11px] font-semibold text-ink/50 tabular-nums">{count}</span>}
      {hint && <span className="text-[11px] text-ink/45 hidden sm:inline truncate">· {hint}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

const BAR = { red: 'before:bg-loss', amber: 'before:bg-warn', green: 'before:bg-gain', blue: 'before:bg-royal-500', grey: 'before:bg-rule' }
/**
 * One row of a list: a coloured bar down the left (its state), the product picture, the main lines, and a right-hand
 * column for the state and the action. The whole row opens; the action button does its own thing.
 */
export function Row({ tone = 'grey', thumb, title, lines, chips, right, onClick, testid }) {
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} data-row={testid}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick() } }}
      className={`relative flex items-stretch gap-3 pl-5 pr-4 py-3 border-b border-rule last:border-0 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${BAR[tone]} ${onClick ? 'cursor-pointer hover:bg-royal-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-royal-500' : ''}`}>
      {thumb !== undefined && <div className="shrink-0">{thumb}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold text-ink leading-snug">{title}</div>
        {lines && <div className="text-[12.5px] text-ink/60 mt-0.5 leading-snug">{lines}</div>}
        {chips && <div className="flex flex-wrap gap-1.5 mt-1.5">{chips}</div>}
      </div>
      {right && <div className="shrink-0 flex flex-col items-end justify-between gap-1.5 text-right">{right}</div>}
    </div>
  )
}

/** A product's picture in a small white square (Amazon's image by ASIN when known, else a box icon) */
export function Thumb({ asin, size = 52, count }) {
  return (
    <div className="relative bg-white border border-rule rounded-[8px] overflow-hidden flex items-center justify-center" style={{ width: size, height: size }}>
      <ProductImage asin={asin} alt="" size="small" className="object-contain w-full h-full p-1" placeholderSize="text-xl" />
      {count > 1 && <span className="absolute bottom-0 right-0 bg-ink text-white text-[10px] font-bold px-1 rounded-tl-[4px] tabular-nums">×{count}</span>}
    </div>
  )
}

/** A small neutral chip for facts (order number, carrier, tracking) */
export function Chip({ children, mono = false, icon, tone = 'plain', title }) {
  const t = { plain: 'bg-paper border-rule text-ink/70', blue: 'bg-sky/55 border-royal-200 text-royal-700', red: 'bg-coral/10 border-coral/25 text-loss', amber: 'bg-[#FFF4D6] border-[#F2D58A] text-warn', green: 'bg-lime/25 border-lime/50 text-ink' }[tone]
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium px-1.5 py-0.5 rounded-[4px] border ${t} ${mono ? 'font-mono' : ''}`}>{icon && <Icon name={icon} size={10} />}{children}</span>
}

/** How long it has been against a limit (14 days for a prepaid return): a thin bar that turns amber then red */
export function AgeBar({ days, limit }) {
  const pct = Math.max(4, Math.min(100, (days / limit) * 100))
  const tone = days > limit ? 'bg-loss' : days > limit * 0.7 ? 'bg-warn' : 'bg-royal-500'
  return (
    <div className="w-28" title={`${days} of ${limit} days`}>
      <div className="h-1.5 bg-rule/70 rounded-full overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <div className={`text-[10.5px] mt-0.5 tabular-nums ${days > limit ? 'text-loss font-semibold' : 'text-ink/50'}`}>{days} day{days === 1 ? '' : 's'}{days > limit ? ' — overdue' : ''}</div>
    </div>
  )
}

/** A white section with a small capital heading — the drawers' and forms' building block */
export function Section({ title, right, children, tone, className = '', step }) {
  return (
    <section className={`${tone === 'sky' ? 'bg-sky/40 border-royal-200' : tone === 'coral' ? 'bg-[#FDF3F1] border-coral/30' : 'bg-white border-rule'} border rounded-card px-4 py-3.5 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.08em] font-bold text-ink/70">
            {step != null && <span className="w-5 h-5 rounded-full bg-royal-500 text-white text-[11px] flex items-center justify-center tracking-normal">{step}</span>}{title}
          </span>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** Label / value pairs in a grid */
export function Facts({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {items.filter(x => x && x[1] != null && x[1] !== '').map(([k, v, mono]) => (
        <div key={k} className="min-w-0"><dt className="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-ink/45">{k}</dt><dd className={`text-[13px] text-ink font-medium break-words ${mono ? 'font-mono text-[12px]' : ''}`}>{v}</dd></div>
      ))}
    </dl>
  )
}

/** What happened, newest first, as a line of dots */
export function Timeline({ list = [] }) {
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-').replace(',', '') : '')
  if (!list.length) return <div className="text-sm text-ink/45">Nothing yet.</div>
  return (
    <ol className="relative border-l-2 border-rule ml-1.5 space-y-3">
      {[...list].reverse().map((h, k) => (
        <li key={k} className="ml-4">
          <span className={`absolute -left-[7px] w-3 h-3 rounded-full border-2 border-white ${k === 0 ? 'bg-royal-500' : 'bg-muted'}`} />
          <div className="text-[13px] text-ink leading-snug">{h.what}</div>
          <div className="text-[11px] text-ink/45">{h.by} · {when(h.at)}</div>
        </li>
      ))}
    </ol>
  )
}

/** The warehouse's choice for each item: five big tiles, each with its own colour when chosen */
export const OUTCOME_LOOK = {
  back_in_stock: { icon: 'check', on: 'bg-gain text-white border-gain', label: 'Fine', sub: 'back in stock' },
  disposed: { icon: 'trash', on: 'bg-loss text-white border-loss', label: 'Damaged', sub: 'dispose' },
  faulty: { icon: 'alert', on: 'bg-loss text-white border-loss', label: 'Faulty', sub: 'doesn’t work' },
  wrong_item: { icon: 'swap', on: 'bg-loss text-white border-loss', label: 'Not ours', sub: 'wrong item sent back' },
  empty: { icon: 'box', on: 'bg-loss text-white border-loss', label: 'Empty / short', sub: 'items missing' },
}
export function OutcomePicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5" role="radiogroup" aria-label="What state is it in">
      {Object.entries(OUTCOME_LOOK).map(([k, o]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} data-outcome={k}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-[8px] border px-1 py-2 min-h-[64px] text-center transition ${value === k ? o.on : 'bg-white border-rule text-ink/75 hover:border-royal-300'}`}>
          <Icon name={o.icon} size={16} />
          <span className="text-[12px] font-bold leading-tight">{o.label}</span>
          <span className={`text-[9.5px] leading-tight ${value === k ? 'text-white/85' : 'text-ink/45'}`}>{o.sub}</span>
        </button>
      ))}
    </div>
  )
}
