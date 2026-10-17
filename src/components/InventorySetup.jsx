import React, { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Icon, StatusBadge, SearchInput } from './UI'
import { num } from './InventoryParts'
import {
  readCountSheet, packToSingles, parseAmazonOrders, salesByDay, skuSummary, learnSkus, suggestProducts, packOf, fmtUnits, norm,
} from '../lib/inventory'
import {
  invImportCount, invImportSales, invSaveSku, invSaveProduct, loadHelmItems, loadSlipsByRef, loadChannelSkus, loadChannelSkuTotals,
  invSetCountPlan,
} from '../lib/db'

const localInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16) }

/**
 * For the office: loading a stock count, loading sales history, saying what
 * each marketplace SKU is, and adding products that sell but aren't in
 * inventory.
 */
export default function InventorySetup({ me, inventory, products, showToast, onRefresh, onDone }) {
  const started = !!inventory?.meta?.started_at
  return (
    <div className="space-y-8 max-w-4xl">
      <CountImport me={me} started={started} meta={inventory?.meta} showToast={showToast} onDone={onDone} />
      {started && <CountPlan inventory={inventory} showToast={showToast} onRefresh={onRefresh} />}
      {started && <SalesImport me={me} products={products} showToast={showToast} onRefresh={onRefresh} />}
      {started && <Unmatched me={me} inventory={inventory} showToast={showToast} onRefresh={onRefresh} />}
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="text-sm text-ink/60 mt-0.5 mb-3 max-w-2xl">{description}</p>}
      {children}
    </section>
  )
}

// ── Stock count ──────────────────────────────────────────────────────────────

function CountImport({ me, started, meta, showToast, onDone }) {
  const [file, setFile] = useState(null)
  const [read, setRead] = useState(null)
  const [countedAt, setCountedAt] = useState(localInput('2026-10-16T18:00:00'))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const load = async (f) => {
    setFile(f); setRead(null); setResult(null)
    try {
      const wb = XLSX.read(await f.arrayBuffer())
      const name = wb.SheetNames.find(n => /stock by location/i.test(n)) || wb.SheetNames[0]
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })
      const sheet = readCountSheet(aoa)
      let helm = []
      try { helm = await loadHelmItems() } catch { /* read from the names instead */ }
      const conv = packToSingles(sheet.rows, helm)
      setRead({ sheet: name, rows: conv.rows, conversions: conv.conversions, problems: sheet.problems })
    } catch (e) { setRead({ rows: [], conversions: [], problems: [`Couldn’t read that file — ${e.message}`] }) }
  }

  const summary = useMemo(() => {
    if (!read?.rows.length) return null
    const r = read.rows
    return {
      rows: r.length, units: r.reduce((s, x) => s + x.qty, 0), shelves: new Set(r.map(x => x.location)).size,
      products: new Set(r.map(x => norm(x.code))).size, pending: new Set(r.filter(x => !x.in_helm).map(x => norm(x.code))).size,
      empty: r.filter(x => !x.qty).length, pick: new Set(r.filter(x => x.pickable).map(x => x.location)).size,
    }
  }, [read])

  const run = async () => {
    setBusy(true)
    try {
      const rows = read.rows.map(({ location, pickable, code, name, in_helm, qty }) => ({ location, pickable, code, name, in_helm, qty }))
      const res = await invImportCount(rows, new Date(countedAt).toISOString(), me?.name)
      setResult(res)
      showToast?.(res.opening ? 'Opening stock loaded' : 'Stock count loaded')
    } catch (e) { showToast?.(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Section title={started ? 'Load a stock count' : 'Load the opening stock'}
      description={started
        ? 'Upload a count in the same layout as the HELM “Stock by Location” sheet. Each shelf listed is set to the number counted and the difference is recorded. Shelves not in the sheet are left alone.'
        : 'Upload the HELM “Stock by Location” sheet. Only the shelf, product, code, HELM status and quantity are read — other columns are ignored.'}>
      {started && meta?.counted_at && <div className="text-xs text-ink/50 mb-3">Opening count taken {new Date(meta.counted_at).toLocaleString('en-GB')}.</div>}
      <label className="btn btn-secondary cursor-pointer">
        <Icon name="upload" size={15} /> {file ? 'Choose another file' : 'Choose the spreadsheet'}
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f) }} />
      </label>
      {file && <span className="text-sm text-ink/60 ml-3">{file.name}</span>}

      {read && (
        <div className="card p-4 mt-4 space-y-3">
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-ink/50">Units</div><div className="text-lg font-semibold tabular-nums">{fmtUnits(summary.units)}</div></div>
              <div><div className="text-xs text-ink/50">Products</div><div className="text-lg font-semibold tabular-nums">{summary.products}</div></div>
              <div><div className="text-xs text-ink/50">Shelves</div><div className="text-lg font-semibold tabular-nums">{summary.shelves} <span className="text-xs font-normal text-ink/50">({summary.pick} pick)</span></div></div>
              <div><div className="text-xs text-ink/50">Not in HELM yet</div><div className="text-lg font-semibold tabular-nums">{summary.pending}</div></div>
            </div>
          )}
          {summary?.empty > 0 && <div className="text-xs text-ink/55">{summary.empty} line{summary.empty === 1 ? '' : 's'} at 0 — kept as the product’s pick shelf.</div>}
          {read.conversions.map((c, i) => (
            <div key={i} className="text-sm px-3 py-2 rounded-[6px] bg-sky/30 border border-royal-200">
              Counted as singles: {fmtUnits(c.from.qty)} × <b>{c.from.name}</b> on {c.from.location} → {fmtUnits(c.to.qty)} × <b>{c.to.name}</b> <span className="tabular-nums text-ink/55">({c.to.code})</span>
            </div>
          ))}
          {read.problems.length > 0 && (
            <div className="text-sm text-loss space-y-0.5">{read.problems.slice(0, 10).map(p => <div key={p}>{p}</div>)}
              {read.problems.length > 10 && <div>…and {read.problems.length - 10} more</div>}</div>
          )}
          {summary && !result && (
            <>
              <div className="max-w-xs">
                <label className="label" htmlFor="counted-at">When was it counted?</label>
                <input id="counted-at" type="datetime-local" className="input" value={countedAt} onChange={e => setCountedAt(e.target.value)} />
                {!started && <div className="text-xs text-ink/50 mt-1">Orders dispatched after this come off the count straight away. Orders dispatched before it were already gone when you counted.</div>}
              </div>
              <button className="btn btn-primary" disabled={busy} onClick={run}>
                <Icon name="check" size={15} /> {busy ? 'Loading…' : started ? `Load ${summary.rows} counted lines` : `Load ${fmtUnits(summary.units)} units as the opening stock`}
              </button>
            </>
          )}
          {result && (
            <div className="text-sm text-gain">
              Loaded {result.rows} lines, {fmtUnits(result.units)} units.
              {result.opening && ` ${result.orders_taken_off} order${result.orders_taken_off === 1 ? '' : 's'} dispatched since the count ${result.orders_taken_off === 1 ? 'has' : 'have'} been taken off.`}
              <button className="btn btn-primary btn-sm ml-3" onClick={onDone}>See the stock</button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ── Sales history ────────────────────────────────────────────────────────────

function SalesImport({ me, products, showToast, onRefresh }) {
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [skus, setSkus] = useState(null)        // what's saved
  const [totals, setTotals] = useState(null)

  const reload = async () => {
    try {
      const [s, t] = await Promise.all([loadChannelSkus('amazon'), loadChannelSkuTotals('amazon')])
      setSkus(s); setTotals(t)
    } catch { setSkus([]) }
  }
  useEffect(() => { reload() }, [])

  const load = async (f) => {
    setParsed({ reading: true })
    try {
      const p = parseAmazonOrders(await f.text())
      if (p.problem) { setParsed({ problem: p.problem }); return }
      const refs = [...new Set(p.rows.map(r => norm(r.orderId)))]
      let slips = {}
      try { slips = await loadSlipsByRef(refs) } catch { /* nothing learned, all by hand */ }
      const learned = learnSkus(p.rows, slips)
      setParsed({ ...p, learned, summary: skuSummary(p.rows), matchedOrders: Object.keys(slips).length, file: f.name })
    } catch (e) { setParsed({ problem: `Couldn’t read that file — ${e.message}` }) }
  }

  const run = async () => {
    setBusy(true)
    try {
      const rows = salesByDay(parsed.rows)
      const list = parsed.summary.map(s => ({ sku: s.sku, title: s.title, items: parsed.learned[s.sku]?.items || [], how: parsed.learned[s.sku] ? 'orders' : null }))
      await invImportSales('amazon', rows, list, me?.name)
      showToast?.('Sales history loaded')
      setParsed(null); await reload(); onRefresh?.()
    } catch (e) { showToast?.(e.message, 'error') } finally { setBusy(false) }
  }

  const learnedN = parsed?.summary ? parsed.summary.filter(s => parsed.learned[s.sku]).length : 0

  return (
    <Section title="Sales history"
      description="Upload Amazon’s order report to give the stock a head start on how fast things sell. Only the order number, SKU, quantity and date are read — no customer details are kept. From the day Dispatch has the orders itself, its figures (every channel) are used instead.">
      <label className="btn btn-secondary cursor-pointer">
        <Icon name="upload" size={15} /> Upload Amazon orders (.txt)
        <input type="file" accept=".txt,.tsv,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f) }} />
      </label>
      {parsed?.reading && <div className="text-sm text-ink/50 mt-3">Reading and matching orders…</div>}
      {parsed?.problem && <div className="text-sm text-loss mt-3">{parsed.problem}</div>}
      {parsed?.summary && (
        <div className="card p-4 mt-4 space-y-2 text-sm">
          <div><b>{parsed.file}</b>: {fmtUnits(parsed.rows.length)} order lines, {parsed.from} to {parsed.to}, {parsed.summary.length} SKUs.</div>
          <div className="text-ink/60">Left out: {parsed.skipped.cancelled} cancelled, {parsed.skipped.unshipped} never shipped.</div>
          <div className="text-ink/60">{learnedN} of {parsed.summary.length} SKUs were worked out from orders that went through Dispatch ({fmtUnits(parsed.matchedOrders)} orders matched). The rest you can set below after loading.</div>
          <button className="btn btn-primary" disabled={busy} onClick={run}><Icon name="check" size={15} /> {busy ? 'Loading…' : 'Load the sales history'}</button>
        </div>
      )}
      {skus && skus.length > 0 && <SkuList skus={skus} totals={totals} products={products} me={me} showToast={showToast} onSaved={() => { reload(); onRefresh?.() }} />}
    </Section>
  )
}

function SkuList({ skus, totals, products, me, showToast, onSaved }) {
  const [show, setShow] = useState('todo')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const byCode = useMemo(() => new Map(products.map(p => [norm(p.code), p])), [products])
  const rows = skus.map(s => ({ ...s, units: totals?.totals.get(s.sku) || 0 }))
    .sort((a, b) => b.units - a.units)
  const todo = rows.filter(s => !s.items?.length)
  const list = (show === 'todo' ? todo : rows).filter(s => !q.trim() || `${s.sku} ${s.title}`.toLowerCase().includes(q.trim().toLowerCase()))
  const describe = (items) => items.map(i => `${i.qty} × ${byCode.get(norm(i.code))?.name || i.code}`).join(' + ')
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-ink mr-auto">What each Amazon SKU is{totals?.from ? ` · sales ${totals.from} to ${totals.to}` : ''}</h3>
        <button className={`btn btn-xs ${show === 'todo' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShow('todo')}>Not set ({todo.length})</button>
        <button className={`btn btn-xs ${show === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShow('all')}>All ({rows.length})</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="SKU or title" className="w-full sm:w-56" />
      </div>
      {show === 'todo' && todo.length > 0 && <div className="text-xs text-ink/55 mb-2">Busiest first. Until a SKU is set, its sales don’t count towards any product’s rate.</div>}
      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {list.slice(0, 80).map(s => (
          <div key={s.sku}>
            <button className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-sky/20" onClick={() => setOpen(open === s.sku ? null : s.sku)}>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink font-medium">{s.sku}</div>
                <div className="text-xs text-ink/50 truncate">{s.title}</div>
                <div className="text-xs mt-0.5">{s.items?.length ? <span className="text-ink/75">{describe(s.items)}</span> : <span className="text-loss">Not set</span>}
                  {s.how === 'orders' && <span className="text-ink/40"> · from orders</span>}{s.how === 'person' && <span className="text-ink/40"> · set by {s.updated_by || 'hand'}</span>}</div>
              </div>
              <span className="text-xs tabular-nums text-ink/55 shrink-0">{fmtUnits(s.units)} sold</span>
            </button>
            {open === s.sku && <SkuEditor s={s} products={products} me={me} showToast={showToast} onSaved={() => { setOpen(null); onSaved() }} />}
          </div>
        ))}
        {!list.length && <div className="px-3 py-3 text-sm text-ink/50">{show === 'todo' ? 'Every SKU is set.' : 'Nothing matches.'}</div>}
      </div>
    </div>
  )
}

function SkuEditor({ s, products, me, showToast, onSaved }) {
  const byCode = useMemo(() => new Map(products.map(p => [norm(p.code), p])), [products])
  const ideas = useMemo(() => suggestProducts(s.sku, s.title, products, 4), [s, products])
  const [items, setItems] = useState(s.items?.length ? s.items.map(i => ({ ...i })) : [])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const found = q.trim() ? products.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : []
  const add = (p, qty = packOf(s.sku, s.title)) => { setItems(x => [...x.filter(i => norm(i.code) !== norm(p.code)), { code: p.code, qty }]); setQ('') }
  const save = async (list) => {
    setBusy(true)
    try { await invSaveSku('amazon', s.sku, list, me?.name); showToast?.('Saved'); onSaved() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) }
  }
  return (
    <div className="px-3 pb-3 pt-1 bg-paper/50 space-y-2.5">
      {!items.length && ideas.length > 0 && (
        <div>
          <div className="label">Probably</div>
          <div className="flex gap-1.5 flex-wrap">
            {ideas.map(x => (
              <button key={x.product.id} className="btn btn-secondary btn-xs" onClick={() => add(x.product, x.units)}>{x.units} × {x.product.name}</button>
            ))}
          </div>
        </div>
      )}
      {items.map((i, k) => (
        <div key={i.code} className="flex items-center gap-2">
          <input type="number" min="1" className="input w-20 py-1.5 tabular-nums" value={i.qty} aria-label="How many in one sale"
            onChange={e => setItems(x => x.map((y, j) => (j === k ? { ...y, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : y)))} />
          <span className="text-sm text-ink flex-1">× {byCode.get(norm(i.code))?.name || i.code}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setItems(x => x.filter((_, j) => j !== k))} aria-label="Remove">✕</button>
        </div>
      ))}
      <div>
        <input className="input py-1.5" value={q} onChange={e => setQ(e.target.value)} placeholder={items.length ? 'Add another product (for a mixed set)' : 'Search for the product'} />
        {found.length > 0 && (
          <div className="mt-1 border border-rule rounded-[6px] bg-white divide-y divide-rule/70">
            {found.map(p => <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-sky/25" onClick={() => add(p)}>{p.name} <span className="text-xs text-ink/45">{p.code}</span></button>)}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy || !items.length} onClick={() => save(items)}>Save</button>
        {s.items?.length > 0 && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save([])}>Clear it</button>}
        <span className="text-xs text-ink/45 self-center">The number is how many of that product one sale of this SKU sends out.</span>
      </div>
    </div>
  )
}

// ── Sold, but not in inventory ───────────────────────────────────────────────

function Unmatched({ me, inventory, showToast, onRefresh }) {
  const list = useMemo(() => {
    const m = new Map()
    for (const u of inventory?.unmatched_open || []) m.set(norm(u.code), { code: u.code, name: u.name, open: num(u.units), sold: 0 })
    for (const u of inventory?.unmatched_sold || []) {
      const k = norm(u.code)
      m.set(k, { ...(m.get(k) || { code: u.code, name: u.name, open: 0 }), sold: num(u.units) })
    }
    return [...m.values()]
  }, [inventory])
  const [busy, setBusy] = useState(null)
  if (!list.length) return null
  const add = async (u) => {
    setBusy(u.code)
    try {
      await invSaveProduct(null, { code: u.code, name: u.name || u.code, in_helm: true }, me?.name)
      showToast?.(`${u.code} added — give it a shelf and count it`); onRefresh?.()
    } catch (e) { showToast?.(e.message, 'error') } finally { setBusy(null) }
  }
  return (
    <Section title="Selling, but not in inventory"
      description="Item codes on orders that don’t match any product here, so nothing comes off for them. Add the ones you hold. If one is a pack or set of things you do hold, upload HELM’s product list in Dispatch instead, so it’s split into its parts.">
      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {list.map(u => (
          <div key={u.code} className="px-3 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">{u.name || u.code}</div>
              <div className="text-xs text-ink/50 tabular-nums">{u.code}{u.open ? ` · ${fmtUnits(u.open)} on open orders` : ''}{u.sold ? ` · ${fmtUnits(u.sold)} gone out` : ''}</div>
            </div>
            <StatusBadge tone="paused">Not in inventory</StatusBadge>
            <button className="btn btn-secondary btn-xs" disabled={busy === u.code} onClick={() => add(u)}><Icon name="plus" size={12} /> Add</button>
          </div>
        ))}
      </div>
    </Section>
  )
}

function CountPlan({ inventory, showToast, onRefresh }) {
  const [n, setN] = useState(String(inventory?.meta?.count_per_day ?? 12))
  const [busy, setBusy] = useState(false)
  const shelves = (inventory?.locations || []).length
  return (
    <Section title="Daily cycle counts"
      description="Each day the warehouse gets a few shelves to count in Tasks — the ones not counted for longest, with fast sellers, or where something didn’t add up. Shelves counted in the last two weeks are skipped.">
      <div className="flex items-end gap-2">
        <div><label className="label" htmlFor="cpd">Shelves a day</label>
          <input id="cpd" type="number" min="0" max="100" className="input w-24 tabular-nums" value={n} onChange={e => setN(e.target.value)} /></div>
        <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await invSetCountPlan(parseInt(n, 10) || 0); showToast?.('Saved — applies from tomorrow'); onRefresh?.() } catch (e) { showToast?.(e.message, 'error') } finally { setBusy(false) } }}>Save</button>
        {num(n) > 0 && shelves > 0 && <span className="text-xs text-ink/50 pb-2">Every shelf about every {Math.max(14, Math.ceil(shelves / num(n) * 7 / 6))} days</span>}
      </div>
    </Section>
  )
}
