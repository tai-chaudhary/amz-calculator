import React, { useState, useMemo } from 'react'
import { shippingSaving } from '../lib/calc'
import { freshness } from './SuppliersPage'
import { calcProduct, hasComponents, fmt, fmtSigned, pct } from '../lib/calc'
import { ProductImage, PageHeader, Icon } from './UI'

export default function DashboardPage({
  savedProducts, liveProducts, stockItems, settings,
  priceHistory = [], costHistory = [], me, onNavigate, hunts = [], huntItems = [],
  proposals = [], suppliers = [], catalogueStats = [], syncStatus = { states: [] },
}) {
  const [rateRise, setRateRise] = useState(5)

  const rows = useMemo(() => liveProducts
    .map(lp => {
      const saved = savedProducts.find(s => s.id === lp.saved_product_id)
      if (!saved) return null
      const p = saved.data || saved
      return { lp, saved, p, r: calcProduct(p, settings.carriers, settings.packaging, stockItems) }
    })
    .filter(Boolean), [liveProducts, savedProducts, stockItems, settings])

  const live = rows.filter(x => x.lp.status === 'live')

  const stats = useMemo(() => {
    const counted = live.filter(x => !x.r.incomplete)
    const margins = counted.map(x => x.r.margin)
    const weekAgo = Date.now() - 7 * 86400000
    return {
      live: live.length,
      paused: rows.length - live.length,
      avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
      lossMaking: counted.filter(x => x.r.netProfit < 0),
      lowMargin: counted.filter(x => x.r.margin >= 0 && x.r.margin < 10),
      incomplete: live.filter(x => x.r.incomplete),
      inReview: savedProducts.filter(r => (r.data?.reviewStatus || 'none') === 'review'),
      approved: savedProducts.filter(r => r.data?.reviewStatus === 'approved' &&
        !liveProducts.some(lp => lp.saved_product_id === r.id)),
      unlinked: savedProducts.filter(r => !hasComponents(r.data || {})),
      addedThisWeek: savedProducts.filter(r => new Date(r.created_at).getTime() > weekAgo).length,
      recentPriceChanges: priceHistory.filter(h => new Date(h.changed_at).getTime() > weekAgo),
      recentCostChanges: costHistory.filter(h => new Date(h.changed_at).getTime() > weekAgo),
    }
  }, [rows, live, savedProducts, priceHistory, costHistory])

  // ── Profit concentration ────────────────────────────────────────────────
  const concentration = useMemo(() => {
    const sorted = [...live].sort((a, b) => b.r.netProfit - a.r.netProfit)
    const total = sorted.reduce((s, x) => s + Math.max(0, x.r.netProfit), 0)
    if (!total) return null
    const share = (n) => sorted.slice(0, n).reduce((s, x) => s + Math.max(0, x.r.netProfit), 0) / total * 100
    return {
      top5: share(5), top10: share(10), top20: share(20),
      total, leaders: sorted.slice(0, 5),
    }
  }, [live])

  // ── Supplier dependency ─────────────────────────────────────────────────
  const dependency = useMemo(() => {
    const map = new Map()
    live.forEach(x => {
      const comps = hasComponents(x.p)
        ? x.p.components.map(c => stockItems.find(s => s.id === c.stockItemId)).filter(Boolean)
        : []
      const supplier = (comps[0]?.data?.supplierName || x.p.supplierName || '').trim() || 'Not set'
      if (!map.has(supplier)) map.set(supplier, { name: supplier, count: 0, profit: 0 })
      const e = map.get(supplier)
      e.count++
      e.profit += x.r.netProfit
    })
    const list = [...map.values()].sort((a, b) => b.count - a.count)
    const total = live.length || 1
    return list.map(s => ({ ...s, share: (s.count / total) * 100 }))
  }, [live, stockItems])

  // ── Margin distribution ─────────────────────────────────────────────────
  const buckets = useMemo(() => {
    const defs = [
      // Two warning colours, then one hue deepening as margin improves
      { label: 'Loss',   min: -Infinity, max: 0,  colour: 'bg-loss' },
      { label: '0–10%',  min: 0,  max: 10,        colour: 'bg-warn' },
      { label: '10–20%', min: 10, max: 20,        colour: 'bg-royal-200' },
      { label: '20–30%', min: 20, max: 30,        colour: 'bg-royal-400' },
      { label: '30–40%', min: 30, max: 40,        colour: 'bg-royal-500' },
      { label: '40%+',   min: 40, max: Infinity,  colour: 'bg-gain' },
    ]
    return defs.map(d => ({
      ...d,
      items: live.filter(x => x.r.margin >= d.min && x.r.margin < d.max),
    }))
  }, [live])
  const maxBucket = Math.max(1, ...buckets.map(b => b.items.length))

  // ── Carrier rate sensitivity ────────────────────────────────────────────
  const sensitivity = useMemo(() => {
    const factor = 1 + rateRise / 100
    const bumped = {}
    Object.entries(settings.carriers || {}).forEach(([id, c]) => {
      bumped[id] = {
        ...c,
        categories: (c.categories || []).map(cat => ({
          ...cat,
          rates: Object.fromEntries(Object.entries(cat.rates || {}).map(([k, v]) => [k, (v || 0) * factor])),
        })),
      }
    })

    const affected = live.map(x => {
      const after = calcProduct(x.p, bumped, settings.packaging, stockItems)
      return { ...x, after }
    })

    const nowLoss = affected.filter(x => x.r.netProfit >= 0 && x.after.netProfit < 0)
    const nowLow = affected.filter(x => x.r.margin >= 10 && x.after.margin < 10)
    const profitBefore = affected.reduce((s, x) => s + x.r.netProfit, 0)
    const profitAfter = affected.reduce((s, x) => s + x.after.netProfit, 0)

    return {
      nowLoss, nowLow,
      profitBefore, profitAfter,
      hit: profitBefore - profitAfter,
      worst: [...affected].sort((a, b) => (a.after.margin - a.r.margin) - (b.after.margin - b.r.margin)).slice(0, 5),
    }
  }, [live, settings, stockItems, rateRise])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const openHunts = hunts.filter(h => h.status !== 'complete' && h.status !== 'archived')
    .map(h => ({ h, left: huntItems.filter(i => i.hunt_id === h.id && i.disposition === 'pending').length }))
    .filter(x => x.left > 0)
  // Things the portal has spotted that would make money if acted on
  const pendingChanges = proposals.filter(p => p.status === 'pending')
  const opportunities = useMemo(() => {
    let shipCount = 0, shipPerUnit = 0, shipMonthly = 0
    for (const x of live) {
      if (x.r.incomplete) continue
      const s = shippingSaving(x.p, settings.carriers, stockItems)
      if (s && !s.rateMissing && s.saving > 0.001) {
        shipCount++; shipPerUnit += s.saving
        shipMonthly += s.saving * (parseFloat(x.p.monthlyVolume) || 0)
      }
    }
    const cheaper = pendingChanges.filter(p => p.kind === 'cheaper_supplier').length
    // Families whose cheapest-per-unit pack is losing money or under 10%
    const byStock = new Map()
    for (const x of live) {
      const c = x.p.components
      if (x.r.incomplete || !c || c.length !== 1) continue
      if (!byStock.has(c[0].stockItemId)) byStock.set(c[0].stockItemId, [])
      byStock.get(c[0].stockItemId).push(x)
    }
    const ladders = [...byStock.values()].filter(r => r.length > 1 && r.some(x => x.r.margin < 10)).length
    return { shipCount, shipPerUnit, shipMonthly, cheaper, ladders }
  }, [live, settings, stockItems, pendingChanges])

  const supplierData = suppliers.map(s => freshness(s,
    catalogueStats.find(x => x.supplier_id === s.id),
    syncStatus.states.find(x => x.supplier_id === s.id)?.state))
  const staleSuppliers = supplierData.filter(f => f.key === 'stale' || f.key === 'due').length

  const attentionTotal = pendingChanges.length + staleSuppliers + stats.incomplete.length + stats.lossMaking.length + stats.lowMargin.length + stats.inReview.length + stats.approved.length + stats.unlinked.length + openHunts.length

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Overview"
        title={`${greeting}${me?.name ? `, ${me.name}` : ''}`}
        description={attentionTotal
          ? `You have ${attentionTotal} catalogue item${attentionTotal === 1 ? '' : 's'} that need attention today.`
          : 'Your catalogue has no immediate exceptions. Keep an eye on margin and cost movement below.'}
        meta={<span>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>}
        actions={(
          <button className="btn btn-primary" onClick={() => onNavigate?.('calculator')}>
            <Icon name="plus" size={15} /> New calculation
          </button>
        )}
      />

      {/* Needs attention — an action queue, not a row of decorative chips. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] gap-4 mb-5">
        <div className="surface overflow-hidden">
          <div className="px-4 py-3.5 bg-white border-b border-rule flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">{attentionTotal ? `${attentionTotal} thing${attentionTotal === 1 ? '' : 's'} need${attentionTotal === 1 ? 's' : ''} you` : 'Needs you'}</div>
              <div className="text-xs text-ink/50 mt-0.5">Problems and decisions, most urgent first.</div>
            </div>
            <span className={`pill ${attentionTotal ? 'pill-alert' : 'pill-live'}`}>{attentionTotal || 'Clear'}</span>
          </div>
          {attentionTotal ? (
            <div>
              {pendingChanges.length > 0 && (
                <AttentionRow icon="check" tone="brand" title={`${pendingChanges.length} proposed change${pendingChanges.length !== 1 ? 's' : ''} waiting`}
                  detail="Cost, fee, carrier and supplier changes — nothing is applied until you approve."
                  onClick={() => onNavigate?.('approvals', 'changes')} />
              )}
              {stats.lossMaking.length > 0 && (
                <AttentionRow icon="alert" tone="alert" title={`${stats.lossMaking.length} loss-making listing${stats.lossMaking.length !== 1 ? 's' : ''}`} detail="Review selling price, product cost or shipping." onClick={() => onNavigate?.('live')} />
              )}
              {stats.lowMargin.length > 0 && (
                <AttentionRow icon="trend" tone="warn" title={`${stats.lowMargin.length} listing${stats.lowMargin.length !== 1 ? 's' : ''} below 10% margin`} detail="Small cost movements could make these unprofitable." onClick={() => onNavigate?.('live')} />
              )}
              {stats.inReview.length > 0 && (
                <AttentionRow icon="review" tone="brand" title={`${stats.inReview.length} awaiting review`} detail="Approve, return or edit before they go live." onClick={() => onNavigate?.('approvals', 'listings')} />
              )}
              {openHunts.length > 0 && (
                <AttentionRow icon="search" tone="brand"
                  title={`${openHunts.length} hunt${openHunts.length !== 1 ? 's' : ''} in progress`}
                  detail={openHunts.slice(0, 2).map(x => `${x.h.name}: ${x.left} to decide`).join(' · ')}
                  onClick={() => onNavigate?.('hunter')} />
              )}
              {stats.approved.length > 0 && (
                <AttentionRow icon="check" tone="brand" title={`${stats.approved.length} approved, ready to order`} detail="Place the stock order, then push each one live once it's listed." onClick={() => onNavigate?.('saved')} />
              )}
              {stats.incomplete.length > 0 && (
                <AttentionRow icon="alert" tone="alert" title={`${stats.incomplete.length} live listing${stats.incomplete.length !== 1 ? 's' : ''} can't be calculated`}
                  detail={`${stats.incomplete[0].r.issues[0]?.text}${stats.incomplete.length > 1 ? ' and others' : ''} — their profit isn't shown until fixed.`}
                  onClick={() => onNavigate?.('live')} />
              )}
              {staleSuppliers > 0 && (
                <AttentionRow icon="clock" tone="warn" title={`${staleSuppliers} supplier${staleSuppliers !== 1 ? 's' : ''} with ageing prices`}
                  detail="Their price data is over a week old — costs behind your margins may have moved."
                  onClick={() => onNavigate?.('suppliers')} />
              )}
              {stats.unlinked.length > 0 && (
                <AttentionRow icon="package" tone="quiet" title={`${stats.unlinked.length} listing${stats.unlinked.length !== 1 ? 's' : ''} not linked to stock`} detail="Link stock so cost changes can flow through correctly." onClick={() => onNavigate?.('stock')} />
              )}
            </div>
          ) : (
            <div className="px-4 py-5 flex items-center gap-3 text-sm text-ink/55">
              <div className="attention-icon bg-lime/25 text-gain"><Icon name="check" size={16} /></div>
              <div><span className="font-semibold text-ink">Nothing urgent.</span> No loss-makers, low-margin exceptions or review items.</div>
            </div>
          )}
        </div>

        <div className="space-y-4">
        <div className="surface overflow-hidden">
          <div className="px-4 py-3.5 bg-white border-b border-rule">
            <div className="text-sm font-semibold text-ink">Opportunities</div>
            <div className="text-xs text-ink/50 mt-0.5">Money the portal has spotted on the table.</div>
          </div>
          {opportunities.shipCount + opportunities.cheaper + opportunities.ladders === 0 ? (
            <div className="px-4 py-4 text-sm text-ink/55">Nothing obvious right now.</div>
          ) : (
            <div>
              {opportunities.shipCount > 0 && (
                <AttentionRow icon="truck" tone="brand"
                  title={opportunities.shipMonthly > 0 ? `${fmt(opportunities.shipMonthly)} a month on shipping` : `${fmt(opportunities.shipPerUnit)} per unit on shipping`}
                  detail={`${opportunities.shipCount} listing${opportunities.shipCount !== 1 ? 's' : ''} could use a cheaper carrier.`}
                  onClick={() => onNavigate?.('shipping')} />
              )}
              {opportunities.cheaper > 0 && (
                <AttentionRow icon="package" tone="brand" title={`${opportunities.cheaper} product${opportunities.cheaper !== 1 ? 's' : ''} cheaper elsewhere`}
                  detail="Same barcode, lower unit price at another supplier." onClick={() => onNavigate?.('approvals', 'changes')} />
              )}
              {opportunities.ladders > 0 && (
                <AttentionRow icon="layers" tone="brand" title={`${opportunities.ladders} pack-size ladder${opportunities.ladders !== 1 ? 's' : ''} worth reviewing`}
                  detail="A multipack in the family is under 10% margin or losing money." onClick={() => onNavigate?.('families')} />
              )}
            </div>
          )}
        </div>
        <div className="surface-sky p-5 flex flex-col justify-between min-h-[150px]">
          <div>
            <div className="section-kicker">Catalogue pulse</div>
            <div className="text-sm text-royal-800 mt-2 leading-relaxed">
              {stats.recentPriceChanges.length + stats.recentCostChanges.length
                ? `${stats.recentPriceChanges.length + stats.recentCostChanges.length} commercial change${stats.recentPriceChanges.length + stats.recentCostChanges.length === 1 ? '' : 's'} recorded in the last seven days.`
                : 'No price or cost changes recorded in the last seven days.'}
            </div>
          </div>
          <div className="flex items-end justify-between gap-3 mt-5">
            <div>
              <div className="figure text-[32px] text-royal-700">{stats.addedThisWeek}</div>
              <div className="text-xs text-royal-700/70 mt-1">Listings added this week</div>
            </div>
            <Icon name="trend" size={24} className="text-royal-500" />
          </div>
        </div>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Live listings" value={stats.live} sub={stats.paused ? `${stats.paused} paused` : null} onClick={() => onNavigate?.('live')} />
        <Stat label="Average margin" value={pct(stats.avgMargin)} colour={stats.avgMargin >= 20 ? 'text-gain' : stats.avgMargin >= 10 ? 'text-warn' : 'text-loss'} />
        <Stat label="Products" value={stockItems.length} onClick={() => onNavigate?.('stock')} />
        <Stat label="Changes this week" value={stats.recentPriceChanges.length + stats.recentCostChanges.length}
          sub={`${stats.recentPriceChanges.length} price · ${stats.recentCostChanges.length} cost`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Margin distribution */}
        <div className="card">
          <div className="text-base font-semibold text-ink">Margin distribution</div>
          <div className="text-xs text-ink/50 mb-4 mt-0.5">Where your {live.length} live listings sit</div>
          <div className="space-y-2">
            {buckets.map(b => (
              <div key={b.label} className="flex items-center gap-3">
                <div className="text-xs text-ink/55 text-right" style={{ width: 52 }}>{b.label}</div>
                <div className="flex-1 bg-ink/5 rounded h-7 relative overflow-hidden">
                  <div className={`${b.colour} h-full rounded transition-[width] duration-500`}
                    style={{ width: `${(b.items.length / maxBucket) * 100}%` }} />
                  {b.items.length > 0 && (
                    <span className={`absolute inset-y-0 left-2 flex items-center text-xs font-semibold ${
                      b.colour === 'bg-royal-200' ? 'text-royal-700' : 'text-white'
                    }`}>
                      {b.items.length}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink/45 text-right" style={{ width: 34 }}>
                  {live.length ? Math.round((b.items.length / live.length) * 100) : 0}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Profit concentration */}
        <div className="card">
          <div className="text-base font-semibold text-ink">Profit concentration</div>
          <div className="text-xs text-ink/50 mb-4 mt-0.5">Share of total per-unit profit from your best sellers</div>
          {!concentration ? (
            <div className="text-sm text-ink/45 py-6 text-center">Not enough data yet</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <ConcStat label="Top 5" value={concentration.top5} />
                <ConcStat label="Top 10" value={concentration.top10} />
                <ConcStat label="Top 20" value={concentration.top20} />
              </div>
              <div className="text-xs font-semibold text-ink/45 mb-2">Biggest contributors</div>
              <div className="space-y-1">
                {concentration.leaders.map(({ lp, saved, p, r }) => (
                  <button key={lp.id}
                    className="w-full flex items-center gap-2 text-left py-1.5 px-2 rounded-[5px] hover:bg-paper"
                    onClick={() => onNavigate?.('live', saved.id)}
                  >
                    <div className="w-7 h-7 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <ProductImage asin={p.asin} manualImage={p.productImage} alt="" className="object-contain w-full h-full p-0.5" placeholderSize="text-xs" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink/80 truncate">{saved.name}</div>
                    </div>
                    <div className="text-xs font-medium text-gain flex-shrink-0">{fmt(r.netProfit)}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Supplier dependency */}
        <div className="card">
          <div className="text-base font-semibold text-ink">Supplier dependency</div>
          <div className="text-xs text-ink/50 mb-4 mt-0.5">How much of the catalogue each supplier accounts for</div>
          {dependency.length === 0 ? (
            <div className="text-sm text-ink/45 py-6 text-center">No live listings yet</div>
          ) : (
            <div className="space-y-2">
              {dependency.slice(0, 8).map(s => (
                <button key={s.name} className="w-full text-left" onClick={() => onNavigate?.('suppliers')}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-ink/80 truncate" style={{ maxWidth: "min(100%, 200px)" }}>{s.name}</span>
                    <span className={`font-medium ${s.share > 40 ? 'text-warn' : 'text-ink/45'}`}>
                      {s.count} · {s.share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="bg-paper rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full ${s.share > 40 ? 'bg-warn/70' : 'bg-royal-400'}`}
                      style={{ width: `${s.share}%` }} />
                  </div>
                </button>
              ))}
              {dependency[0]?.share > 40 && (
                <div className="text-xs text-warn bg-warn/5 rounded-[5px] px-2.5 py-2 mt-3">
                  {dependency[0].name} accounts for {dependency[0].share.toFixed(0)}% of your live listings —
                  worth knowing if their prices move or they have supply problems.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Carrier rate sensitivity */}
        <div className="card">
          <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-ink/80">Carrier rate sensitivity</div>
              <div className="text-xs text-ink/45">What a shipping price rise would do</div>
            </div>
            <div className="flex gap-1">
              {[3, 5, 10, 15].map(n => (
                <button key={n}
                  className={`px-2 py-1 rounded-[5px] text-xs font-medium transition-colors ${rateRise === n ? 'bg-royal-100 text-royal-700' : 'text-ink/45 hover:text-ink/70 hover:bg-paper'}`}
                  onClick={() => setRateRise(n)}
                >+{n}%</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 my-4">
            <div className="metric-card py-2">
              <div className="metric-label">Profit hit</div>
              <div className="metric-value text-sm text-loss">−{fmt(sensitivity.hit)}</div>
              <div className="text-xs text-ink/45 mt-0.5">per unit, all listings</div>
            </div>
            <div className="metric-card py-2">
              <div className="metric-label">Turn loss-making</div>
              <div className={`metric-value text-sm ${sensitivity.nowLoss.length ? 'text-loss' : 'text-ink/45'}`}>
                {sensitivity.nowLoss.length}
              </div>
            </div>
            <div className="metric-card py-2">
              <div className="metric-label">Drop under 10%</div>
              <div className={`metric-value text-sm ${sensitivity.nowLow.length ? 'text-warn' : 'text-ink/45'}`}>
                {sensitivity.nowLow.length}
              </div>
            </div>
          </div>

          {sensitivity.nowLoss.length > 0 && (
            <>
              <div className="text-xs font-semibold text-ink/45 mb-2">
                Would start losing money
              </div>
              <div className="space-y-1">
                {sensitivity.nowLoss.slice(0, 5).map(({ lp, saved, r, after }) => (
                  <button key={lp.id}
                    className="w-full flex items-center justify-between gap-2 text-left py-1.5 px-2 rounded-[5px] hover:bg-loss/5"
                    onClick={() => onNavigate?.('live', saved.id)}
                  >
                    <span className="text-xs text-ink/80 truncate flex-1">{saved.name}</span>
                    <span className="text-xs flex-shrink-0">
                      <span className="text-ink/45">{pct(r.margin)}</span>
                      <span className="text-ink/30 mx-1">→</span>
                      <span className="text-loss font-medium">{pct(after.margin)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {sensitivity.nowLoss.length === 0 && (
            <div className="text-xs text-gain bg-lime/15 border border-lime/40 rounded-[5px] px-2.5 py-2 flex items-start gap-2">
              <Icon name="check" size={14} className="mt-0.5 flex-shrink-0" />
              <span>Nothing tips into a loss at +{rateRise}%. Total per-unit profit falls from{' '}{fmt(sensitivity.profitBefore)} to {fmt(sensitivity.profitAfter)}.</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      {(stats.recentPriceChanges.length > 0 || stats.recentCostChanges.length > 0) && (
        <div className="card mt-4">
          <div className="text-base font-semibold text-ink">Recent changes</div>
          <div className="text-xs text-ink/50 mb-3 mt-0.5">Last 7 days</div>
          <div className="space-y-1.5">
            {[...stats.recentPriceChanges.map(h => ({ ...h, kind: 'price' })),
              ...stats.recentCostChanges.map(h => ({ ...h, kind: 'cost' }))]
              .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))
              .slice(0, 8)
              .map(h => {
                const saved = savedProducts.find(r => r.id === h.saved_product_id)
                const isPrice = h.kind === 'price'
                const oldV = isPrice ? h.old_price : h.old_cost
                const newV = isPrice ? h.new_price : h.new_cost
                const up = newV > oldV
                return (
                  <button key={`${h.kind}-${h.id}`}
                    className="w-full flex items-center justify-between gap-3 text-left py-1.5 px-2 rounded-[5px] hover:bg-paper"
                    onClick={() => saved && onNavigate?.('live', saved.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isPrice ? 'bg-royal-100 text-royal-700' : 'bg-ink/5 text-ink/70'}`}>
                        {isPrice ? 'Price' : 'Cost'}
                      </span>
                      <span className="text-xs text-ink/80 truncate">{saved?.name || 'Deleted listing'}</span>
                    </div>
                    <div className="text-xs flex-shrink-0 flex items-center gap-2">
                      <span className="text-ink/45">{fmt(oldV)} → {fmt(newV)}</span>
                      <span className={up ? (isPrice ? 'text-gain' : 'text-loss') : (isPrice ? 'text-loss' : 'text-gain')}>
                        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
                      </span>
                      {h.user_name && <span className="text-ink/45">{h.user_name}</span>}
                    </div>
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, colour, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left ${onClick ? 'hover:border-royal-200 cursor-pointer transition-colors' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`figure text-[26px] mt-0.5 ${colour || ''}`}>{value}</div>
      {sub && <div className="text-xs text-ink/45 mt-0.5">{sub}</div>}
    </Tag>
  )
}

function ConcStat({ label, value }) {
  return (
    <div className="metric-card py-2">
      <div className="metric-label">{label}</div>
      <div className={`figure text-xl mt-0.5 ${value > 70 ? 'text-warn' : 'text-ink'}`}>{value.toFixed(0)}%</div>
    </div>
  )
}

function AttentionRow({ icon, tone, title, detail, onClick }) {
  const iconStyles = {
    alert: 'bg-coral/12 text-loss',
    warn: 'bg-warn/10 text-warn',
    brand: 'bg-sky/60 text-royal-600',
    quiet: 'bg-paper text-ink/50',
  }
  return (
    <button className="attention-row" onClick={onClick}>
      <div className={`attention-icon ${iconStyles[tone] || iconStyles.quiet}`}><Icon name={icon} size={16} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="text-xs text-ink/45 mt-0.5">{detail}</div>
      </div>
      <Icon name="arrowRight" size={15} className="text-ink/25 flex-shrink-0" />
    </button>
  )
}
