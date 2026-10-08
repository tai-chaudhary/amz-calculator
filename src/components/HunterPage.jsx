import React, { useState, useMemo, useRef, useEffect } from 'react'
import { indexSupplierProducts, matchListing, evaluateListing, flagsFor, parseHeliumExport } from '../lib/hunter'
import { DISPOSITIONS, SKIP_REASONS, STALE_HELIUM_DAYS, daysSince, defaultHuntName, heliumDateFromFile,
         sentStatus, previousSkips, huntProgress, validityChecks } from '../lib/hunts'
import { fmt, fmtSigned, pct } from '../lib/calc'
import { Icon, PageHeader, StatusBadge, ProductImage, EmptyState, Modal, Tabs, SegmentedControl } from './UI'
import HuntDetail from './HuntDetail'

const SEGMENTS = {
  ready:   { label: 'Ready to consider', tiers: ['barcode', 'confirmed'] },
  confirm: { label: 'Needs confirming',  tiers: ['likely', 'possible'] },
  none:    { label: 'No supplier match', tiers: ['none', 'rejected'] },
}
const SORTS = {
  monthly: { label: 'Monthly profit potential', fn: (a, b) => (b.ev?.monthlyMarketProfit ?? -1e9) - (a.ev?.monthlyMarketProfit ?? -1e9) },
  profit:  { label: 'Profit per sale',          fn: (a, b) => (b.ev?.netProfit ?? -1e9) - (a.ev?.netProfit ?? -1e9) },
  margin:  { label: 'Margin',                   fn: (a, b) => (b.ev?.margin ?? -1e9) - (a.ev?.margin ?? -1e9) },
  sales:   { label: 'Market sales',             fn: (a, b) => (b.l.data.sales || 0) - (a.l.data.sales || 0) },
}
const DEFAULT_VIEW = { tab: 'pending', segment: 'ready', sort: 'monthly', minMargin: '', profitableOnly: true, hideAmazon: true }

export default function HunterPage(props) {
  const { hunts, focusId, onNavigate } = props
  const hunt = focusId ? hunts.find(h => h.id === focusId) : null
  return hunt
    ? <HuntWorkspace key={hunt.id} hunt={hunt} {...props} onBack={() => onNavigate?.('hunter')} />
    : <HuntsOverview {...props} />
}

/* ── All hunts ──────────────────────────────────────────────────────────── */

function HuntsOverview({ hunts, huntItems, onCreateHunts, onUpdateHunt, onNavigate }) {
  const [pending, setPending] = useState(null)   // files waiting to be named
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const pick = async (files) => {
    const parsed = []
    for (const f of files) {
      const text = await f.text()
      const { listings, error } = parseHeliumExport(text, f.name)
      parsed.push({ fileName: f.name, listings, error, name: listings.length ? defaultHuntName(listings, f.name) : '' })
    }
    setPending(parsed)
    if (fileRef.current) fileRef.current.value = ''
  }

  const create = async () => {
    setBusy(true)
    await onCreateHunts(pending.filter(p => !p.error && p.listings.length))
    setBusy(false); setPending(null)
  }

  const open = hunts.filter(h => h.status !== 'complete' && h.status !== 'archived')
  const done = hunts.filter(h => h.status === 'complete' || h.status === 'archived')

  return (
    <div>
      <PageHeader
        eyebrow="Sourcing / discovery"
        title="Product hunter"
        description="Each Helium export becomes a hunt you can work through at your own pace. Progress is saved as you go, so you can stop and pick up exactly where you left off."
        meta={`${open.length} in progress${done.length ? ` · ${done.length} finished` : ''}`}
        actions={
          <>
            <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> New hunt from Helium export
            </button>
            <input ref={fileRef} type="file" accept=".csv" multiple className="hidden" onChange={e => pick([...e.target.files])} />
          </>
        }
      />

      {hunts.length === 0 ? (
        <EmptyState icon="search" title="No hunts yet"
          sub="Export a brand from Helium 10's Black Box as CSV and start a hunt. You can import several at once and work through them one by one." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {open.map(h => <HuntTile key={h.id} h={h} huntItems={huntItems} onOpen={() => onNavigate?.('hunter', h.id)} onUpdateHunt={onUpdateHunt} />)}
          </div>
          {done.length > 0 && (
            <div className="mt-6">
              <button className="text-sm text-ink/55 hover:text-royal-600" onClick={() => setShowDone(s => !s)}>
                <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={14} /> Finished hunts ({done.length})
              </button>
              {showDone && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
                  {done.map(h => <HuntTile key={h.id} h={h} huntItems={huntItems} onOpen={() => onNavigate?.('hunter', h.id)} onUpdateHunt={onUpdateHunt} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {pending && (
        <Modal title={pending.length > 1 ? `Start ${pending.length} hunts` : 'Start a hunt'}
          description="Name each hunt so it's easy to find later. You don't have to work through them now."
          onClose={() => setPending(null)} maxWidth="max-w-lg">
          <div className="space-y-3">
            {pending.map((p, i) => (
              <div key={i} className="p-3 rounded-lg border border-rule bg-paper">
                <div className="text-[12px] text-ink/45 truncate mb-1.5">{p.fileName}</div>
                {p.error ? <div className="text-sm text-loss">{p.error}</div> : (
                  <>
                    <input className="input" value={p.name}
                      onChange={e => setPending(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <div className="text-[12px] text-ink/50 mt-1.5">{p.listings.length.toLocaleString()} listings · Helium data from {new Date(heliumDateFromFile(p.fileName)).toLocaleDateString('en-GB')}</div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary flex-1 justify-center" disabled={busy || !pending.some(p => !p.error && p.listings.length && p.name.trim())} onClick={create}>
              {busy ? 'Creating…' : pending.filter(p => !p.error).length > 1 ? 'Create hunts' : 'Create hunt'}
            </button>
            <button className="btn btn-secondary" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function HuntTile({ h, huntItems, onOpen, onUpdateHunt }) {
  const p = huntProgress(h.id, huntItems)
  const age = daysSince(h.data?.heliumDate || h.created_at)
  const pctDone = p.total ? Math.round((p.decided / p.total) * 100) : 0
  const finished = h.status === 'complete' || h.status === 'archived'
  return (
    <div className="card cursor-pointer hover:border-royal-300 transition-colors" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (onOpen)() } }} onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{h.name}</div>
          <div className="text-[12px] text-ink/45 mt-0.5">
            {h.created_by ? `${h.created_by} · ` : ''}{new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {age !== null && ` · data ${age === 0 ? 'from today' : `${age}d old`}`}
          </div>
        </div>
        {age !== null && age > STALE_HELIUM_DAYS && !finished && <StatusBadge tone="paused">Data ageing</StatusBadge>}
        {finished && <StatusBadge tone="live">Finished</StatusBadge>}
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[13px] mb-1">
          <span className="text-ink/60">{p.decided.toLocaleString()} of {p.total.toLocaleString()} decided</span>
          <span className="font-semibold text-ink">{pctDone}%</span>
        </div>
        <div className="h-2 bg-ink/5 rounded-full overflow-hidden flex">
          <div className="bg-royal-500" style={{ width: `${p.total ? p.sent / p.total * 100 : 0}%` }} />
          <div className="bg-ink/25" style={{ width: `${p.total ? p.skipped / p.total * 100 : 0}%` }} />
          <div className="bg-warn/60" style={{ width: `${p.total ? p.later / p.total * 100 : 0}%` }} />
        </div>
        <div className="flex gap-3 text-[12px] text-ink/55 mt-2 flex-wrap">
          <span><span className="inline-block w-2 h-2 rounded-full bg-royal-500 mr-1" />{p.sent} sent</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-ink/25 mr-1" />{p.skipped} skipped</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-warn/60 mr-1" />{p.later} later</span>
          <span>{p.pending} to go</span>
        </div>
      </div>

      <div className="flex gap-2 mt-4" onClick={e => e.stopPropagation()}>
        <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={onOpen}>
          {p.decided > 0 && !finished ? 'Continue' : 'Open'}
        </button>
        <button className="btn btn-secondary btn-sm"
          onClick={() => onUpdateHunt(h.id, { status: finished ? 'open' : 'complete' })}>
          {finished ? 'Reopen' : 'Mark finished'}
        </button>
      </div>
    </div>
  )
}

/* ── One hunt ───────────────────────────────────────────────────────────── */

function HuntWorkspace({
  hunt, huntItems, hunts, marketListings, loadHuntCatalogue, suppliers, asinMatches, savedProducts, liveProducts,
  stockItems, settings, onBack, onUpdateHunt, onDecideMatch, onSendToReview, onSetDisposition, onNavigate,
}) {
  // Only the supplier lines this hunt could match — its barcodes and brands
  const [supplierProducts, setSupplierProducts] = useState(null)
  const [catalogueError, setCatalogueError] = useState(null)
  const saved = hunt.data?.view || {}
  const [view, setView] = useState({ ...DEFAULT_VIEW, ...saved })
  const [openAsin, setOpenAsin] = useState(null)
  const [limit, setLimit] = useState(50)
  const [bulk, setBulk] = useState(null)       // { rows, label }
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(hunt.name)
  const set = (patch) => { setView(v => ({ ...v, ...patch })); setLimit(50) }

  // Remember where you are, quietly, as you work
  useEffect(() => {
    const t = setTimeout(() => {
      onUpdateHunt(hunt.id, { data: { ...hunt.data, view, lastAsin: openAsin || hunt.data?.lastAsin || null } }, { quiet: true })
    }, 800)
    return () => clearTimeout(t)
  }, [view, openAsin]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => huntItems.filter(i => i.hunt_id === hunt.id), [huntItems, hunt.id])
  const itemByAsin = useMemo(() => new Map(items.map(i => [i.asin, i])), [items])
  const listingByAsin = useMemo(() => new Map(marketListings.map(l => [l.asin, l])), [marketListings])
  useEffect(() => {
    const listings = items.map(i => listingByAsin.get(i.asin)).filter(Boolean)
    if (!listings.length || !loadHuntCatalogue) return
    let live = true
    loadHuntCatalogue(listings).then(r => live && setSupplierProducts(r)).catch(e => live && setCatalogueError(e?.message || 'Could not load supplier products'))
    return () => { live = false }
  }, [hunt.id, items.length, listingByAsin.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const index = useMemo(() => indexSupplierProducts(supplierProducts || [], suppliers), [supplierProducts, suppliers])
  const confirmed = useMemo(() => new Map(asinMatches.map(m => [m.asin, m])), [asinMatches])

  const rows = useMemo(() => !supplierProducts ? [] : items.map(item => {
    const l = listingByAsin.get(item.asin)
    if (!l) return null
    const m = matchListing(l, index, confirmed)
    const ev = evaluateListing(l, m, { settings, savedProducts, stockItems })
    return {
      l, m, ev, item,
      flags: ev ? flagsFor(l, m, ev) : [],
      listed: savedProducts.some(r => (r.data?.asin || '').toUpperCase() === l.asin),
      status: item.disposition === 'sent' ? sentStatus(item, savedProducts, liveProducts) : null,
      prevSkips: previousSkips(l.asin, hunt.id, huntItems, hunts),
    }
  }).filter(Boolean), [items, listingByAsin, index, confirmed, settings, savedProducts, stockItems, liveProducts, huntItems, hunts, hunt.id])

  const progress = huntProgress(hunt.id, huntItems)
  const tabCount = (t) => rows.filter(r => r.item.disposition === t).length
  const segCount = (s) => rows.filter(r => r.item.disposition === 'pending' && SEGMENTS[s].tiers.includes(r.m.tier)).length

  const shown = useMemo(() => {
    let list = rows.filter(r => r.item.disposition === view.tab)
    if (view.tab === 'pending') {
      list = list.filter(r => SEGMENTS[view.segment].tiers.includes(r.m.tier))
      if (view.segment !== 'none') {
        if (view.hideAmazon) list = list.filter(r => !r.l.data.amazonSelling)
        if (view.profitableOnly) list = list.filter(r => r.ev && r.ev.netProfit > 0)
        const mm = parseFloat(view.minMargin)
        if (Number.isFinite(mm)) list = list.filter(r => r.ev && r.ev.margin >= mm)
      }
    }
    return [...list].sort(view.segment === 'none' && view.tab === 'pending' ? SORTS.sales.fn : SORTS[view.sort].fn)
  }, [rows, view])

  // Items the filters are hiding, so bulk skips can catch them
  const hiddenAmazon = view.tab === 'pending' && view.segment !== 'none'
    ? rows.filter(r => r.item.disposition === 'pending' && SEGMENTS[view.segment].tiers.includes(r.m.tier) && r.l.data.amazonSelling) : []

  const openRow = openAsin ? rows.find(r => r.l.asin === openAsin) : null
  const openIdx = openAsin ? shown.findIndex(r => r.l.asin === openAsin) : -1

  // After a decision, move to whatever's next in the list you were working
  const advance = (fromAsin) => {
    const i = shown.findIndex(r => r.l.asin === fromAsin)
    const next = shown.slice(i + 1).find(r => r.l.asin !== fromAsin) || shown.slice(0, Math.max(0, i)).reverse().find(r => r.l.asin !== fromAsin)
    setOpenAsin(next ? next.l.asin : null)
  }

  const decide = async (rowsToSet, disposition, reason = null, note = null, { advanceFrom } = {}) => {
    await onSetDisposition(rowsToSet.map(r => r.item.id), disposition, reason, note)
    if (advanceFrom) advance(advanceFrom)
  }

  const lastRow = hunt.data?.lastAsin && !openAsin ? rows.find(r => r.l.asin === hunt.data.lastAsin) : null
  const age = daysSince(hunt.data?.heliumDate || hunt.created_at)

  return (
    <div>
      <button className="text-sm text-ink/55 hover:text-royal-600 mb-3 inline-flex items-center gap-1" onClick={onBack}><Icon name="back" size={14} /> All hunts</button>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          {editingName ? (
            <div className="flex gap-2 items-center">
              <input className="input text-lg font-semibold w-full sm:w-[360px]" value={name} autoFocus
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { onUpdateHunt(hunt.id, { name: name.trim() || hunt.name }); setEditingName(false) } }} />
              <button className="btn btn-primary btn-sm" onClick={() => { onUpdateHunt(hunt.id, { name: name.trim() || hunt.name }); setEditingName(false) }}>Save</button>
            </div>
          ) : (
            <h1 className="text-[28px] leading-tight cursor-pointer hover:text-royal-600" title="Rename" onClick={() => setEditingName(true)}>{hunt.name}</h1>
          )}
          <div className="text-sm text-ink/50 mt-1">
            {progress.total.toLocaleString()} listings · {hunt.created_by ? `started by ${hunt.created_by} · ` : ''}
            Helium data {age === 0 ? 'from today' : `${age} days old`}
            {age > STALE_HELIUM_DAYS && <span className="text-warn font-medium"> — consider re-exporting</span>}
          </div>
        </div>
        <div className="w-full sm:w-72">
          <div className="flex justify-between text-[13px] mb-1">
            <span className="text-ink/60">{progress.decided} of {progress.total} decided</span>
            <span className="font-semibold">{progress.total ? Math.round(progress.decided / progress.total * 100) : 0}%</span>
          </div>
          <div className="h-2 bg-ink/5 rounded-full overflow-hidden flex">
            <div className="bg-royal-500" style={{ width: `${progress.total ? progress.sent / progress.total * 100 : 0}%` }} />
            <div className="bg-ink/25" style={{ width: `${progress.total ? progress.skipped / progress.total * 100 : 0}%` }} />
            <div className="bg-warn/60" style={{ width: `${progress.total ? progress.later / progress.total * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      {lastRow && (
        <div className="panel-brand mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm min-w-0">
            <span className="text-ink/60">You were last on </span>
            <span className="font-medium text-ink">{lastRow.l.title.slice(0, 70)}{lastRow.l.title.length > 70 ? '…' : ''}</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setOpenAsin(lastRow.l.asin)}>Pick up here</button>
        </div>
      )}

      <Tabs className="mb-4" value={view.tab} onChange={(t) => set({ tab: t })}
        items={Object.entries(DISPOSITIONS).map(([k, d]) => ({ id: k, label: d.label, count: tabCount(k) }))} />

      {view.tab === 'pending' && (
        <SegmentedControl className="mb-3" label="Match" value={view.segment} onChange={(k) => set({ segment: k })}
          items={Object.entries(SEGMENTS).map(([k, s]) => ({ id: k, label: s.label, count: segCount(k) }))} />
      )}

      {view.tab === 'pending' && view.segment !== 'none' && (
        <div className="card py-3 mb-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="label">Sort by</label>
              <select className="input w-full sm:w-[210px]" value={view.sort} onChange={e => set({ sort: e.target.value })}>
                {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Minimum margin %</label>
              <input type="number" className="input w-full sm:w-[110px]" value={view.minMargin} placeholder="Any" onChange={e => set({ minMargin: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer pb-2.5">
              <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={view.profitableOnly} onChange={e => set({ profitableOnly: e.target.checked })} /> Profitable only
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer pb-2.5">
              <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={view.hideAmazon} onChange={e => set({ hideAmazon: e.target.checked })} /> Hide ones Amazon sells
            </label>
          </div>
        </div>
      )}

      {view.tab === 'pending' && (
        <div className="flex gap-2 flex-wrap items-center mb-3 text-[13px]">
          <span className="text-ink/50">Clear out in one go:</span>
          {hiddenAmazon.length > 0 && (
            <button className="btn btn-secondary btn-xs" onClick={() => setBulk({ rows: hiddenAmazon, label: `${hiddenAmazon.length} that Amazon sells`, reason: 'Amazon sells it' })}>
              Skip {hiddenAmazon.length} Amazon sells
            </button>
          )}
          {view.segment !== 'none' && (() => {
            const losers = rows.filter(r => r.item.disposition === 'pending' && SEGMENTS[view.segment].tiers.includes(r.m.tier) && r.ev && r.ev.netProfit <= 0)
            return losers.length > 0 && (
              <button className="btn btn-secondary btn-xs" onClick={() => setBulk({ rows: losers, label: `${losers.length} that lose money`, reason: 'Margin too low' })}>
                Skip {losers.length} that lose money
              </button>
            )
          })()}
          {shown.length > 0 && (
            <button className="btn btn-secondary btn-xs" onClick={() => setBulk({ rows: shown, label: `all ${shown.length} shown`, reason: '' })}>
              Skip all {shown.length} shown…
            </button>
          )}
        </div>
      )}

      {!supplierProducts ? (
        <div className="card text-center py-12 text-sm text-ink/55">
          {catalogueError ? `Couldn't load supplier products: ${catalogueError}` : 'Matching against your suppliers…'}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon="check"
          title={view.tab === 'pending' ? 'Nothing left here' : `Nothing ${DISPOSITIONS[view.tab].label.toLowerCase()}`}
          sub={view.tab === 'pending' ? 'Try another group above, or loosen the filters.' : ''} />
      ) : (
        <div className="space-y-2">
          {shown.slice(0, limit).map(r => (
            <HuntRow key={r.l.asin} r={r} settings={settings} index={index}
              highlight={r.l.asin === hunt.data?.lastAsin}
              onOpen={() => setOpenAsin(r.l.asin)}
              onUndo={() => decide([r], 'pending')} />
          ))}
          {shown.length > limit && (
            <button className="btn btn-secondary w-full justify-center" onClick={() => setLimit(l => l + 50)}>
              Show more ({(shown.length - limit).toLocaleString()} left)
            </button>
          )}
        </div>
      )}

      {openRow && (
        <HuntDetail
          key={openRow.l.asin}
          r={openRow} hunt={hunt} index={index} settings={settings}
          position={openIdx >= 0 ? { at: openIdx + 1, of: shown.length } : null}
          checks={validityChecks({ listing: openRow.l, match: openRow.m, ev: openRow.ev, hunt, savedProducts, stockItems })}
          onPrev={openIdx > 0 ? () => setOpenAsin(shown[openIdx - 1].l.asin) : null}
          onNext={openIdx >= 0 && openIdx < shown.length - 1 ? () => setOpenAsin(shown[openIdx + 1].l.asin) : null}
          onClose={() => setOpenAsin(null)}
          onDecideMatch={onDecideMatch}
          onSendToReview={async (r, overrides) => {
            const ok = await onSendToReview(r, overrides, { item: r.item, hunt })
            if (ok) advance(r.l.asin)
          }}
          onSkip={(reason, note) => decide([openRow], 'skipped', reason, note, { advanceFrom: openRow.l.asin })}
          onLater={() => decide([openRow], 'later', null, null, { advanceFrom: openRow.l.asin })}
          onUndo={() => decide([openRow], 'pending')}
          onNavigate={onNavigate}
        />
      )}

      {bulk && (
        <BulkSkip bulk={bulk} onClose={() => setBulk(null)}
          onConfirm={async (reason, note) => { await decide(bulk.rows, 'skipped', reason, note); setBulk(null) }} />
      )}
    </div>
  )
}

function BulkSkip({ bulk, onClose, onConfirm }) {
  const [reason, setReason] = useState(bulk.reason || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`Skip ${bulk.label}`} description="They move to Skipped with this reason. You can undo any of them from there." onClose={onClose}>
      <label className="label">Reason</label>
      <select className="input mb-3" value={reason} onChange={e => setReason(e.target.value)}>
        <option value="">Choose…</option>
        {SKIP_REASONS.map(r => <option key={r}>{r}</option>)}
      </select>
      {reason === 'Other' && <input className="input mb-3" placeholder="Say why" value={note} onChange={e => setNote(e.target.value)} />}
      <button className="btn btn-primary w-full justify-center" disabled={busy || !reason || (reason === 'Other' && !note.trim())}
        onClick={async () => { setBusy(true); await onConfirm(reason, note.trim() || null); setBusy(false) }}>
        Skip {bulk.rows.length}
      </button>
    </Modal>
  )
}

function HuntRow({ r, settings, index, highlight, onOpen, onUndo }) {
  const { l, m, ev, item, flags, status, prevSkips, listed } = r
  const d = l.data || {}
  const comp = m.components[0]
  return (
    <div className={`card py-3 px-4 cursor-pointer transition-colors ${highlight ? 'border-royal-400' : 'hover:border-royal-300'}`} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (onOpen)() } }} onClick={onOpen}>
      <div className="flex gap-3 items-start">
        <div className="w-14 h-14 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
          <ProductImage asin={l.asin} alt="" className="object-contain w-full h-full p-1" placeholderSize="text-lg" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.disposition === 'sent' && status && <StatusBadge tone={status.tone} dot>{status.label}</StatusBadge>}
            {item.disposition === 'skipped' && <StatusBadge tone="quiet">Skipped — {item.reason}{item.note ? `: ${item.note}` : ''}</StatusBadge>}
            {item.disposition === 'later' && <StatusBadge tone="paused">Saved for later</StatusBadge>}
            {item.disposition === 'pending' && (
              <StatusBadge tone={m.tier === 'confirmed' || m.tier === 'barcode' ? 'live' : m.tier === 'likely' ? 'brand' : 'quiet'}>
                {{ confirmed: 'Confirmed match', barcode: 'Barcode match', likely: 'Likely match', possible: 'Possible match', none: 'No match', rejected: 'Not a match' }[m.tier]}
              </StatusBadge>
            )}
            {listed && item.disposition !== 'sent' && <StatusBadge tone="brand">Already in your listings</StatusBadge>}
            {prevSkips.length > 0 && item.disposition === 'pending' && (
              <StatusBadge tone="paused">Skipped before: {prevSkips[0].reason}</StatusBadge>
            )}
            {flags.slice(0, 3).map((f, i) => <StatusBadge key={i} tone={f.tone}>{f.text}</StatusBadge>)}
          </div>
          <div className="text-sm font-semibold text-ink mt-1 line-clamp-2">{l.title}</div>
          <div className="text-[12px] text-ink/50 mt-0.5">
            {fmt(d.price || 0)} · {(d.sales || 0).toLocaleString()} sales/mo · {d.sellers ?? '?'} sellers
            {comp && <> · {index.nameOf(comp.sp.supplier_id)} {fmt(comp.sp.unit_cost)} × {comp.qty}</>}
            {ev && <> · {ev.pack?.ownPackaging ? 'own packaging' : (settings.packaging.find(p => p.id === ev.pack?.packagingId)?.name || 'no packaging')}</>}
          </div>
          {status?.note && <div className="text-[12px] text-loss mt-1">Sent back: {status.note}</div>}
        </div>
        {ev && (
          <div className="text-right flex-shrink-0 w-[130px]">
            <div className={`text-lg font-semibold ${ev.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(ev.netProfit)}</div>
            <div className="text-[12px] text-ink/55">{pct(ev.margin)} · fee {ev.referralRate.toFixed(1)}%</div>
            {ev.upsideProfit !== null && <div className="text-xs text-ink/40">up to {fmt(ev.upsideProfit)}</div>}
          </div>
        )}
      </div>
      {item.disposition !== 'pending' && item.disposition !== 'sent' && (
        <div className="flex justify-end mt-2" onClick={e => e.stopPropagation()}>
          <button className="btn btn-secondary btn-xs" onClick={onUndo}>Move back to "to decide"</button>
        </div>
      )}
    </div>
  )
}
