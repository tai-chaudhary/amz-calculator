import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, InfoBox, Modal, SearchInput, Spinner, StatusBadge } from './UI'
import { loadProductPackaging, setProductPackaging, removeProductPackaging } from '../lib/db'
import { groupProductPackaging, packagingOn, packagingStates } from '../lib/productPackaging'
import { packagingOnly, typeCost } from '../lib/packaging'
import { seesCosts } from '../lib/access'
import { fmt } from '../lib/calc'
import { matches, hay } from '../lib/match'
import { londonToday, fmtDate } from '../lib/dates'

/**
 * Packaging → Products (v2.105.0): what each product goes out in when it is sent on its own, dated.
 *
 * A marketplace order is costed from its listing's packaging. A website order (Plenty&More, Salt 4 U) has no listing,
 * so it is costed as one basket: the dearest of its products' packaging here, once for each parcel. A change applies
 * from a date and earlier days keep what they had; a wrong entry is removed, never edited.
 */
export default function ProductPackaging({ stockItems = [], settings, me }) {
  const canEdit = me?.role === 'admin' || seesCosts(me)
  const packaging = settings?.packaging || []
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('')            // '' | 'unset' | a packaging id | 'own'
  const [form, setForm] = useState(null)          // { si, current }
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)

  const load = useCallback(() => loadProductPackaging().then(d => { setData(d); setError(null) }).catch(e => setError(e?.message || 'Could not load')), [])
  useEffect(() => { load() }, [load])

  const today = data?.today || londonToday()
  const byItem = useMemo(() => groupProductPackaging(data?.rows || []), [data])
  const typeOf = (id) => packaging.find(p => p.id === id)
  const rows = useMemo(() => stockItems.filter(si => !packagingOnly(si) && !si.data?.archived).map(si => {
    const cur = packagingOn(byItem, si.id, today)
    const type = cur && !cur.own ? packaging.find(p => p.id === cur.packaging_id) : null
    return { si, cur, type, gone: !!cur && !cur.own && !type, all: byItem.get(si.id) || [], key: !cur ? 'unset' : cur.own ? 'own' : cur.packaging_id }
  }).sort((a, b) => a.si.name.localeCompare(b.si.name)), [stockItems, byItem, today, packaging])
  const counts = useMemo(() => rows.reduce((m, r) => m.set(r.key, (m.get(r.key) || 0) + 1), new Map()), [rows])
  const shown = rows.filter(r => (!show || r.key === show) && (!search.trim() || matches(hay(r.si.name, r.si.data?.sku, r.type?.name), search)))
  const unset = counts.get('unset') || 0

  const save = async (v) => {
    setBusy(true); setSaid(null)
    try { await setProductPackaging(v); await load(); setForm(null) } catch (e) { setSaid(e?.message || 'Could not save') } finally { setBusy(false) }
  }
  const remove = async (r) => {
    if (!window.confirm(`Remove the entry from ${fmtDate(r.from_date)}? Use this only for one entered by mistake.`)) return
    setBusy(true); setSaid(null)
    try { await removeProductPackaging(r.id); await load() } catch (e) { setSaid(e?.message || 'Could not remove') } finally { setBusy(false) }
  }

  if (error) return <div className="card text-sm text-ink" data-pp-error><b>This list could not be loaded.</b> <span className="text-ink/60">{error}</span></div>
  if (!data) return <div className="surface p-8 flex justify-center"><Spinner /></div>

  return (
    <div data-product-packaging>
      <InfoBox title="How this is used">
        What each product goes out in <b>when it is sent on its own</b>. A website order has no listing, so it is costed as one basket:
        the dearest packaging among its products, once for each parcel. Marketplace orders keep using their listing’s packaging.
      </InfoBox>
      {said && <div className="text-sm text-warn mt-3" role="alert">{said}</div>}
      <div className="filter-bar my-4">
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Product, code or packaging…" className="flex-1 min-w-[200px]" />
        <select className="input text-sm sm:w-[230px]" value={show} onChange={e => setShow(e.target.value)} aria-label="Packaging filter" data-pp-filter>
          <option value="">All products</option>
          {unset > 0 && <option value="unset">Not set ({unset})</option>}
          {packaging.filter(p => counts.get(p.id)).map(p => <option key={p.id} value={p.id}>{p.name} ({counts.get(p.id)})</option>)}
          {counts.get('own') > 0 && <option value="own">Own packaging ({counts.get('own')})</option>}
        </select>
        <div className="text-xs text-ink/45 sm:ml-auto">{shown.length} of {rows.length}{unset ? ` · ${unset} not set` : ''}</div>
      </div>
      {shown.length === 0 ? <div className="surface"><EmptyState icon="box" title="No products match" /></div> : (
        <div className="card p-0 overflow-hidden">
          <ul className="divide-y divide-ink/5">
            {shown.map(r => {
              const states = packagingStates(r.all, today)
              const next = r.all.find(x => states.get(x.id) === 'to come')
              return (
                <li key={r.si.id} className="px-4 py-3" data-pp-row={r.si.id}>
                  <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1 basis-full sm:basis-0">
                      <div className="text-sm font-medium text-ink break-words">{r.si.name}</div>
                      {r.si.data?.sku && <div className="text-xs text-ink/45 font-mono break-all">{r.si.data.sku}</div>}
                    </div>
                    <div className="min-w-0 flex-1 sm:flex-none sm:w-[250px]">
                      {!r.cur ? <StatusBadge tone="warn">Not set</StatusBadge>
                        : r.cur.own ? <div className="text-sm text-ink">Own packaging <span className="text-ink/45">· no box</span></div>
                        : r.gone ? <StatusBadge tone="warn">Packaging type removed</StatusBadge>
                        : <div className="text-sm text-ink">{r.type.name} <span className="text-ink/45 tabular-nums">· {fmt(typeCost(r.type, stockItems))}</span></div>}
                      {r.cur && <div className="text-xs text-ink/45">from {fmtDate(r.cur.from_date)}</div>}
                      {next && <div className="text-xs text-royal-700">{next.own ? 'Own packaging' : typeOf(next.packaging_id)?.name || 'Another type'} from {fmtDate(next.from_date)}</div>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {r.all.length > 0 && <button className="btn btn-secondary btn-xs" onClick={() => setOpen(o => ({ ...o, [r.si.id]: !o[r.si.id] }))}>{open[r.si.id] ? 'Hide' : 'Dates'}</button>}
                      {canEdit && <button className="btn btn-secondary btn-xs" data-pp-change onClick={() => setForm({ si: r.si, current: r.cur })}>{r.cur ? 'Change' : 'Set'}</button>}
                    </div>
                  </div>
                  {open[r.si.id] && (
                    <ul className="mt-2 rounded-lg bg-ink/[0.03] divide-y divide-ink/5 text-xs">
                      {r.all.map(x => (
                        <li key={x.id} className="px-3 py-2 flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-ink">
                              <b>{fmtDate(x.from_date)}</b> · {x.own ? 'Own packaging' : typeOf(x.packaging_id)?.name || 'A packaging type since removed'}
                              {states.get(x.id) !== 'earlier' && <span className="ml-2 text-ink/45">{states.get(x.id) === 'current' ? 'Current' : 'To come'}</span>}
                            </div>
                            {(x.note || x.by) && <div className="text-ink/50 break-words">{[x.note, x.by && `by ${x.by}`].filter(Boolean).join(' · ')}</div>}
                          </div>
                          {canEdit && <button className="btn btn-secondary btn-xs shrink-0" disabled={busy} onClick={() => remove(x)}>Remove</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {form && <PackForm form={form} packaging={packaging} stockItems={stockItems} today={today} busy={busy} onCancel={() => setForm(null)} onSave={save} />}
    </div>
  )
}

function PackForm({ form, packaging, stockItems, today, busy, onCancel, onSave }) {
  const cur = form.current
  const [pick, setPick] = useState(cur ? (cur.own ? 'own' : cur.packaging_id || '') : '')
  const [from, setFrom] = useState(today)
  const [note, setNote] = useState('')
  const past = from < today
  return (
    <Modal title="Packaging when sent on its own" description={form.si.name} onClose={onCancel}>
      <label className="label" htmlFor="pp-pick">Goes out in</label>
      <select id="pp-pick" className="input text-base sm:text-sm" value={pick} onChange={e => setPick(e.target.value)}>
        <option value="">Choose…</option>
        {packaging.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(typeCost(p, stockItems))}</option>)}
        <option value="own">Own packaging (no box, no cost)</option>
      </select>
      <label className="label mt-3" htmlFor="pp-from">Applies from</label>
      <input id="pp-from" type="date" className="input text-base sm:text-sm" value={from} onChange={e => setFrom(e.target.value || today)} />
      <div className={`text-xs mt-1 ${past ? 'text-warn' : 'text-ink/50'}`}>
        {past ? `Website orders from ${fmtDate(from)} are costed with this.` : 'Earlier days keep what they had.'}
      </div>
      <label className="label mt-3" htmlFor="pp-note">Note (optional)</label>
      <input id="pp-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. now sent in the glass box" />
      <div className="flex gap-2 pt-4">
        <button className="btn btn-secondary flex-1 justify-center" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1 justify-center" data-pp-save disabled={busy || !pick}
          onClick={() => onSave({ stockItemId: form.si.id, packagingId: pick === 'own' ? null : pick, own: pick === 'own', from, note: note.trim() })}>
          {busy ? 'Saving…' : `Save, from ${fmtDate(from)}`}
        </button>
      </div>
    </Modal>
  )
}
