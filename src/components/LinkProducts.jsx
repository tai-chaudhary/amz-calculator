import React, { useEffect, useMemo, useState } from 'react'
import { smartFilter, matches, hay } from '../lib/match'
import { Icon, Modal, Spinner, Tabs, SearchInput, StatusBadge } from './UI'
import { loadItemStock, invLinkStockItem, invUnlinkStockItem, invPairNewItems, invAddFromStockItem } from '../lib/db'
import { suggestLinks, compareNames, looksLikePackaging } from '../lib/productLink'
import { fmtUnits } from '../lib/inventory'
import SkuField from './SkuField'

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const money = (v) => (parseFloat(v) > 0 ? `£${(+v).toFixed(2)}` : '')
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Skipped and "waiting for Goods In" are remembered on this device, so you can stop anywhere and pick up later.
// Every link itself is saved the moment it's made.
const KEY = 'gg.linkProducts.v1'
const loadMemo = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const saveMemo = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* private mode: kept for this visit */ } }

function SizeBadge({ sizes }) {
  if (sizes === 'same') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gain"><Icon name="check" size={12} /> Same size</span>
  if (sizes === 'differ') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-loss"><Icon name="alert" size={12} /> Different size or pack</span>
  return <span className="text-[11px] text-ink/45">Size not on both — check</span>
}

/** One Products entry, as a choice: what you need to recognise it */
function ItemCard({ si, against, selected = false, onPick = null, compact = false }) {
  const d = si.data || {}
  const cmp = against ? compareNames(against, si.name) : null
  // A choice in a list is a button; the suggestion beside an inventory product is just shown
  const Tag = onPick ? 'button' : 'div'
  return (
    <Tag {...(onPick ? { type: 'button', onClick: onPick } : {})}
      className={`w-full text-left rounded-[8px] border px-3 py-2.5 transition-colors ${selected ? 'border-royal-400 bg-royal-50/60 ring-1 ring-royal-300' : onPick ? 'border-rule bg-white hover:border-royal-300 hover:bg-paper' : 'border-rule bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink leading-snug">{si.name}</div>
          <div className="text-[11px] text-ink/50 mt-0.5 flex flex-wrap gap-x-2">
            {d.supplierName && <span>{d.supplierName}</span>}
            {d.supplierSku && <span>Supplier SKU {d.supplierSku}</span>}
            {money(d.costPrice) && <span>{money(d.costPrice)}</span>}
            {d.sku && <span className="font-mono">{d.sku}</span>}
          </div>
        </div>
        {!compact && cmp && cmp.score >= 0.3 && <div className="shrink-0 text-right"><div className="text-[11px] text-ink/45 tabular-nums">{Math.round(cmp.score * 100)}% alike</div></div>}
      </div>
      {cmp && <div className="mt-1"><SizeBadge sizes={cmp.sizes} /></div>}
    </Tag>
  )
}

/** Search every Products entry not linked yet; suggestions first until you type */
function FindItem({ product, items, suggested, onPick, onClose }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean)
    if (!words.length) return suggested.map(o => o.si)
    return smartFilter(items, q, si => hay(si.name, si.data?.sku, si.data?.supplierName, si.data?.supplierSku, si.data?.supplierProductName, si.data?.brand))
      .slice(0, 12)
  }, [q, items, suggested, product.name])
  return (
    <div className="mt-3 rounded-[8px] border border-royal-200 bg-royal-50/30 p-3">
      <div className="flex items-center gap-2">
        <SearchInput className="flex-1" value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder="Search Products — name, supplier or supplier SKU"
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) onPick(results[0]); if (e.key === 'Escape') onClose() }} />
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="text-[11px] text-ink/45 mt-2">{q ? `${plural(results.length, 'match', 'matches')}${results.length === 12 ? ' (first 12)' : ''} · Enter picks the first` : 'Suggested — or type to search them all'}</div>
      <div className="grid gap-2 mt-2 max-h-[340px] overflow-y-auto pr-1">
        {results.length ? results.map(si => <ItemCard key={si.id} si={si} against={product.name} onPick={() => onPick(si)} />)
          : <div className="text-sm text-ink/55 py-3 text-center">Nothing on Products matches. Make it a new Products entry instead.</div>}
      </div>
    </div>
  )
}

/** An inventory product and its best match, side by side */
function MatchCard({ p, sugg, items, busy, onLink, onCreate, onSkip, skipped }) {
  const [open, setOpen] = useState(false)
  const best = sugg.options[0]
  // A different size or pack is a different product: linking it is never the easy button
  const risky = best && compareNames(p.name, best.si.name).sizes === 'differ'
  return (
    <div className="card p-0 overflow-hidden">
      <div className="grid md:grid-cols-[1fr_auto_1fr]">
        <div className="p-3.5">
          <div className="text-[10px] uppercase tracking-wide text-ink/40 font-semibold">In Inventory</div>
          <div className="text-sm font-semibold text-ink leading-snug mt-1">{p.name}</div>
          <div className="text-[11px] text-ink/50 mt-0.5"><span className="font-mono">{p.code}</span> · {fmtUnits(p.on_hand)} on hand{p.kind === 'packaging' ? ' · packaging' : ''}</div>
        </div>
        <div className="hidden md:flex items-center px-1 text-ink/25"><Icon name="arrowRight" size={18} /></div>
        <div className="p-3.5 border-t md:border-t-0 md:border-l border-rule bg-paper/40">
          <div className="text-[10px] uppercase tracking-wide text-ink/40 font-semibold flex items-center gap-2">
            On Products {sugg.confident && <StatusBadge tone="live">Clear match</StatusBadge>}
          </div>
          {best ? <div className="mt-1.5"><ItemCard si={best.si} against={p.name} compact /></div>
            : <div className="text-sm text-ink/55 mt-1.5">No likely match on Products.</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-t border-rule bg-white">
        {best && !risky && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onLink(best.si)}>
            <Icon name="check" size={14} /> Link to this
          </button>
        )}
        <button className={`btn btn-sm ${best && !risky ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => setOpen(o => !o)}>
          <Icon name="search" size={14} /> {best ? 'Choose another' : 'Search Products'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onCreate} title="It isn’t on Products yet: make its entry (details filled in on Products)">
          <Icon name="plus" size={14} /> New Products entry
        </button>
        {risky && (
          <button className="btn btn-ghost btn-sm text-loss" disabled={busy} onClick={() => onLink(best.si)} title="The sizes or packs don’t match">Link anyway</button>
        )}
        <button className="btn btn-ghost btn-sm ml-auto" disabled={busy} onClick={onSkip}>{skipped ? 'Back to the list' : 'Skip for now'}</button>
      </div>
      {open && <div className="px-3.5 pb-3.5"><FindItem product={p} items={items} suggested={sugg.options} onPick={(si) => { setOpen(false); onLink(si) }} onClose={() => setOpen(false)} /></div>}
    </div>
  )
}

/** A Products entry that isn't in Inventory: the same as one that is, packaging we hold, or not stocked yet */
function ProductsOnlyCard({ si, unlinked, busy, waiting, extra, onLink, onPackaging, onWait }) {
  const ranked = useMemo(() => unlinked.map(p => ({ p, ...compareNames(p.name, si.name) })).filter(x => x.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, 3), [unlinked, si.name])
  const [mode, setMode] = useState(looksLikePackaging(si.name, si.data?.supplierName) ? 'packaging' : null)
  const [code, setCode] = useState('')
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean)
    if (!words.length) return []
    return smartFilter(unlinked, q, p => hay(p.name, p.code)).slice(0, 8)
  }, [q, unlinked])
  const d = si.data || {}
  return (
    <div className="card p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-ink/40 font-semibold">On Products only</div>
          <div className="text-sm font-semibold text-ink leading-snug mt-1">{si.name}</div>
          <div className="text-[11px] text-ink/50 mt-0.5 flex flex-wrap gap-x-2">
            <span>{d.supplierName || 'No supplier'}</span>{d.supplierSku && <span>Supplier SKU {d.supplierSku}</span>}{money(d.costPrice) && <span>{money(d.costPrice)}</span>}
          </div>
        </div>
        {waiting && <StatusBadge tone="quiet">Waiting for Goods In</StatusBadge>}
      </div>

      {ranked.length > 0 && mode !== 'packaging' && (
        <div className="mt-3">
          <div className="text-xs text-ink/60 mb-1.5">Is it one of these in Inventory?</div>
          <div className="grid gap-2">
            {ranked.map(x => (
              <button key={x.p.id} type="button" disabled={busy} onClick={() => onLink(x.p)}
                className="w-full text-left rounded-[8px] border border-rule bg-white hover:border-royal-300 hover:bg-paper px-3 py-2 flex items-center justify-between gap-3">
                <span className="min-w-0"><span className="text-sm text-ink">{x.p.name}</span><span className="block text-[11px] text-ink/50 font-mono">{x.p.code} · {fmtUnits(x.p.on_hand)} on hand</span></span>
                <span className="shrink-0 flex flex-col items-end gap-0.5"><SizeBadge sizes={x.sizes} /><span className="text-[11px] text-royal-600 font-medium">Link →</span></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'search' && (
        <div className="mt-3 rounded-[8px] border border-royal-200 bg-royal-50/30 p-3">
          <SearchInput value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search Inventory — name or SKU"
            onKeyDown={e => { if (e.key === 'Enter' && found[0]) onLink(found[0]); if (e.key === 'Escape') setMode(null) }} />
          <div className="grid gap-1.5 mt-2 max-h-[280px] overflow-y-auto">
            {found.map(p => (
              <button key={p.id} type="button" onClick={() => onLink(p)} className="text-left rounded-[6px] border border-rule bg-white hover:bg-paper px-3 py-2">
                <div className="text-sm text-ink">{p.name}</div><div className="text-[11px] text-ink/50 font-mono">{p.code} · {fmtUnits(p.on_hand)} on hand</div>
              </button>
            ))}
            {q && !found.length && <div className="text-sm text-ink/55 py-2 text-center">No unlinked inventory product matches.</div>}
          </div>
        </div>
      )}

      {mode === 'packaging' && (
        <div className="mt-3 rounded-[8px] border border-rule bg-paper/50 p-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <SkuField id={`po-${si.id}`} label="Its SKU in Inventory" name={si.name} brand={d.brand || ''} value={code} onChange={setCode} check stockItemId={si.id} extra={extra} />
          </div>
          <button className="btn btn-primary btn-sm mb-0.5" disabled={busy || !code.trim()} onClick={() => onPackaging(code.trim())}>
            <Icon name="box" size={14} /> Add to Inventory as packaging
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {mode !== 'search' && <button className="btn btn-secondary btn-sm" onClick={() => setMode('search')}><Icon name="search" size={14} /> Find it in Inventory</button>}
        {mode !== 'packaging' && <button className="btn btn-secondary btn-sm" onClick={() => setMode('packaging')}><Icon name="box" size={14} /> It’s packaging we hold</button>}
        {mode && <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Back</button>}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onWait}>{waiting ? 'Not waiting — check again' : 'Not stocked yet — wait for Goods In'}</button>
      </div>
    </div>
  )
}

/**
 * Inventory and Products are one product, one to one. The one-off clean-up, done at your own pace: every
 * choice saves straight away (with Undo), skips are remembered, and you can stop anywhere.
 */
export default function LinkProducts({ me, stockItems = [], showToast, onChanged }) {
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('todo')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [memo, setMemo] = useState(loadMemo)       // { skipped: {id: true}, waiting: {id: true} }
  const [reviewing, setReviewing] = useState(null)  // Set of product ids in the clear-match review
  const [creatingAll, setCreatingAll] = useState(false)
  const [session, setSession] = useState(0)
  const [limit, setLimit] = useState(25)
  const who = me?.name || ''
  useEffect(() => { setLimit(25) }, [tab, q])

  // Each row is an inventory product: id is its product id (what every link uses)
  const reload = () => loadItemStock().then(r => setRows((r || []).map(x => ({ ...x, id: x.product_id })))).catch(e => { setRows([]); showToast?.(e.message, 'error') })
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (kind, id, on) => setMemo(m => { const n = { ...m, [kind]: { ...(m[kind] || {}) } }; if (on) n[kind][id] = true; else delete n[kind][id]; saveMemo(n); return n })

  const byItem = useMemo(() => new Map(stockItems.map(si => [si.id, si])), [stockItems])
  const linkedIds = useMemo(() => new Set((rows || []).filter(r => r.stock_item_id).map(r => r.stock_item_id)), [rows])
  const unlinked = useMemo(() => (rows || []).filter(r => !r.stock_item_id), [rows])
  const freeItems = useMemo(() => stockItems.filter(si => !si.data?.archived && !linkedIds.has(si.id)), [stockItems, linkedIds])
  const sugg = useMemo(() => suggestLinks(unlinked, freeItems), [unlinked, freeItems])
  const extra = useMemo(() => stockItems.filter(si => (si.data?.sku || '').trim()).map(si => ({ code: si.data.sku, name: si.name })), [stockItems])
  // Links made here (or entries made for one), newest first — these can be undone
  const linked = useMemo(() => (rows || []).filter(r => r.stock_item_id).map(r => ({ r, si: byItem.get(r.stock_item_id) }))
    .filter(x => x.si && (x.si.data?.linkedAt || x.si.data?.createdAt))
    .sort((a, b) => String(b.si.data?.linkedAt || b.si.data?.createdAt).localeCompare(String(a.si.data?.linkedAt || a.si.data?.createdAt))), [rows, byItem])

  const skipped = memo.skipped || {}
  const waiting = memo.waiting || {}
  const todo = unlinked.filter(p => !skipped[p.id])
  const clear = todo.filter(p => sugg.get(p.id)?.confident)
  const productsOnly = freeItems.filter(si => !waiting[si.id])
  const match = (text) => matches(text, q)

  const done = async (msg, undo) => {
    setSession(n => n + 1)
    showToast?.(msg, 'success', undo ? { label: 'Undo', run: undo } : null)
    await Promise.all([reload(), onChanged?.()])
  }
  const act = async (key, fn) => {
    setBusy(key)
    try { await fn() } catch (e) { showToast?.(e.message || 'That didn’t save', 'error') } finally { setBusy(null) }
  }
  const undoLink = (p) => act(`u-${p.id}`, async () => { await invUnlinkStockItem(p.id, who); showToast?.(`${p.name} unlinked`); await Promise.all([reload(), onChanged?.()]) })
  const link = (p, si) => act(p.id, async () => { await invLinkStockItem(p.id, si.id, who); remember('skipped', p.id, false); await done(`${p.name} linked`, () => undoLink(p)) })
  const create = (p) => act(p.id, async () => { await invPairNewItems([p.id], who); remember('skipped', p.id, false); await done(`${p.name} is on Products now — fill in its cost, supplier and weight there`, () => undoLink(p)) })

  if (rows === null) return <div className="card"><Spinner /></div>
  const total = rows.length
  const linkedCount = total - unlinked.length
  const pct = total ? Math.round((100 * linkedCount) / total) : 100

  const list = tab === 'todo' ? todo : tab === 'clear' ? clear : tab === 'skipped' ? unlinked.filter(p => skipped[p.id]) : []
  const shownList = list.filter(p => !q || match(`${p.name} ${p.code}`))
  const shownItems = (tab === 'products' ? productsOnly : tab === 'waiting' ? freeItems.filter(si => waiting[si.id]) : []).filter(si => !q || match(`${si.name} ${si.data?.supplierName} ${si.data?.supplierSku}`))
  const shownLinked = tab === 'linked' ? linked.filter(x => !q || match(`${x.r.name} ${x.r.code} ${x.si.data?.supplierProductName}`)) : []
  const noMatch = todo.filter(p => !sugg.get(p.id)?.options.length)

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h2 className="title-case text-base font-semibold text-ink">Inventory and Products</h2>
          <p className="text-sm text-ink/60 mt-1">
            Each inventory product is the same product as one entry on Products. Every choice saves straight away — stop whenever you like,
            and Undo any link from the toast or the Linked tab.
          </p>
        </div>
        <div className="min-w-[220px]">
          <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink tabular-nums">{linkedCount} of {total}</span><span className="text-ink/50">{pct}% linked</span></div>
          <div className="h-2 rounded-full bg-ink/10 overflow-hidden mt-1.5"><div className="h-full bg-gain transition-all" style={{ width: `${pct}%` }} /></div>
          {session > 0 && <div className="text-[11px] text-ink/45 mt-1">{plural(session, 'change')} this session</div>}
        </div>
      </div>

      <Tabs className="mt-4 mb-3" value={tab} onChange={setTab} items={[
        { id: 'todo', label: 'To link', count: todo.length },
        { id: 'clear', label: 'Clear matches', count: clear.length },
        { id: 'skipped', label: 'Skipped', count: Object.keys(skipped).filter(id => unlinked.some(p => p.id === id)).length || null },
        { id: 'products', label: 'On Products only', count: productsOnly.length },
        { id: 'waiting', label: 'Waiting for Goods In', count: freeItems.filter(si => waiting[si.id]).length || null },
        { id: 'linked', label: 'Linked', count: linked.length || null },
      ]} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput className="flex-1 min-w-[220px] max-w-md" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter this list" />
        {tab === 'clear' && clear.length > 0 && (
          <button className="btn btn-primary btn-sm w-full sm:w-auto justify-center" onClick={() => setReviewing(new Set(clear.map(p => p.id)))}>
            <Icon name="check" size={14} /> Review and link all {clear.length}
          </button>
        )}
        {tab === 'todo' && noMatch.length > 0 && (
          <button className="btn btn-secondary btn-sm w-full sm:w-auto justify-center" onClick={() => setCreatingAll(true)} title="The ones with no likely match on Products">
            <Icon name="plus" size={14} /> New entries for the {noMatch.length} with no match
          </button>
        )}
      </div>

      {tab === 'clear' && <div className="text-xs text-ink/55 mb-3">Same words and same size or pack. Still check each one — linking renames the Products entry to the Inventory name.</div>}
      {tab === 'products' && <div className="text-xs text-ink/55 mb-3">Not in Inventory: link it if it’s the same as an inventory product, add it if it’s packaging we hold, or leave it to arrive through Goods In.</div>}

      <div className="grid gap-3">
        {shownList.slice(0, limit).map(p => (
          <MatchCard key={p.id} p={p} sugg={sugg.get(p.id) || { options: [] }} items={freeItems} busy={!!busy} skipped={!!skipped[p.id]}
            onLink={(si) => link(p, si)} onCreate={() => create(p)} onSkip={() => remember('skipped', p.id, !skipped[p.id])} />
        ))}
        {shownItems.slice(0, limit).map(si => (
          <ProductsOnlyCard key={si.id} si={si} unlinked={unlinked} busy={!!busy} waiting={!!waiting[si.id]} extra={extra}
            onLink={(p) => link(p, si)}
            onPackaging={(code) => act(si.id, async () => { await invAddFromStockItem(si.id, code, 'packaging', who); await done(`${si.name} added to Inventory as packaging — count it onto its shelf`) })}
            onWait={() => remember('waiting', si.id, !waiting[si.id])} />
        ))}
        {shownLinked.slice(0, limit).map(({ r, si }) => (
          <div key={r.product_id} className="card py-2.5 flex items-center gap-3 flex-wrap">
            <Icon name="check" size={16} className="text-gain shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">{r.name} <span className="text-[11px] text-ink/45 font-mono">{r.code}</span></div>
              <div className="text-[11px] text-ink/50">
                {si.data?.preLinkName && si.data.preLinkName !== r.name ? `Was “${si.data.preLinkName}” on Products` : si.data?.linkedAt ? 'Linked to its Products entry' : 'New Products entry'}
                {si.data?.linkedByName ? ` · ${si.data.linkedByName}` : ''}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => undoLink({ id: r.product_id, name: r.name })}>Undo</button>
          </div>
        ))}
        {(() => {
          const n = shownList.length + shownItems.length + shownLinked.length
          if (n > limit) return <button className="btn btn-secondary btn-sm justify-self-center" onClick={() => setLimit(l => l + 25)}>Show more ({n - limit} left)</button>
          if (n) return null
          return (
            <div className="py-8 text-center text-sm text-ink/55">
              {q ? 'Nothing here matches that.'
                : tab === 'todo' ? <span className="inline-flex items-center gap-2 text-gain"><Icon name="check" size={16} /> Every inventory product is linked — they stay paired from here.</span>
                  : tab === 'clear' ? 'No clear matches left — the rest need a look in To link.'
                    : tab === 'products' ? 'Every Products entry is either in Inventory or waiting for Goods In.' : 'Nothing here.'}
            </div>
          )
        })()}
      </div>

      {reviewing && (
        <Modal title={`Link ${plural(reviewing.size, 'clear match', 'clear matches')}?`} description="Untick any that aren’t the same product. Each Products entry takes the Inventory name."
          onClose={() => setReviewing(null)} maxWidth="max-w-3xl">
          <div className="max-h-[60vh] overflow-y-auto border border-rule rounded-[8px] divide-y divide-rule/70">
            {clear.map(p => {
              const si = sugg.get(p.id).options[0].si
              const on = reviewing.has(p.id)
              return (
                <label key={p.id} className={`grid grid-cols-[auto_1fr_1fr] gap-3 px-3 py-2.5 text-sm cursor-pointer ${on ? '' : 'opacity-50'}`}>
                  <input type="checkbox" className="mt-1" checked={on}
                    onChange={e => setReviewing(t => { const n = new Set(t); e.target.checked ? n.add(p.id) : n.delete(p.id); return n })} />
                  <span className="min-w-0"><span className="text-ink">{p.name}</span><span className="block text-[11px] text-ink/45 font-mono">{p.code}</span></span>
                  <span className="min-w-0"><span className="text-ink/75">{si.name}</span><span className="block text-[11px] text-ink/45">{[si.data?.supplierName, money(si.data?.costPrice)].filter(Boolean).join(' · ')}</span></span>
                </label>
              )
            })}
          </div>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setReviewing(null)}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={!!busy || !reviewing.size}
              onClick={() => act('bulk', async () => {
                let n = 0
                for (const p of clear) { if (reviewing.has(p.id)) { await invLinkStockItem(p.id, sugg.get(p.id).options[0].si.id, who); n++ } }
                setReviewing(null); setSession(s => s + n - 1); await done(`${plural(n, 'product')} linked — undo any from the Linked tab`)
              })}>
              {busy === 'bulk' ? 'Linking…' : `Link ${reviewing.size}`}
            </button>
          </div>
        </Modal>
      )}

      {creatingAll && (
        <Modal title={`New Products entries for ${plural(noMatch.length, 'product')}?`}
          description="These have no likely match on Products. Each gets an entry with its Inventory name; cost, supplier and weight are filled in on Products."
          onClose={() => setCreatingAll(false)}>
          <div className="max-h-[40vh] overflow-y-auto text-sm text-ink/75 border border-rule rounded-[8px] divide-y divide-rule/70">
            {noMatch.map(p => <div key={p.id} className="px-3 py-1.5">{p.name}</div>)}
          </div>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setCreatingAll(false)}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={!!busy}
              onClick={() => act('all', async () => { const n = await invPairNewItems(noMatch.map(p => p.id), who); setCreatingAll(false); setSession(s => s + n - 1); await done(`${plural(n, 'Products entry', 'Products entries')} made — fill in the details on Products`) })}>
              {busy === 'all' ? 'Making…' : `Make ${noMatch.length}`}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
