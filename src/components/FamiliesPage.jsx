import React, { useState, useMemo } from 'react'
import { calcProduct, hasComponents, modelPackSizes, priceForTargetMargin, fmt, fmtSigned, pct } from '../lib/calc'
import { FEE_CATEGORIES, describeCategory } from '../lib/feeSchedule'
import { SERVICE_LABELS } from '../lib/defaults'
import { ProductImage, Icon, PageHeader, StatusBadge, SegmentedControl, SearchInput, EmptyState, Drawer } from './UI'
import { AmazonLink, SupplierLink, BrandLink, ProductLink, ListingLink } from './Links'
import { exportRowsToCsv, stampedName } from '../lib/csv'

const TARGET = 15
const COMMON_PACKS = [1, 2, 3, 4, 6, 8, 10, 12, 24]
const marginTone = (m) => (m >= TARGET ? 'text-gain' : m >= 0 ? 'text-warn' : 'text-loss')
const marginDot = (m) => (m >= TARGET ? 'bg-gain' : m >= 0 ? 'bg-warn' : 'bg-loss')

/**
 * The same product sold at different pack sizes, as one ladder. Built to answer
 * one question per family: is every pack size earning its place?
 */
export default function FamiliesPage({ savedProducts, liveProducts, stockItems, settings, onNavigate, onCreateListing }) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState('review')
  const [sort, setSort] = useState('attention')
  const [openId, setOpenId] = useState(null)
  const [modelFor, setModelFor] = useState(null)

  const families = useMemo(() => {
    const live = liveProducts.filter(lp => lp.status !== 'removed').map(lp => {
      const saved = savedProducts.find(s => s.id === lp.saved_product_id)
      if (!saved) return null
      const p = saved.data || {}
      if (!hasComponents(p)) return null
      return { lp, saved, p, r: calcProduct(p, settings.carriers, settings.packaging, stockItems) }
    }).filter(Boolean)

    return stockItems.filter(si => !si.data?.archived).map(si => {
      const pure = live.filter(x => x.p.components.length === 1 && x.p.components[0].stockItemId === si.id)
      const mixed = live.filter(x => x.p.components.length > 1 && x.p.components.some(c => c.stockItemId === si.id))
      const rungs = pure.map(x => {
        const qty = parseInt(x.p.components[0].qty) || 1
        return { ...x, qty, pricePerUnit: qty ? x.r.sellPrice / qty : 0, profitPerUnit: qty ? x.r.netProfit / qty : 0 }
      }).sort((a, b) => a.qty - b.qty || b.pricePerUnit - a.pricePerUnit)
      const ok = rungs.filter(r => !r.r.incomplete)
      const prices = ok.map(r => r.pricePerUnit).filter(v => v > 0)
      const spread = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 : 0
      const losing = ok.filter(r => r.r.netProfit < 0).length
      const thin = ok.filter(r => r.r.margin >= 0 && r.r.margin < 10).length
      const status = losing ? { tone: 'alert', label: `${losing} losing money` }
        : thin ? { tone: 'paused', label: `${thin} under 10%` }
        : ok.length ? { tone: 'live', label: 'All sizes healthy' } : { tone: 'quiet', label: 'Can’t calculate' }
      return {
        si, d: si.data || {}, rungs, mixed, spread, losing, thin, status,
        sizes: [...new Set(rungs.map(r => r.qty))],
        asin: rungs[0]?.p?.asin || mixed[0]?.p?.asin || '',
        brand: rungs[0]?.p?.brand || si.data?.brand || '',
        attention: losing * 100 + thin * 10 + (spread > 50 ? 5 : 0),
      }
    }).filter(f => f.rungs.length + f.mixed.length > 0)
  }, [savedProducts, liveProducts, stockItems, settings])

  const VIEWS = {
    review: { label: 'Worth reviewing', test: f => f.losing > 0 || f.thin > 0 || f.spread > 50 },
    losing: { label: 'Losing money', test: f => f.losing > 0 },
    spread: { label: 'Wide price spread', test: f => f.spread > 50 },
    ladders: { label: 'Several pack sizes', test: f => f.sizes.length > 1 },
    all: { label: 'All', test: () => true },
  }
  const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, families.filter(v.test).length]))
  const q = search.trim().toLowerCase()
  const shown = families.filter(VIEWS[view].test).filter(f => !q ||
    f.si.name.toLowerCase().includes(q) || (f.d.supplierName || '').toLowerCase().includes(q) ||
    f.brand.toLowerCase().includes(q) || f.rungs.some(r => r.saved.name.toLowerCase().includes(q)))
    .sort({
      attention: (a, b) => b.attention - a.attention || a.si.name.localeCompare(b.si.name),
      spread: (a, b) => b.spread - a.spread,
      sizes: (a, b) => b.sizes.length - a.sizes.length,
      name: (a, b) => a.si.name.localeCompare(b.si.name),
    }[sort])

  return (
    <div>
      <PageHeader
        eyebrow="Optimise / pack sizes"
        title="Product families"
        description="Each product with every pack size you sell it in, priced side by side — so you can see which multipacks undercut your singles or lose money, and which sizes are missing."
        meta={`${families.length} products on sale · ${counts.ladders} sold in more than one size`}
        actions={
          <button className="btn btn-secondary btn-sm" disabled={!families.length}
            onClick={() => exportRowsToCsv(stampedName('product-families'), families.flatMap(f => f.rungs.map(r => ({ f, r }))), [
              { header: 'Product', value: x => x.f.si.name },
              { header: 'Listing', value: x => x.r.saved.name },
              { header: 'ASIN', value: x => x.r.p.asin || '' },
              { header: 'Pack size', value: x => x.r.qty },
              { header: 'Sell price', value: x => x.r.r.sellPrice.toFixed(2) },
              { header: 'Price per unit', value: x => x.r.pricePerUnit.toFixed(2) },
              { header: 'Profit', value: x => x.r.r.incomplete ? '' : x.r.r.netProfit.toFixed(2) },
              { header: 'Margin %', value: x => x.r.r.incomplete ? '' : x.r.r.margin.toFixed(1) },
            ])}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Products on sale" value={families.length} />
        <Stat label="Sold in several sizes" value={counts.ladders} />
        <Stat label="Losing money somewhere" value={counts.losing} tone={counts.losing ? 'text-loss' : ''} />
        <Stat label="Wide price spread" value={counts.spread} tone={counts.spread ? 'text-warn' : ''} sub="over 50% per unit" />
      </div>

      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <SegmentedControl label="Show" value={view} onChange={setView}
          items={Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: counts[id] }))} />
        <div className="flex gap-2 items-center flex-wrap">
          <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Product, listing, brand or supplier" className="w-full sm:w-64" />
          <select className="input w-full sm:w-[190px]" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
            <option value="attention">Most in need first</option>
            <option value="spread">Widest price spread</option>
            <option value="sizes">Most pack sizes</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="layers" title={view === 'review' ? 'Every family looks healthy' : 'Nothing here'}
          sub={view === 'review' ? 'No pack size is losing money, under 10%, or undercutting the rest by more than half.' : 'Try another view.'} />
      ) : (
        <div className="space-y-3">
          {shown.map(f => (
            <FamilyCard key={f.si.id} f={f} open={openId === f.si.id} settings={settings} stockItems={stockItems}
              onToggle={() => setOpenId(openId === f.si.id ? null : f.si.id)}
              onModel={() => setModelFor(f)} onCreateListing={onCreateListing} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {modelFor && <ModelDrawer f={modelFor} settings={settings} onClose={() => setModelFor(null)} onCreateListing={onCreateListing} />}
    </div>
  )
}

function Stat({ label, value, tone = '', sub }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink/45 mt-0.5">{sub}</div>}
    </div>
  )
}

function FamilyCard({ f, open, settings, stockItems, onToggle, onModel, onCreateListing, onNavigate }) {
  const gaps = f.sizes.length ? COMMON_PACKS.filter(n => n > Math.min(...f.sizes) && n < Math.max(...f.sizes) && !f.sizes.includes(n)) : []
  return (
    <div className={`surface overflow-hidden ${open ? 'ring-1 ring-royal-200' : ''}`}>
      <div className="px-5 py-4 flex items-center gap-4 flex-wrap cursor-pointer hover:bg-paper/60" role="button" tabIndex={0}
        aria-expanded={open} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} className="text-ink/35 flex-shrink-0" />
        <div className="w-12 h-12 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
          <ProductImage asin={f.asin} alt="" className="object-contain w-full h-full p-1" placeholderSize="text-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink truncate">{f.si.name}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
            <SupplierLink name={f.d.supplierName} />
            {f.brand && <BrandLink name={f.brand} />}
            <span className="text-xs text-ink/50">{fmt(parseFloat(f.d.costPrice))} a unit</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {f.rungs.map(r => (
            <span key={r.lp.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-paper border border-rule text-xs font-semibold text-ink/70"
              title={r.r.incomplete ? 'Can’t calculate' : `${pct(r.r.margin)} margin`}>
              <span className={`w-1.5 h-1.5 rounded-full ${r.r.incomplete ? 'bg-ink/25' : marginDot(r.r.margin)}`} />×{r.qty}
            </span>
          ))}
        </div>
        <div className="flex flex-col items-end gap-1 min-w-[140px]">
          <StatusBadge tone={f.status.tone}>{f.status.label}</StatusBadge>
          {f.spread > 0 && <span className={`text-xs ${f.spread > 50 ? 'text-warn font-semibold' : 'text-ink/45'}`}>{f.spread.toFixed(0)}% price spread</span>}
        </div>
      </div>

      {open && (
        <div className="border-t border-rule">
          <Ladder f={f} settings={settings} stockItems={stockItems} gaps={gaps} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-y border-rule">
                  <th className="th text-left px-5">Listing</th>
                  <th className="th text-center px-3">Pack</th>
                  <th className="th text-right px-3">Sell price</th>
                  <th className="th text-right px-3">Per unit</th>
                  <th className="th text-right px-3">Profit</th>
                  <th className="th text-right px-5">Margin</th>
                </tr>
              </thead>
              <tbody>
                {f.rungs.map(r => (
                  <tr key={r.lp.id} className="border-b border-rule/60 hover:bg-royal-50/40 cursor-pointer" tabIndex={0}
                    onClick={() => onNavigate?.('live', r.saved.id)} onKeyDown={e => e.key === 'Enter' && onNavigate?.('live', r.saved.id)}>
                    <td className="td px-5">
                      <div className="text-ink truncate max-w-[360px]">{r.saved.name}</div>
                      <div className="flex gap-1.5 mt-1 items-center">
                        {r.lp.status === 'paused' && <StatusBadge tone="paused">Paused</StatusBadge>}
                        <AmazonLink asin={r.p.asin} />
                      </div>
                    </td>
                    <td className="td px-3 text-center"><span className="font-semibold">×{r.qty}</span></td>
                    <td className="td px-3 text-right">{fmt(r.r.sellPrice)}</td>
                    <td className="td px-3 text-right font-medium">{fmt(r.pricePerUnit)}</td>
                    <td className={`td px-3 text-right ${r.r.incomplete ? 'text-ink/40' : r.r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{r.r.incomplete ? '—' : fmtSigned(r.r.netProfit)}</td>
                    <td className={`td px-5 text-right font-semibold ${r.r.incomplete ? 'text-ink/40' : marginTone(r.r.margin)}`}>{r.r.incomplete ? 'Incomplete' : pct(r.r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.mixed.length > 0 && (
            <div className="px-5 py-3 border-t border-rule bg-paper/60">
              <div className="text-xs font-semibold text-ink/55 mb-1.5">Also in mixed bundles</div>
              <div className="flex flex-wrap gap-1.5">{f.mixed.map(m => <ListingLink key={m.lp.id} id={m.saved.id} name={m.saved.name} />)}</div>
            </div>
          )}
          <div className="px-5 py-3 border-t border-rule flex gap-2 flex-wrap items-center">
            <button className="btn btn-primary btn-sm" onClick={onModel}><Icon name="trend" size={14} /> Model pack sizes</button>
            {gaps.slice(0, 3).map(n => (
              <button key={n} className="btn btn-secondary btn-sm" onClick={() => onCreateListing?.(f.si, n)}>
                <Icon name="plus" size={14} /> Create ×{n} listing
              </button>
            ))}
            <span className="ml-auto"><ProductLink id={f.si.id} name="Open product" /></span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Price per unit at each size, and what it's telling you. Observations, not decisions. */
function Ladder({ f, settings, stockItems, gaps }) {
  const rungs = f.rungs.filter(r => !r.r.incomplete && r.pricePerUnit > 0)
  if (!rungs.length) return null
  const max = Math.max(...rungs.map(r => r.pricePerUnit))
  const smallest = Math.min(...rungs.map(r => r.qty))
  const base = rungs.filter(r => r.qty === smallest).reduce((a, b) => (b.pricePerUnit > a.pricePerUnit ? b : a))
  const cheapest = rungs.reduce((a, b) => (b.pricePerUnit < a.pricePerUnit ? b : a))
  const drop = base !== cheapest ? (1 - cheapest.pricePerUnit / base.pricePerUnit) * 100 : 0
  const fix = cheapest.r.margin < TARGET ? priceForTargetMargin(cheapest.p, settings.carriers, settings.packaging, stockItems, TARGET) : null
  const losing = rungs.filter(r => r.r.netProfit < 0)

  const notes = []
  if (drop > 0.5) notes.push({ tone: 'ink', title: 'Pricing',
    text: `The ×${cheapest.qty} is ${drop.toFixed(0)}% cheaper per unit than the ${base.qty === 1 ? 'single' : `×${base.qty}`}, at ${pct(cheapest.r.margin)} margin.${fix ? ` ${fmt(fix)} would give it ${TARGET}%.` : ''}` })
  if (losing.length) notes.push({ tone: 'loss', title: 'Losing money',
    text: losing.map(r => `×${r.qty} at ${fmt(r.r.sellPrice)}${r.r.breakEven ? ` — breaks even at ${fmt(r.r.breakEven)}` : ''}`).join('; ') + '.' })
  if (gaps.length) notes.push({ tone: 'ink', title: 'Gaps',
    text: `Not sold as ${gaps.map(n => `×${n}`).join(' or ')}. Model pack sizes shows whether ${gaps.length === 1 ? 'it' : 'they'} would earn a place.` })
  if (!notes.length) notes.push({ tone: 'gain', title: 'Looks right', text: 'Per-unit pricing steps down sensibly and every size makes money.' })

  return (
    <div className="px-5 py-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6">
      <div>
        <div className="text-xs font-semibold text-ink/55 mb-3">Price per unit, by pack size</div>
        <div className="space-y-2">
          {rungs.map(r => (
            <div key={r.lp.id} className="flex items-center gap-3 text-sm">
              <span className="w-9 text-right font-semibold text-ink/70 flex-shrink-0">×{r.qty}</span>
              <div className="flex-1 bg-ink/5 rounded-[4px] h-7 relative overflow-hidden">
                <div className={`h-full rounded-[4px] ${r === cheapest && drop > 0.5 ? 'bg-warn/80' : 'bg-royal-500/85'}`} style={{ width: `${Math.max(8, (r.pricePerUnit / max) * 100)}%` }} />
                <span className="absolute inset-y-0 left-2.5 flex items-center text-xs font-semibold text-white">{fmt(r.pricePerUnit)}</span>
              </div>
              <span className={`w-14 text-right text-xs font-semibold flex-shrink-0 ${marginTone(r.r.margin)}`}>{pct(r.r.margin)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {notes.map((n, i) => (
          <div key={i} className={`pl-3 border-l-2 ${n.tone === 'loss' ? 'border-loss' : n.tone === 'gain' ? 'border-gain' : 'border-royal-400'}`}>
            <div className={`text-sm font-semibold ${n.tone === 'loss' ? 'text-loss' : n.tone === 'gain' ? 'text-gain' : 'text-ink'}`}>{n.title}</div>
            <p className="text-sm text-ink/70 mt-0.5">{n.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * What the product would earn at every pack size. Price per unit is held
 * steady so the only thing moving is shipping — which is what makes big packs
 * stop working when they cross into a heavier band.
 */
function ModelDrawer({ f, settings, onClose, onCreateListing }) {
  const ref = f.rungs.find(r => !r.r.incomplete) || f.rungs[0]
  const [ppu, setPpu] = useState(ref ? ref.pricePerUnit.toFixed(2) : '')
  const [feeCategory, setFeeCategory] = useState(ref?.p?.feeCategory || 'Everything else')
  const [service, setService] = useState(ref?.p?.serviceLevel || 'nextday')
  const sizes = [1, 2, 3, 4, 6, 8, 10, 12, 24]

  const rows = useMemo(() => modelPackSizes(f.si,
    { pricePerUnit: ppu, feeCategory, serviceLevel: service, packagingId: ref?.p?.packagingId || '', vatZero: ref?.p?.vatZero },
    settings.carriers, settings.packaging, sizes), [f, ppu, feeCategory, service, settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const viable = rows.filter(r => r.viable)
  const best = viable.length ? viable.reduce((a, b) => (b.profitPerUnit > a.profitPerUnit ? b : a)) : null
  const maxAbs = Math.max(0.01, ...rows.map(r => Math.abs(r.profitPerUnit)))
  const unitW = parseFloat(f.d.weightKg) || 0

  return (
    <Drawer title={`Model pack sizes — ${f.si.name}`} description={`${fmt(parseFloat(f.d.costPrice))} and ${unitW ? unitW.toFixed(3) + 'kg' : 'no weight set'} per unit`}
      onClose={onClose} width="max-w-3xl"
      footer={<div className="text-xs text-ink/55">Uses the cheapest carrier that can take each weight, and Amazon’s fee schedule for the category you choose. Nothing is saved until you create a listing.</div>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div><label className="label" htmlFor="md-ppu">Price per unit £</label>
          <input id="md-ppu" type="number" step="0.01" className="input" value={ppu} onChange={e => setPpu(e.target.value)} /></div>
        <div><label className="label" htmlFor="md-fee">Amazon fee category</label>
          <select id="md-fee" className="input" value={feeCategory} onChange={e => setFeeCategory(e.target.value)}>
            {FEE_CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name} — {describeCategory(c)}</option>)}
          </select></div>
        <div><label className="label" htmlFor="md-svc">Service</label>
          <select id="md-svc" className="input" value={service} onChange={e => setService(e.target.value)}>
            {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      {!unitW && <div className="panel-notice mb-4 text-sm">This product has no weight, so shipping can’t be worked out properly. Add it on the product first.</div>}

      {best && (
        <div className="p-4 rounded-card bg-ink text-white mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-white/60">Most profit per unit</div>
            <div className="text-2xl font-semibold">×{best.qty} — {fmt(best.profitPerUnit)} a unit</div>
            <div className="text-sm text-white/70 mt-0.5">{fmt(best.sell)} sell price · {pct(best.margin)} margin · {best.carrier}</div>
          </div>
          {!f.sizes.includes(best.qty) && (
            <button className="btn btn-sm bg-white text-ink hover:bg-sky" onClick={() => onCreateListing?.(f.si, best.qty)}>
              <Icon name="plus" size={14} /> Create ×{best.qty} listing
            </button>
          )}
        </div>
      )}

      <div className="text-xs font-semibold text-ink/55 mb-2">Profit per unit at each size</div>
      <div className="space-y-1.5 mb-5">
        {rows.map(r => {
          const sold = f.sizes.includes(r.qty)
          const w = Math.max(3, (Math.abs(r.profitPerUnit) / maxAbs) * 100)
          return (
            <div key={r.qty} className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_140px] items-center gap-2 text-sm">
              <span className="text-right font-semibold text-ink/70">×{r.qty}</span>
              <div className="flex justify-end">{r.profitPerUnit < 0 && <div className="h-6 rounded-l bg-loss/80" style={{ width: `${w}%` }} />}</div>
              <div className="flex items-center gap-2 min-w-0">
                {r.profitPerUnit >= 0 && <div className={`h-6 rounded-r ${r === best ? 'bg-gain' : 'bg-royal-500/80'}`} style={{ width: `${w * 0.8}%` }} />}
                <span className={`text-xs font-semibold whitespace-nowrap ${r.profitPerUnit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.profitPerUnit)}</span>
              </div>
              <div className="text-right">
                {sold ? <StatusBadge tone="brand">You sell this</StatusBadge>
                  : r.viable ? <button className="btn btn-secondary btn-xs" onClick={() => onCreateListing?.(f.si, r.qty)}><Icon name="plus" size={12} /> Create listing</button>
                  : <span className="text-xs text-ink/45">{r.carrier === 'No carrier fits' ? 'Too heavy to ship' : 'Loses money'}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="overflow-x-auto border border-rule rounded-card">
        <table className="w-full text-sm">
          <thead><tr className="bg-paper border-b border-rule">
            <th className="th text-left px-4">Pack</th><th className="th text-right px-3">Weight</th><th className="th text-left px-3">Cheapest carrier</th>
            <th className="th text-right px-3">Ship / unit</th><th className="th text-right px-3">Sell</th><th className="th text-right px-3">Profit</th><th className="th text-right px-4">Margin</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.qty} className={`border-b border-rule/60 ${r === best ? 'bg-gain/5' : ''}`}>
                <td className="td px-4 font-semibold">×{r.qty}</td>
                <td className="td px-3 text-right text-ink/60">{r.weight.toFixed(2)}kg</td>
                <td className="td px-3 text-ink/60 text-xs">{r.carrier}</td>
                <td className="td px-3 text-right text-ink/60">{fmt(r.shippingPerUnit)}</td>
                <td className="td px-3 text-right">{fmt(r.sell)}</td>
                <td className={`td px-3 text-right font-medium ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</td>
                <td className={`td px-4 text-right font-semibold ${marginTone(r.margin)}`}>{pct(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  )
}
