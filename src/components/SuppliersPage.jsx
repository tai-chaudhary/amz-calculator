import React, { useState, useMemo } from 'react'
import { calcProduct, fmt, pct, hasComponents } from '../lib/calc'
import { supplierForName } from '../lib/proposals'
import { Icon, PageHeader, StatusBadge, Modal, EmptyState, Tabs, SegmentedControl, ProductImage } from './UI'
import { ImportPanel } from './PriceListsPage'
import { SupplierSync } from './OnlineSuppliers'
import { AmazonLink, BrandLink } from './Links'

const DAY = 86400000
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null

/**
 * How far to trust a supplier's prices: fresh lists and nightly syncs are
 * current; an old list means the costs behind your margins may have moved.
 */
export function freshness(s, stat, syncState) {
  if (s.data?.sync) {
    const age = daysSince(syncState?.lastDoneAt)
    if (age === null) return { key: 'none', label: 'Not synced yet', tone: 'quiet' }
    return age <= 2 ? { key: 'fresh', label: 'Synced nightly', tone: 'live', age }
                    : { key: 'stale', label: `Sync ${age} days old`, tone: 'alert', age }
  }
  if (s.data?.syncBlocked || s.data?.source === 'manual') return { key: 'manual', label: 'Manual prices', tone: 'quiet' }
  const age = daysSince(stat?.latest_list)
  if (age === null) return { key: 'none', label: 'No price list', tone: 'quiet' }
  if (age < 7) return { key: 'fresh', label: 'Fresh', tone: 'live', age }
  if (age <= 30) return { key: 'due', label: `Due — ${age} days old`, tone: 'paused', age }
  return { key: 'stale', label: `Stale — ${age} days old`, tone: 'alert', age }
}

const SOURCE_LABEL = { list: 'Sends a price list', online: 'Online ordering', manual: 'Manual prices' }

export default function SuppliersPage(props) {
  const { suppliers, focusId, onNavigate } = props
  const supplier = focusId ? suppliers.find(s => s.id === focusId) : null
  return supplier
    ? <SupplierDetail key={supplier.id} s={supplier} {...props} onBack={() => onNavigate?.('suppliers')} />
    : <SupplierList {...props} />
}

/** Everything the portal knows about each supplier's footprint in your business. */
function useSupplierFacts({ suppliers, stockItems, savedProducts, liveProducts, settings, proposals }) {
  return useMemo(() => {
    const liveIds = new Set(liveProducts.filter(lp => lp.status === 'live').map(lp => lp.saved_product_id))
    const facts = {}
    for (const s of suppliers) facts[s.id] = { stock: [], listings: [], live: [], pending: [] }
    for (const si of stockItems) {
      if (si.data?.archived) continue
      const s = supplierForName(si.data?.supplierName, suppliers)
      if (s) facts[s.id].stock.push(si)
    }
    const stockSupplier = new Map()
    Object.entries(facts).forEach(([id, f]) => f.stock.forEach(si => stockSupplier.set(si.id, id)))
    for (const row of savedProducts) {
      const p = row.data || {}
      const ids = hasComponents(p)
        ? [...new Set(p.components.map(c => stockSupplier.get(c.stockItemId)).filter(Boolean))]
        : [supplierForName(p.supplierName, suppliers)?.id].filter(Boolean)
      for (const id of ids) {
        const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
        const entry = { row, p, r }
        facts[id].listings.push(entry)
        if (liveIds.has(row.id)) facts[id].live.push(entry)
      }
    }
    for (const pr of proposals) {
      if (pr.status !== 'pending') continue
      const names = [pr.payload?.supplier, pr.payload?.toSupplier, pr.payload?.fromSupplier].filter(Boolean)
      for (const n of names) {
        const s = supplierForName(n, suppliers)
        if (s && !facts[s.id].pending.includes(pr)) facts[s.id].pending.push(pr)
      }
    }
    for (const f of Object.values(facts)) {
      const counted = f.live.filter(x => !x.r.incomplete)
      f.avgMargin = counted.length ? counted.reduce((a, x) => a + x.r.margin, 0) / counted.length : null
      const withVol = counted.filter(x => parseFloat(x.p.monthlyVolume) > 0)
      f.monthlyProfit = withVol.length ? withVol.reduce((a, x) => a + x.r.netProfit * parseFloat(x.p.monthlyVolume), 0) : null
    }
    return facts
  }, [suppliers, stockItems, savedProducts, liveProducts, settings, proposals])
}

/* ── All suppliers ─────────────────────────────────────────────────────── */

function SupplierList(props) {
  const { suppliers, catalogueStats, syncStatus, imports, onImport, onNavigate } = props
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('all')
  const facts = useSupplierFacts(props)
  const statOf = (id) => catalogueStats.find(x => x.supplier_id === id)
  const stateOf = (id) => syncStatus.states.find(x => x.supplier_id === id)?.state

  const rows = suppliers.map(s => ({ s, f: facts[s.id], fr: freshness(s, statOf(s.id), stateOf(s.id)), stat: statOf(s.id) }))
    .sort((a, b) => b.f.live.length - a.f.live.length || a.s.name.localeCompare(b.s.name))
  const shown = rows.filter(x => filter === 'all' ? true
    : filter === 'used' ? x.f.stock.length > 0
    : filter === 'attention' ? (['stale', 'due'].includes(x.fr.key) || x.f.pending.length > 0) : true)
  const attention = rows.filter(x => ['stale', 'due'].includes(x.fr.key) || x.f.pending.length > 0).length

  return (
    <div>
      <PageHeader
        eyebrow="Sourcing / suppliers"
        title="Suppliers"
        description="Each supplier's terms, how current their prices are, and how much of your catalogue depends on them."
        meta={`${suppliers.length} suppliers`}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setImporting(true)}>
            <Icon name="upload" size={14} /> Import a price list
          </button>
        }
      />

      <SegmentedControl className="mb-4" label="Show" value={filter} onChange={setFilter} items={[
        { id: 'all', label: 'All', count: rows.length },
        { id: 'used', label: 'Ones you buy from', count: rows.filter(x => x.f.stock.length).length },
        { id: 'attention', label: 'Need attention', count: attention },
      ]} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map(({ s, f, fr, stat }) => (
          <button key={s.id} className="card text-left hover:border-royal-300 transition-colors"
            onClick={() => onNavigate?.('suppliers', s.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-ink truncate">{s.name}</div>
                <div className="text-xs text-ink/50 mt-0.5">
                  {SOURCE_LABEL[s.data?.source] || 'Supplier'} · {s.data?.moq ? `£${Number(s.data.moq).toLocaleString()} minimum` : 'no minimum set'}
                </div>
              </div>
              <StatusBadge tone={fr.tone}>{fr.label}</StatusBadge>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <Mini label="Products" value={f.stock.length} />
              <Mini label="Live listings" value={f.live.length} />
              <Mini label="Avg margin" value={f.avgMargin === null ? '—' : pct(f.avgMargin)} />
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-ink/50">
              <span>{stat ? `${Number(stat.products).toLocaleString()} products on file` : 'No catalogue'}</span>
              {f.pending.length > 0 && <span className="text-warn font-semibold">{f.pending.length} change{f.pending.length !== 1 ? 's' : ''} waiting</span>}
            </div>
          </button>
        ))}
      </div>

      {importing && (
        <Modal title="Import a price list" description="The supplier is recognised from the file. Changes to products you stock go to Approvals." onClose={() => setImporting(false)} maxWidth="max-w-4xl">
          <ImportPanel suppliers={suppliers} imports={imports} onImport={async (...a) => { await onImport(...a); setImporting(false) }} />
        </Modal>
      )}
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div className="rounded-lg bg-paper py-2">
      <div className="text-base font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink/50">{label}</div>
    </div>
  )
}

/* ── One supplier ──────────────────────────────────────────────────────── */

function SupplierDetail(props) {
  const { s, catalogueStats, syncStatus, imports, onUpdateSupplier, onSyncNow, onImport, onNavigate, onBack, suppliers } = props
  const [tab, setTab] = useState('live')
  const [importing, setImporting] = useState(false)
  const facts = useSupplierFacts(props)[s.id]
  const stat = catalogueStats.find(x => x.supplier_id === s.id)
  const state = syncStatus.states.find(x => x.supplier_id === s.id)?.state || {}
  const runs = syncStatus.runs.filter(r => r.supplier_id === s.id)
  const fr = freshness(s, stat, state)
  const myImports = imports.filter(i => i.supplier_id === s.id)
  const d = s.data || {}

  const [terms, setTerms] = useState({ moq: d.moq ?? '', delivery: d.delivery ?? 0, leadDays: d.leadDays ?? '', source: d.source || 'online' })
  const termsChanged = String(terms.moq) !== String(d.moq ?? '') || String(terms.delivery) !== String(d.delivery ?? 0) ||
    String(terms.leadDays) !== String(d.leadDays ?? '') || terms.source !== (d.source || 'online')
  const setT = (k) => (e) => setTerms(t => ({ ...t, [k]: e.target.value }))

  const lossMaking = facts.live.filter(x => !x.r.incomplete && x.r.netProfit < 0).length
  const thin = facts.live.filter(x => !x.r.incomplete && x.r.margin >= 0 && x.r.margin < 10).length

  return (
    <div>
      <button className="text-sm text-ink/55 hover:text-royal-600 mb-3 inline-flex items-center gap-1" onClick={onBack}>
        <Icon name="back" size={14} /> All suppliers
      </button>
      <PageHeader
        eyebrow="Sourcing / supplier"
        title={s.name}
        description={SOURCE_LABEL[d.source] || 'Supplier'}
        actions={
          <div className="flex gap-2 items-center">
            <StatusBadge tone={fr.tone}>{fr.label}</StatusBadge>
            {d.source === 'list' && (
              <button className="btn btn-primary btn-sm" onClick={() => setImporting(true)}><Icon name="upload" size={14} /> Import new price list</button>
            )}
            {d.website && <a className="btn btn-secondary btn-sm" href={d.website} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> Website</a>}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="card">
          <div className="font-semibold text-ink mb-3">Commercial terms</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field"><span className="label">Minimum order £</span>
              <input type="number" className="input" value={terms.moq} onChange={setT('moq')} /></label>
            <label className="field"><span className="label">Delivery £</span>
              <input type="number" step="0.01" className="input" value={terms.delivery} onChange={setT('delivery')} /></label>
            <label className="field"><span className="label">Lead time (days)</span>
              <input type="number" className="input" value={terms.leadDays} onChange={setT('leadDays')} /></label>
            <label className="field"><span className="label">How they sell</span>
              <select className="input" value={terms.source} onChange={setT('source')}>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
          </div>
          {termsChanged && (
            <button className="btn btn-primary btn-sm mt-3" onClick={() => onUpdateSupplier(s.id, {
              ...d, source: terms.source, moq: parseFloat(terms.moq) || 0,
              delivery: parseFloat(terms.delivery) || 0, leadDays: parseInt(terms.leadDays) || 0,
            })}>Save terms</button>
          )}
        </div>

        <div className="card">
          <div className="font-semibold text-ink mb-3">Price data</div>
          <Fact label="Products on file" value={stat ? Number(stat.products).toLocaleString() : 'None'} />
          <Fact label="With barcodes" value={stat ? `${Number(stat.with_barcode).toLocaleString()} (${Math.round(Number(stat.with_barcode) / Math.max(1, Number(stat.products)) * 100)}%)` : '—'} />
          <Fact label={d.sync ? 'Last sync' : 'Latest price list'}
            value={d.sync ? (state.lastDoneAt ? new Date(state.lastDoneAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not yet')
                          : (stat?.latest_list ? new Date(stat.latest_list).toLocaleDateString('en-GB') : 'None imported')} />
          {fr.key === 'stale' && !d.sync && <div className="text-xs text-loss mt-2">Costs from this supplier may have moved since this list — margins relying on it are less certain.</div>}
          {d.syncBlocked && <div className="text-xs text-ink/55 mt-2">{d.syncBlocked}</div>}
        </div>

        <div className="card">
          <div className="font-semibold text-ink mb-3">Your exposure</div>
          <Fact label="Products bought here" value={facts.stock.length} />
          <Fact label="Live listings depending on it" value={facts.live.length} />
          <Fact label="Average live margin" value={facts.avgMargin === null ? '—' : pct(facts.avgMargin)} />
          {facts.monthlyProfit !== null && <Fact label="Monthly profit (where volume set)" value={fmt(facts.monthlyProfit)} />}
          {(lossMaking > 0 || thin > 0) && (
            <div className="text-xs text-warn mt-2">{lossMaking > 0 && `${lossMaking} losing money`}{lossMaking > 0 && thin > 0 && ' · '}{thin > 0 && `${thin} under 10%`}</div>
          )}
        </div>
      </div>

      {facts.pending.length > 0 && (
        <div className="panel-notice mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-ink">{facts.pending.length} change{facts.pending.length !== 1 ? 's' : ''} from {s.name} waiting for you</div>
            <div className="text-sm text-ink/60 mt-0.5">
              {[...new Set(facts.pending.map(p => ({ cost: 'cost changes', barcode: 'barcodes', lifecycle: 'discontinued lines', cheaper_supplier: 'cheaper alternatives' }[p.kind] || p.kind)))].join(', ')}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate?.('approvals', 'changes')}>Review changes</button>
        </div>
      )}

      {d.sync && (
        <div className="mb-5">
          <SupplierSync s={s} count={Number(stat?.products || 0)} state={state} runs={runs} onSyncNow={onSyncNow} onUpdateSupplier={onUpdateSupplier} />
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={[
        { id: 'live', label: 'Live listings', count: facts.live.length },
        { id: 'stock', label: 'Products', count: facts.stock.length },
        { id: 'history', label: d.sync ? 'Sync history' : 'Price list history', count: d.sync ? runs.length : myImports.length },
      ]} />

      {tab === 'live' && (facts.live.length === 0
        ? <EmptyState icon="live" title="No live listings use this supplier" />
        : <div className="card-flush overflow-hidden"><div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-paper border-b border-rule">
                <th className="th text-left px-5">Listing</th><th className="th text-right px-3">Price</th>
                <th className="th text-right px-3">Profit</th><th className="th text-right px-5">Margin</th>
              </tr></thead>
              <tbody>
                {[...facts.live].sort((a, b) => (a.r.incomplete ? -1e9 : a.r.margin) - (b.r.incomplete ? -1e9 : b.r.margin)).map(({ row, p, r }) => (
                  <tr key={row.id} className="border-b border-rule/60 hover:bg-royal-50/40 cursor-pointer" tabIndex={0}
                    onClick={() => onNavigate?.('live', row.id)} onKeyDown={e => e.key === 'Enter' && onNavigate?.('live', row.id)}>
                    <td className="td px-5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded border border-rule bg-white flex-shrink-0 overflow-hidden flex items-center justify-center">
                          <ProductImage asin={p.asin} manualImage={p.productImage} alt="" className="object-contain w-full h-full p-0.5" placeholderSize="text-sm" />
                        </div>
                        <div className="min-w-0"><div className="truncate text-ink">{row.name}</div><div className="mt-0.5"><AmazonLink asin={p.asin} /></div></div>
                      </div>
                    </td>
                    <td className="td px-3 text-right">{fmt(r.sellPrice)}</td>
                    <td className={`td px-3 text-right ${r.incomplete ? 'text-ink/40' : r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{r.incomplete ? '—' : fmt(r.netProfit)}</td>
                    <td className={`td px-5 text-right font-medium ${r.incomplete ? 'text-warn' : r.margin >= 10 ? 'text-gain' : r.margin >= 0 ? 'text-warn' : 'text-loss'}`}>
                      {r.incomplete ? 'Incomplete' : pct(r.margin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>)}

      {tab === 'stock' && (facts.stock.length === 0
        ? <EmptyState icon="package" title="No products from this supplier" />
        : <div className="card-flush overflow-hidden"><div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-paper border-b border-rule">
                <th className="th text-left px-5">Product</th><th className="th text-left px-3">Code</th>
                <th className="th text-left px-3">Barcode</th><th className="th text-right px-5">Cost</th>
              </tr></thead>
              <tbody>
                {facts.stock.map(si => (
                  <tr key={si.id} className="border-b border-rule/60 hover:bg-royal-50/40 cursor-pointer" tabIndex={0}
                    onClick={() => onNavigate?.('stock', si.id)} onKeyDown={e => e.key === 'Enter' && onNavigate?.('stock', si.id)}>
                    <td className="td px-5 text-ink">{si.name}</td>
                    <td className="td px-3 text-ink/60">{si.data?.supplierSku || '—'}</td>
                    <td className="td px-3 text-ink/60">{si.data?.barcode || <span className="text-warn">none</span>}</td>
                    <td className="td px-5 text-right">{fmt(parseFloat(si.data?.costPrice))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>)}

      {tab === 'history' && (d.sync
        ? (runs.length === 0 ? <EmptyState icon="clock" title="No sync runs yet" /> : (
          <div className="card-flush overflow-hidden">
            {runs.map(r => (
              <div key={r.id} className="px-5 py-3 border-b border-rule/60 last:border-0 flex items-center justify-between gap-3 text-sm">
                <span>{new Date(r.finished_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-ink/60">{r.stats?.seen ? `${Number(r.stats.seen).toLocaleString()} products read` : ''}{r.stats?.watched ? ` · ${r.stats.watched.found} of ${r.stats.watched.watched} yours checked` : ''}</span>
                <StatusBadge tone={r.status === 'done' ? 'live' : 'alert'}>{r.status === 'done' ? 'Done' : 'Failed'}</StatusBadge>
              </div>
            ))}
          </div>))
        : (myImports.length === 0 ? <EmptyState icon="upload" title="No price lists imported yet" /> : (
          <div className="card-flush overflow-hidden">
            {myImports.map(im => (
              <div key={im.id} className="px-5 py-3 border-b border-rule/60 last:border-0 flex items-center justify-between gap-3 text-sm">
                <span>{im.list_date ? `List dated ${new Date(im.list_date).toLocaleDateString('en-GB')}` : im.file_name}</span>
                <span className="text-ink/60">{Number(im.summary?.products || 0).toLocaleString()} products · {im.summary?.proposals || 0} changes proposed</span>
                <span className="text-ink/50">{new Date(im.created_at).toLocaleDateString('en-GB')}{im.imported_by ? ` · ${im.imported_by}` : ''}</span>
              </div>
            ))}
          </div>)))}

      {importing && (
        <Modal title={`Import a price list from ${s.name}`} onClose={() => setImporting(false)} maxWidth="max-w-4xl">
          <ImportPanel suppliers={suppliers} imports={imports} onImport={async (...a) => { await onImport(...a); setImporting(false) }} />
        </Modal>
      )}
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-rule/50 last:border-0 text-sm">
      <span className="text-ink/60">{label}</span>
      <span className="font-medium text-ink text-right">{value}</span>
    </div>
  )
}
