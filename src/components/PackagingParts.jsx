import React, { useMemo, useState } from 'react'
import { smartFilter, matches, hay } from '../lib/match'
import { Icon, Modal, Drawer, SearchInput, EmptyState } from './UI'
import { fmt } from '../lib/calc'
import { isPackaging, unitCost, isBuilt, partsOf, typeCost, typeWeight, usageOf, unitLabel, tapeMetres } from '../lib/packaging'

const num = (v) => parseFloat(v) || 0
const money = (v) => fmt(num(v))
const money4 = (v) => `£${num(v).toFixed(num(v) < 1 ? 3 : 2)}`
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** Search packaging items (name, supplier, supplier SKU) — never a long dropdown */
function ItemPicker({ items, exclude = [], onPick, placeholder = 'Add a packaging item — search by name, supplier or SKU' }) {
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    return smartFilter(items.filter(si => !exclude.includes(si.id)), q, si => hay(si.name, si.data?.supplierName, si.data?.supplierSku, si.data?.sku))
      .slice(0, 8)
  }, [q, items, exclude])
  return (
    <div className="rounded-[8px] border border-royal-200 bg-royal-50/30 p-2.5">
      <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter' && found[0]) { onPick(found[0]); setQ('') } }} />
      <div className="grid gap-1 mt-2 max-h-[240px] overflow-y-auto">
        {found.map(si => (
          <button key={si.id} type="button" onClick={() => { onPick(si); setQ('') }}
            className="text-left rounded-[6px] border border-rule bg-white hover:border-royal-300 hover:bg-paper px-3 py-2 flex items-center justify-between gap-3">
            <span className="min-w-0"><span className="text-sm text-ink block truncate">{si.name}</span>
              <span className="text-[11px] text-ink/50">{[si.data?.supplierName, si.data?.supplierSku].filter(Boolean).join(' · ')}</span></span>
            <span className="text-xs tabular-nums text-ink/70 shrink-0 text-right">{unitCost(si) > 0 ? `${money4(unitCost(si))} ${unitLabel(si) === 'each' ? 'each' : `a ${unitLabel(si)}`}` : <span className="text-warn">no cost</span>}
              {!(num(si.data?.packUnits) >= 1) && <span className="block text-[10px] text-warn">pack size not set</span>}</span>
          </button>
        ))}
        {!found.length && <div className="text-sm text-ink/55 text-center py-2">No packaging item matches — add it on the Items tab.</div>}
      </div>
    </div>
  )
}

/* ─────────────────────────────── Types ─────────────────────────────── */

export function TypesView({ settings, stockItems, savedProducts, items, office, who, openId = null, onSaveTypes, onOpenItem, onShowListings }) {
  const packaging = settings?.packaging || []
  const [editing, setEditing] = useState(() => (openId ? packaging.find(p => p.id === openId) || null : null))   // a type, or { new: true }
  const usage = (pk) => savedProducts.filter(r => !r.data?.archived && r.data?.packagingId === pk.id)
  const built = packaging.filter(isBuilt).length

  return (
    <div>
      {packaging.length > 0 && built < packaging.length && (
        <div className="card border-l-2 border-l-warn mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="title-case text-sm font-semibold text-ink">{plural(packaging.length - built, 'type')} not built yet</div>
            <div className="text-xs text-ink/60 mt-0.5">They still use a typed-in cost. Build each from the packaging items it’s made of, so its cost is real and despatch can take it off stock.</div>
          </div>
          <div className="text-sm tabular-nums text-ink/70">{built} of {packaging.length} built</div>
        </div>
      )}
      <div className="flex justify-end mb-3">
        {office && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ new: true })}><Icon name="plus" size={14} /> New packaging type</button>}
      </div>
      {!packaging.length ? <EmptyState icon="box" title="No packaging types yet" sub="A packaging type is what a listing ships in — a mailer, a box, a box with cushion film." /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...packaging].sort((a, b) => usage(b).length - usage(a).length || a.name.localeCompare(b.name)).map(pk => {
            const parts = partsOf(pk, stockItems)
            const n = usage(pk).length
            return (
              <button key={pk.id} type="button" onClick={() => setEditing(pk)}
                className="card text-left hover:border-royal-300 hover:shadow-sm transition-all flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink leading-snug">{pk.name}</div>
                    <div className="text-xs text-ink/50 mt-0.5">{plural(n, 'listing')}{typeWeight(pk, stockItems) > 0 ? ` · ${typeWeight(pk, stockItems).toFixed(3)} kg` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums text-ink">{money4(typeCost(pk, stockItems))}</div>
                    <div className="text-[11px] text-ink/45">a parcel</div>
                  </div>
                </div>
                {isBuilt(pk) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {parts.map(p => (
                      <span key={p.stockItemId} title={p.si && !(p.unit > 0) ? 'No cost yet' : undefined} className={`text-[11px] px-2 py-0.5 rounded-full border ${p.missing ? 'border-loss/40 text-loss' : p.unit > 0 ? 'border-rule bg-paper text-ink/75' : 'border-warn/40 bg-warn/5 text-warn'}`}>
                        {p.qty !== 1 ? `${p.qty} × ` : ''}{p.si?.name || 'Item removed'}
                      </span>
                    ))}
                    {pk.extraOn && num(pk.extraCost) > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full border border-rule bg-paper text-ink/60">+ {money4(pk.extraCost)} {pk.extraNote || 'extra'}</span>}
                  </div>
                ) : <div className="text-xs text-warn">Not built yet — typed-in cost</div>}
              </button>
            )
          })}
        </div>
      )}
      {editing && (
        <TypeEditor pk={editing.new ? null : editing} packaging={packaging} items={items} stockItems={stockItems} office={office} who={who}
          listings={editing.new ? [] : usage(editing)} onOpenItem={onOpenItem} onShowListings={onShowListings}
          onClose={() => setEditing(null)}
          onSave={async (next, removed) => { await onSaveTypes(next, removed); setEditing(null) }} />
      )}
    </div>
  )
}

function TypeEditor({ pk, packaging, items, stockItems, listings, office, who, onOpenItem, onShowListings, onClose, onSave }) {
  const isNew = !pk
  const [f, setF] = useState(() => ({
    name: pk?.name || '', components: (pk?.components || []).map(c => ({ ...c })),
    extraOn: !!pk?.extraOn, extraCost: pk?.extraCost ?? '', extraNote: pk?.extraNote || '', weightKg: pk?.weightKg ?? '',
  }))
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const draft = { ...(pk || {}), ...f, components: f.components.filter(c => c.stockItemId) }
  const parts = partsOf(draft, stockItems)
  const before = pk ? typeCost(pk, stockItems) : 0
  const after = isBuilt(draft) ? typeCost(draft, stockItems) : num(pk?.cost)
  const volume = listings.reduce((s, r) => s + (parseInt(r.data?.monthlyVolume, 10) || 0), 0)
  const set = (patch) => setF(x => ({ ...x, ...patch }))
  const setPart = (i, patch) => set({ components: f.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const problem = !f.name.trim() ? 'Give it a name'
    : !f.components.length ? 'Add what it’s made of'
      : f.components.some(c => !(num(c.qty) > 0)) ? 'Each item needs a quantity'
        : parts.some(p => p.missing) ? 'One of its items has been removed'
          : f.extraOn && !(num(f.extraCost) > 0) ? 'Enter the extra cost, or untick it'
            : null
  // Tape: worked out from the box in this type — a cross on top and a cross on the bottom
  const box = parts.find(p => p.si?.data?.dims?.l)
  const tapeItem = items.find(si => unitLabel(si) === 'metre' && /tape/i.test(si.name))
  const tapeAt = f.components.findIndex(c => tapeItem && c.stockItemId === tapeItem.id)
  const tapeNeed = box ? tapeMetres(box.si.data.dims) : 0
  const changes = []
  if (pk) {
    if (f.name.trim() !== pk.name) changes.push(`Name: ${pk.name} → ${f.name.trim()}`)
    const was = (pk.components || []).map(c => `${num(c.qty)}×${c.stockItemId}`).sort().join()
    const now = draft.components.map(c => `${num(c.qty)}×${c.stockItemId}`).sort().join()
    if (was !== now) changes.push('What it’s made of')
    if (!!pk.extraOn !== f.extraOn || num(pk.extraCost) !== num(f.extraCost) || (pk.extraNote || '') !== f.extraNote) changes.push('Extra cost')
  }
  const save = async () => {
    setBusy(true)
    try {
      const entry = { at: new Date().toISOString(), by: who || '', cost: +after.toFixed(4), summary: isNew ? 'Created' : changes.join(' · ') || 'Saved' }
      const next = {
        ...(pk || { id: 'p' + Date.now() }), name: f.name.trim(),
        components: draft.components.map(c => ({ stockItemId: c.stockItemId, qty: num(c.qty) })),
        extraOn: f.extraOn, extraCost: f.extraOn ? num(f.extraCost) : 0, extraNote: f.extraOn ? f.extraNote.trim() : '',
        cost: +after.toFixed(4), weightKg: num(f.weightKg) || pk?.weightKg || 0,
        history: [entry, ...(pk?.history || [])].slice(0, 50),
      }
      await onSave(isNew ? [...packaging, next] : packaging.map(x => (x.id === next.id ? next : x)), null)
    } finally { setBusy(false) }
  }

  return (
    <Drawer title={isNew ? 'New packaging type' : pk.name} description={isNew ? 'What a listing ships in, built from real packaging items' : `${listings.length === 1 ? '1 listing ships' : `${listings.length} listings ship`} in this`} onClose={onClose} width="max-w-2xl"
      footer={office && (
        <div className="flex gap-2">
          {!isNew && <button className="btn btn-ghost btn-sm text-loss" onClick={() => setDeleting(true)}><Icon name="trash" size={14} /> Delete</button>}
          <button className="btn btn-secondary flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center" disabled={!!problem} title={problem || ''} onClick={() => setConfirm(true)}>
            <Icon name="check" size={14} /> {isNew ? 'Create type' : 'Save changes'}
          </button>
        </div>
      )}>
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="pt-name">Name</label>
          <input id="pt-name" className="input" value={f.name} disabled={!office} onChange={e => set({ name: e.target.value })} placeholder="e.g. Medium Glass Item" />
        </div>

        <div>
          <div className="title-case text-sm font-semibold text-ink mb-2">Made of</div>
          {f.components.length > 0 && (
            <div className="border border-rule rounded-[8px] divide-y divide-rule/70 bg-white mb-2">
              {f.components.map((c, i) => {
                const p = parts[i] || partsOf({ components: [c] }, stockItems)[0]
                return (
                  <div key={c.stockItemId} className="flex items-center gap-3 px-3 py-2.5">
                    <input type="number" min="0" step="any" aria-label="How many" disabled={!office}
                      className="input text-sm w-[72px] tabular-nums" value={c.qty} onChange={e => setPart(i, { qty: e.target.value })} />
                    <span className="text-ink/40 text-sm">×</span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => p.si && onOpenItem?.(p.si)}>
                      <div className={`text-sm leading-snug ${p.missing ? 'text-loss' : 'text-ink hover:text-royal-600'}`}>{p.si?.name || 'This item has been removed'}</div>
                      <div className="text-[11px] text-ink/50">{p.si ? `${p.unit > 0 ? `${money4(p.unit)} ${unitLabel(p.si) === 'each' ? 'each' : `a ${unitLabel(p.si)}`}` : 'no cost yet'}${unitLabel(p.si) !== 'each' ? ` · ${num(c.qty)} ${unitLabel(p.si)}${num(c.qty) === 1 ? '' : 's'}` : ''}${p.si.data?.supplierName ? ` · ${p.si.data.supplierName}` : ''}` : ''}</div>
                      {i === tapeAt && tapeNeed > 0 && <div className="text-[11px] text-ink/45">Cross top and bottom of the {box.si.data.dims.l}×{box.si.data.dims.w} box, 50 mm over each edge = {tapeNeed} m</div>}
                    </button>
                    {i === tapeAt && tapeNeed > 0 && Math.abs(num(c.qty) - tapeNeed) > 0.001 && office && (
                      <button type="button" className="text-[11px] text-royal-600 hover:underline shrink-0" onClick={() => setPart(i, { qty: tapeNeed })}>Use {tapeNeed} m</button>
                    )}
                    <span className="text-sm tabular-nums text-ink/75 w-16 text-right">{money4(p.line)}</span>
                    {office && <button type="button" className="icon-btn" aria-label="Remove" onClick={() => set({ components: f.components.filter((_, j) => j !== i) })}><Icon name="close" size={15} /></button>}
                  </div>
                )
              })}
            </div>
          )}
          {office && box && tapeItem && tapeAt < 0 && (
            <button type="button" className="btn btn-secondary btn-sm mb-2" onClick={() => set({ components: [...f.components, { stockItemId: tapeItem.id, qty: tapeNeed }] })}>
              <Icon name="plus" size={14} /> Tape it — {tapeNeed} m, cross top and bottom
            </button>
          )}
          {office && <ItemPicker items={items} exclude={f.components.map(c => c.stockItemId)}
            onPick={(si) => set({ components: [...f.components, { stockItemId: si.id, qty: tapeItem && si.id === tapeItem.id && tapeNeed ? tapeNeed : 1 }] })} />}
        </div>

        <div className="rounded-[8px] border border-rule bg-paper/60 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={f.extraOn} disabled={!office} onChange={e => set({ extraOn: e.target.checked })} /> Add an extra cost per parcel
          </label>
          <div className="text-xs text-ink/55 mt-0.5 ml-6">For what isn’t tracked as stock — tape, void fill, labels.</div>
          {f.extraOn && (
            <div className="grid grid-cols-[120px_1fr] gap-2 mt-2 ml-6">
              <div><label className="label">£ a parcel</label><input className="input text-sm tabular-nums" type="number" min="0" step="0.001" value={f.extraCost} disabled={!office} onChange={e => set({ extraCost: e.target.value })} /></div>
              <div><label className="label">What it’s for</label><input className="input text-sm" value={f.extraNote} disabled={!office} onChange={e => set({ extraNote: e.target.value })} placeholder="e.g. tape and void fill" /></div>
            </div>
          )}
        </div>

        <div className="rounded-[8px] border border-royal-200 bg-royal-50/40 p-3 flex items-center justify-between gap-3">
          <div className="text-sm text-ink/75">Cost a parcel{listings.length ? <span className="text-ink/50"> · {plural(listings.length, 'listing')}</span> : ''}</div>
          <div className="text-right">
            <div className="text-xl font-semibold tabular-nums text-ink">{money4(after)}</div>
            {pk && Math.abs(after - before) > 0.0005 && <div className="text-[11px] text-ink/55">was {money4(before)}</div>}
          </div>
        </div>
        {parts.some(p => p.si && !(p.unit > 0)) && <div className="text-xs text-warn">An item here has no cost yet, so this cost is too low until it has one.</div>}
        {problem && office && <div className="text-xs text-ink/50">{problem}</div>}

        {listings.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5"><div className="title-case text-sm font-semibold text-ink">Listings that ship in it</div>
              <button className="text-xs text-royal-600 hover:underline" onClick={() => onShowListings?.(pk.id)}>See them all</button></div>
            <div className="text-xs text-ink/65 space-y-1">{listings.slice(0, 6).map(r => <div key={r.id} className="truncate">{r.name}</div>)}{listings.length > 6 && <div className="text-ink/45">+{listings.length - 6} more</div>}</div>
          </div>
        )}
        {(pk?.history || []).length > 0 && (
          <div>
            <div className="title-case text-sm font-semibold text-ink mb-1.5">History</div>
            <div className="space-y-1">{pk.history.map((h, i) => (
              <div key={i} className="text-xs text-ink/65 flex justify-between gap-3"><span>{h.summary}{h.by ? ` · ${h.by}` : ''}</span><span className="tabular-nums text-ink/45 shrink-0">{money4(h.cost)} · {day(h.at)}</span></div>
            ))}</div>
          </div>
        )}
      </div>

      {confirm && (
        <Modal title={isNew ? 'Create this packaging type?' : 'Save these changes?'} description={f.name.trim()} onClose={() => setConfirm(false)}>
          <div className="space-y-2 text-sm">
            {!isNew && changes.map(c => <div key={c} className="text-ink/75">• {c}</div>)}
            <div className="rounded-[6px] bg-paper px-3 py-2 flex justify-between"><span className="text-ink/60">Cost a parcel</span>
              <span className="tabular-nums">{!isNew && Math.abs(after - before) > 0.0005 ? <><span className="line-through text-ink/45">{money4(before)}</span> → </> : ''}<b>{money4(after)}</b></span></div>
            {!isNew && listings.length > 0 && Math.abs(after - before) > 0.0005 && (
              <div className="text-xs text-warn">Changes the packaging cost — and margin — of {plural(listings.length, 'listing')}{volume ? `: about ${after > before ? '+' : '−'}${money(Math.abs(after - before) * volume)} a month at current volumes` : ''}.</div>
            )}
          </div>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setConfirm(false)}>Keep editing</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={save}><Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete this packaging type?" description={pk.name} onClose={() => setDeleting(false)}>
          {listings.length ? (
            <div className="text-sm text-ink/75">{plural(listings.length, 'listing')} ship in it. Move them to another type on the Listings tab first.</div>
          ) : <div className="text-sm text-ink/75">No listing uses it. The packaging items stay as they are.</div>}
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setDeleting(false)}>Keep it</button>
            {!listings.length && <button className="btn btn-danger flex-1 justify-center" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(packaging.filter(x => x.id !== pk.id), pk) } finally { setBusy(false) } }}>Delete</button>}
          </div>
        </Modal>
      )}
    </Drawer>
  )
}

/* ─────────────────────────────── Items ─────────────────────────────── */

export function ItemsView({ stockItems, settings, savedProducts, inventory, office, onOpenItem, onAddItem, onMarkItem }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const packaging = settings?.packaging || []
  const items = stockItems.filter(si => isPackaging(si) && !si.data?.archived)
  const inv = new Map((inventory?.products || []).filter(p => p.stock_item_id).map(p => [p.stock_item_id, p]))
  const shown = q.trim() ? smartFilter(items, q, si => hay(si.name, si.data?.supplierName, si.data?.supplierSku, si.data?.sku))
    : [...items].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput className="flex-1 min-w-[220px] max-w-md" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, supplier or SKU" />
        {office && <button className="btn btn-primary btn-sm ml-auto" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add packaging item</button>}
      </div>
      {!items.length ? <EmptyState icon="box" title="No packaging items yet" sub="Boxes, mailers and film we pack orders in. Each one has a supplier, a pack size and a cost per unit." /> : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-rule bg-paper text-xs text-ink/45">
                <th className="text-left px-4 py-2.5 font-semibold">Item</th><th className="text-left px-3 py-2.5 font-semibold">Supplier</th>
                <th className="text-right px-3 py-2.5 font-semibold">Pack</th><th className="text-right px-3 py-2.5 font-semibold">Cost per unit</th>
                <th className="text-right px-3 py-2.5 font-semibold">In stock</th><th className="text-left px-4 py-2.5 font-semibold">Used in</th>
              </tr></thead>
              <tbody>
                {shown.map(si => {
                  const d = si.data || {}
                  const ip = inv.get(si.id)
                  const types = packaging.filter(pk => (pk.components || []).some(c => c.stockItemId === si.id))
                  return (
                    <tr key={si.id} className="border-b border-rule/60 last:border-0 hover:bg-paper cursor-pointer" onClick={() => onOpenItem(si)}>
                      <td className="px-4 py-2.5"><div className="text-ink font-medium">{si.name}</div>
                        <div className="text-[11px] text-ink/45 flex gap-2">{d.sku ? <span className="font-mono">{d.sku}</span> : <span>No SKU yet</span>}{d.alsoSold && <span className="text-royal-700">also sold</span>}</div></td>
                      <td className="px-3 py-2.5 text-ink/70">{d.supplierName || '—'}{d.supplierSku && <div className="text-[11px] text-ink/45">{d.supplierSku}</div>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink/70">{num(d.packUnits) > 1 ? <>{num(d.packUnits).toLocaleString('en-GB')}{unitLabel(si) !== 'each' ? ` ${unitLabel(si)}s` : ''} for {money(d.packPrice)}</> : num(d.packUnits) === 1 ? 'single' : <span className="text-warn text-xs">pack size?</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{unitCost(si) > 0 ? <>{money4(unitCost(si))}{unitLabel(si) !== 'each' && <span className="text-ink/45 text-[11px]"> /{unitLabel(si)}</span>}</> : <span className="text-warn text-xs">no cost</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{ip ? Math.round(ip.on_hand).toLocaleString('en-GB') : <span className="text-ink/35 text-xs">not in Inventory</span>}</td>
                      <td className="px-4 py-2.5 text-xs text-ink/65">{types.length ? types.map(t => t.name).join(', ') : <span className="text-ink/35">No packaging type</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding && <AddItem stockItems={stockItems} onClose={() => setAdding(false)} onAdd={async (x) => { await onAddItem(x); setAdding(false) }} onMark={async (si) => { await onMarkItem(si); setAdding(false) }} />}
    </div>
  )
}

function AddItem({ stockItems, onClose, onAdd, onMark }) {
  const [mode, setMode] = useState('new')
  const [f, setF] = useState({ name: '', supplierName: '', supplierSku: '', packUnits: '', packPrice: '', weightKg: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }))
  const others = stockItems.filter(si => !isPackaging(si) && !si.data?.archived)
  const each = num(f.packUnits) > 0 && num(f.packPrice) > 0 ? num(f.packPrice) / num(f.packUnits) : 0
  return (
    <Modal title="Add a packaging item" description="Boxes, mailers, film — anything we pack orders in" onClose={onClose} maxWidth="max-w-lg">
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button className={`btn btn-sm justify-center ${mode === 'new' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('new')}>New item</button>
        <button className={`btn btn-sm justify-center ${mode === 'existing' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('existing')}>It’s already on Products</button>
      </div>
      {mode === 'new' ? (
        <div className="space-y-3">
          <div><label className="label">Name</label><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Kite bubble lined mailer size 6, gold" autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Supplier</label><input className="input" value={f.supplierName} onChange={set('supplierName')} /></div>
            <div><label className="label">Supplier’s code</label><input className="input" value={f.supplierSku} onChange={set('supplierSku')} /></div>
            <div><label className="label">Units in a pack</label><input className="input tabular-nums" type="number" min="1" step="1" value={f.packUnits} onChange={set('packUnits')} placeholder="e.g. 100" /></div>
            <div><label className="label">Pack price £</label><input className="input tabular-nums" type="number" min="0" step="0.01" value={f.packPrice} onChange={set('packPrice')} /></div>
            <div><label className="label">Weight of one, kg</label><input className="input tabular-nums" type="number" min="0" step="0.001" value={f.weightKg} onChange={set('weightKg')} /></div>
            <div className="flex items-end pb-2 text-sm text-ink/70">{each > 0 ? <>Costs <b className="mx-1 tabular-nums">{money4(each)}</b> each</> : ''}</div>
          </div>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-secondary flex-1 justify-center" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy || !f.name.trim()} onClick={async () => {
              setBusy(true)
              try { await onAdd({ name: f.name.trim(), supplierName: f.supplierName.trim(), supplierSku: f.supplierSku.trim(), packUnits: num(f.packUnits) || '', packPrice: num(f.packPrice) || '', costPrice: each ? String(+each.toFixed(4)) : '', weightKg: f.weightKg, packaging: true }) }
              finally { setBusy(false) }
            }}>Add item</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs text-ink/60 mb-2">It becomes a packaging item and leaves the Products page (tick “Also sold” on it if we sell it too).</div>
          <ItemPicker items={others} onPick={(si) => onMark(si)} placeholder="Search Products — name, supplier or SKU" />
        </div>
      )}
    </Modal>
  )
}

/** One packaging item: its details (confirmed before saving), stock, and everywhere it's used */
export function ItemDrawer({ si, stockItems, settings, savedProducts, inventory, office, onClose, onSave, onOpenProductPage, onOpenType }) {
  const d = si.data || {}
  const [f, setF] = useState({ name: si.name, supplierName: d.supplierName || '', supplierSku: d.supplierSku || '', packUnits: d.packUnits ?? '', packPrice: d.packPrice ?? '', costPrice: d.costPrice ?? '', weightKg: d.weightKg ?? '', alsoSold: !!d.alsoSold })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const packs = num(f.packUnits) > 1
  const each = packs && num(f.packPrice) > 0 ? num(f.packPrice) / num(f.packUnits) : num(f.costPrice)
  const use = usageOf(si, settings?.packaging || [], savedProducts, stockItems)
  const ip = (inventory?.products || []).find(p => p.stock_item_id === si.id)
  const LABEL = { name: 'Name', supplierName: 'Supplier', supplierSku: 'Supplier’s code', packUnits: 'Units in a pack', packPrice: 'Pack price', costPrice: 'Cost each', weightKg: 'Weight', alsoSold: 'Also sold' }
  const was = { name: si.name, supplierName: d.supplierName || '', supplierSku: d.supplierSku || '', packUnits: d.packUnits ?? '', packPrice: d.packPrice ?? '', costPrice: d.costPrice ?? '', weightKg: d.weightKg ?? '', alsoSold: !!d.alsoSold }
  const changed = Object.keys(f).filter(k => String(f[k]) !== String(was[k]))
  const oldEach = unitCost(si)
  const save = async () => {
    setBusy(true)
    try {
      await onSave(si, { ...d, name: f.name.trim(), supplierName: f.supplierName.trim(), supplierSku: f.supplierSku.trim(),
        packUnits: packs ? num(f.packUnits) : '', packPrice: packs ? num(f.packPrice) : '', costPrice: String(+each.toFixed(4)), weightKg: f.weightKg, alsoSold: f.alsoSold, packaging: true })
      setConfirm(false)
    } finally { setBusy(false) }
  }
  return (
    <Drawer title={si.name} description={[d.sku, d.supplierName].filter(Boolean).join(' · ') || 'Packaging item'} onClose={onClose} width="max-w-xl"
      footer={office && (
        <div className="flex gap-2">
          {ip && <button className="btn btn-secondary btn-sm" onClick={() => onOpenProductPage(si)}>Product page</button>}
          <button className="btn btn-primary flex-1 justify-center" disabled={!changed.length || !f.name.trim()} onClick={() => setConfirm(true)}>Save changes{changed.length ? ` (${changed.length})` : ''}</button>
        </div>
      )}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><label className="label">Name</label><input className="input" value={f.name} onChange={set('name')} disabled={!office} /></div>
          <div><label className="label">Supplier</label><input className="input" value={f.supplierName} onChange={set('supplierName')} disabled={!office} /></div>
          <div><label className="label">Supplier’s code</label><input className="input" value={f.supplierSku} onChange={set('supplierSku')} disabled={!office} /></div>
          <div><label className="label">Units in a pack</label><input className="input tabular-nums" type="number" min="1" step="1" value={f.packUnits} onChange={set('packUnits')} disabled={!office} placeholder="1 if sold singly" /></div>
          {packs
            ? <div><label className="label">Pack price £</label><input className="input tabular-nums" type="number" min="0" step="0.01" value={f.packPrice} onChange={set('packPrice')} disabled={!office} /></div>
            : <div><label className="label">Cost each £</label><input className="input tabular-nums" type="number" min="0" step="0.0001" value={f.costPrice} onChange={set('costPrice')} disabled={!office} /></div>}
          <div><label className="label">Weight of one, kg</label><input className="input tabular-nums" type="number" min="0" step="0.001" value={f.weightKg} onChange={set('weightKg')} disabled={!office} /></div>
          <div className="flex items-end pb-2 text-sm">{each > 0 ? <span>Costs <b className="tabular-nums">{money4(each)}</b> each</span> : <span className="text-warn">No cost yet</span>}</div>
          <label className="col-span-2 flex items-center gap-2 text-sm mt-1"><input type="checkbox" checked={f.alsoSold} onChange={set('alsoSold')} disabled={!office} /> Also sold — show it on Products too (one stock count for both)</label>
        </div>

        {d.priceSource && <div className="text-xs text-ink/50 -mt-2">Price from {d.priceSource}</div>}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-[6px] bg-paper px-3 py-2"><div className="text-[11px] text-ink/50">In stock</div><div className="font-semibold tabular-nums">{ip ? Math.round(ip.on_hand).toLocaleString('en-GB') : '—'}</div></div>
          <div className="rounded-[6px] bg-paper px-3 py-2"><div className="text-[11px] text-ink/50">Packaging types</div><div className="font-semibold tabular-nums">{use.types.length}</div></div>
          <div className="rounded-[6px] bg-paper px-3 py-2"><div className="text-[11px] text-ink/50">Listings</div><div className="font-semibold tabular-nums">{use.listings.length}</div></div>
        </div>
        {!ip && <div className="text-xs text-ink/55">Not in Inventory yet — it comes in through Goods In, or is added from Inventory → Set up.</div>}

        <div>
          <div className="title-case text-sm font-semibold text-ink mb-1.5">Used in</div>
          {use.types.length ? (
            <div className="space-y-3">
              {use.types.map(t => {
                const ls = use.listings.filter(r => r.data?.packagingId === t.id)
                return (
                  <div key={t.id} className="rounded-[8px] border border-rule p-3">
                    <button className="text-sm font-medium text-royal-700 hover:underline" onClick={() => onOpenType?.(t)}>{t.name}</button>
                    <div className="text-xs text-ink/55 mt-0.5">{plural(ls.length, 'listing')}</div>
                    {ls.length > 0 && <div className="text-xs text-ink/65 mt-1.5 space-y-0.5">{ls.slice(0, 5).map(r => <div key={r.id} className="truncate">{r.name}</div>)}{ls.length > 5 && <div className="text-ink/45">+{ls.length - 5} more</div>}</div>}
                  </div>
                )
              })}
              {use.products.length > 0 && <div className="text-xs text-ink/60">Packs {plural(use.products.length, 'product')}: {use.products.slice(0, 8).map(p => p.name).join(', ')}{use.products.length > 8 ? '…' : ''}</div>}
            </div>
          ) : <div className="text-sm text-ink/55">Not part of any packaging type yet.</div>}
        </div>
      </div>
      {confirm && (
        <Modal title="Save these changes?" description={si.name} onClose={() => setConfirm(false)}>
          <div className="border border-rule rounded-[8px] divide-y divide-rule/70 text-sm">
            {changed.map(k => <div key={k} className="px-3 py-2 grid grid-cols-[120px_1fr] gap-2"><span className="text-ink/55">{LABEL[k]}</span>
              <span><span className="line-through text-ink/45">{String(was[k] === true ? 'yes' : was[k] === false ? 'no' : was[k] || 'empty')}</span> → <b>{String(f[k] === true ? 'yes' : f[k] === false ? 'no' : f[k] || 'empty')}</b></span></div>)}
          </div>
          {Math.abs(each - oldEach) > 0.00005 && use.types.length > 0 && (
            <div className="text-xs text-warn mt-3">Cost each {money4(oldEach)} → {money4(each)}: changes the cost of {plural(use.types.length, 'packaging type')} and {plural(use.listings.length, 'listing')}’ margins.</div>
          )}
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setConfirm(false)}>Keep editing</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={save}><Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </Drawer>
  )
}

