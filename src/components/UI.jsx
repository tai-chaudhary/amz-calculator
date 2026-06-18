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
    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
      <input type="checkbox" className="w-4 h-4 accent-indigo-500 cursor-pointer" {...props} />
      {label}
    </label>
  )
}

export function MetricCard({ label, value, color = 'text-slate-800' }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color}`}>{value}</div>
    </div>
  )
}

export function WarnBox({ children }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 mt-2">
      ⚠️ {children}
    </div>
  )
}

export function InfoBox({ children }) {
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700 mt-2">
      🤖 {children}
    </div>
  )
}

export function EmptyState({ icon, title, sub }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-base font-medium text-slate-500 mb-1">{title}</div>
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ResultRow({ label, value, valueClass = '' }) {
  return (
    <div className="result-row">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

export function PLRow({ label, value, valueClass = '', bold = false }) {
  return (
    <div className={`pl-row ${bold ? 'font-semibold text-base border-t-2 border-slate-200 pt-3 mt-1 border-b-0' : ''}`}>
      <span className={bold ? '' : 'text-slate-600'}>{label}</span>
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
      <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
