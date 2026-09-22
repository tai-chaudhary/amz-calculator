import React, { useEffect, useState } from 'react'
import { EmptyState, SearchInput, SegmentedControl } from './UI'

const TYPES = { all: 'Everything', listing: 'Listings', stock: 'Products', supplier: 'Suppliers', hunt: 'Hunts', settings: 'Cost settings' }

/** The audit trail: who did what, to what, and when. */
export default function ActivityLog({ onLoad }) {
  const [rows, setRows] = useState(null)
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { let live = true; onLoad?.({ limit: 500 }).then(r => live && setRows(r)); return () => { live = false } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows) return <div className="card text-sm text-ink/55 py-8 text-center">Loading activity…</div>
  const q = search.trim().toLowerCase()
  const shown = rows.filter(r => (type === 'all' || r.entity_type === type) &&
    (!q || [r.entity_name, r.user_name, r.action, r.detail].some(v => String(v || '').toLowerCase().includes(q))))

  // Group by day so the trail reads like a diary
  const days = []
  for (const r of shown) {
    const d = new Date(r.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] })
    days[days.length - 1].items.push(r)
  }

  return (
    <div>
      <div className="flex gap-3 flex-wrap items-center mb-4">
        <SegmentedControl label="Show" value={type} onChange={setType}
          items={Object.entries(TYPES).map(([id, label]) => ({ id, label }))} />
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by product, person or action" className="w-full sm:w-72" />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="clock" title={rows.length ? 'Nothing matches' : 'No activity recorded yet'}
          sub={rows.length ? '' : 'Every change made in the portal from now on is recorded here.'} />
      ) : days.map(day => (
        <div key={day.d} className="mb-5">
          <div className="text-xs font-semibold text-ink/55 mb-2">{day.d}</div>
          <div className="card-flush overflow-hidden">
            {day.items.map(r => (
              <div key={r.id} className="px-4 py-2.5 border-b border-rule/60 last:border-0 flex items-start gap-3 text-sm">
                <span className="text-xs text-ink/45 w-12 flex-shrink-0 pt-0.5 tabular-nums">
                  {new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{r.user_name || 'Someone'}</span>
                  <span className="text-ink/70"> — {r.action.toLowerCase()}</span>
                  {r.entity_name && <span className="text-ink"> "{r.entity_name}"</span>}
                  {r.detail && <div className="text-xs text-ink/55 mt-0.5 break-words">{r.detail}</div>}
                  {(r.before?.value !== undefined || r.after?.value !== undefined) && (
                    <div className="text-xs text-ink/55 mt-0.5">{String(r.before?.value ?? '—')} → {String(r.after?.value ?? '—')}</div>
                  )}
                </div>
                <span className="text-xs text-ink/40 flex-shrink-0">{TYPES[r.entity_type] ? TYPES[r.entity_type].replace(/s$/, '') : r.entity_type}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
