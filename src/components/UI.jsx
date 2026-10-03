import React from 'react'
import { Icon, ICON_NAMES } from './Icons'

export { Icon }

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="text-xs text-ink/50 mt-1.5 leading-relaxed">{hint}</div>}
    </div>
  )
}

export function Input({ label, hint, id, ...props }) {
  const auto = React.useId()
  const fieldId = id || auto
  return (
    <Field label={label} hint={hint} htmlFor={fieldId}>
      <input id={fieldId} className="input" {...props} />
    </Field>
  )
}

export function Select({ label, hint, children, id, ...props }) {
  const auto = React.useId()
  const fieldId = id || auto
  return (
    <Field label={label} hint={hint} htmlFor={fieldId}>
      <select id={fieldId} className="input" {...props}>{children}</select>
    </Field>
  )
}

/**
 * Section tabs: switch between views of the same thing (Approvals: New
 * listings / Changes). Arrow keys move between them.
 */
export function Tabs({ items, value, onChange, className = 'mb-5' }) {
  const onKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]
    onChange?.(next.id)
    e.currentTarget.parentElement?.querySelectorAll('[role=tab]')[items.indexOf(next)]?.focus()
  }
  return (
    <div className={`tab-row ${className}`} role="tablist">
      {items.map((t, i) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          className={`tab ${value === t.id ? 'tab-active' : ''}`}
          onClick={() => onChange?.(t.id)} onKeyDown={e => onKey(e, i)}>
          {t.label}
          {t.count !== undefined && t.count !== null && (
            <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded ${value === t.id ? 'bg-royal-50 text-royal-600' : 'bg-ink/5 text-ink/50'}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Segmented control: narrow what's shown (Ready / Needs confirming / No match).
 * Different from tabs — it filters one list rather than switching views.
 */
export function SegmentedControl({ items, value, onChange, label, className = '' }) {
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      {items.map(t => (
        <button key={t.id} role="radio" aria-checked={value === t.id}
          className={`segment ${value === t.id ? 'segment-active' : ''}`} onClick={() => onChange?.(t.id)}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="ml-1.5 opacity-60">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// Close on Escape, keep focus inside while open, and give it back afterwards
function useDialog(onClose) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const previous = document.activeElement
    const el = ref.current
    const focusables = () => [...(el?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])]
      .filter(x => !x.disabled)
    ;(focusables()[1] || focusables()[0])?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
      if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink/65 select-none">
      <input type="checkbox" className="w-4 h-4 accent-royal-500 cursor-pointer" {...props} />
      <span>{label}</span>
    </label>
  )
}

export function PageHeader({ eyebrow, title, description, meta, actions, children, className = '' }) {
  return (
    <header className={`page-header ${className}`}>
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div className="min-w-0">
          {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
          {meta && <div className="page-meta">{meta}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function SectionHead({ icon, eyebrow, title, description, action, children }) {
  const resolvedTitle = title || children
  return (
    <div className="section-head">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && (
          <div className="w-8 h-8 rounded-[5px] bg-sky/55 text-royal-600 flex items-center justify-center flex-shrink-0">
            <Icon name={icon} size={16} />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="section-kicker mb-1">{eyebrow}</div>}
          {resolvedTitle && <div className="section-title">{resolvedTitle}</div>}
          {description && <div className="section-description">{description}</div>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function MetricCard({ label, value, color = 'text-ink', sub, onClick, prominent = false }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left ${onClick ? 'hover:border-royal-200 transition-colors cursor-pointer' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`${prominent ? 'figure text-[28px]' : 'metric-value'} ${color}`}>{value}</div>
      {sub && <div className="text-xs text-ink/42 mt-1">{sub}</div>}
    </Tag>
  )
}

export function WarnBox({ children, title = 'Check this' }) {
  return (
    <div className="panel-alert mt-3 flex items-start gap-2.5 text-sm">
      <Icon name="alert" size={16} className="text-coral mt-0.5 flex-shrink-0" />
      <div>
        <div className="text-xs font-semibold text-ink mb-0.5">{title}</div>
        <div className="text-xs text-ink/60 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

export function InfoBox({ children, title = 'Recommended' }) {
  return (
    <div className="surface-sky px-3.5 py-3 mt-3 flex items-start gap-2.5 text-sm">
      <Icon name="sparkles" size={16} className="text-royal-600 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-royal-700 mb-0.5">{title}</div>
        <div className="text-xs text-royal-800 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

export function StatusBadge({ tone = 'quiet', children, dot = false }) {
  const cls = {
    live: 'pill-live',
    success: 'pill-live',
    alert: 'pill-alert',
    brand: 'pill-brand',
    paused: 'pill-paused',
    quiet: 'pill-quiet',
  }[tone] || 'pill-quiet'
  return (
    <span className={`pill ${cls}`}>
      {dot && <span className={`status-dot ${(tone === 'live' || tone === 'success') ? 'bg-gain' : tone === 'alert' ? 'bg-coral' : tone === 'brand' ? 'bg-royal-500' : 'bg-ink/30'}`} />}
      {children}
    </span>
  )
}

export function EmptyState({ icon = 'box', title, sub, action }) {
  const isIconName = typeof icon === 'string' && ICON_NAMES.includes(icon)
  return (
    <div className="text-center py-16 px-6 text-ink/45">
      <div className="w-12 h-12 mx-auto mb-4 rounded-[6px] bg-sky/45 text-royal-600 flex items-center justify-center">
        {isIconName ? <Icon name={icon} size={21} /> : <span className="text-2xl leading-none">{icon}</span>}
      </div>
      <div className="text-base font-semibold text-ink/70 mb-1">{title}</div>
      <div className="text-sm max-w-md mx-auto leading-relaxed">{sub}</div>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function Modal({ title, description, onClose, children, maxWidth = 'max-w-md' }) {
  const ref = useDialog(onClose)
  const titleId = React.useId()
  return (
    <div className="fixed inset-0 bg-ink/35 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`bg-paper border border-rule rounded-[7px] w-full ${maxWidth} shadow-modal overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 bg-white border-b border-rule">
          <div>
            <div id={titleId} className="font-semibold text-base text-ink">{title}</div>
            {description && <div className="text-xs text-ink/55 mt-1">{description}</div>}
          </div>
          <button onClick={onClose} className="icon-btn -mr-1 -mt-1" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Drawer({ title, description, onClose, children, footer, width = 'max-w-xl' }) {
  const ref = useDialog(onClose)
  const titleId = React.useId()
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]" aria-hidden="true" onClick={onClose} />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative h-full w-full ${width} bg-paper border-l border-rule shadow-modal flex flex-col animate-[slideIn_.18s_ease-out]`}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-5 bg-white border-b border-rule">
          <div className="min-w-0">
            <div id={titleId} className="font-semibold text-lg text-ink truncate">{title}</div>
            {description && <div className="text-xs text-ink/55 mt-1">{description}</div>}
          </div>
          <button onClick={onClose} className="icon-btn flex-shrink-0" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 bg-white border-t border-rule">{footer}</div>}
      </aside>
    </div>
  )
}

export function IconButton({ icon, label, className = '', ...props }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label || icon} title={label || icon} {...props}>
      <Icon name={icon} size={16} />
    </button>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '', ...props }) {
  return (
    <div className={`relative ${className}`}>
      <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none" />
      <input className="input pl-9" value={value} onChange={onChange} placeholder={placeholder} {...props} />
    </div>
  )
}

export function ResultRow({ label, value, valueClass = '' }) {
  return (
    <div className="result-row">
      <span className="text-ink/55">{label}</span>
      <span className={`font-medium text-right ${valueClass}`}>{value}</span>
    </div>
  )
}

export function PLRow({ label, value, valueClass = '', bold = false }) {
  return (
    <div className={`pl-row ${bold ? 'font-semibold text-base border-t-2 border-rule pt-3 mt-1 border-b-0' : ''}`}>
      <span className={bold ? '' : 'text-ink/70'}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-royal-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Amazon product image with automatic fallback chain
export function ProductImage({ asin, manualImage, alt = '', className = '', size = 'large', placeholderSize = 'text-4xl' }) {
  const [stage, setStage] = React.useState(0)
  React.useEffect(() => { setStage(0) }, [asin, manualImage])

  const a = asin?.trim()?.toUpperCase()
  const sizeCode = size === 'small' ? '_SCTHUMBZZZ_' : '_SCLZZZZZZZ_'

  let src = null
  if (manualImage) src = manualImage
  else if (a && a.length >= 5) {
    if (stage === 0) src = `https://images-eu.ssl-images-amazon.com/images/P/${a}.02.${sizeCode}.jpg`
    else if (stage === 1) src = `https://images-na.ssl-images-amazon.com/images/P/${a}.01.${sizeCode}.jpg`
  }

  if (!src || stage >= 2) {
    return (
      <div className={`flex flex-col items-center justify-center text-ink/22 ${className}`}>
        <Icon name="package" size={placeholderSize.includes('3xl') ? 26 : placeholderSize.includes('xl') ? 18 : 22} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setStage(s => s + 1)}
      loading="lazy"
    />
  )
}
