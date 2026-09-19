import React from 'react'

export function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

export function Input({ label, ...props }) {
  return (
    <Field label={label}>
      <input className="input" {...props} />
    </Field>
  )
}

export function Select({ label, children, ...props }) {
  return (
    <Field label={label}>
      <select className="input" {...props}>
        {children}
      </select>
    </Field>
  )
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-ink/70">
      <input type="checkbox" className="w-4 h-4 accent-royal-500 cursor-pointer" {...props} />
      {label}
    </label>
  )
}

export function MetricCard({ label, value, color = 'text-ink' }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color}`}>{value}</div>
    </div>
  )
}

export function WarnBox({ children }) {
  return (
    <div className="bg-warn/5 border border-warn/25 rounded-lg px-3 py-2 text-xs text-warn mt-2">
      ⚠️ {children}
    </div>
  )
}

export function InfoBox({ children }) {
  return (
    <div className="bg-royal-50 border border-royal-200 rounded-lg px-3 py-2 text-xs text-royal-700 mt-2">
      🤖 {children}
    </div>
  )
}

export function EmptyState({ icon, title, sub }) {
  return (
    <div className="text-center py-16 text-ink/45">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-base font-medium text-ink/55 mb-1">{title}</div>
      <div className="text-sm">{sub}</div>
    </div>
  )
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-base">{title}</div>
          <button onClick={onClose} className="text-ink/45 hover:text-ink/70 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ResultRow({ label, value, valueClass = '' }) {
  return (
    <div className="result-row">
      <span className="text-ink/55">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
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

export function SectionHead({ children }) {
  return <div className="section-head">{children}</div>
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
  // stage 0 = manual/EU, 1 = US fallback, 2 = placeholder

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
      <div className={`flex flex-col items-center justify-center text-ink/30 ${className}`}>
        <div className={placeholderSize}>📦</div>
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
