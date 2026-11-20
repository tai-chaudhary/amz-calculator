import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Drawer, EmptyState, Flag, Icon, Modal, PageHeader, SearchInput, SegmentedControl, Spinner } from './UI'
import { loadOverheadsList, saveOverhead, setOverheadAmount, removeOverheadAmount, endOverhead, removeOverhead, setOverheadFulfilment, removeOverheadFulfilment } from '../lib/db'
import { OVERHEAD_CATEGORIES, FREQUENCIES, categoryLabel, everyWord, amountOn, costBetween, daysInMonth, monthStart, monthEnd, addMonths, monthLabel, partMonthNote, fulfilmentShare, fulfilmentWord, shareOn } from '../lib/overheads'
import { fmtDate, londonToday } from '../lib/dates'
import { smartFilter, hay } from '../lib/match'

/**
 * Overheads (v2.82.0; frequency in v2.82.1) — fixed costs with the date each one starts from.
 *
 * The owner's rules: fixed costs only; each is paid weekly, monthly, quarterly or yearly and is counted by days
 * whatever the frequency; a change of amount is added with the date it applies from, so earlier months keep what
 * they were; amounts are ex VAT. The list started empty on purpose (the
 * nine undated items of the old page were not carried over) so every start date is entered properly.
 *
 * Every figure on the page comes from the database (migration 104), which is also what Finance → Profit & Loss uses.
 * The forms work the same sum in the browser only to show what a date or an amount will do before it is saved.
 * Each action saves on its own, and every change is kept in the overhead's history with who made it.
 */
const money = (v) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v) || 0)
const per = (amount, every) => `${money(amount)} ${everyWord(every)}`
const addDay = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const errText = (e) => (e?.message || 'Something went wrong').replace(/^.*?RESULT\s*/, '')

export default function OverheadsPage({ showToast, onChanged }) {
  const today = useMemo(londonToday, [])
  const [month, setMonth] = useState(monthStart(today))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try { setData(await loadOverheadsList(month, monthEnd(month))); setError(null) }
    catch (e) { setError(errText(e)) }
  }, [month])
  useEffect(() => { load() }, [load])
  // After any change: reload this page (onChanged was for Build a Month, which came off the menu in v2.84.0)
  const changed = useCallback(async (msg) => { await load(); onChanged?.(); if (msg) showToast?.(msg) }, [load, onChanged, showToast])

  const items = data?.items || []
  const counts = useMemo(() => ({
    all: items.length,
    running: items.filter(i => i.status === 'running').length,
    upcoming: items.filter(i => i.status === 'upcoming').length,
    ended: items.filter(i => i.status === 'ended').length,
  }), [items])
  const list = useMemo(() => {
    const byStatus = show === 'all' ? items : items.filter(i => i.status === show)
    return q.trim() ? smartFilter(byStatus, q, i => hay(i.name, categoryLabel(i.category), i.note, FREQ_LABEL[i.every_now]), { closest: false, fillTo: 0 }) : byStatus
  }, [items, show, q])
  const total = Number(data?.total) || 0
  const shownTotal = list.reduce((s, i) => s + (Number(i.period_cost) || 0), 0)
  const biggest = Math.max(0, ...list.map(i => Number(i.period_cost) || 0))
  const groups = useMemo(() => OVERHEAD_CATEGORIES.map(c => {
    const rows = list.filter(i => i.category === c.id)
    return { ...c, rows, total: rows.reduce((s, i) => s + (Number(i.period_cost) || 0), 0) }
  }).filter(g => g.rows.length), [list])
  const open = items.find(i => i.id === openId) || null
  const name = monthLabel(month)
  const counted = items.filter(i => Number(i.period_days) > 0).length
  const isThisMonth = month === monthStart(today)

  // The months around the one shown (three before, two after), worked out from the same amounts and dates.
  // The month shown uses the database's own figure.
  const trend = useMemo(() => [-3, -2, -1, 0, 1, 2].map(n => {
    const m = addMonths(month, n)
    return { m, cost: n === 0 ? total : items.reduce((s, i) => s + costBetween(i, m, monthEnd(m)).cost, 0) }
  }), [items, month, total])
  const trendMax = Math.max(1, ...trend.map(t => t.cost))
  const prev = trend[2].cost
  const delta = prev > 0 ? ((total - prev) / prev) * 100 : null

  // Where the month's overheads go, by category (largest first)
  const split = useMemo(() => OVERHEAD_CATEGORIES.map((c, n) => ({ ...c, tone: SPLIT_TONES[n], cost: items.filter(i => i.category === c.id).reduce((s, i) => s + (Number(i.period_cost) || 0), 0) }))
    .filter(c => c.cost > 0).sort((a, b) => b.cost - a.cost), [items])
  // How the overheads active today are paid
  const paid = useMemo(() => FREQUENCIES.map(f => {
    const rows = items.filter(i => i.status === 'running' && i.every_now === f.id)
    return { ...f, n: rows.length, sum: rows.reduce((s, i) => s + (Number(i.amount_now) || 0), 0) }
  }).filter(f => f.n), [items])
  // Dated changes still to come: starts, last days and new amounts
  const ahead = useMemo(() => items.flatMap(i => [
    ...(i.start_date > today ? [{ d: i.start_date, text: `${i.name} starts` }] : []),
    ...(i.end_date && i.end_date >= today ? [{ d: i.end_date, text: `${i.name} ends` }] : []),
    ...(i.amounts || []).filter(a => a.from_date > today && a.from_date > i.start_date).map(a => ({ d: a.from_date, text: `${i.name} → ${per(a.amount, a.every)}` })),
  ]).sort((a, b) => a.d.localeCompare(b.d)), [items, today])

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Finance / fixed costs"
        title="Overheads"
        description="Fixed costs — wages, rent, software — paid weekly, monthly, quarterly or yearly. Each one counts from the date it starts, by days, and comes off gross profit on Profit & Loss. Amounts are ex VAT."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add overhead</button>}
      />

      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && !data && <div className="surface flex justify-center py-10"><Spinner /></div>}

      {data && items.length === 0 && (
        <div className="surface">
          <EmptyState icon="briefcase" title="No overheads yet"
            sub="Add each fixed cost with how often it is paid and the date it starts from. Everything is counted by days, and the P&L picks up whatever was active on each day."
            action={<button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add the first overhead</button>} />
        </div>
      )}

      {data && items.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
            {/* The month's figure, with the months either side */}
            <div className="lg:col-span-5 bg-royal-500 text-white rounded-card px-6 pt-5 pb-4 flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky">{name} overheads</div>
                {delta != null && Math.abs(delta) >= 0.05 && (
                  <span className="text-[11px] font-semibold rounded-[4px] bg-white/15 px-2 py-0.5 tabular-nums" title={`${monthLabel(trend[2].m)}: ${money(prev)}`}>
                    {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% on {monthLabel(trend[2].m).split(' ')[0]}
                  </span>
                )}
              </div>
              <div className="text-[44px] leading-none font-bold tabular-nums mt-3" style={{ letterSpacing: '-0.03em' }}>{money(total)}</div>
              <div className="w-24 h-1 bg-lime rounded-sm mt-3" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-sky mt-3">
                <span><b className="text-white font-semibold tabular-nums">{money(total / daysInMonth(month))}</b> a day</span>
                <span><b className="text-white font-semibold">{counted}</b> of {items.length} counted</span>
              </div>
              <div className="flex items-end gap-2 h-16 mt-5" role="group" aria-label="Overheads by month">
                {trend.map(t => (
                  <button key={t.m} type="button" onClick={() => setMonth(t.m)} title={`${monthLabel(t.m)}: ${money(t.cost)}`} aria-label={`${monthLabel(t.m)}: ${money(t.cost)}`}
                    className="flex-1 h-full flex items-end rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-lime">
                    <span className={`block w-full rounded-[3px] transition-all ${t.m === month ? 'bg-lime' : 'bg-white/25 hover:bg-white/40'}`} style={{ height: `${Math.max(4, (t.cost / trendMax) * 100)}%` }} />
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-1.5 text-[11px] text-sky/90">
                {trend.map(t => <span key={t.m} className={`flex-1 text-center ${t.m === month ? 'text-white font-semibold' : ''}`}>{monthLabel(t.m).slice(0, 3)}</span>)}
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Tile label="Where it goes" right={`${split.length} categor${split.length === 1 ? 'y' : 'ies'}`}>
                <div className="flex h-2 rounded-sm overflow-hidden bg-ink/5 mt-1" aria-hidden="true">
                  {split.map(c => <span key={c.id} className={c.tone} style={{ width: `${total ? (c.cost / total) * 100 : 0}%` }} />)}
                </div>
                <div className="mt-2 space-y-1">
                  {split.slice(0, 3).map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2 text-ink/70 min-w-0"><span className={`w-2 h-2 rounded-[2px] flex-shrink-0 ${c.tone}`} /><span className="truncate">{c.label}</span></span>
                      <span className="tabular-nums text-ink flex-shrink-0"><b className="font-semibold">{money(c.cost)}</b> <span className="text-ink/45">{total ? Math.round((c.cost / total) * 100) : 0}%</span></span>
                    </div>
                  ))}
                  {split.length > 3 && <div className="text-xs text-ink/45">+ {split.length - 3} more below</div>}
                  {!split.length && <div className="text-xs text-ink/45">Nothing counted in {name}.</div>}
                </div>
              </Tile>
              <Tile label="Active now" right={`${counts.running} active`}>
                <div className="text-[28px] leading-tight font-bold text-ink tabular-nums">{money(data.running_monthly)}</div>
                <div className="text-xs text-ink/50">an average month, at today’s amounts</div>
                <div className="text-xs text-ink/70 mt-auto pt-2 tabular-nums"><b className="font-semibold text-ink">{money((Number(data.running_monthly) || 0) * 12)}</b> a year</div>
                <div className="text-xs text-ink/70 pt-1 tabular-nums" data-fulfil-monthly title="The part of the active overheads marked as a cost of fulfilment. Open an overhead to change its share."><b className="font-semibold text-ink">{money(data.fulfilment_monthly)}</b> of it is fulfilment</div>
              </Tile>
              <Tile label="How it is paid">
                <div className="space-y-1.5 mt-0.5">
                  {paid.map(f => (
                    <div key={f.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2"><FreqTag every={f.id} /><span className="text-ink/45">{f.n}</span></span>
                      <span className="tabular-nums text-ink"><b className="font-semibold">{money(f.sum)}</b> <span className="text-ink/45">{f.word}</span></span>
                    </div>
                  ))}
                  {!paid.length && <div className="text-xs text-ink/45">Nothing active today.</div>}
                </div>
              </Tile>
              <Tile label="Coming up" right={ahead.length ? `${ahead.length} dated` : null}>
                <div className="space-y-1.5 mt-0.5">
                  {ahead.slice(0, 3).map((a, n) => (
                    <div key={n} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-ink/75 truncate">{a.text}</span>
                      <span className="tabular-nums text-ink/50 flex-shrink-0">{fmtDate(a.d)}</span>
                    </div>
                  ))}
                  {!ahead.length && <div className="text-xs text-ink/45 leading-relaxed">No starts, last days or new amounts entered ahead of today.</div>}
                </div>
              </Tile>
            </div>
          </div>

          <div className="filter-bar mb-3 flex-wrap gap-3">
            <div className="inline-flex items-center gap-0.5 rounded-[6px] border border-rule bg-paper/60 p-0.5">
              <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(m => addMonths(m, -1))}><Icon name="chevronLeft" size={16} /></button>
              <div className="text-sm font-semibold text-ink min-w-[128px] text-center" aria-live="polite">{name}</div>
              <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(m => addMonths(m, 1))}><Icon name="chevronRight" size={16} /></button>
            </div>
            {!isThisMonth && <button className="btn btn-secondary btn-xs" onClick={() => setMonth(monthStart(today))}>This month</button>}
            <SegmentedControl label="Show" className="max-w-full overflow-x-auto" value={show} onChange={setShow} items={[
              { id: 'all', label: 'All', count: counts.all }, { id: 'running', label: 'Active', count: counts.running },
              ...(counts.upcoming ? [{ id: 'upcoming', label: 'Not started', count: counts.upcoming }] : []),
              ...(counts.ended ? [{ id: 'ended', label: 'Ended', count: counts.ended }] : []),
            ]} />
            <SearchInput className="w-full sm:w-64 sm:ml-auto" value={q} onChange={e => setQ(e.target.value)} placeholder="Search overheads…" aria-label="Search overheads" />
          </div>

          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse table-fixed">
              <colgroup>
                <col /><col style={{ width: 200 }} /><col style={{ width: 132 }} /><col style={{ width: 150 }} /><col style={{ width: 180 }} /><col style={{ width: 176 }} /><col style={{ width: 40 }} />
              </colgroup>
              <thead className="table-head">
                <tr>
                  <th className="th text-left pl-5">Overhead</th>
                  <th className="th text-right">Amount</th>
                  <th className="th text-right">Average month</th>
                  <th className="th text-left pl-6">Since</th>
                  <th className="th text-right">{name}</th>
                  <th className="th text-left pl-6">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <React.Fragment key={g.id}>
                    <tr className="bg-paper/70 border-b border-rule/70">
                      <td className="pl-5 pr-3 py-2" colSpan={4}>
                        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/60">
                          <Icon name={g.icon} size={13} className="text-royal-500" />{g.label}<span className="font-medium text-ink/35 normal-case tracking-normal">{g.rows.length}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold text-ink/70 tabular-nums">{money(g.total)}</td>
                      <td className="pl-6 pr-3 py-2 text-xs text-ink/45 tabular-nums" colSpan={2}>{shownTotal ? `${Math.round((g.total / shownTotal) * 100)}% of the month` : ''}</td>
                    </tr>
                    {g.rows.map(i => <Row key={i.id} i={i} month={month} today={today} biggest={biggest} onOpen={() => setOpenId(i.id)} />)}
                  </React.Fragment>
                ))}
              </tbody>
              {list.length > 0 && (
                <tfoot>
                  <tr className="bg-white">
                    <td className="pl-5 pr-3 py-3 text-sm font-semibold text-ink" colSpan={4}>Total for {name}{list.length !== items.length ? ' (shown)' : ''}</td>
                    <td className="px-3 py-3 text-right text-sm font-bold text-ink tabular-nums">{money(shownTotal)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
            {!list.length && <EmptyState icon="search" title="Nothing matches" sub="Try a different search, or show all." />}
          </div>
          <div className="text-xs text-ink/45 mt-3">
            A month only counts the days an overhead was active in it. Select an overhead to change its amount from a date, end it, or see its history.
          </div>
        </>
      )}

      {adding && <AddOverhead today={today} onClose={() => setAdding(false)} onSaved={changed} />}
      {open && <OverheadDrawer key={open.id} i={open} month={month} today={today} onClose={() => setOpenId(null)} onChanged={changed} showToast={showToast} />}
    </div>
  )
}

// Category colours in the "Where it goes" bar, in category order — brand blue first, quieter after
const SPLIT_TONES = ['bg-royal-500', 'bg-royal-300', 'bg-ink', 'bg-lime', 'bg-muted', 'bg-rule']
const FREQ_LABEL = Object.fromEntries(FREQUENCIES.map(f => [f.id, f.label]))

function Tile({ label, right, children }) {
  return (
    <div className="bg-white border border-rule rounded-card px-5 py-4 flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">{label}</span>
        {right && <span className="text-[11px] text-ink/45">{right}</span>}
      </div>
      {children}
    </div>
  )
}

/** How often it is paid, as a small label: Weekly, Monthly, Quarterly, Yearly. */
function FreqTag({ every }) {
  return <span className="inline-flex items-center rounded-[3px] border border-royal-200 bg-royal-50 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em] text-royal-600 whitespace-nowrap">{FREQ_LABEL[every] || 'Monthly'}</span>
}

// "Active" is the word for an overhead being charged today (the database calls it running)
function StatusFlag({ i, today }) {
  if (i.status === 'upcoming') return <Flag tone="blue" icon="clock">Starts {fmtDate(i.start_date)}</Flag>
  if (i.status === 'ended') return <Flag tone="grey">Ended</Flag>
  if (i.end_date && i.end_date >= today) return <Flag tone="amber" icon="clock">Ends {fmtDate(i.end_date)}</Flag>
  return <span className="pill pill-live whitespace-nowrap"><span className="status-dot bg-gain" />Active</span>
}

// The next change of amount still to come, if one has been entered
const nextChange = (i, today) => [...(i.amounts || [])].filter(a => a.from_date > today && a.from_date > i.start_date).sort((a, b) => a.from_date.localeCompare(b.from_date))[0]

function Row({ i, month, today, biggest, onOpen }) {
  const part = partMonthNote(Number(i.period_days) || 0, month)
  const next = nextChange(i, today)
  const cost = Number(i.period_cost) || 0
  return (
    <tr className="table-row cursor-pointer group" onClick={onOpen}>
      <td className="td pl-5">
        <button type="button" className="text-left max-w-full" onClick={e => { e.stopPropagation(); onOpen() }}>
          <span className="block text-sm font-semibold text-ink truncate">{i.name}</span>
          {fulfilmentShare(i) > 0 && <span className="inline-block mt-1 text-[10px] uppercase tracking-[0.06em] font-bold text-royal-500 bg-royal-50 border border-royal-200 rounded-[3px] px-1.5 py-px" data-fulfil-tag
            title="Counts towards the fulfilment cost in Profit & Loss">Fulfilment{fulfilmentShare(i) < 100 ? ` ${+fulfilmentShare(i).toFixed(2)}%` : ''}</span>}
          {i.note && <span className="block text-xs text-ink/45 mt-0.5 truncate">{i.note}</span>}
        </button>
      </td>
      <td className="td text-right">
        <div className="flex items-center justify-end gap-2">
          <FreqTag every={i.every_now} />
          <span className="text-sm font-semibold text-ink tabular-nums">{money(i.amount_now)}</span>
        </div>
        {next && <div className="text-[11px] text-ink/45 mt-1 tabular-nums">{money(next.amount)}{next.every !== i.every_now ? ` ${everyWord(next.every)}` : ''} from {fmtDate(next.from_date)}</div>}
      </td>
      <td className={`td text-right text-sm tabular-nums ${i.every_now === 'month' ? 'text-ink/35' : 'text-ink/70'}`}>{money(i.monthly_now)}</td>
      <td className="td pl-6">
        <div className="text-sm text-ink/75 tabular-nums whitespace-nowrap">{fmtDate(i.start_date)}</div>
        {i.end_date && <div className={`text-[11px] mt-0.5 tabular-nums whitespace-nowrap ${i.status === 'ended' ? 'text-ink/45' : 'text-warn'}`}>{i.status === 'ended' ? 'ended' : 'to'} {fmtDate(i.end_date)}</div>}
      </td>
      <td className="td text-right">
        <div className={`text-sm font-semibold tabular-nums ${cost ? 'text-ink' : 'text-ink/30'}`}>{money(cost)}</div>
        <div className="flex items-center justify-end gap-2 mt-1.5">
          {part && <span className="text-[11px] text-ink/45 whitespace-nowrap">{part}</span>}
          <span className="block h-1 w-20 rounded-sm bg-ink/5 overflow-hidden" aria-hidden="true"><span className="block h-full bg-royal-500/70 rounded-sm" style={{ width: `${biggest ? (cost / biggest) * 100 : 0}%` }} /></span>
        </div>
      </td>
      <td className="td pl-6"><StatusFlag i={i} today={today} /></td>
      <td className="td pr-3 text-ink/25 group-hover:text-royal-500"><Icon name="chevronRight" size={15} /></td>
    </tr>
  )
}

function CategoryChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
      {OVERHEAD_CATEGORIES.map(c => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} onClick={() => onChange(c.id)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] border text-xs font-medium transition-colors ${value === c.id ? 'bg-sky/55 border-royal-200 text-royal-700' : 'bg-white border-rule text-ink/65 hover:border-royal-200'}`}>
          <Icon name={c.icon} size={13} />{c.label}
        </button>
      ))}
    </div>
  )
}

function MoneyInput({ value, onChange, id, autoFocus, onEnter }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40 text-sm pointer-events-none">£</span>
      <input id={id} className="input pl-7 tabular-nums" inputMode="decimal" autoFocus={autoFocus} placeholder="0.00"
        value={value} onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={e => e.key === 'Enter' && onEnter?.()} />
    </div>
  )
}

// "August 2026 will come to £1,700.00 (17 of 31 days)" — what a start date and amount mean for that month
function Preview({ children }) {
  return <div className="surface-sky px-3 py-2.5 text-xs text-royal-800 leading-relaxed flex items-start gap-2"><Icon name="info" size={14} className="text-royal-600 mt-0.5 flex-shrink-0" /><div>{children}</div></div>
}

function AddOverhead({ today, onClose, onSaved }) {
  const blank = { name: '', category: 'staff', amount: '', every: 'month', start_date: '', note: '', ends: false, end_date: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [added, setAdded] = useState([])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const amount = parseFloat(f.amount)
  const ready = f.name.trim() && amount > 0 && f.start_date && (!f.ends || (f.end_date && f.end_date >= f.start_date))
  const first = ready ? costBetween({ start_date: f.start_date, end_date: f.ends ? f.end_date : null, amounts: [{ from_date: f.start_date, amount, every: f.every }] }, monthStart(f.start_date), monthEnd(f.start_date)) : null

  const save = async (another) => {
    if (!ready || busy) return
    setBusy(true); setErr(null)
    try {
      await saveOverhead({ name: f.name.trim(), category: f.category, amount, every: f.every, start_date: f.start_date, note: f.note, end_date: f.ends ? f.end_date : '' })
      await onSaved(another ? null : `${f.name.trim()} added`)
      if (another) { setAdded(a => [...a, f.name.trim()]); setF({ ...blank, category: f.category, every: f.every, start_date: f.start_date }) }
      else onClose()
    } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }

  return (
    <Modal title="Add overhead" description="A fixed cost paid every week, month, quarter or year. It counts from its start date, by days." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {added.length > 0 && <div className="text-xs text-gain flex items-center gap-1.5"><Icon name="check" size={13} /> Added: {added.join(', ')}</div>}
        <div>
          <label className="label" htmlFor="oh-name">Name</label>
          <input id="oh-name" className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Warehouse rent, HELM, a person’s wages" />
        </div>
        <div>
          <div className="label">Category</div>
          <CategoryChips value={f.category} onChange={v => set('category', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="oh-amount">Amount, ex VAT</label>
            <MoneyInput id="oh-amount" value={f.amount} onChange={v => set('amount', v)} onEnter={() => save(false)} />
          </div>
          <div>
            <label className="label" htmlFor="oh-start">Starts from</label>
            <input id="oh-start" type="date" className="input" value={f.start_date} onChange={e => set('start_date', e.target.value)} />
          </div>
        </div>
        <div>
          <div className="label">How often it is paid</div>
          <SegmentedControl label="How often it is paid" value={f.every} onChange={v => set('every', v)} items={FREQUENCIES.map(x => ({ id: x.id, label: x.label }))} />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer">
            <input type="checkbox" checked={f.ends} onChange={e => set('ends', e.target.checked)} /> It has already ended, or has a known last day
          </label>
          {f.ends && (
            <div className="mt-2 max-w-[220px]">
              <label className="label" htmlFor="oh-end">Last day charged</label>
              <input id="oh-end" type="date" className="input" value={f.end_date} min={f.start_date || undefined} onChange={e => set('end_date', e.target.value)} />
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="oh-note">Note <span className="font-normal text-ink/40">(optional)</span></label>
          <input id="oh-note" className="input" value={f.note} onChange={e => set('note', e.target.value)} placeholder="Anything worth remembering about it" />
        </div>
        {first && (
          <Preview>
            <b>{monthLabel(f.start_date)}</b> will come to <b>{money(first.cost)}</b>{partMonthNote(first.days, f.start_date) ? ` (${partMonthNote(first.days, f.start_date)})` : ''}
            {!f.ends && (f.every === 'month' ? <>, then {money(amount)} for every full month after it</> : <>. After that it is {per(amount, f.every)}, counted by days</>)}.
            {f.start_date > today && ' It starts in the future, so nothing is charged until then.'}
          </Preview>
        )}
        {f.ends && f.end_date && f.start_date && f.end_date < f.start_date && <div className="text-xs text-loss">The last day is before the start date.</div>}
        {err && <div className="text-xs text-loss">{err}</div>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>{added.length ? 'Done' : 'Cancel'}</button>
          <button className="btn btn-secondary btn-sm" disabled={!ready || busy} onClick={() => save(true)}>Add and start another</button>
          <button className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Add overhead'}</button>
        </div>
      </div>
    </Modal>
  )
}

function OverheadDrawer({ i, month, today, onClose, onChanged, showToast }) {
  const [mode, setMode] = useState(null)   // null | 'amount' | 'end' | 'edit' | 'remove'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const amounts = i.amounts || []
  const firstAmountId = [...amounts].sort((a, b) => a.from_date.localeCompare(b.from_date))[0]?.id
  const part = partMonthNote(Number(i.period_days) || 0, month)
  // The amount in force today: the latest one on or before today (before it starts, the starting amount)
  const ref = today >= i.start_date ? today : i.start_date
  const equiv = i.every_now !== 'month' ? `${money(i.monthly_now)} an average month` : null
  const currentId = [...amounts].sort((a, b) => b.from_date.localeCompare(a.from_date)).find(a => a.from_date <= ref)?.id || firstAmountId

  // One place for every save: stays open on a failure with the reason, closes the form on success
  const run = async (fn, msg, closeDrawer = false) => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fn()
      if (res?.unchanged) showToast?.('Nothing changed')
      else await onChanged(msg)
      setMode(null)
      if (closeDrawer) onClose()
    } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  const pick = (m) => { setErr(null); setMode(x => (x === m ? null : m)) }

  return (
    <Drawer title={i.name} description={`${categoryLabel(i.category)} · fixed cost, ex VAT`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusFlag i={i} today={today} />
          {i.note && <span className="text-xs text-ink/55">{i.note}</span>}
        </div>

        <div className="surface divide-y divide-rule/70">
          <Line label="Amount" value={<span className="inline-flex items-center gap-2"><FreqTag every={i.every_now} />{money(i.amount_now)}</span>} hint={equiv} strong />
          <Line label="Starts from" value={fmtDate(i.start_date)} />
          <Line label="Last day charged" value={i.end_date ? fmtDate(i.end_date) : 'No end date'} />
          <Line label={`${monthLabel(month)}`} value={money(i.period_cost)} hint={part || (Number(i.period_days) ? 'Whole month' : 'Not active in this month')} />
          <Line label="Fulfilment cost" value={fulfilmentWord(i.fulfilment_share)} hint={Number(i.period_fulfilment) > 0 ? `${money(i.period_fulfilment)} of ${monthLabel(month)}` : fulfilmentShare(i) > 0 ? `Nothing in ${monthLabel(month)}` : 'Not part of the cost of sending orders'} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={`btn btn-sm ${mode === 'amount' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('amount')}><Icon name="pound" size={14} /> Change amount</button>
          {i.end_date
            ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => endOverhead(i.id, null), `${i.name} has no end date now`)}><Icon name="play" size={14} /> Remove the end date</button>
            : null}
          <button className={`btn btn-sm ${mode === 'end' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('end')}><Icon name="pause" size={14} /> {i.end_date ? 'Change last day' : 'End it'}</button>
          <button className={`btn btn-sm ${mode === 'fulfil' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('fulfil')} data-fulfil-open><Icon name="box" size={14} /> Fulfilment share</button>
          <button className={`btn btn-sm ${mode === 'edit' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('edit')}><Icon name="edit" size={14} /> Edit details</button>
          <button className={`btn btn-sm ${mode === 'remove' ? 'btn-danger' : 'btn-secondary'}`} onClick={() => pick('remove')}><Icon name="trash" size={14} /> Remove</button>
        </div>

        {mode === 'amount' && <AmountForm i={i} today={today} busy={busy} onCancel={() => setMode(null)}
          onSave={(from, amount, every) => run(() => setOverheadAmount(i.id, from, amount, every), `${i.name}: ${per(amount, every)} from ${fmtDate(from)}`)} />}
        {mode === 'end' && <EndForm i={i} today={today} busy={busy} onCancel={() => setMode(null)}
          onSave={(end) => run(() => endOverhead(i.id, end), `${i.name} ends on ${fmtDate(end)}`)} />}
        {mode === 'edit' && <EditForm i={i} busy={busy} onCancel={() => setMode(null)}
          onSave={(p) => run(() => saveOverhead({ id: i.id, ...p }), `${p.name} saved`)} />}
        {mode === 'fulfil' && <FulfilmentForm i={i} today={today} busy={busy} onCancel={() => setMode(null)}
          onSave={(share, from) => run(() => setOverheadFulfilment(i.id, share, from), `${i.name}: ${share <= 0 ? 'not a fulfilment cost' : share >= 100 ? 'a fulfilment cost' : `${share}% a fulfilment cost`} from ${fmtDate(from)}`)} />}
        {mode === 'remove' && <RemoveForm i={i} busy={busy} onCancel={() => setMode(null)}
          onSave={(reason) => run(() => removeOverhead(i.id, reason), `${i.name} removed`, true)} />}
        {err && <div className="panel-alert text-xs text-loss px-3 py-2.5">{err}</div>}

        <div>
          <div className="section-kicker mb-2">Amounts</div>
          <div className="surface divide-y divide-rule/70">
            {amounts.map(a => {
              const current = a.id === currentId
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-ink"><span className="font-semibold tabular-nums">{money(a.amount)}</span> {everyWord(a.every)}</div>
                    <div className="text-xs text-ink/45 mt-0.5">From {fmtDate(a.from_date)}{a.id === firstAmountId ? ' · starting amount' : ''}{a.by ? ` · ${a.by}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {a.from_date > today && <Flag tone="blue">To come</Flag>}
                    {current && i.status === 'running' && <Flag tone="green">Current</Flag>}
                    {a.id !== firstAmountId && (
                      <button className="icon-btn" aria-label={`Remove the change from ${fmtDate(a.from_date)}`} title="Remove this change (entered by mistake)" disabled={busy}
                        onClick={() => run(() => removeOverheadAmount(a.id), 'Change removed')}><Icon name="trash" size={14} /></button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-xs text-ink/45 mt-2">Each amount applies from its date until the next one. Earlier months keep what they were charged.</div>
        </div>

        {(i.fulfilment_shares || []).length > 0 && (
          <div data-fulfil-dated>
            <div className="section-kicker mb-2">Fulfilment share</div>
            <div className="surface divide-y divide-rule/70">
              {i.fulfilment_shares.map(f => {
                const current = f.from_date <= today && !i.fulfilment_shares.some(x => x.from_date <= today && x.from_date > f.from_date)
                return (
                  <div key={f.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm text-ink"><span className="font-semibold">{fulfilmentWord(f.share)}</span></div>
                      <div className="text-xs text-ink/45 mt-0.5">From {fmtDate(f.from_date)}{f.from_date === i.start_date ? ' · since it started' : ''}{f.by ? ` · ${f.by}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {f.from_date > today && <Flag tone="blue">To come</Flag>}
                      {current && <Flag tone="green">Current</Flag>}
                      <button className="icon-btn" aria-label={`Remove the share from ${fmtDate(f.from_date)}`} title="Remove this share (entered by mistake)" disabled={busy}
                        onClick={() => run(() => removeOverheadFulfilment(f.id), 'Share removed')}><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="text-xs text-ink/45 mt-2">Each share applies from its date until the next one. Earlier periods keep the share they had.</div>
          </div>
        )}

        <div>
          <div className="section-kicker mb-2">History</div>
          <div className="space-y-2.5">
            {(i.log || []).map((l, n) => (
              <div key={n} className="flex items-start gap-2.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-royal-500 mt-1.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-ink/80"><span className="font-semibold text-ink">{l.action.replace(/^Overhead /, '').replace(/^./, c => c.toUpperCase())}</span>{l.detail ? ` — ${l.detail}` : ''}</div>
                  <div className="text-ink/40 mt-0.5">{l.by || 'Portal'} · {new Date(l.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '-')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  )
}

function Line({ label, value, hint, strong }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-sm text-ink/60">{label}</span>
      <span className="text-right">
        <span className={`block tabular-nums ${strong ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}`}>{value}</span>
        {hint && <span className="block text-[11px] text-ink/45">{hint}</span>}
      </span>
    </div>
  )
}

function FormShell({ title, children, onCancel, onSave, busy, ready, saveLabel, danger }) {
  return (
    <div className="surface p-4 space-y-3">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children}
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ready || busy} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  )
}

function AmountForm({ i, today, busy, onCancel, onSave }) {
  const [from, setFrom] = useState(today >= i.start_date ? today : i.start_date)
  const was = amountOn(i.amounts, from || today)
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState(was.every)
  const v = parseFloat(amount)
  const inRange = from && from >= i.start_date && (!i.end_date || from <= i.end_date)
  const same = v === was.amount && every === was.every
  const ready = amount !== '' && v >= 0 && inRange && !same
  const after = ready ? costBetween({ ...i, amounts: [...(i.amounts || []).filter(a => a.from_date !== from), { from_date: from, amount: v, every }] }, monthStart(from), monthEnd(from)) : null
  return (
    <FormShell title="Change the amount" onCancel={onCancel} busy={busy} ready={ready} saveLabel="Save new amount" onSave={() => onSave(from, v, every)}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="oh-new-amount">New amount, ex VAT</label>
          <MoneyInput id="oh-new-amount" value={amount} onChange={setAmount} autoFocus onEnter={() => ready && onSave(from, v, every)} />
        </div>
        <div>
          <label className="label" htmlFor="oh-new-from">Applies from</label>
          <input id="oh-new-from" type="date" className="input" value={from} min={i.start_date} max={i.end_date || undefined} onChange={e => setFrom(e.target.value)} />
        </div>
      </div>
      <div>
        <div className="label">How often it is paid</div>
        <SegmentedControl label="How often it is paid" value={every} onChange={setEvery} items={FREQUENCIES.map(x => ({ id: x.id, label: x.label }))} />
      </div>
      {from && from < i.start_date && <div className="text-xs text-loss">That is before it starts ({fmtDate(i.start_date)}). Change the start date in Edit details instead.</div>}
      {amount !== '' && same && inRange && <div className="text-xs text-ink/55">It is already {per(was.amount, was.every)} on that date.</div>}
      {after && (
        <Preview>
          {per(was.amount, was.every)} → <b>{per(v, every)}</b> from {fmtDate(from)}. <b>{monthLabel(from)}</b> will come to <b>{money(after.cost)}</b>
          {from > monthStart(from) ? ' (the days before it stay at the old amount)' : ''}. Earlier months do not change.
        </Preview>
      )}
    </FormShell>
  )
}

function EndForm({ i, today, busy, onCancel, onSave }) {
  const [end, setEnd] = useState(i.end_date || (today >= i.start_date ? today : i.start_date))
  const ready = end && end >= i.start_date
  const last = ready ? costBetween({ ...i, end_date: end }, monthStart(end), monthEnd(end)) : null
  return (
    <FormShell title={i.end_date ? 'Change the last day' : 'End this overhead'} onCancel={onCancel} busy={busy} ready={ready} saveLabel="Save last day" onSave={() => onSave(end)}>
      <div className="max-w-[220px]">
        <label className="label" htmlFor="oh-end-day">Last day charged</label>
        <input id="oh-end-day" type="date" className="input" value={end} min={i.start_date} onChange={e => setEnd(e.target.value)} />
      </div>
      {end && end < i.start_date && <div className="text-xs text-loss">It starts on {fmtDate(i.start_date)} — the last day cannot be before that.</div>}
      {last && (
        <Preview>
          It is charged up to and including {fmtDate(end)}. <b>{monthLabel(end)}</b> will come to <b>{money(last.cost)}</b>
          {partMonthNote(last.days, end) ? ` (${partMonthNote(last.days, end)})` : ''}, and nothing after that. Earlier months keep it.
        </Preview>
      )}
    </FormShell>
  )
}

/**
 * How much of this overhead is a cost of fulfilment — none, all, or a share for someone who does both jobs — and the
 * date it applies from (v2.101.0). The first time, the date starts at the overhead's own start (it has usually always
 * been one); after that it starts at today, so a change never rewrites earlier periods by accident.
 */
function FulfilmentForm({ i, today, busy, onCancel, onSave }) {
  const shares = i.fulfilment_shares || []
  const startFrom = today >= i.start_date ? today : i.start_date
  const [from, setFrom] = useState(shares.length ? startFrom : i.start_date)
  const was = from ? shareOn(shares, from) : fulfilmentShare(i)
  const now = fulfilmentShare(i)
  const [kind, setKind] = useState(now <= 0 ? 'none' : now >= 100 ? 'all' : 'part')
  const [pct, setPct] = useState(now > 0 && now < 100 ? String(+now.toFixed(2)) : '50')
  const n = Number(pct)
  const share = kind === 'none' ? 0 : kind === 'all' ? 100 : n
  const dateOk = !!from && from >= i.start_date && (!i.end_date || from <= i.end_date)
  const pctOk = kind !== 'part' || (pct.trim() !== '' && Number.isFinite(n) && n > 0 && n < 100)
  const ready = dateOk && pctOk
  const later = shares.filter(f => f.from_date > from).sort((a, b) => a.from_date.localeCompare(b.from_date))[0]
  return (
    <FormShell title="How much of this is a cost of fulfilment?" onCancel={onCancel} busy={busy} ready={ready && share !== was} saveLabel="Save share" onSave={() => onSave(Math.round(share * 100) / 100, from)}>
      <div className="text-xs text-ink/60 leading-relaxed">Fulfilment is storing, picking, packing and sending orders. Count an overhead if you would not pay it should someone else send the orders for you.</div>
      <div className="space-y-1.5" role="radiogroup" aria-label="Fulfilment share">
        {[['none', 'None of it', 'Management, software for the office, memberships…'], ['all', 'All of it', 'Warehouse rent, warehouse and dispatch staff, HELM…'], ['part', 'Part of it', 'Someone who works on fulfilment and on other things']].map(([id, label, eg]) => (
          <label key={id} className={`flex items-start gap-2.5 rounded-[6px] border px-3 py-2 cursor-pointer ${kind === id ? 'border-royal-500 bg-royal-50' : 'border-rule hover:bg-paper'}`}>
            <input type="radio" name="oh-fulfil" className="mt-0.5" checked={kind === id} onChange={() => setKind(id)} />
            <span className="min-w-0"><span className="block text-sm font-medium text-ink">{label}</span><span className="block text-xs text-ink/50">{eg}</span></span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {kind === 'part' && (
          <div className="w-[120px]">
            <label className="label" htmlFor="oh-fulfil-pct">Share, %</label>
            <input id="oh-fulfil-pct" type="number" inputMode="decimal" min="1" max="99" step="1" className="input tabular-nums" value={pct} onChange={e => setPct(e.target.value)} />
          </div>
        )}
        <div className="w-[190px]">
          <label className="label" htmlFor="oh-fulfil-from">Applies from</label>
          <input id="oh-fulfil-from" type="date" className="input" value={from} min={i.start_date} max={i.end_date || undefined} onChange={e => setFrom(e.target.value)} />
        </div>
      </div>
      {!pctOk && <div className="text-xs text-loss">The share is between 1 and 99.</div>}
      {from && from < i.start_date && <div className="text-xs text-loss">It starts on {fmtDate(i.start_date)} — the date cannot be before that.</div>}
      {from && i.end_date && from > i.end_date && <div className="text-xs text-loss">It ends on {fmtDate(i.end_date)} — choose a date on or before that.</div>}
      {ready && share === was && <div className="text-xs text-ink/55">It is already {fulfilmentWord(was).toLowerCase()} on {fmtDate(from)}.</div>}
      {ready && share !== was && (
        <Preview>
          From <b>{fmtDate(from)}</b>{from === i.start_date ? ' (the day it started)' : ''}, <b>{share <= 0 ? 'none' : share >= 100 ? 'all' : `${Math.round(share * 100) / 100}%`}</b> of this overhead counts towards the fulfilment cost in Profit &amp; Loss
          {later ? <>, until {fmtDate(later.from_date)} when it becomes {fulfilmentWord(later.share).toLowerCase()}</> : null}.
          {from > i.start_date ? <> Days before that keep what they had ({fulfilmentWord(shareOn(shares, addDay(from, -1))).toLowerCase()}).</> : null} No profit figure changes.
        </Preview>
      )}
    </FormShell>
  )
}

function EditForm({ i, busy, onCancel, onSave }) {
  const [f, setF] = useState({ name: i.name, category: i.category, note: i.note || '', start_date: i.start_date })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ready = f.name.trim() && f.start_date && (!i.end_date || f.start_date <= i.end_date)
  const moved = f.start_date && f.start_date !== i.start_date
  return (
    <FormShell title="Edit details" onCancel={onCancel} busy={busy} ready={ready} saveLabel="Save details" onSave={() => onSave({ ...f, name: f.name.trim() })}>
      <div>
        <label className="label" htmlFor="oh-edit-name">Name</label>
        <input id="oh-edit-name" className="input" value={f.name} onChange={e => set('name', e.target.value)} />
      </div>
      <div>
        <div className="label">Category</div>
        <CategoryChips value={f.category} onChange={v => set('category', v)} />
      </div>
      <div className="max-w-[220px]">
        <label className="label" htmlFor="oh-edit-start">Starts from</label>
        <input id="oh-edit-start" type="date" className="input" value={f.start_date} max={i.end_date || undefined} onChange={e => set('start_date', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="oh-edit-note">Note</label>
        <input id="oh-edit-note" className="input" value={f.note} onChange={e => set('note', e.target.value)} />
      </div>
      {moved && <Preview>The start date moves from {fmtDate(i.start_date)} to {fmtDate(f.start_date)}, so the months in between will {f.start_date < i.start_date ? 'now include it' : 'no longer include it'}. The starting amount moves with it.</Preview>}
    </FormShell>
  )
}

function RemoveForm({ i, busy, onCancel, onSave }) {
  const [reason, setReason] = useState('')
  return (
    <FormShell title="Remove this overhead" onCancel={onCancel} busy={busy} ready saveLabel="Remove it" danger onSave={() => onSave(reason)}>
      <div className="text-xs text-ink/65 leading-relaxed">
        Only remove it if it was <b>added by mistake</b> — it will stop counting in <b>every</b> month, including past ones.
        If it has simply stopped{i.end_date ? '' : ', use “End it” instead'}, earlier months keep it.
      </div>
      <div>
        <label className="label" htmlFor="oh-remove-why">Why <span className="font-normal text-ink/40">(optional)</span></label>
        <input id="oh-remove-why" className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. entered twice" />
      </div>
    </FormShell>
  )
}
