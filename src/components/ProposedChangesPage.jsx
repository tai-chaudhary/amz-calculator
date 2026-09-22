import React, { useState, useMemo } from 'react'
import { calcProduct, fmt, pct } from '../lib/calc'
import { EmptyState, Icon, PageHeader, StatusBadge, SegmentedControl } from './UI'

const KINDS = {
  referral_fee:     { label: 'Referral fees',     icon: 'percent', tone: 'brand' },
  cost:             { label: 'Cost changes',      icon: 'trend',   tone: 'paused' },
  carrier:          { label: 'Shipping',          icon: 'truck',   tone: 'brand' },
  cheaper_supplier: { label: 'Cheaper supplier',  icon: 'truck',   tone: 'live' },
  barcode:          { label: 'Barcodes',          icon: 'package', tone: 'quiet' },
  lifecycle:        { label: 'Discontinued',      icon: 'alert',   tone: 'alert' },
}

export default function ProposedChangesPage({
  proposals, savedProducts, stockItems, settings, onDecide, onScan, onNavigate, embedded = false,
}) {
  const [kind, setKind] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)

  const pending = proposals.filter(p => p.status === 'pending')
  const history = proposals.filter(p => p.status !== 'pending')
  const counts = useMemo(() => {
    const c = {}; pending.forEach(p => { c[p.kind] = (c[p.kind] || 0) + 1 }); return c
  }, [pending])

  const shown = (showHistory ? history : pending).filter(p => kind === 'all' || p.kind === kind)

  // What each change would do to margins, worked out now rather than stored,
  // so it reflects today's prices and costs
  const impact = useMemo(() => {
    const out = {}
    const listingsUsing = (siId) => savedProducts.filter(r =>
      (r.data?.components || []).some(c => c.stockItemId === siId) && !r.data?.archived)
    for (const p of shown) {
      if (p.kind === 'referral_fee' || p.kind === 'carrier') {
        const row = savedProducts.find(r => r.id === p.target_id)
        if (!row) continue
        const before = calcProduct(row.data, settings.carriers, settings.packaging, stockItems)
        const changed = p.kind === 'carrier'
          ? { ...row.data, carrierId: p.payload.toCarrierId, carrierCatId: p.payload.toCatId }
          : { ...row.data, refFee: String(p.payload.to) }
        const after = calcProduct(changed, settings.carriers, settings.packaging, stockItems)
        out[p.id] = { rows: [{ name: row.name, before, after, volume: parseFloat(row.data?.monthlyVolume) || 0 }] }
      } else if (p.kind === 'cost' || p.kind === 'cheaper_supplier') {
        const proposed = stockItems.map(s => s.id === p.target_id
          ? { ...s, data: { ...s.data, costPrice: String(p.payload.to) } } : s)
        const rows = listingsUsing(p.target_id).map(r => ({
          name: r.name, volume: parseFloat(r.data?.monthlyVolume) || 0,
          before: calcProduct(r.data, settings.carriers, settings.packaging, stockItems),
          after: calcProduct(r.data, settings.carriers, settings.packaging, proposed),
        }))
        out[p.id] = { rows }
      }
    }
    return out
  }, [shown, savedProducts, stockItems, settings])

  const toggle = (id) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const allShownSelected = shown.length > 0 && shown.every(p => selected.has(p.id))
  const selectAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map(p => p.id)))

  const decide = async (ids, status) => {
    if (!ids.length) return
    if (ids.length > 1 && !window.confirm(`${status === 'approved' ? 'Approve' : 'Reject'} ${ids.length} changes?`)) return
    setBusy(true)
    await onDecide(proposals.filter(p => ids.includes(p.id)), status)
    setSelected(new Set())
    setBusy(false)
  }

  const scan = async () => { setScanning(true); await onScan(); setScanning(false) }

  return (
    <div>
      {embedded ? (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <p className="text-sm text-ink/55">Changes the portal wants to make to existing products. Nothing is applied until you approve it.</p>
          <button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning}>
            <Icon name="search" size={14} /> {scanning ? 'Checking…' : 'Check for changes'}
          </button>
        </div>
      ) : (
        <PageHeader
          eyebrow="Operations / approvals"
          title="Proposed changes"
          description="Anything the portal wants to change on an existing product waits here for you. Nothing is applied until it's approved."
          meta={`${pending.length} waiting`}
          actions={
            <button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning}>
              <Icon name="search" size={14} /> {scanning ? 'Checking…' : 'Check for changes'}
            </button>
          }
        />
      )}

      <SegmentedControl className="mb-4" label="Type of change" value={kind}
        onChange={(k) => { setKind(k); setSelected(new Set()) }}
        items={[{ id: 'all', label: 'All', count: pending.length },
                ...Object.entries(KINDS).map(([k, v]) => ({ id: k, label: v.label, count: counts[k] || 0 }))]} />

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-royal-500"
            checked={showHistory} onChange={e => { setShowHistory(e.target.checked); setSelected(new Set()) }} />
          Show decided changes
        </label>
        {!showHistory && shown.length > 0 && (
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={selectAll}>
              {allShownSelected ? 'Clear selection' : `Select all ${shown.length}`}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy || !selected.size}
              onClick={() => decide([...selected], 'rejected')}>
              Reject {selected.size || ''}
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy || !selected.size}
              onClick={() => decide([...selected], 'approved')}>
              <Icon name="check" size={14} /> Approve {selected.size || ''}
            </button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="check"
          title={showHistory ? 'No decided changes yet' : 'Nothing waiting'}
          sub={showHistory ? 'Approved and rejected changes appear here.' : 'New price lists and checks will raise changes here for you to review.'} />
      ) : (
        <div className="space-y-2">
          {shown.map(p => (
            <ProposalRow key={p.id} p={p} impact={impact[p.id]}
              selected={selected.has(p.id)} onToggle={() => toggle(p.id)}
              readOnly={showHistory} busy={busy}
              onApprove={() => decide([p.id], 'approved')}
              onReject={() => decide([p.id], 'rejected')}
              onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProposalRow({ p, impact, selected, onToggle, readOnly, busy, onApprove, onReject, onNavigate }) {
  const [open, setOpen] = useState(false)
  const k = KINDS[p.kind] || { label: p.kind, tone: 'quiet' }
  const pl = p.payload || {}
  const target = pl.listing || pl.stockItem || 'Product'

  let change = null
  if (p.kind === 'referral_fee') change = <>{pl.from}% <Arrow /> <b>{pl.to}%</b></>
  if (p.kind === 'cost') change = <>{fmt(pl.from)} <Arrow /> <b>{fmt(pl.to)}</b></>
  if (p.kind === 'carrier') change = <>{pl.from} {fmt(pl.fromRate)} <Arrow /> <b>{pl.to} {fmt(pl.toRate)}</b></>
  if (p.kind === 'cheaper_supplier') change = <>{pl.fromSupplier || 'current'} {fmt(pl.from)} <Arrow /> <b>{pl.toSupplier} {fmt(pl.to)}</b></>
  if (p.kind === 'barcode') change = <>Add barcode <b>{pl.to}</b></>
  if (p.kind === 'lifecycle') change = <b>{(pl.status || '').toLowerCase()}</b>

  // Margin summary
  let summary = null
  const rows = impact?.rows || []
  // Money matters more than percentages: where a listing has a monthly
  // volume, show what the change is worth per month
  const withVolume = rows.filter(r => r.volume > 0)
  const monthly = withVolume.reduce((s, r) => s + (r.after.netProfit - r.before.netProfit) * r.volume, 0)
  if (rows.length) {
    const deltas = rows.map(r => r.after.margin - r.before.margin)
    const worst = Math.min(...deltas)
    const lossNow = rows.filter(r => r.before.netProfit >= 0 && r.after.netProfit < 0).length
    summary = rows.length === 1
      ? <>margin {pct(rows[0].before.margin)} <Arrow /> <span className={deltas[0] < 0 ? 'text-loss' : 'text-gain'}>{pct(rows[0].after.margin)}</span></>
      : <>{rows.length} listings · worst <span className={worst < 0 ? 'text-loss' : 'text-gain'}>{worst > 0 ? '+' : ''}{worst.toFixed(2)}%</span>
          {lossNow > 0 && <span className="text-loss font-semibold"> · {lossNow} would lose money</span>}</>
  }

  const targetPage = p.target_type === 'saved_product' ? 'live' : 'stock'

  return (
    <div className={`card py-3 px-4 ${pl.checkFirst ? 'border-warn/40' : ''}`}>
      <div className="flex items-start gap-3">
        {!readOnly && (
          <input type="checkbox" className="w-4 h-4 mt-1 accent-royal-500 flex-shrink-0"
            checked={selected} onChange={onToggle} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge tone={k.tone}>{k.label}</StatusBadge>
            <button className="text-sm font-semibold text-ink hover:text-royal-600 truncate max-w-[420px] text-left"
              onClick={() => onNavigate?.(targetPage, p.target_id)}>{target}</button>
            {pl.checkFirst && <StatusBadge tone="alert">Check before switching</StatusBadge>}
            {readOnly && (
              <StatusBadge tone={p.status === 'approved' ? 'live' : 'quiet'}>
                {p.status === 'approved' ? 'Approved' : 'Rejected'}{p.decided_by ? ` by ${p.decided_by}` : ''}
              </StatusBadge>
            )}
          </div>
          <div className="text-sm text-ink/80 mt-1 flex items-center gap-1.5 flex-wrap">{change}</div>
          <div className="text-[13px] text-ink/50 mt-0.5">{p.reason}</div>
          {withVolume.length > 0 && Math.abs(monthly) >= 0.01 && (
            <div className={`text-sm font-semibold mt-1 ${monthly < 0 ? 'text-loss' : 'text-gain'}`}>
              {monthly < 0 ? '−' : '+'}{fmt(Math.abs(monthly))} a month
              <span className="text-xs font-normal text-ink/50"> at your monthly volumes{withVolume.length < rows.length ? ` (${withVolume.length} of ${rows.length} listings have one)` : ''}</span>
            </div>
          )}
          {summary && (
            <button className="text-[13px] text-ink/70 mt-1 hover:text-royal-600 text-left" onClick={() => setOpen(o => !o)}>
              {summary} {rows.length > 1 && <span className="text-royal-500">{open ? '· hide' : '· show'}</span>}
            </button>
          )}
          {open && rows.length > 1 && (
            <div className="mt-2 border border-rule rounded-lg overflow-hidden">
              {rows.map((r, i) => (
                <div key={i} className="flex justify-between gap-3 px-3 py-1.5 text-[13px] border-b border-rule/60 last:border-0">
                  <span className="text-ink/70 truncate">{r.name}</span>
                  <span className="flex-shrink-0">
                    {pct(r.before.margin)} <Arrow />{' '}
                    <span className={r.after.margin < r.before.margin ? 'text-loss' : 'text-gain'}>{pct(r.after.margin)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {readOnly && p.decided_at && (
            <div className="text-xs text-ink/40 mt-1">{new Date(p.decided_at).toLocaleString('en-GB')}</div>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button className="btn btn-secondary btn-xs" disabled={busy} onClick={onReject}>Reject</button>
            <button className="btn btn-primary btn-xs" disabled={busy} onClick={onApprove}>
              {p.kind === 'lifecycle' ? 'Noted' : p.kind === 'cheaper_supplier' ? 'Switch' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const Arrow = () => <span className="text-ink/35">→</span>
