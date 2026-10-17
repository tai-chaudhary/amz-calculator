import React, { useState, useMemo, useEffect } from 'react'
import { PageHeader, Icon, StatusBadge, SegmentedControl, SearchInput, EmptyState, Drawer, MetricCard } from './UI'
import { StockChange, PickBadge, HelmFlag, LocationInput, WhoSelect, useWho, num } from './InventoryParts'
import InventorySetup from './InventorySetup'
import {
  AISLES, baysIn, parseLocation, byLocation, shelfLabel, cleanLocation, stockState, STATE_LABEL, needsRestock,
  fmtUnits, fmtDays, matchesProduct, MOVEMENT_LABEL,
} from '../lib/inventory'
import { loadMovements, loadProductOrders, loadDespatchDays, invSaveLocation, invSaveProduct, invAssign } from '../lib/db'

const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const todayLondon = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'restock', label: 'Need ordering', test: (p) => needsRestock(p.st) },
  { id: 'pick', label: 'Pick shelf low', test: (p, tasks) => tasks.some(t => t.product_id === p.id && t.status === 'open') },
  { id: 'helm', label: 'Not in HELM', test: (p) => !p.in_helm },
  { id: 'check', label: 'Needs a count', test: (p) => p.on_hand < 0 || (p.locations || []).some(l => l.qty < 0) || p.nowhere !== 0 },
  { id: 'noshelf', label: 'No pick shelf', test: (p) => !(p.locations || []).some(l => l.pickable) },
]

/**
 * Stock: how much of everything there is, where it is, and how long it'll
 * last. Open orders hold stock from the moment their labels are uploaded,
 * and units come off the shelf when they're despatched.
 */
export default function InventoryPage({ me, inventory, people = [], focusId, office = false, canEdit = false, stockItems = [], showToast, onRefresh, onNavigate }) {
  const [view, setView] = useState('stock')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const [openId, setOpenId] = useState(null)
  const [openShelf, setOpenShelf] = useState(null)
  const [change, setChange] = useState(null)      // { mode, product, from, to }

  useEffect(() => {
    onRefresh?.()
    const t = setInterval(() => onRefresh?.(), 60000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusId) return
    if (String(focusId).startsWith('shelf:')) { setView('shelves'); setOpenShelf(focusId.slice(6)) }
    else setOpenId(focusId)
  }, [focusId])

  const tasks = inventory?.tasks || []
  const locations = inventory?.locations || []
  const products = useMemo(() => (inventory?.products || []).map(p => ({ ...p, st: stockState(p) })), [inventory])
  const started = !!inventory?.meta?.started_at

  const shown = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter)
    const list = products.filter(p => matchesProduct(p, search) && (!f?.test || f.test(p, tasks)))
    if (sort === 'days') return list.sort((a, b) => (a.st.cover ?? 1e9) - (b.st.cover ?? 1e9) || a.name.localeCompare(b.name))
    if (sort === 'stock') return list.sort((a, b) => b.on_hand - a.on_hand)
    return list
  }, [products, search, filter, sort, tasks])

  const totals = useMemo(() => products.reduce((t, p) => ({
    onHand: t.onHand + Math.max(0, p.on_hand), open: t.open + p.open_orders, available: t.available + Math.max(0, p.available),
    restock: t.restock + (needsRestock(p.st) ? 1 : 0), helm: t.helm + (p.in_helm ? 0 : 1),
  }), { onHand: 0, open: 0, available: 0, restock: 0, helm: 0 }), [products])
  const openTasks = tasks.filter(t => t.status === 'open').length

  const open = products.find(p => p.id === openId)
  const counts = Object.fromEntries(FILTERS.map(f => [f.id, f.test ? products.filter(p => f.test(p, tasks)).length : products.length]))
  const VIEWS = [
    { id: 'stock', label: 'Stock', count: null },
    { id: 'shelves', label: 'Shelves', count: null },
    { id: 'despatched', label: 'Despatched', count: null },
    { id: 'history', label: 'History', count: null },
    ...(office ? [{ id: 'setup', label: 'Set up', count: null }] : []),
  ]
  const common = { me, people, office, locations, products, showToast }

  if (inventory && !started && view !== 'setup') {
    return (
      <div>
        <PageHeader eyebrow="Warehouse / inventory" title="Inventory" description="Stock by product and shelf, kept up to date by Goods In and Dispatch." />
        <EmptyState icon="box" title="No stock loaded yet"
          sub={office ? 'Start by importing your stock count — the HELM “Stock by Location” sheet.' : 'The office needs to import the opening stock count first.'}
          action={office && <button className="btn btn-primary btn-sm" onClick={() => setView('setup')}><Icon name="upload" size={14} /> Import the stock count</button>} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse / inventory"
        title="Inventory"
        description="What’s in stock, where it is, and how long it’ll last."
        actions={canEdit && (
          <button className="btn btn-primary w-full sm:w-auto justify-center py-3 sm:py-2" onClick={() => setChange({ mode: null })}>
            <Icon name="layers" size={16} /> Move, add or count
          </button>
        )}
      />

      <div className="overflow-x-auto max-w-full -mx-1 px-1 mb-4">
        <SegmentedControl label="Show" value={view} onChange={setView} items={VIEWS} />
      </div>

      {view === 'stock' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="On the shelves" value={fmtUnits(totals.onHand)} sub={`${products.length} products`} />
            <MetricCard label="In open orders" value={fmtUnits(totals.open)} sub="labels uploaded, not gone yet" />
            <MetricCard label="Available" value={fmtUnits(totals.available)} sub="on the shelves minus open orders" />
            <MetricCard label="Need ordering" value={totals.restock} color={totals.restock ? 'text-loss' : 'text-ink'} sub="under 15 days’ stock" onClick={() => setFilter('restock')} />
            <MetricCard label="Pick shelves to top up" value={openTasks} color={openTasks ? 'text-warn' : 'text-ink'} sub="tasks for the warehouse" onClick={() => onNavigate?.('tasks')} />
          </div>

          <div className="flex gap-3 flex-wrap items-center justify-between mb-3">
            <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Product, code or shelf" className="w-full sm:w-80" autoFocus={false} />
            <div className="flex gap-2 items-center">
              <label className="text-xs text-ink/50" htmlFor="inv-sort">Sort</label>
              <select id="inv-sort" className="input py-1.5 text-sm w-auto" value={sort} onChange={e => setSort(e.target.value)}>
                <option value="name">Name</option>
                <option value="days">Days left</option>
                <option value="stock">Most stock</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap mb-4">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-full border text-xs ${filter === f.id ? 'border-royal-500 bg-royal-500 text-white' : 'border-rule bg-white text-ink/70 hover:border-royal-300'}`}>
                {f.label} <span className={filter === f.id ? 'text-white/70' : 'text-ink/35'}>{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {(inventory?.unmatched_open?.length > 0) && filter === 'all' && !search && (
            <div className="text-xs text-ink/60 mb-3 px-3 py-2 rounded-[6px] bg-coral/10 border border-coral/25">
              {inventory.unmatched_open.length} item code{inventory.unmatched_open.length === 1 ? ' is' : 's are'} on open orders but not in inventory
              ({inventory.unmatched_open.slice(0, 3).map(u => u.code).join(', ')}{inventory.unmatched_open.length > 3 ? '…' : ''}).
              {office ? ' Add them under Set up.' : ' The office can add them.'}
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState icon="box" title="Nothing matches" sub="Try a different search or filter." />
          ) : (
            <>
              {/* Phones: a card each */}
              <div className="space-y-2 md:hidden">
                {shown.map(p => <ProductCard key={p.id} p={p} onOpen={() => setOpenId(p.id)} />)}
              </div>
              {/* Wider: a table */}
              <div className="hidden md:block table-shell overflow-x-auto">
                <table className="data-table">
                  <thead><tr>
                    <th>Product</th><th>Shelves</th><th className="text-right">On shelves</th><th className="text-right">Open orders</th>
                    <th className="text-right">Available</th><th className="text-right">Sells / day</th><th className="text-right">Lasts</th><th></th>
                  </tr></thead>
                  <tbody>
                    {shown.map(p => (
                      <tr key={p.id} className="cursor-pointer" onClick={() => setOpenId(p.id)}>
                        <td className="max-w-[320px]">
                          <div className="text-ink font-medium leading-snug">{p.name}</div>
                          <div className="text-xs text-ink/45 tabular-nums flex items-center gap-1.5 mt-0.5">{p.code} <HelmFlag p={p} /></div>
                        </td>
                        <td className="text-xs tabular-nums"><ShelfList p={p} /></td>
                        <td className={`text-right tabular-nums ${p.on_hand < 0 ? 'text-loss' : ''}`}>{fmtUnits(p.on_hand)}</td>
                        <td className="text-right tabular-nums text-ink/60">{p.open_orders ? fmtUnits(p.open_orders) : '—'}</td>
                        <td className={`text-right tabular-nums font-semibold ${p.available <= 0 ? 'text-loss' : 'text-ink'}`}>{fmtUnits(p.available)}</td>
                        <td className="text-right tabular-nums text-ink/60">{p.st.daily > 0 ? p.st.daily.toFixed(p.st.daily < 10 ? 1 : 0) : '—'}</td>
                        <td className="text-right tabular-nums">{fmtDays(p.st.cover)}</td>
                        <td><StateBadge p={p} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {view === 'shelves' && <ShelvesView {...common} onOpenShelf={setOpenShelf} onOpenProduct={setOpenId} />}
      {view === 'despatched' && <DespatchedView onOpenProduct={setOpenId} />}
      {view === 'history' && <HistoryView products={products} onOpenProduct={setOpenId} />}
      {view === 'setup' && office && <InventorySetup {...common} inventory={inventory} stockItems={stockItems} onRefresh={onRefresh} onDone={() => { onRefresh?.(); setView('stock') }} />}

      {open && (
        <ProductDrawer p={open} {...common} canEdit={canEdit} stockItems={stockItems} tasks={tasks}
          onClose={() => setOpenId(null)} onChange={(c) => setChange({ ...c, product: open })} onRefresh={onRefresh}
          onOpenShelf={(code) => { setOpenId(null); setView('shelves'); setOpenShelf(code) }} />
      )}
      {openShelf && (
        <ShelfDrawer code={openShelf} {...common} canEdit={canEdit} onClose={() => setOpenShelf(null)} onRefresh={onRefresh}
          onOpenProduct={(id) => { setOpenShelf(null); setOpenId(id) }}
          onChange={(c) => setChange(c)} />
      )}
      {change && (
        <StockChange {...common} {...change} mode={change.mode || undefined}
          product={change.product ? products.find(p => p.id === change.product.id) : null}
          onClose={() => setChange(null)} onDone={() => { setChange(null); onRefresh?.() }} />
      )}
    </div>
  )
}

function StateBadge({ p }) {
  const s = STATE_LABEL[p.st.state]
  if (!s || p.st.state === 'ok') return null
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
}

function ShelfList({ p, max = 3 }) {
  const shelves = [...(p.locations || [])].sort((a, b) => (b.pickable - a.pickable) || byLocation(a, b))
  if (!shelves.length) return <span className="text-loss">No shelf</span>
  return (
    <span>
      {shelves.slice(0, max).map((l, i) => (
        <span key={l.code}>{i > 0 && ', '}<span className={l.pickable ? 'font-semibold text-royal-600' : 'text-ink/60'}>{l.code}</span></span>
      ))}
      {shelves.length > max && <span className="text-ink/40"> +{shelves.length - max}</span>}
    </span>
  )
}

function ProductCard({ p, onOpen }) {
  return (
    <button className="card w-full text-left p-3.5 active:bg-sky/20" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink leading-snug">{p.name}</div>
          <div className="text-xs text-ink/45 tabular-nums mt-0.5">{p.code}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xl font-semibold tabular-nums ${p.available <= 0 ? 'text-loss' : 'text-ink'}`}>{fmtUnits(p.available)}</div>
          <div className="text-[11px] text-ink/45">available</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="text-xs tabular-nums"><ShelfList p={p} max={2} /></div>
        <div className="flex gap-1 flex-wrap justify-end"><HelmFlag p={p} /><StateBadge p={p} /></div>
      </div>
      {(p.open_orders > 0 || p.st.cover != null) && (
        <div className="text-xs text-ink/50 mt-1.5">
          {[`${fmtUnits(p.on_hand)} on shelves`, p.open_orders > 0 && `${fmtUnits(p.open_orders)} in open orders`, p.st.cover != null && `lasts ${fmtDays(p.st.cover)}`].filter(Boolean).join(' · ')}
        </div>
      )}
    </button>
  )
}

// ── One product ──────────────────────────────────────────────────────────────

function ProductDrawer({ p, me, people, office, canEdit, locations, stockItems, tasks, showToast, onClose, onChange, onRefresh, onOpenShelf }) {
  const [history, setHistory] = useState(null)
  const [orders, setOrders] = useState(null)
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  useEffect(() => {
    setHistory(null); setOrders(null)
    loadMovements({ productId: p.id, limit: 40 }).then(setHistory).catch(() => setHistory([]))
  }, [p.id, p.on_hand])
  const shelves = [...(p.locations || [])].sort((a, b) => (b.pickable - a.pickable) || byLocation(a, b))
  const task = tasks.find(t => t.product_id === p.id && t.status === 'open')
  const s = p.st

  return (
    <Drawer title={p.name} description={<span className="tabular-nums">{p.code}</span>} onClose={onClose}
      footer={canEdit && (
        <div className="grid grid-cols-4 gap-2">
          <button className="btn btn-secondary justify-center py-3 sm:py-2" onClick={() => onChange({ mode: 'move' })}>Move</button>
          <button className="btn btn-secondary justify-center py-3 sm:py-2" onClick={() => onChange({ mode: 'add' })}>Add</button>
          <button className="btn btn-secondary justify-center py-3 sm:py-2" onClick={() => onChange({ mode: 'remove' })}>Remove</button>
          <button className="btn btn-secondary justify-center py-3 sm:py-2" onClick={() => onChange({ mode: 'count' })}>Count</button>
        </div>
      )}>
      <div className="space-y-5">
        {!p.in_helm && (
          <div className="text-sm px-3 py-2.5 rounded-[6px] bg-warn/10 border border-warn/30 text-ink/80">
            Not in HELM yet. Create it there with the code <b className="tabular-nums">{p.code}</b> so its orders take stock off automatically.
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="On shelves" value={fmtUnits(p.on_hand)} bad={p.on_hand < 0} />
          <button className="text-left" onClick={() => p.open_orders > 0 && loadProductOrders(p.id).then(setOrders).catch(() => setOrders([]))}>
            <Stat label="Open orders" value={fmtUnits(p.open_orders)} sub={p.open_orders > 0 ? `${p.open_order_count} order${p.open_order_count === 1 ? '' : 's'} · show` : null} />
          </button>
          <Stat label="Available" value={fmtUnits(p.available)} bad={p.available <= 0} strong />
        </div>
        {orders && (
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 text-sm">
            {orders.map((o, i) => (
              <div key={i} className="px-3 py-2 flex justify-between gap-2">
                <span className="tabular-nums text-ink/75">{o.ref || 'Order'}{o.status === 'held' && <span className="text-loss"> · on hold</span>}</span>
                <span className="tabular-nums">{fmtUnits(o.units)} · {when(o.created_at)}</span>
              </div>
            ))}
            {!orders.length && <div className="px-3 py-2 text-ink/50">None now.</div>}
          </div>
        )}

        <section>
          <h3 className="text-xs font-semibold text-ink/50 mb-2">How long it’ll last</h3>
          <div className="card p-3.5 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-ink/60">Sold, last 7 days</span><span className="tabular-nums">{fmtUnits(p.units_7)}</span></div>
            <div className="flex justify-between"><span className="text-ink/60">Sold, last 28 days</span><span className="tabular-nums">{fmtUnits(p.units_28)}</span></div>
            <div className="flex justify-between"><span className="text-ink/60">Rate used</span>
              <span className="tabular-nums">{s.daily > 0 ? `${s.daily.toFixed(1)} a day` : '—'}{p.daily_override ? ' (set by hand)' : ''}</span></div>
            <div className="flex justify-between"><span className="text-ink/60">Available plus on order lasts</span><span className="tabular-nums font-semibold">{fmtDays(s.cover)}</span></div>
            <div className="flex justify-between"><span className="text-ink/60">Takes to arrive</span><span className="tabular-nums">{s.lead} days{p.lead_known ? '' : ' (a guess)'}</span></div>
            {p.on_order > 0 && <div className="flex justify-between"><span className="text-ink/60">On order</span><span className="tabular-nums">{fmtUnits(p.on_order)}</span></div>}
            <div className="pt-1.5 border-t border-rule/70 flex items-center justify-between gap-2">
              <StatusBadge tone={STATE_LABEL[s.state].tone}>{STATE_LABEL[s.state].label}</StatusBadge>
              {p.request ? <span className="text-xs text-ink/55">Asked for: {p.request.ref}</span>
                : needsRestock(s) && s.suggest > 0 ? <span className="text-xs text-ink/70">Suggest ordering about <b>{fmtUnits(s.suggest)}</b></span> : null}
            </div>
            {s.learning && <div className="text-xs text-ink/45">Still learning — under two weeks of sales so far, so treat this as rough.</div>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-ink/50">Shelves</h3>
            {canEdit && <button className="btn btn-ghost btn-xs" onClick={() => setAssigning(true)}><Icon name="plus" size={12} /> Give it a pick shelf</button>}
          </div>
          {task && (
            <div className="text-xs mb-2 px-3 py-2 rounded-[6px] bg-warn/10 border border-warn/30">
              {task.ref}: move {fmtUnits(task.qty)} from {task.from_location} to {task.to_location || 'a pick shelf'} — {task.why.toLowerCase()}.
            </div>
          )}
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
            {shelves.map(l => (
              <div key={l.code} className="px-3 py-2.5 flex items-center gap-2">
                <button className="font-semibold tabular-nums text-royal-600 hover:underline" onClick={() => onOpenShelf(l.code)}>{l.code}</button>
                <PickBadge pickable={l.pickable} />
                <span className={`ml-auto tabular-nums font-semibold ${l.qty < 0 ? 'text-loss' : ''}`}>{fmtUnits(l.qty)}</span>
                {canEdit && l.pickable && l.qty === 0 && (
                  <button className="btn btn-ghost btn-xs" title="This shelf is no longer for this product"
                    onClick={async () => { try { await invAssign({ productId: p.id, location: l.code, assign: false, by: me?.name }); onRefresh?.() } catch (e) { showToast?.(e.message, 'error') } }}>
                    Free it
                  </button>
                )}
              </div>
            ))}
            {p.nowhere !== 0 && (
              <div className="px-3 py-2.5 flex items-center gap-2 text-loss">
                <span>Not on a shelf</span><span className="ml-auto tabular-nums font-semibold">{fmtUnits(p.nowhere)}</span>
              </div>
            )}
            {!shelves.length && !p.nowhere && <div className="px-3 py-2.5 text-sm text-ink/50">Not on any shelf.</div>}
          </div>
          {(p.on_hand < 0 || shelves.some(l => l.qty < 0) || p.nowhere < 0) && (
            <div className="text-xs text-loss mt-1.5">More has gone out than was recorded here — count the shelves to put it right.</div>
          )}
        </section>

        {(office || canEdit) && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-ink/50">Settings</h3>
              {!editing && <button className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}><Icon name="edit" size={12} /> Change</button>}
            </div>
            {editing ? (
              <ProductSettings p={p} me={me} office={office} stockItems={stockItems} showToast={showToast}
                onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onRefresh?.() }} />
            ) : (
              <div className="card p-3.5 text-sm space-y-1.5">
                <Row label="Keep on the pick shelf" value={p.min_pick ? `at least ${p.min_pick}` : 'worked out from sales'} />
                <Row label="Sales rate" value={p.daily_override ? `${p.daily_override} a day${p.override_until ? ` until ${dayName(p.override_until)}` : ''}` : 'from sales'} />
                <Row label="Takes to arrive" value={p.lead_days ? `${p.lead_days} days` : 'from the supplier'} />
                {office && <Row label="Product" value={stockItems.find(s => s.id === p.stock_item_id)?.name || 'Not linked'} />}
                {p.note && <Row label="Note" value={p.note} />}
              </div>
            )}
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold text-ink/50 mb-2">Recent changes</h3>
          {history == null ? <div className="text-sm text-ink/45">Loading…</div> : <MovementList rows={history} />}
        </section>
      </div>
      {assigning && (
        <AssignShelf p={p} me={me} people={people} office={office} locations={locations} showToast={showToast}
          onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); onRefresh?.() }} />
      )}
    </Drawer>
  )
}

function Stat({ label, value, sub, bad, strong }) {
  return (
    <div className={`rounded-[6px] border px-3 py-2.5 ${strong ? 'border-royal-200 bg-sky/30' : 'border-rule bg-white'}`}>
      <div className="text-[11px] text-ink/50">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${bad ? 'text-loss' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[11px] text-royal-600">{sub}</div>}
    </div>
  )
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3"><span className="text-ink/60">{label}</span><span className="text-right">{value}</span></div>
)

function ProductSettings({ p, me, office, stockItems, showToast, onClose, onSaved }) {
  const [f, setF] = useState({
    name: p.name, code: p.code, in_helm: p.in_helm, min_pick: p.min_pick ?? '', daily_override: p.daily_override ?? '',
    override_until: p.override_until || '', lead_days: p.lead_days ?? '', note: p.note || '', stock_item_id: p.stock_item_id || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = async () => {
    setBusy(true)
    try {
      const out = { ...f }
      if (!office) delete out.stock_item_id
      await invSaveProduct(p.id, out, me?.name)
      showToast?.('Saved'); onSaved()
    } catch (e) { showToast?.(e.message, 'error'); setBusy(false) }
  }
  return (
    <div className="card p-3.5 space-y-3">
      <div><label className="label" htmlFor="ps-name">Name</label><input id="ps-name" className="input" value={f.name} onChange={set('name')} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ps-code">HELM code</label><input id="ps-code" className="input tabular-nums" value={f.code} onChange={set('code')} /></div>
        <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={f.in_helm} onChange={set('in_helm')} /> It’s in HELM</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ps-min">Keep at least on the pick shelf</label>
          <input id="ps-min" type="number" min="0" className="input" value={f.min_pick} onChange={set('min_pick')} placeholder="from sales" /></div>
        <div><label className="label" htmlFor="ps-lead">Days to arrive once ordered</label>
          <input id="ps-lead" type="number" min="0" className="input" value={f.lead_days} onChange={set('lead_days')} placeholder="supplier’s" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ps-rate">Sells a day (seasonal)</label>
          <input id="ps-rate" type="number" min="0" step="0.1" className="input" value={f.daily_override} onChange={set('daily_override')} placeholder="from sales" /></div>
        <div><label className="label" htmlFor="ps-until">Until</label>
          <input id="ps-until" type="date" className="input" value={f.override_until} onChange={set('override_until')} /></div>
      </div>
      <div className="text-xs text-ink/45 -mt-1">For things like de-icing salt, where last month’s sales don’t tell you about winter. Leave empty to use sales.</div>
      {office && (
        <div><label className="label" htmlFor="ps-si">Linked Product (for supplier, lead time and what’s on order)</label>
          <select id="ps-si" className="input" value={f.stock_item_id} onChange={set('stock_item_id')}>
            <option value="">Not linked</option>
            {stockItems.filter(s => !s.data?.archived).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      )}
      <div><label className="label" htmlFor="ps-note">Note</label><input id="ps-note" className="input" value={f.note} onChange={set('note')} /></div>
      <div className="flex gap-2">
        <button className="btn btn-secondary flex-1 justify-center" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1 justify-center" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function AssignShelf({ p, me, people, office, locations, showToast, onClose, onDone }) {
  const [code, setCode] = useState('')
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  const clean = cleanLocation(code)
  return (
    <Drawer title="Give it a pick shelf" description={p.name} onClose={onClose}>
      <div className="space-y-4">
        <LocationInput value={code} onChange={setCode} locations={locations} autoFocus label="Pick shelf" />
        <div className="text-xs text-ink/50">The shelf becomes a pick shelf if it isn’t one already. Move stock onto it afterwards.</div>
        <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} />
        <button className="btn btn-primary w-full justify-center py-3 sm:py-2" disabled={!clean || !who || busy}
          onClick={async () => { setBusy(true); try { await invAssign({ productId: p.id, location: clean, assign: true, by: who }); showToast?.(`${clean} is now a pick shelf for it`); onDone() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) } }}>
          Save
        </button>
      </div>
    </Drawer>
  )
}

export function MovementList({ rows, showProduct = false, onOpenProduct }) {
  if (!rows.length) return <div className="text-sm text-ink/45">Nothing yet.</div>
  return (
    <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
      {rows.map(m => (
        <div key={m.id} className="px-3 py-2.5 flex items-start gap-3 text-sm">
          <div className="min-w-0 flex-1">
            {showProduct && m.product && (
              <button className="text-ink font-medium hover:underline text-left" onClick={() => onOpenProduct?.(m.product.id)}>{m.product.name}</button>
            )}
            <div className={showProduct ? 'text-xs text-ink/60' : 'text-ink/80'}>
              {MOVEMENT_LABEL[m.kind] || m.kind}{m.location ? ` · ${m.location}` : ' · no shelf'}{m.reason && m.reason !== 'Opening count' && m.reason !== 'Counted' ? ` · ${m.reason}` : ''}
            </div>
            <div className="text-xs text-ink/45">{[m.ref, m.note, m.by_name, when(m.at)].filter(Boolean).join(' · ')}</div>
          </div>
          <div className={`tabular-nums font-semibold shrink-0 ${m.qty < 0 ? 'text-loss' : 'text-gain'}`}>{m.qty > 0 ? '+' : ''}{fmtUnits(m.qty)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Shelves ──────────────────────────────────────────────────────────────────

function ShelvesView({ locations, products, onOpenShelf, onOpenProduct }) {
  const [aisle, setAisle] = useState('A')
  const [go, setGo] = useState('')
  const [only, setOnly] = useState('all')
  // What's on each shelf
  const contents = useMemo(() => {
    const m = new Map()
    for (const p of products) for (const l of p.locations || []) {
      if (!m.has(l.code)) m.set(l.code, [])
      m.get(l.code).push({ id: p.id, name: p.name, code: p.code, qty: l.qty })
    }
    return m
  }, [products])
  const inAisle = locations.filter(l => parseLocation(l.code)?.aisle === aisle)
    .filter(l => only === 'all' || (only === 'pick' ? l.pickable : !l.pickable))
  const bays = Array.from({ length: baysIn(aisle) }, (_, i) => i + 1)
  const perAisle = Object.fromEntries(AISLES.map(a => [a, locations.filter(l => l.code.startsWith(a + '-')).length]))
  const clean = cleanLocation(go)

  return (
    <div>
      <div className="flex gap-2 flex-wrap items-end mb-4">
        <div className="flex-1 min-w-[200px] max-w-xs">
          <label className="label" htmlFor="go-shelf">Go to a shelf</label>
          <div className="flex gap-2">
            <input id="go-shelf" className="input uppercase tabular-nums" value={go} onChange={e => setGo(e.target.value)} placeholder="e.g. D-11-2-4"
              onKeyDown={e => { if (e.key === 'Enter' && clean) onOpenShelf(clean) }} />
            <button className="btn btn-secondary" disabled={!clean} onClick={() => onOpenShelf(clean)}>Open</button>
          </div>
        </div>
        <select className="input w-auto" value={only} onChange={e => setOnly(e.target.value)} aria-label="Which shelves">
          <option value="all">All shelves</option><option value="pick">Pick shelves</option><option value="overflow">Overflow</option>
        </select>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {AISLES.map(a => (
          <button key={a} onClick={() => setAisle(a)}
            className={`w-12 h-12 rounded-[6px] border text-lg font-semibold ${aisle === a ? 'bg-royal-500 border-royal-500 text-white' : 'bg-white border-rule text-ink hover:border-royal-300'}`}>
            {a}<span className={`block text-[10px] font-normal -mt-1 ${aisle === a ? 'text-white/70' : 'text-ink/40'}`}>{perAisle[a]}</span>
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {bays.map(bay => {
          const here = inAisle.filter(l => parseLocation(l.code).bay === bay).sort(byLocation)
          if (!here.length) return null
          return (
            <section key={bay}>
              <h2 className="text-xs font-semibold text-ink/50 mb-1.5">Aisle {aisle} · Bay {bay}</h2>
              <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
                {here.map(l => {
                  const c = contents.get(l.code) || []
                  const pl = parseLocation(l.code)
                  return (
                    <button key={l.code} className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-sky/20" onClick={() => onOpenShelf(l.code)}>
                      <div className="w-[92px] shrink-0">
                        <div className="font-semibold tabular-nums text-ink">{l.code}</div>
                        <div className="text-[11px] text-ink/45">{shelfLabel(pl.shelf)} · sect. {pl.section}</div>
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        {c.length ? c.map(x => (
                          <div key={x.id} className="flex justify-between gap-2"><span className="truncate text-ink/80">{x.name}</span><span className={`tabular-nums shrink-0 ${x.qty < 0 ? 'text-loss' : ''}`}>{fmtUnits(x.qty)}</span></div>
                        )) : <span className="text-ink/40">Empty</span>}
                      </div>
                      <PickBadge pickable={l.pickable} />
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
        {!inAisle.length && <EmptyState icon="box" title={`Nothing recorded in aisle ${aisle}`} sub="Shelves appear here once stock is put on them." />}
      </div>
    </div>
  )
}

function ShelfDrawer({ code, me, people, office, canEdit, locations, products, showToast, onClose, onRefresh, onOpenProduct, onChange }) {
  const loc = locations.find(l => l.code === code)
  const pl = parseLocation(code)
  const here = products.flatMap(p => (p.locations || []).filter(l => l.code === code).map(l => ({ p, qty: l.qty })))
  const [history, setHistory] = useState(null)
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(loc?.note || '')
  useEffect(() => { loadMovements({ location: code, limit: 25 }).then(setHistory).catch(() => setHistory([])) }, [code, here.length])

  const setPickable = async (pickable) => {
    if (!who) { showToast?.('Choose your name first', 'error'); return }
    setBusy(true)
    try { await invSaveLocation({ code, pickable, note, by: who }); showToast?.(`${code} is now ${pickable ? 'a pick shelf' : 'overflow'}`); onRefresh?.() }
    catch (e) { showToast?.(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Drawer title={code} description={pl ? `Aisle ${pl.aisle} · Bay ${pl.bay} · ${shelfLabel(pl.shelf)} · Section ${pl.section}` : ''} onClose={onClose}
      footer={canEdit && <button className="btn btn-primary w-full justify-center py-3 sm:py-2" onClick={() => onChange({ mode: 'add', from: code })}><Icon name="plus" size={15} /> Put stock here</button>}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          {loc ? <PickBadge pickable={loc.pickable} /> : <StatusBadge tone="quiet">Not used yet</StatusBadge>}
          {loc?.updated_by && <span className="text-xs text-ink/45">last changed by {loc.updated_by}</span>}
        </div>
        <section>
          <h3 className="text-xs font-semibold text-ink/50 mb-2">On this shelf</h3>
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
            {here.map(({ p, qty }) => (
              <div key={p.id} className="px-3 py-2.5 flex items-center gap-2">
                <button className="text-left min-w-0 flex-1" onClick={() => onOpenProduct(p.id)}>
                  <div className="text-sm text-ink truncate">{p.name}</div>
                  <div className="text-xs text-ink/45 tabular-nums">{p.code}</div>
                </button>
                <span className={`tabular-nums font-semibold ${qty < 0 ? 'text-loss' : ''}`}>{fmtUnits(qty)}</span>
                {canEdit && qty > 0 && <button className="btn btn-secondary btn-xs" onClick={() => onChange({ mode: 'move', product: p, from: code })}>Move</button>}
                {canEdit && <button className="btn btn-ghost btn-xs" onClick={() => onChange({ mode: 'count', product: p, from: code })}>Count</button>}
              </div>
            ))}
            {!here.length && <div className="px-3 py-2.5 text-sm text-ink/45">Empty.</div>}
          </div>
        </section>
        {canEdit && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-ink/50">This shelf</h3>
            <div><label className="label" htmlFor="sh-note">Note</label><input id="sh-note" className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. top shelf, needs the ladder" /></div>
            <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} />
            <div className="grid grid-cols-2 gap-2">
              <button className={`btn justify-center py-3 sm:py-2 ${loc?.pickable ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => setPickable(true)}>Pick shelf</button>
              <button className={`btn justify-center py-3 sm:py-2 ${loc && !loc.pickable ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => setPickable(false)}>Overflow</button>
            </div>
            <div className="text-xs text-ink/45">Pick shelves are where orders are picked from; overflow holds extra stock. When a pick shelf runs low, a task asks for it to be topped up from overflow.</div>
          </section>
        )}
        <section>
          <h3 className="text-xs font-semibold text-ink/50 mb-2">Recent changes</h3>
          {history == null ? <div className="text-sm text-ink/45">Loading…</div> : <MovementList rows={history} showProduct onOpenProduct={onOpenProduct} />}
        </section>
      </div>
    </Drawer>
  )
}

// ── Close of day: what went out ──────────────────────────────────────────────

function DespatchedView({ onOpenProduct }) {
  const today = todayLondon()
  const RANGES = { today: [today, today], yesterday: [addDays(today, -1), addDays(today, -1)], week: [addDays(today, -6), today], month: [addDays(today, -29), today] }
  const [range, setRange] = useState('today')
  const [rows, setRows] = useState(null)
  useEffect(() => { setRows(null); loadDespatchDays(...RANGES[range]).then(setRows).catch(() => setRows([])) }, [range]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) { if (!m.has(r.day)) m.set(r.day, []); m.get(r.day).push(r) }
    return [...m.entries()]
  }, [rows])
  return (
    <div>
      <div className="overflow-x-auto max-w-full -mx-1 px-1 mb-4">
        <SegmentedControl label="When" value={range} onChange={setRange}
          items={[{ id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }]} />
      </div>
      {rows == null ? <div className="text-sm text-ink/45">Loading…</div> : !days.length ? (
        <EmptyState icon="printer" title="Nothing despatched" sub="Units come off the shelves when their labels are marked dispatched — usually when the day is closed." />
      ) : (
        <div className="space-y-5">
          {days.map(([day, list]) => (
            <section key={day}>
              <h2 className="text-sm font-semibold text-ink mb-1.5">{dayName(day)} <span className="text-ink/45 font-normal">· {fmtUnits(list.reduce((s, r) => s + num(r.units), 0))} units</span></h2>
              <div className="table-shell overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Product</th><th className="text-right">Units</th><th className="text-right">Orders</th></tr></thead>
                  <tbody>
                    {list.map(r => (
                      <tr key={r.product_id} className="cursor-pointer" onClick={() => onOpenProduct(r.product_id)}>
                        <td><div className="text-ink">{r.name}</div><div className="text-xs text-ink/45 tabular-nums">{r.code}{num(r.replacements) ? ` · ${fmtUnits(r.replacements)} replacements` : ''}</div></td>
                        <td className="text-right tabular-nums font-semibold">{fmtUnits(r.units)}</td>
                        <td className="text-right tabular-nums text-ink/60">{r.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Every change ─────────────────────────────────────────────────────────────

const KIND_GROUPS = {
  all: null,
  manual: ['add', 'remove', 'count'],
  moves: ['move'],
  goods_in: ['goods_in'],
  despatch: ['despatch', 'despatch_undo'],
}

function HistoryView({ products, onOpenProduct }) {
  const [kind, setKind] = useState('manual')
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { setRows(null); loadMovements({ kinds: KIND_GROUPS[kind], limit: 300 }).then(setRows).catch(() => setRows([])) }, [kind])
  const shown = (rows || []).filter(m => !q.trim() || `${m.product?.name} ${m.product?.code} ${m.location} ${m.reason} ${m.note} ${m.by_name} ${m.ref}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div>
      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <div className="overflow-x-auto max-w-full -mx-1 px-1">
          <SegmentedControl label="Show" value={kind} onChange={setKind}
            items={[{ id: 'manual', label: 'By hand' }, { id: 'moves', label: 'Moves' }, { id: 'goods_in', label: 'Goods in' }, { id: 'despatch', label: 'Despatched' }, { id: 'all', label: 'Everything' }]} />
        </div>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Product, shelf, reason or person" className="w-full sm:w-72" />
      </div>
      {rows == null ? <div className="text-sm text-ink/45">Loading…</div> : <MovementList rows={shown} showProduct onOpenProduct={onOpenProduct} />}
    </div>
  )
}
