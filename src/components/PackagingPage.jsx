import React, { useState, useMemo } from 'react'
import { calcProduct, fmt, pct } from '../lib/calc'
import { PageHeader, Icon, StatusBadge, SearchInput, EmptyState, Drawer, Modal } from './UI'
import { ProductLink } from './Links'

const NONE = '__none__'

/**
 * Which packaging each listing uses, and changing it for many at once.
 *
 * Packaging is a property of a listing, not a product: the same product can be
 * sent in different packaging depending on how it's bundled. So this groups
 * listings by their packaging and shows the products behind each one.
 */
export default function PackagingPage({
  savedProducts, liveProducts, stockItems, settings, me, onNavigate, onBulkPackaging,
}) {
  const [openType, setOpenType] = useState(null)
  const [search, setSearch] = useState('')

  const packaging = settings?.packaging || []
  const isLive = (id) => liveProducts.some(lp => lp.saved_product_id === id && lp.status === 'live')

  // Every listing, with what it costs and what it's made of
  const listings = useMemo(() => savedProducts
    .filter(r => !r.data?.archived)
    .map(r => {
      const p = r.data || {}
      const calc = calcProduct(p, settings?.carriers, packaging, stockItems)
      return {
        id: r.id, name: r.name, p, calc,
        live: isLive(r.id),
        packagingId: p.packagingId || NONE,
        products: (p.components || []).map(c => ({
          qty: parseInt(c.qty) || 0,
          si: stockItems.find(s => s.id === c.stockItemId),
        })).filter(x => x.si),
      }
    }), [savedProducts, liveProducts, stockItems, settings, packaging])

  const groups = useMemo(() => {
    const rows = packaging.map(pk => ({
      id: pk.id, name: pk.name, cost: parseFloat(pk.cost) || 0, weightKg: parseFloat(pk.weightKg) || 0,
      items: listings.filter(l => l.packagingId === pk.id),
    }))
    const unset = listings.filter(l => l.packagingId === NONE)
    if (unset.length) rows.push({ id: NONE, name: 'No packaging set', cost: 0, weightKg: 0, items: unset, missing: true })
    return rows.sort((a, b) => (b.missing ? 1 : 0) - (a.missing ? 1 : 0) || b.items.length - a.items.length)
  }, [packaging, listings])

  const q = search.trim().toLowerCase()
  const shown = q
    ? groups.map(g => ({ ...g, items: g.items.filter(l => l.name.toLowerCase().includes(q) ||
        l.products.some(x => x.si.name.toLowerCase().includes(q))) })).filter(g => g.items.length)
    : groups
  const chosen = openType ? groups.find(g => g.id === openType) : null

  return (
    <div>
      <PageHeader
        eyebrow="Optimise / packaging"
        title="Packaging"
        description="Which packaging each listing ships in, what it costs, and changing it for many listings at once."
        meta={`${packaging.length} type${packaging.length !== 1 ? 's' : ''} · ${listings.length} listings`}
      />

      <div className="flex justify-between gap-3 flex-wrap mb-4">
        <SearchInput value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Listing or product name" className="w-full sm:w-80" />
        <div className="text-xs text-ink/50 self-center">Click a packaging type to see and change what uses it.</div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="box" title="Nothing matches that" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map(g => {
            const live = g.items.filter(l => l.live).length
            const monthly = g.items.reduce((s, l) => s + g.cost * (parseInt(l.p.monthlyVolume) || 0), 0)
            return (
              <button key={g.id} className={`surface px-5 py-4 text-left hover:border-royal-300 transition-colors ${g.missing ? 'border-warn/50' : ''}`}
                onClick={() => setOpenType(g.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink flex items-center gap-2 flex-wrap">
                      <Icon name="box" size={15} className="text-royal-500" />{g.name}
                      {g.missing && <StatusBadge tone="alert">Needs setting</StatusBadge>}
                    </div>
                    <div className="text-xs text-ink/55 mt-1">
                      {g.missing ? 'These listings ship with no packaging cost counted'
                        : `${fmt(g.cost)} each · ${g.weightKg.toFixed(3)}kg added to the parcel`}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xl font-semibold text-ink">{g.items.length}</div>
                    <div className="text-xs text-ink/50">{live} live</div>
                  </div>
                </div>
                {monthly > 0 && (
                  <div className="text-xs text-ink/45 mt-2">About {fmt(monthly)} a month at current volumes</div>
                )}
                <div className="text-xs text-ink/55 mt-2 truncate">
                  {g.items.slice(0, 3).map(l => l.name).join(' · ')}{g.items.length > 3 ? ` and ${g.items.length - 3} more` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {chosen && (
        <PackagingDrawer group={chosen} packaging={packaging} settings={settings} stockItems={stockItems}
          onClose={() => setOpenType(null)} onNavigate={onNavigate} onBulkPackaging={onBulkPackaging} />
      )}
    </div>
  )
}

/** What uses this packaging, and moving some of it to another type. */
function PackagingDrawer({ group, packaging, settings, stockItems, onClose, onNavigate, onBulkPackaging }) {
  const [picked, setPicked] = useState(new Set())
  const [moving, setMoving] = useState(false)
  const allPicked = picked.size === group.items.length && group.items.length > 0
  const toggle = (id) => setPicked(s => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <Drawer title={group.name} width="max-w-3xl"
      description={group.missing
        ? `${group.items.length} listings with no packaging set`
        : `${fmt(group.cost)} each · ${group.weightKg.toFixed(3)}kg · used by ${group.items.length} listing${group.items.length !== 1 ? 's' : ''}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(group.items.map(l => l.id)))} />
            {picked.size ? `${picked.size} selected` : 'Select all'}
          </label>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm" disabled={picked.size === 0} onClick={() => setMoving(true)}>
              <Icon name="edit" size={14} /> Change packaging
            </button>
          </div>
        </div>
      }>

      <div className="card-flush overflow-hidden">
        {group.items.map(l => (
          <label key={l.id} className="flex items-start gap-3 px-4 py-3 border-b border-rule/60 last:border-0 cursor-pointer hover:bg-royal-50/40">
            <input type="checkbox" className="w-4 h-4 accent-royal-500 mt-1" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">{l.name}</span>
                {l.live ? <StatusBadge tone="live">Live</StatusBadge> : <StatusBadge tone="quiet">Saved</StatusBadge>}
              </div>
              <div className="flex gap-1.5 flex-wrap mt-1">
                {l.products.map((x, i) => (
                  <span key={i} className="text-xs text-ink/55">{x.qty} × {x.si.name}</span>
                ))}
                {l.products.length === 0 && <span className="text-xs text-ink/45">not built from products</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm text-ink">{l.calc.incomplete ? '—' : pct(l.calc.margin)}</div>
              <div className="text-xs text-ink/45">margin</div>
            </div>
          </label>
        ))}
      </div>

      {moving && (
        <ChangePackaging
          items={group.items.filter(l => picked.has(l.id))}
          from={group} packaging={packaging} settings={settings} stockItems={stockItems}
          onClose={() => setMoving(false)}
          onConfirm={async (toId) => {
            await onBulkPackaging([...picked], toId, group.name)
            setMoving(false); setPicked(new Set()); onClose()
          }} />
      )}
    </Drawer>
  )
}

/** Choosing the new packaging, with what it does to margins before committing. */
function ChangePackaging({ items, from, packaging, settings, stockItems, onClose, onConfirm }) {
  const [toId, setToId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = packaging.filter(p => p.id !== from.id)
  const target = packaging.find(p => p.id === toId)

  // What this does to each listing, worked out before anything is saved
  const effect = useMemo(() => {
    if (!target) return null
    let better = 0, worse = 0, monthly = 0, tipped = 0
    for (const l of items) {
      const after = calcProduct({ ...l.p, packagingId: toId }, settings.carriers, packaging, stockItems)
      if (l.calc.incomplete || after.incomplete) continue
      const diff = after.netProfit - l.calc.netProfit
      if (diff > 0.001) better++
      if (diff < -0.001) worse++
      if (l.calc.netProfit > 0 && after.netProfit <= 0) tipped++
      monthly += diff * (parseInt(l.p.monthlyVolume) || 0)
    }
    return { better, worse, monthly, tipped }
  }, [items, toId, target, settings, packaging, stockItems])

  return (
    <Modal title={`Change packaging on ${items.length} listing${items.length !== 1 ? 's' : ''}`}
      description={`Currently ${from.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="pk-to">Change to</label>
          <select id="pk-to" className="input" value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">Choose packaging…</option>
            {options.map(p => (
              <option key={p.id} value={p.id}>{p.name} — {fmt(parseFloat(p.cost) || 0)}, {(parseFloat(p.weightKg) || 0).toFixed(3)}kg</option>
            ))}
          </select>
        </div>

        {effect && (
          <div className="card">
            <div className="text-sm font-semibold text-ink mb-2">What this changes</div>
            <div className="text-sm text-ink/70 space-y-1">
              <div>{effect.better} better off, {effect.worse} worse off</div>
              {effect.monthly !== 0 && (
                <div className={effect.monthly >= 0 ? 'text-gain' : 'text-loss'}>
                  About {fmt(Math.abs(effect.monthly))} a month {effect.monthly >= 0 ? 'better' : 'worse'} at current volumes
                </div>
              )}
              {effect.tipped > 0 && (
                <div className="text-loss">{effect.tipped} listing{effect.tipped !== 1 ? 's' : ''} would stop making a profit.</div>
              )}
              {items.some(l => l.live) && (
                <div className="text-xs text-ink/55 pt-1">
                  {items.filter(l => l.live).length} of these are live, so this changes margins on listings you're selling now.
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={busy || !toId}
            onClick={async () => {
              setBusy(true); setError('')
              try { await onConfirm(toId) } catch (e) { setError(e?.message || 'Could not change them'); setBusy(false) }
            }}>
            {busy ? 'Changing…' : `Change ${items.length}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
