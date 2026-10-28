import React, { useState } from 'react'
import { Icon, StatusBadge } from './UI'

const when = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * Suppliers read automatically from their websites overnight: where each has
 * got to, how its prices are interpreted, and a way to run it now.
 */
export default function OnlineSuppliers({ suppliers, counts = {}, syncStatus, onSyncNow, onUpdateSupplier }) {
  const synced = suppliers.filter(s => s.data?.sync)
  const blocked = suppliers.filter(s => s.data?.syncBlocked)

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink/60 max-w-3xl">
        These suppliers are read from their websites automatically every night between midnight and 6am — politely,
        one page at a time. Any change to a product you already stock goes to Proposed Changes for your approval.
      </div>

      {synced.map(s => (
        <SupplierSync key={s.id} s={s} count={counts[s.id] || 0}
          state={syncStatus.states.find(x => x.supplier_id === s.id)?.state || {}}
          runs={syncStatus.runs.filter(r => r.supplier_id === s.id)}
          onSyncNow={onSyncNow} onUpdateSupplier={onUpdateSupplier} />
      ))}

      {blocked.map(s => (
        <div key={s.id} className="card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold text-ink">{s.name}</div>
              {s.data?.website && <a className="text-xs text-royal-500 hover:underline" href={s.data.website} target="_blank" rel="noopener noreferrer">{s.data.website.replace(/^https?:\/\//, '')} ↗</a>}
            </div>
            <StatusBadge tone="paused">Can't be read automatically</StatusBadge>
          </div>
          <div className="text-sm text-ink/60 mt-2">{s.data.syncBlocked}</div>
          <div className="text-[13px] text-ink/50 mt-1">
            If they send one, import it on the "Import a price list" tab and it's treated like your other list suppliers.
          </div>
        </div>
      ))}
    </div>
  )
}

export function SupplierSync({ s, count, state, runs, onSyncNow, onUpdateSupplier }) {
  const [busy, setBusy] = useState(false)
  const cfg = s.data.sync
  const last = runs.find(r => r.status === 'done')
  const lastError = runs[0]?.status === 'error' ? runs[0] : null
  const inProgress = !!state.cycle
  const chunk = state.lastChunk || {}
  const watched = last?.stats?.watched || chunk.watched

  const setVat = (v) => onUpdateSupplier(s.id, { ...s.data, sync: { ...cfg, pricesIncludeVat: v } })

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-ink">{s.name}</div>
          <a className="text-xs text-royal-500 hover:underline" href={cfg.base} target="_blank" rel="noopener noreferrer">{cfg.base.replace(/^https?:\/\//, '')} ↗</a>
        </div>
        <div className="flex items-center gap-2">
          {lastError && <StatusBadge tone="alert">Last run failed</StatusBadge>}
          {inProgress && !lastError && <StatusBadge tone="brand" dot>Reading — page {state.cycle.pos || 0}</StatusBadge>}
          {!inProgress && last && !lastError && <StatusBadge tone="live" dot>Up to date</StatusBadge>}
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={async () => { setBusy(true); await onSyncNow(s.name); setBusy(false) }}>
            <Icon name="download" size={14} /> {busy ? 'Reading…' : 'Sync now'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Fact label="Products on file" value={count.toLocaleString()} />
        <Fact label="Last completed" value={when(last?.finished_at || state.lastDoneAt)} />
        <Fact label="Your products checked"
          value={watched ? `${watched.found} of ${watched.watched}` : '—'}
          tone={watched && watched.missing ? 'text-warn' : ''} />
        <Fact label="Errors last run" value={last?.stats?.errors ?? 0} />
      </div>

      {lastError && (
        <div className="text-[13px] text-loss mt-3">
          {when(lastError.finished_at)}: {lastError.error}. The next scheduled run will try again from where it stopped.
        </div>
      )}
      {(last?.stats?.capped || chunk.capped) && (
        <div className="text-[13px] text-ink/55 mt-3">
          Their store only lets the first 25,000 or so products be read in bulk. The products you stock from them are
          looked up individually each night, so those are always covered.
        </div>
      )}
      {watched?.missing > 0 && (
        <div className="text-[13px] text-warn mt-2">
          {watched.missing} of your products from {s.name} couldn't be found on their site — check the supplier code on those products.
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-rule flex items-center gap-6 flex-wrap text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={!!cfg.pricesIncludeVat}
            onChange={e => setVat(e.target.checked)} />
          Website prices include VAT
        </label>
        <span className="text-[13px] text-ink/50">
          Case prices ("Case of 12") are divided down to a per-item cost automatically.
        </span>
      </div>
    </div>
  )
}

function Fact({ label, value, tone = '' }) {
  return (
    <div className="metric-card py-2">
      <div className="metric-label">{label}</div>
      <div className={`text-sm font-semibold ${tone || 'text-ink'}`}>{value}</div>
    </div>
  )
}
