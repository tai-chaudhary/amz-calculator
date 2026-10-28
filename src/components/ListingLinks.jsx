import React, { useMemo, useState } from 'react'
import { smartFilter, matches, hay } from '../lib/match'
import { Icon, Modal, Tabs, SearchInput, StatusBadge } from './UI'
import { groupListings, suggestProducts, qtyOf } from '../lib/listingLink'
import { compareNames } from '../lib/productLink'

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const money = (v) => (parseFloat(v) > 0 ? `£${(+v).toFixed(2)}` : '')
const kg = (v) => (parseFloat(v) > 0 ? `${(+v).toFixed(3)}kg` : '')
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const KEY = 'gg.listingLinks.v1'
const loadSkips = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const saveSkips = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* kept for this visit */ } }

/** What linking would fill in on the Product from the listings (only what the Product is missing) */
function fillsFor(si, g) {
  const d = si?.data || {}
  const out = {}
  if (!(parseFloat(d.costPrice) > 0) && g.cost > 0) out.costPrice = String(g.cost)
  if (!(parseFloat(d.weightKg) > 0) && g.weight > 0) out.weightKg = String(g.weight)
  if (!(d.supplierSku || '').trim() && g.sku) out.supplierSku = g.sku
  if (!(d.supplierName || '').trim() && g.supplier) out.supplierName = g.supplier
  if (!(d.brand || '').trim() && g.brand) out.brand = g.brand
  return out
}
const FILL_LABEL = { costPrice: 'cost', weightKg: 'weight', supplierSku: 'supplier SKU', supplierName: 'supplier', brand: 'brand' }

function SizeBadge({ sizes }) {
  if (sizes === 'same') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gain"><Icon name="check" size={12} /> Same size</span>
  if (sizes === 'differ') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-loss"><Icon name="alert" size={12} /> Different size or pack</span>
  return null
}

function ProductCard({ si, onPick, note }) {
  const d = si.data || {}
  const Tag = onPick ? 'button' : 'div'
  return (
    <Tag {...(onPick ? { type: 'button', onClick: onPick } : {})}
      className={`w-full text-left rounded-[8px] border border-rule bg-white px-3 py-2.5 ${onPick ? 'hover:border-royal-300 hover:bg-paper transition-colors' : ''}`}>
      <div className="text-sm font-medium text-ink leading-snug">{si.name}</div>
      <div className="text-[11px] text-ink/50 mt-0.5 flex flex-wrap gap-x-2">
        {d.sku && <span className="font-mono">{d.sku}</span>}
        {d.supplierName && <span>{d.supplierName}</span>}
        {d.supplierSku && <span>Supplier SKU {d.supplierSku}</span>}
        <span>{money(d.costPrice) || 'no cost'}</span>
      </div>
      {note}
    </Tag>
  )
}

function FindProduct({ group, stockItems, onPick, onClose }) {
  const [q, setQ] = useState('')
  const sugg = useMemo(() => suggestProducts(group, stockItems).options.map(o => o.si), [group, stockItems])
  const results = useMemo(() => {
    const w = norm(q).split(' ').filter(Boolean)
    if (!w.length) return sugg
    return smartFilter(stockItems.filter(si => !si.data?.archived), q,
      si => hay(si.name, si.data?.sku, si.data?.supplierName, si.data?.supplierSku, si.data?.supplierProductName)).slice(0, 12)
  }, [q, sugg, stockItems, group.name])
  return (
    <div className="mt-3 rounded-[8px] border border-royal-200 bg-royal-50/30 p-3">
      <div className="flex gap-2">
        <SearchInput className="flex-1" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search Products — name, our SKU, supplier or supplier SKU"
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) onPick(results[0]); if (e.key === 'Escape') onClose() }} />
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="text-[11px] text-ink/45 mt-2">{q ? `${plural(results.length, 'match', 'matches')} · Enter picks the first` : 'Suggested — or type to search every product'}</div>
      <div className="grid gap-2 mt-2 max-h-[300px] overflow-y-auto pr-1">
        {results.map(si => <ProductCard key={si.id} si={si} onPick={() => onPick(si)} />)}
        {!results.length && <div className="text-sm text-ink/55 py-3 text-center">Nothing matches — make it a new Products entry.</div>}
      </div>
    </div>
  )
}

/** A new Products entry from the listings: the product's own name (not the listing title), checked first */
function NewProduct({ group, onCreate, onClose, busy }) {
  const [f, setF] = useState({ name: group.name, supplierName: group.supplier, supplierSku: group.sku || '', costPrice: group.cost ? String(group.cost) : '', weightKg: group.weight ? String(group.weight) : '', brand: group.brand || '' })
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }))
  return (
    <div className="mt-3 rounded-[8px] border border-rule bg-paper/60 p-3">
      <div className="text-xs text-ink/60 mb-2">The product’s own name — no “2 x”, “Pack of”, or listing wording. It gets our SKU when it’s approved.</div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2"><label className="label">Product name</label><input className="input text-sm" value={f.name} onChange={set('name')} autoFocus /></div>
        <div><label className="label">Brand</label><input className="input text-sm" value={f.brand} onChange={set('brand')} /></div>
        <div><label className="label">Supplier</label><input className="input text-sm" value={f.supplierName} onChange={set('supplierName')} /></div>
        <div><label className="label">Supplier SKU</label><input className="input text-sm" value={f.supplierSku} onChange={set('supplierSku')} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Unit cost £</label><input className="input text-sm tabular-nums" type="number" min="0" step="0.0001" value={f.costPrice} onChange={set('costPrice')} /></div>
          <div><label className="label">Weight kg</label><input className="input text-sm tabular-nums" type="number" min="0" step="0.001" value={f.weightKg} onChange={set('weightKg')} /></div>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={busy || !f.name.trim()} onClick={() => onCreate({ ...f, name: f.name.trim() })}>
          <Icon name="plus" size={14} /> Make it and link {plural(group.rows.length, 'listing')}
        </button>
      </div>
    </div>
  )
}

function ListingsBox({ g }) {
  return (
    <div className="mt-2 grid gap-1">
      {g.rows.map(({ row, p, qty }) => (
        <div key={row.id} className="flex items-center gap-2 text-[12px] text-ink/75 min-w-0">
          <span className="shrink-0 w-9 text-center rounded bg-ink/5 text-ink/70 font-semibold tabular-nums">{qty}×</span>
          <span className="truncate" title={row.name}>{row.name}</span>
          {p.asin && <span className="shrink-0 text-ink/40 font-mono text-[11px]">{p.asin}</span>}
        </div>
      ))}
    </div>
  )
}

function GroupCard({ g, stockItems, busy, skipped, onLink, onCreate, onSkip }) {
  const [mode, setMode] = useState(null)   // 'find' | 'new' | part index for mixed
  const [parts, setParts] = useState({})    // mixed: part index → product
  const s = useMemo(() => (g.mixed ? null : suggestProducts(g, stockItems)), [g, stockItems])
  const best = s?.options[0]
  const risky = best && !best.bySku && best.sizes === 'differ'
  const fills = best ? fillsFor(best.si, g) : {}
  const costNote = best && g.cost > 0 && parseFloat(best.si.data?.costPrice) > 0 && Math.abs(parseFloat(best.si.data.costPrice) - g.cost) > 0.005
    ? `Listings use ${money(g.cost)} a unit, the Product says ${money(best.si.data.costPrice)} — the Product’s cost will be used` : ''

  return (
    <div className="card p-0 overflow-hidden">
      <div className="grid md:grid-cols-2">
        <div className="p-3.5">
          <div className="text-[10px] uppercase tracking-wide text-ink/40 font-semibold">{g.mixed ? 'Mixed bundle' : plural(g.rows.length, 'listing')}</div>
          <div className="text-sm font-semibold text-ink leading-snug mt-1">{g.name}</div>
          <div className="text-[11px] text-ink/50 mt-0.5 flex flex-wrap gap-x-2">
            {g.supplier && <span>{g.supplier}</span>}{g.sku && !g.mixed && <span>Supplier SKU {g.sku}</span>}
            {g.cost > 0 && <span>{money(g.cost)} a unit</span>}{g.weight > 0 && <span>{kg(g.weight)}</span>}
          </div>
          {(g.costs?.length > 1 || g.weights?.length > 1) && (
            <div className="text-[11px] text-warn mt-1">
              The listings don’t agree: {g.costs.length > 1 && <>costs {g.costs.map(money).join(', ')}</>}{g.costs.length > 1 && g.weights.length > 1 && ' · '}{g.weights.length > 1 && <>weights {g.weights.map(kg).join(', ')}</>}
            </div>
          )}
          <ListingsBox g={g} />
        </div>
        <div className="p-3.5 border-t md:border-t-0 md:border-l border-rule bg-paper/40">
          <div className="text-[10px] uppercase tracking-wide text-ink/40 font-semibold flex items-center gap-2">
            Product {s?.confident && <StatusBadge tone="live">{best?.bySku ? 'Same supplier SKU' : 'Clear match'}</StatusBadge>}
          </div>
          {g.mixed ? (
            <div className="grid gap-2 mt-1.5">
              {g.parts.map((part, i) => {
                const sp = suggestProducts({ ...g, sku: part.sku, name: part.sku }, stockItems)
                const chosen = parts[i] || (sp.confident ? sp.options[0].si : null)
                return (
                  <div key={i}>
                    <div className="text-[11px] text-ink/55 mb-1">Part {i + 1}: supplier SKU <span className="font-mono">{part.sku}</span></div>
                    {chosen ? <ProductCard si={chosen} note={<button className="text-[11px] text-royal-600 mt-1" onClick={() => setMode(i)}>Change</button>} />
                      : <button className="btn btn-secondary btn-sm" onClick={() => setMode(i)}><Icon name="search" size={14} /> Choose the product</button>}
                    {mode === i && <FindProduct group={{ ...g, name: g.name, sku: part.sku }} stockItems={stockItems} onClose={() => setMode(null)} onPick={(si) => { setParts(x => ({ ...x, [i]: si })); setMode(null) }} />}
                  </div>
                )
              })}
            </div>
          ) : best ? (
            <div className="mt-1.5">
              <ProductCard si={best.si} note={
                <div className="mt-1 space-y-0.5">
                  {!best.bySku && <SizeBadge sizes={best.sizes} />}
                  {Object.keys(fills).length > 0 && <div className="text-[11px] text-royal-700">Fills in its {Object.keys(fills).map(k => FILL_LABEL[k]).join(', ')} from the listings</div>}
                  {costNote && <div className="text-[11px] text-warn">{costNote}</div>}
                </div>
              } />
            </div>
          ) : <div className="text-sm text-ink/55 mt-1.5">No likely Product — search, or make a new one.</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-t border-rule bg-white">
        {g.mixed ? (() => {
          const chosen = g.parts.map((part, i) => parts[i] || (() => { const sp = suggestProducts({ ...g, sku: part.sku, name: part.sku }, stockItems); return sp.confident ? sp.options[0].si : null })())
          return (
            <button className="btn btn-primary btn-sm" disabled={busy || chosen.some(x => !x)} onClick={() => onLink(chosen.map((si, i) => ({ si, qty: g.parts[i].qty })), {})}>
              <Icon name="check" size={14} /> Link the bundle
            </button>
          )
        })() : (
          <>
            {best && !risky && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onLink([{ si: best.si }], fills)}>
                <Icon name="check" size={14} /> Link {plural(g.rows.length, 'listing')}
              </button>
            )}
            <button className={`btn btn-sm ${best && !risky ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => setMode(m => (m === 'find' ? null : 'find'))}>
              <Icon name="search" size={14} /> {best ? 'Choose another' : 'Search Products'}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setMode(m => (m === 'new' ? null : 'new'))}>
              <Icon name="plus" size={14} /> New Products entry
            </button>
            {risky && <button className="btn btn-ghost btn-sm text-loss" disabled={busy} onClick={() => onLink([{ si: best.si }], fills)}>Link anyway</button>}
          </>
        )}
        <button className="btn btn-ghost btn-sm ml-auto" disabled={busy} onClick={onSkip}>{skipped ? 'Back to the list' : 'Skip for now'}</button>
      </div>
      {mode === 'find' && <div className="px-3.5 pb-3.5"><FindProduct group={g} stockItems={stockItems} onClose={() => setMode(null)} onPick={(si) => { setMode(null); onLink([{ si }], fillsFor(si, g)) }} /></div>}
      {mode === 'new' && <div className="px-3.5 pb-3.5"><NewProduct group={g} busy={busy} onClose={() => setMode(null)} onCreate={async (item) => { await onCreate(item); setMode(null) }} /></div>}
    </div>
  )
}

/**
 * Link listings to their Products, at your own pace: every link saves straight away (Undo in the toast or the
 * Linked tab), skips are remembered, and a Product's missing cost, weight or supplier SKU is filled in from
 * its listings. Existing Products first — a new one only when there's nothing to link to.
 */
export default function ListingLinks({ savedProducts, stockItems, showToast, onLinkListings, onUnlinkListings, onAddStockItem, onPatchStockItem, onClose }) {
  const [tab, setTab] = useState('todo')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [skips, setSkips] = useState(loadSkips)
  const [limit, setLimit] = useState(20)
  const [reviewing, setReviewing] = useState(null)

  const groups = useMemo(() => groupListings(savedProducts), [savedProducts])
  const todo = groups.filter(g => !skips[g.key])
  const clear = todo.filter(g => !g.mixed && suggestProducts(g, stockItems).confident)
  const skipped = groups.filter(g => skips[g.key])
  const linked = useMemo(() => savedProducts.filter(r => r.data?.productLinkedAt && !r.data?.archived)
    .sort((a, b) => String(b.data.productLinkedAt).localeCompare(String(a.data.productLinkedAt))), [savedProducts])
  const totalListings = savedProducts.filter(r => !r.data?.archived).length
  const done = totalListings - groups.reduce((n, g) => n + g.rows.length, 0)
  const pct = totalListings ? Math.round((100 * done) / totalListings) : 100
  const skip = (g, on) => setSkips(m => { const n = { ...m }; if (on) n[g.key] = true; else delete n[g.key]; saveSkips(n); return n })
  const match = (text) => matches(text, q)

  const link = async (g, comps, fills) => {
    setBusy(true)
    try {
      for (const { si } of comps) {
        const f = comps.length === 1 ? fills : {}
        if (Object.keys(f).length) await onPatchStockItem(si, f)
      }
      const rows = g.rows.map(r => r.row)
      const components = (row) => comps.map(({ si, qty }) => ({ stockItemId: si.id, qty: qty || qtyOf({ ...(row.data || {}), name: row.data?.name || row.name }) }))
      await onLinkListings(rows, components)
      skip(g, false)
      showToast?.(`${plural(rows.length, 'listing')} linked to ${comps.map(c => c.si.name).join(' + ')}`, 'success', { label: 'Undo', run: () => onUnlinkListings(rows) })
    } catch (e) { showToast?.(e?.message || 'That didn’t save', 'error') } finally { setBusy(false) }
  }
  const create = async (g, item) => {
    setBusy(true)
    try {
      const si = await onAddStockItem(item)
      if (!si) return
      setBusy(false)
      await link(g, [{ si }], {})
    } finally { setBusy(false) }
  }

  const list = (tab === 'todo' ? todo : tab === 'clear' ? clear : tab === 'skipped' ? skipped : [])
    .filter(g => !q || match(`${g.name} ${g.sku} ${g.supplier} ${g.rows.map(r => r.row.name).join(' ')}`))
  const shownLinked = tab === 'linked' ? linked.filter(r => !q || match(r.name)) : []

  return (
    <Modal title="Link listings to Products" description="Every link saves straight away — stop whenever you like. Undo any from the toast or the Linked tab." onClose={onClose} maxWidth="max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-ink/65 max-w-2xl">
          Each listing sells a Product (1×, 2×, 4× of it). Listings of the same product are grouped and linked together, to the Product you
          already have — so its cost and weight drive every listing. A new Products entry only when there’s nothing to link to.
        </p>
        <div className="min-w-[220px]">
          <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink tabular-nums">{done} of {totalListings}</span><span className="text-ink/50">{pct}% of listings linked</span></div>
          <div className="h-2 rounded-full bg-ink/10 overflow-hidden mt-1.5"><div className="h-full bg-gain transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
      <Tabs className="mt-4 mb-3" value={tab} onChange={(t) => { setTab(t); setLimit(20) }} items={[
        { id: 'todo', label: 'To link', count: todo.length },
        { id: 'clear', label: 'Clear matches', count: clear.length },
        { id: 'skipped', label: 'Skipped', count: skipped.length || null },
        { id: 'linked', label: 'Linked here', count: linked.length || null },
      ]} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput className="flex-1 min-w-[220px] max-w-md" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter — product, listing, supplier SKU" />
        {tab === 'clear' && clear.length > 0 && (
          <button className="btn btn-primary btn-sm w-full sm:w-auto justify-center" onClick={() => setReviewing(new Set(clear.map(g => g.key)))}>
            <Icon name="check" size={14} /> Review and link all {clear.length}
          </button>
        )}
      </div>

      {reviewing && (
        <div className="card mb-3 border-royal-200">
          <div className="title-case text-sm font-semibold text-ink">Link {plural(reviewing.size, 'group')}? Untick any that aren’t right.</div>
          <div className="max-h-[45vh] overflow-y-auto mt-2 border border-rule rounded-[8px] divide-y divide-rule/70">
            {clear.map(g => {
              const si = suggestProducts(g, stockItems).options[0].si
              const on = reviewing.has(g.key)
              return (
                <label key={g.key} className={`grid grid-cols-[auto_1fr_1fr] gap-3 px-3 py-2 text-sm cursor-pointer ${on ? '' : 'opacity-50'}`}>
                  <input type="checkbox" className="mt-1" checked={on} onChange={e => setReviewing(t => { const n = new Set(t); e.target.checked ? n.add(g.key) : n.delete(g.key); return n })} />
                  <span className="min-w-0"><span className="text-ink">{g.name}</span><span className="block text-[11px] text-ink/45">{plural(g.rows.length, 'listing')}{g.sku ? ` · ${g.sku}` : ''}</span></span>
                  <span className="min-w-0 text-ink/75">{si.name}<span className="block text-[11px] text-ink/45">{[si.data?.sku, si.data?.supplierName].filter(Boolean).join(' · ')}</span></span>
                </label>
              )
            })}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn btn-secondary btn-sm" onClick={() => setReviewing(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !reviewing.size} onClick={async () => {
              const chosen = clear.filter(g => reviewing.has(g.key)); setReviewing(null)
              for (const g of chosen) { const si = suggestProducts(g, stockItems).options[0].si; await link(g, [{ si }], fillsFor(si, g)) }
            }}>{busy ? 'Linking…' : `Link ${reviewing.size}`}</button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {list.slice(0, limit).map(g => (
          <GroupCard key={g.key} g={g} stockItems={stockItems} busy={busy} skipped={!!skips[g.key]}
            onLink={(comps, fills) => link(g, comps, fills)} onCreate={(item) => create(g, item)} onSkip={() => skip(g, !skips[g.key])} />
        ))}
        {shownLinked.slice(0, limit).map(r => {
          const names = (r.data.components || []).map(c => stockItems.find(si => si.id === c.stockItemId)?.name).filter(Boolean)
          return (
            <div key={r.id} className="card py-2.5 flex items-center gap-3 flex-wrap">
              <Icon name="check" size={16} className="text-gain shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{r.name}</div>
                <div className="text-[11px] text-ink/50">→ {names.join(' + ') || 'a Product'}{r.data.productLinkedByName ? ` · ${r.data.productLinkedByName}` : ''}</div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onUnlinkListings([r])}>Undo</button>
            </div>
          )
        })}
        {(() => {
          const n = list.length + shownLinked.length
          if (n > limit) return <button className="btn btn-secondary btn-sm justify-self-center" onClick={() => setLimit(l => l + 20)}>Show more ({n - limit} left)</button>
          if (n) return null
          return <div className="py-8 text-center text-sm text-ink/55">{q ? 'Nothing here matches that.' : tab === 'todo'
            ? <span className="inline-flex items-center gap-2 text-gain"><Icon name="check" size={16} /> Every listing is linked to its Product.</span> : 'Nothing here.'}</div>
        })()}
      </div>
    </Modal>
  )
}

