import React, { useEffect, useMemo, useState } from 'react'
import { Icon, Spinner, Flag, StatusBadge } from './UI'
import { loadReturnsStats } from '../lib/db'
import { periodRange } from '../lib/pnlScreen'
import { londonToday, fmtDate } from '../lib/dates'
import { money, money0, pct1, int, Tile, PeriodPicker, ChangeChip, Delta, Bars, spanText, NameLink } from './FinanceParts'
import { summarise, returnsByDay, REASONS, CAUSES, OUTCOMES, causeOf, amazonState, RATE_ALERT } from '../lib/returnsLogic'

/**
 * Returns → Dashboard (v2.111.0). Two versions, as the owner asked (19 Nov 2026): Jignesh "can't see the dashboard"
 * the admins see, so he gets his own.
 *
 *   Admins   the P&L's look and periods: what returns cost the P&L this period (refunds less the fees Amazon gives back,
 *            return postage, SAFE-T paid, the back-in-stock credit), the return rate against units sold, what came
 *            back and in what state, who or what caused it, products by return rate, and every figure beside the
 *            period before.
 *   Office   the workload, no money: what arrived today, what to match, SAFE-T deadlines, overdue returns, his SAFE-T
 *            claims, reasons and products by count and rate, and whether today's Amazon report is uploaded.
 */
const sum = (xs, f) => (xs || []).reduce((t, x) => t + (Number(f(x)) || 0), 0)
const inR = (d, r) => d >= r.from && d <= r.to

export default function ReturnsDashboard({ me, admin, data, todo, inventory, onTab, onOpen, onOpenRma }) {
  const today = useMemo(londonToday, [])
  const [periodId, setPeriodId] = useState(admin ? 'lastweek' : 'week')
  const [custom, setCustom] = useState({ from: today, to: today })
  const range = useMemo(() => periodRange(periodId, today, custom), [periodId, today, custom])
  const [stats, setStats] = useState(null)
  const [prevStats, setPrevStats] = useState(null)
  useEffect(() => {
    let live = true
    setStats(null); setPrevStats(null)
    loadReturnsStats(range.from, range.to).then(s => { if (live) setStats(s) }).catch(() => { if (live) setStats({ sold: {}, money: null }) })
    if (range.prev) loadReturnsStats(range.prev.from, range.prev.to).then(s => { if (live) setPrevStats(s) }).catch(() => { if (live) setPrevStats({ sold: {} }) })
    return () => { live = false }
  }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => Object.fromEntries((inventory?.products || []).map(p => [p.id, p.name])), [inventory])
  const T = useMemo(() => (stats ? summarise({ ...data, sold: stats.sold || {}, names, today }, range.from, range.to) : null), [stats, data, names, today, range])
  const P = useMemo(() => (prevStats && range.prev ? summarise({ ...data, sold: prevStats.sold || {}, names, today }, range.prev.from, range.prev.to) : null), [prevStats, data, names, today, range])
  const moneyOf = (s, r) => {
    const m = s?.money
    if (!m) return null
    const refunds = -sum(m.refunds, x => x.amount), feesBack = sum(m.refunds, x => x.fees)
    const postage = -sum((m.charges || []).filter(c => c.what === 'postage'), c => c.amount), safet = sum((m.charges || []).filter(c => c.what === 'safet'), c => c.amount)
    const credit = sum(m.credit, x => x.credit), writtenOff = sum(m.written_off, x => x.value), claims = Number(m.claims_won) || 0
    return { refunds, feesBack, postage, safet, credit, writtenOff, claims, refundOrders: sum(m.refunds, x => x.orders),
      net: refunds - feesBack + postage - safet - credit - claims, units: sum(m.credit, x => x.units) }
  }
  const M = useMemo(() => moneyOf(stats, range), [stats, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const PM = useMemo(() => (range.prev ? moneyOf(prevStats, range.prev) : null), [prevStats, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => {
    const from = range.days < 14 ? new Date(new Date(`${range.to}T12:00:00Z`).getTime() - 13 * 864e5).toISOString().slice(0, 10) : range.from
    return returnsByDay(data, from, range.to).map(r => ({ ...r, v: r.requests }))
  }, [data, range])
  const periodName = { today: 'Today', yesterday: 'Yesterday', week: 'This week', lastweek: 'Last week', month: 'This month', lastmonth: 'Last month', quarter: 'This quarter', lastquarter: 'Last quarter', all: 'All time', custom: 'Chosen dates' }[periodId]

  return (
    <div>
      <PeriodPicker periodId={periodId} onPeriod={setPeriodId} custom={custom} onCustom={setCustom} today={today} />
      {!T ? <div className="surface flex justify-center py-16"><Spinner /></div> : admin
        ? <AdminView T={T} P={P} M={M} PM={PM} range={range} periodName={periodName} todo={todo} series={series} onTab={onTab} />
        : <OfficeView T={T} P={P} range={range} periodName={periodName} todo={todo} data={data} today={today} series={series} onTab={onTab} onOpen={onOpen} onOpenRma={onOpenRma} />}
    </div>
  )
}

function Hero({ label, value, sub, dates, children, tone = 'bg-royal-500' }) {
  return (
    <div className={`xl:col-span-4 ${tone} text-white rounded-card px-6 pt-5 pb-5 flex flex-col`} data-returns-hero>
      <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky">{label}</div>
      <div className="mt-2.5 inline-flex items-center gap-2 self-start rounded-[6px] bg-white/15 border border-white/25 px-3 py-1.5">
        <Icon name="calendar" size={14} /><span className="text-[15px] font-semibold leading-none">{dates.name}</span><span className="text-[15px] text-sky leading-none">{dates.text}</span>
      </div>
      <div className="text-[52px] leading-none font-bold tabular-nums mt-3" style={{ letterSpacing: '-0.03em' }}>{value}</div>
      <div className="w-24 h-1 bg-lime rounded-sm mt-3" />
      {sub && <div className="text-sm text-sky mt-3">{sub}</div>}
      {children}
    </div>
  )
}

function Breakdown({ rows, total, fmt = int, onPick }) {
  const max = Math.max(1, ...rows.map(r => r.v))
  return (
    <div className="space-y-1.5">{rows.map(r => (
      <button key={r.k} type="button" disabled={!onPick} onClick={() => onPick?.(r)} className="w-full text-left" data-breakdown-row>
        <div className="flex justify-between text-sm gap-3"><span className="text-ink min-w-0 truncate">{r.label}{r.hint && <span className="text-xs text-ink/45"> · {r.hint}</span>}</span><span className="tabular-nums whitespace-nowrap"><b>{fmt(r.v)}</b>{total ? <span className="text-ink/45 text-xs"> · {pct1((r.v / total) * 100)}</span> : null}</span></div>
        <div className="h-1.5 bg-paper rounded-full mt-0.5"><div className={`h-1.5 rounded-full ${r.bar || 'bg-royal-500'}`} style={{ width: `${(r.v / max) * 100}%` }} /></div>
      </button>
    ))}</div>
  )
}
const CAUSE_BAR = { packing: 'bg-loss', product: 'bg-loss/70', carrier: 'bg-warn', listing: 'bg-royal-500', customer: 'bg-muted', unknown: 'bg-rule' }
const causeRows = (T) => Object.entries(T.causes).map(([k, v]) => ({ k, v, label: CAUSES[k]?.label || k, hint: CAUSES[k]?.hint, bar: CAUSE_BAR[k] })).sort((a, b) => b.v - a.v)
const reasonRows = (T) => Object.entries(T.reasons).map(([k, v]) => ({ k, v, label: REASONS[k] || k })).sort((a, b) => b.v - a.v).slice(0, 10)

function ProductsTable({ T, showFlag = true }) {
  const rows = T.products.slice(0, 15)
  if (!rows.length) return <div className="text-sm text-ink/50 py-3">No returns in these dates.</div>
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm border-collapse" data-returns-products>
        <thead><tr className="text-[10px] uppercase tracking-[0.08em] text-ink/50">
          <th className="text-left font-semibold pb-1.5">Product</th><th className="text-right font-semibold pb-1.5 pl-3">Returned</th><th className="text-right font-semibold pb-1.5 pl-3">Sold</th>
          <th className="text-right font-semibold pb-1.5 pl-3">Rate</th><th className="text-left font-semibold pb-1.5 pl-3">Top reason</th></tr></thead>
        <tbody>{rows.map(p => (
          <tr key={p.key} className="border-t border-rule">
            <td className="py-1.5 pr-2"><NameLink kind="product" id={null} name={p.name} />{showFlag && p.rate != null && p.sold >= 20 && p.rate >= RATE_ALERT && <span className="ml-1"><Flag tone="red">High</Flag></span>}</td>
            <td className="py-1.5 pl-3 text-right tabular-nums">{int(p.units)}</td>
            <td className="py-1.5 pl-3 text-right tabular-nums text-ink/60">{p.sold ? int(p.sold) : '—'}</td>
            <td className={`py-1.5 pl-3 text-right tabular-nums font-semibold ${p.rate >= RATE_ALERT ? 'text-loss' : ''}`}>{p.rate != null ? pct1(p.rate) : '—'}</td>
            <td className="py-1.5 pl-3 text-ink/70">{REASONS[p.topReason] || p.topReason || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function Trend({ series, range }) {
  return (
    <Tile label="Returns requested by day" right="Amazon requests">
      <Bars rows={series} k="v" from={range.from} caption={(r) => `${int(r.requests)} requested · ${int(r.arrived)} arrived`} height={150} />
    </Tile>
  )
}

function AdminView({ T, P, M, PM, range, periodName, todo, series, onTab }) {
  const dates = { name: periodName, text: spanText(range.from, range.to) }
  const prevName = range.prev?.name || 'The period before'
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
        <Hero label="What returns cost the P&L" dates={dates} value={M ? money0(M.net) : '—'}
          sub={M ? <>refunds {money0(M.refunds)} − fees back {money0(M.feesBack)} + return postage {money0(M.postage)} − SAFE-T {money0(M.safet)} − back in stock {money0(M.credit)}{M.claims ? ` − claims ${money0(M.claims)}` : ''}</> : null}>
          {M && PM && <div className="mt-auto pt-4 text-sm"><div className="flex items-baseline justify-between gap-3 py-2.5 border-t border-white/20"><span className="text-sky">{prevName}</span><span className="whitespace-nowrap"><b className="tabular-nums">{money0(PM.net)}</b> <span className="ml-2"><Delta now={M.net} was={PM.net} goodUp={false} light /></span></span></div></div>}
          {M && <div className="text-xs text-sky/90 pt-3 leading-relaxed">Refunds, fees and postage are from the channels’ reports, on the day they were charged. The original postage and packaging stay with the order in the P&L.</div>}
        </Hero>
        <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Tile label="Return rate" right={P ? <ChangeChip now={T.rate} was={P.rate} goodUp={false} /> : null}>
            <div className="text-[28px] leading-tight font-bold tabular-nums">{pct1(T.rate)}</div>
            <div className="text-[13px] text-ink mt-1">{int(T.requestUnits)} units asked back of {int(T.unitsSold)} sold</div>
            {P && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {pct1(P.rate)}</div>}
          </Tile>
          <Tile label="Returns" right={P ? <ChangeChip now={T.requests} was={P.requests} goodUp={false} /> : null}>
            <div className="grid grid-cols-2 gap-3"><div><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.requests)}</div><div className="text-[13px]">requested</div></div>
              <div className="border-l border-rule pl-3"><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.arrived)}</div><div className="text-[13px]">arrived</div></div></div>
            <div className="text-xs text-ink/60 mt-1.5">{int(T.stillExpected)} still to come · {int(T.notComing)} not coming back · {int(T.selfPost)} self-post</div>
            {P && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {int(P.requests)} requested · {int(P.arrived)} arrived</div>}
          </Tile>
          <Tile label="What came back">
            <div className="grid grid-cols-2 gap-3"><div><div className="text-[28px] leading-tight font-bold tabular-nums text-gain">{int(T.outcomes.back_in_stock || 0)}</div><div className="text-[13px]">back in stock</div></div>
              <div className="border-l border-rule pl-3"><div className="text-[28px] leading-tight font-bold tabular-nums text-loss">{int(Object.entries(T.outcomes).filter(([k]) => k !== 'back_in_stock').reduce((s, [, v]) => s + v, 0))}</div><div className="text-[13px]">not resaleable</div></div></div>
            {M && <div className="text-xs text-ink/60 mt-1.5">{money0(M.credit)} cost taken back off · {money0(M.writtenOff)} of stock lost (already in cost of goods sold)</div>}
          </Tile>
          <Tile label="Money recovered" right="SAFE-T and claims">
            <div className="text-[28px] leading-tight font-bold tabular-nums text-gain">{M ? money0(M.safet + M.claims) : '—'}</div>
            <div className="text-[13px] mt-1">{T.safetCount.granted} SAFE-T granted · {T.safetCount.refused} refused · {T.safetCount.pending} waiting</div>
            {todo.filter(t => t.kind === 'safet').length > 0 && <button className="text-xs text-loss font-semibold mt-1.5 text-left" onClick={() => onTab('todo')}>{todo.filter(t => t.kind === 'safet').length} SAFE-T claims not filed yet →</button>}
          </Tile>
          <Tile label="Refunds" right={M && PM ? <ChangeChip now={M.refunds} was={PM.refunds} goodUp={false} /> : null}>
            <div className="text-[28px] leading-tight font-bold tabular-nums">{M ? money0(M.refunds) : '—'}</div>
            <div className="text-[13px] mt-1">{M ? `${int(M.refundOrders)} orders · ${money0(M.feesBack)} of fees given back` : ''}</div>
            {M && <div className="text-xs text-ink/60 mt-1.5">Return postage {money0(M.postage)} · labels on Amazon’s report {money0(T.labels)}</div>}
          </Tile>
          <Tile label="Open actions" right={<button className="text-royal-600" onClick={() => onTab('todo')}>Open →</button>}>
            <div className="text-[28px] leading-tight font-bold tabular-nums">{int(todo.length)}</div>
            <div className="text-xs text-ink/60 mt-1">{['safet', 'not_logged', 'overdue', 'match', 'carrier_claim'].map(k => [k, todo.filter(t => t.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${({ safet: 'SAFE-T to file', not_logged: 'delivered, not logged', overdue: 'overdue', match: 'to match', carrier_claim: 'carrier claims' })[k]}`).join(' · ') || 'Nothing waiting'}</div>
          </Tile>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <Tile label="Why they came back" right="By cause"><Breakdown rows={causeRows(T)} total={Object.values(T.causes).reduce((a, b) => a + b, 0)} /></Tile>
        <Tile label="Reasons given"><Breakdown rows={reasonRows(T)} total={Object.values(T.reasons).reduce((a, b) => a + b, 0)} /></Tile>
        <div className="grid gap-3">
          <Tile label="Packing errors" right="Packing-cause returns by packer">{Object.keys(T.packers).length ? <Breakdown rows={Object.entries(T.packers).map(([k, v]) => ({ k, v, label: k, bar: 'bg-loss' }))} /> : <div className="text-sm text-ink/50">None put down to a packer in these dates.</div>}</Tile>
          <Tile label="Brought back by">{Object.keys(T.carriers).length ? <Breakdown rows={Object.entries(T.carriers).map(([k, v]) => ({ k, v, label: k })).sort((a, b) => b.v - a.v)} /> : <div className="text-sm text-ink/50">No boxes logged in these dates.</div>}</Tile>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7"><Tile label="Products" right={`Flagged at ${RATE_ALERT}% of units sold`}>{T.flagged.length > 0 && <div className="mb-2"><Flag tone="red" icon="alert">{T.flagged.length} product{T.flagged.length === 1 ? '' : 's'} over {RATE_ALERT}%: {T.flagged.slice(0, 3).map(p => p.name).join(', ')}</Flag></div>}<ProductsTable T={T} /></Tile></div>
        <div className="lg:col-span-5 grid gap-3"><Trend series={series} range={range} />
          <Tile label="Channels"><Breakdown rows={Object.entries(T.channels).map(([k, v]) => ({ k, v, label: k })).sort((a, b) => b.v - a.v)} /></Tile></div>
      </div>
    </>
  )
}

function OfficeView({ T, P, range, periodName, todo, data, today, series, onTab, onOpen, onOpenRma }) {
  const arrivedToday = data.returns.filter(r => r.status !== 'expected' && String(r.received_at || '').slice(0, 10) === today).length
  const n = (k) => todo.filter(t => t.kind === k).length
  const nextSafet = todo.filter(t => t.kind === 'safet').sort((a, b) => a.due - b.due)[0]
  const matchPct = T.arrived ? (T.matchedAuto / T.arrived) * 100 : null
  const dates = { name: periodName, text: spanText(range.from, range.to) }
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
        <Hero label="Your returns to-do" dates={{ name: 'Today', text: fmtDate(today) }} value={int(todo.length)} tone="bg-ink"
          sub={todo.length ? 'things to act on — most urgent first' : 'Nothing waiting. Nice.'}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-4">
            {[['Arrived today', arrivedToday], ['SAFE-T to file', n('safet')], ['To match', n('match')], ['Delivered, not logged', n('not_logged')], ['Overdue', n('overdue')], ['SAFE-T replies', n('safet_action')]].map(([l, v]) => (
              <div key={l}><div className="text-lg font-bold tabular-nums leading-tight">{int(v)}</div><div className="text-xs text-sky">{l}</div></div>
            ))}
          </div>
          {nextSafet && <div className="mt-4 text-sm text-sky">Next SAFE-T deadline: <b className="text-white">{nextSafet.due} day{nextSafet.due === 1 ? '' : 's'}</b> · {nextSafet.title.replace('File SAFE-T for ', '')}</div>}
          <button className="btn btn-secondary btn-sm mt-4 self-start" onClick={() => onTab('todo')}>Open the to-do list</button>
        </Hero>
        <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Tile label="Returns" right={P ? <ChangeChip now={T.requests} was={P.requests} goodUp={false} /> : null}>
            <div className="text-xs text-ink/50 -mt-1 mb-1">{dates.name} · {dates.text}</div>
            <div className="grid grid-cols-2 gap-3"><div><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.requests)}</div><div className="text-[13px]">requested</div></div>
              <div className="border-l border-rule pl-3"><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.arrived)}</div><div className="text-[13px]">arrived</div></div></div>
            <div className="text-xs text-ink/60 mt-1.5">{int(T.stillExpected)} still to come · {int(T.notComing)} not coming back</div>
          </Tile>
          <Tile label="Return rate" right={P ? <ChangeChip now={T.rate} was={P.rate} goodUp={false} /> : null}>
            <div className="text-[28px] leading-tight font-bold tabular-nums">{pct1(T.rate)}</div>
            <div className="text-[13px] mt-1">{int(T.requestUnits)} units asked back of {int(T.unitsSold)} sold</div>
          </Tile>
          <Tile label="Matched automatically">
            <div className="text-[28px] leading-tight font-bold tabular-nums">{pct1(matchPct)}</div>
            <div className="text-[13px] mt-1">{int(T.matchedAuto)} of {int(T.arrived)} boxes · {int(T.unmatched)} still to match</div>
          </Tile>
          <Tile label="SAFE-T claims">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Granted', T.safetCount.granted, 'text-gain'], ['Refused', T.safetCount.refused, 'text-loss'], ['Waiting', T.safetCount.pending, '']].map(([l, v, c]) => <div key={l}><div className={`text-2xl font-bold tabular-nums ${c}`}>{int(v)}</div><div className="text-xs text-ink/60">{l}</div></div>)}
            </div>
            {n('safet') > 0 && <div className="text-xs text-loss font-semibold mt-2">{n('safet')} still to file</div>}
          </Tile>
          <Tile label="What came back">
            <Breakdown rows={Object.entries(T.outcomes).map(([k, v]) => ({ k, v, label: OUTCOMES[k]?.short || k, bar: k === 'back_in_stock' ? 'bg-gain' : 'bg-loss' }))} />
          </Tile>
          <Tile label="Why they came back"><Breakdown rows={causeRows(T)} total={Object.values(T.causes).reduce((a, b) => a + b, 0)} /></Tile>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7"><Tile label="Products" right="Returned against sold — no money shown"><ProductsTable T={T} /></Tile></div>
        <div className="lg:col-span-5 grid gap-3"><Trend series={series} range={range} /><Tile label="Reasons given"><Breakdown rows={reasonRows(T)} /></Tile></div>
      </div>
    </>
  )
}
