import React, { useState } from 'react'
import ActivityLog from './ActivityLog'
import { SERVICE_LABELS } from '../lib/defaults'
import { Icon, InfoBox, PageHeader, Spinner, StatusBadge, Modal } from './UI'
import { runDbChecks, loadCostVersions, addCostVersions, setCostVersionDate, logActivity, palletQuote } from '../lib/db'
import { MULTI_RULES, carrierChanges, palletChanges, multiExample } from '../lib/costVersions'
import { londonToday, fmtDate } from '../lib/dates'
import { readPalletSheetFile, diffPalletSheets, bandFor } from '../lib/palletSheet'

export default function SettingsPage({ settings, onUpdateSettings, loading = false, me, profiles = [], onSaveProfile, onLoadActivity, onNavigate }) {
  // Edits go into a draft and are saved together, so typing a rate doesn't
  // write to the database on every keystroke — and nothing half-typed goes live
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  React.useEffect(() => { if (!dirty) setDraft(settings) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  // Rates are dated: saving a carrier change asks from when it applies, so the P&L keeps
  // earlier orders at the rates they really cost (an admin can pick a past date)
  const [versions, setVersions] = useState([])
  const [askDate, setAskDate] = useState(null)        // { changes } while choosing the date
  const [palletVersions, setPalletVersions] = useState([])
  const reloadVersions = () => Promise.all([
    loadCostVersions('carrier').then(setVersions).catch(() => setVersions([])),
    loadCostVersions('pallet').then(setPalletVersions).catch(() => setPalletVersions([])),
  ])
  React.useEffect(() => { reloadVersions() }, [])
  const writeSettings = async (changes, from, note) => {
    setSaving(true)
    try {
      const ok = await onUpdateSettings(draft)
      if (ok === false) return
      if (changes?.length) {
        await addCostVersions(changes.map(c => ({ kind: c.kind || 'carrier', ref: c.id, effective_from: from, value: c.value, summary: c.summary, note: note || null, created_by: me?.name || null })))
        changes.forEach(c => logActivity({ user_name: me?.name || null, entity_type: 'settings', entity_id: c.id, entity_name: c.kind === 'pallet' ? 'Pallet carrier rates' : 'Carrier rates',
          action: `Rates apply from ${fmtDate(from)}`, detail: c.summary + (note ? ` · ${note}` : ''), source: 'settings' }))
        await reloadVersions()
      }
      setAskDate(null)
    } finally { setSaving(false) }
  }
  const save = async () => {
    const changes = [...carrierChanges(settings.carriers, draft.carriers), ...palletChanges(settings.palletCarriers, draft.palletCarriers)]
    if (changes.length) setAskDate({ changes })
    else await writeSettings([], null)
  }
  const [tab, setTab] = useState('carriers')
  const tabs = [
    { id: 'carriers', label: 'Carriers' },
    { id: 'pallets', label: 'Pallet carriers' },
    { id: 'packaging', label: 'Packaging' },
    { id: 'routing', label: 'Smart Routing' },
    { id: 'team', label: 'Your profile' },
    { id: 'activity', label: 'Activity' },
    ...(me?.role === 'admin' ? [{ id: 'checks', label: 'Database checks' }] : []),
  ]

  if (loading) return <Spinner />

  return (
    <div>
      <PageHeader
        eyebrow="Tools / costs"
        title="Cost Settings"
        description="Carrier rates, packaging costs and routing rules that every listing's margin is calculated from — plus your team profile and the activity log."
      />

      <div className="flex gap-5 border-b border-rule mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && <TeamSettings me={me} profiles={profiles} onSaveProfile={onSaveProfile} />}
      {tab === 'activity' && <ActivityLog onLoad={onLoadActivity} />}
      {tab === 'checks' && <DbChecks />}
      {dirty && (
        <div className="sticky top-2 z-20 mb-4 p-3 rounded-card border border-warn/40 bg-white shadow-lift flex items-center justify-between gap-3 flex-wrap" role="status">
          <span className="text-sm font-medium text-ink">Unsaved changes — these rates aren't used until you save</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setDraft(settings)} disabled={saving}>Discard</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}
      {tab === 'carriers' && <CarriersSettings settings={draft} onUpdateSettings={setDraft} versions={versions} me={me} onVersionsChanged={reloadVersions} />}
      {tab === 'pallets' && <PalletSettings settings={draft} saved={settings} onUpdateSettings={setDraft} versions={palletVersions} me={me} onVersionsChanged={reloadVersions} />}
      {askDate && <RatesFromModal changes={askDate.changes} saving={saving} isAdmin={me?.role === 'admin'}
        onCancel={() => setAskDate(null)} onSave={(from, note) => writeSettings(askDate.changes, from, note)} />}
      {tab === 'packaging' && <PackagingSettings settings={draft} onNavigate={onNavigate} />}
      {tab === 'routing' && <RoutingSettings settings={draft} onUpdateSettings={setDraft} />}
    </div>
  )
}

function CarriersSettings({ settings, onUpdateSettings, versions = [], me, onVersionsChanged }) {
  const { carriers } = settings
  const [selCarrier, setSelCarrier] = useState(Object.keys(carriers)[0])
  const [editingName, setEditingName] = useState(false)
  const carrier = carriers[selCarrier]

  const updateCarrier = (c) => onUpdateSettings({ ...settings, carriers: { ...carriers, [selCarrier]: c } })
  const toggleService = (sl) => updateCarrier({ ...carrier, services: { ...carrier.services, [sl]: !carrier.services?.[sl] } })
  const updateRate = (catId, sl, val) => updateCarrier({
    ...carrier,
    categories: carrier.categories.map((c) => c.id === catId ? { ...c, rates: { ...c.rates, [sl]: parseFloat(val) || 0 } } : c),
  })
  const updateCatField = (catId, field, val) => updateCarrier({
    ...carrier,
    categories: carrier.categories.map((c) => c.id === catId ? { ...c, [field]: field === 'maxKg' ? parseFloat(val) || 0 : val } : c),
  })
  const addCat = () => updateCarrier({
    ...carrier,
    categories: [...carrier.categories, { id: 'c' + Date.now(), name: 'New category', maxKg: 0, rates: { standard: 0, nextday: 0, prime: 0 } }],
  })
  const delCat = (id) => updateCarrier({ ...carrier, categories: carrier.categories.filter((c) => c.id !== id) })

  const addCarrier = () => {
    const id = 'carrier_' + Date.now()
    const newCarrier = { name: 'New Carrier', maxWeight: 30, services: { standard: true, nextday: false, prime: false }, categories: [] }
    onUpdateSettings({ ...settings, carriers: { ...carriers, [id]: newCarrier } })
    setSelCarrier(id)
    setEditingName(true)
  }

  const deleteCarrier = () => {
    if (!window.confirm(`Delete ${carrier.name}? This cannot be undone.`)) return
    const updated = { ...carriers }
    delete updated[selCarrier]
    onUpdateSettings({ ...settings, carriers: updated })
    setSelCarrier(Object.keys(updated)[0] || '')
  }

  const enabledServices = Object.entries(SERVICE_LABELS).filter(([sl]) => carrier && carrier.services?.[sl])

  if (!carrier) return null

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {Object.entries(carriers).map(([id, c]) => (
          <button key={id} className={`btn ${selCarrier === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSelCarrier(id); setEditingName(false) }}>
            {c.name}
          </button>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={addCarrier}>+ Add carrier</button>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                autoFocus
                value={carrier.name}
                onChange={(e) => updateCarrier({ ...carrier, name: e.target.value })}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                className="input font-semibold text-base"
                style={{ width: 180 }}
              />
            ) : (
              <div
                className="font-semibold text-base text-ink cursor-pointer hover:text-royal-600" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (() => setEditingName(true))() } }} onClick={() => setEditingName(true)}
                title="Click to rename"
              >
                {carrier.name} <Icon name="edit" size={13} className="inline ml-1 text-ink/35" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-ink/55">Max weight (kg)</label>
            <input
              type="number"
              value={carrier.maxWeight}
              onChange={(e) => updateCarrier({ ...carrier, maxWeight: parseFloat(e.target.value) || 0 })}
              className="input text-sm"
              style={{ width: 80 }}
            />
            <button className="btn btn-danger btn-sm" onClick={deleteCarrier}><Icon name="trash" size={13} /> Delete carrier</button>
          </div>
        </div>

        <div className="mb-5">
          <div className="text-xs font-medium text-ink/55 mb-2">Enabled services</div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(SERVICE_LABELS).map(([sl, label]) => (
              <label key={sl} className="flex items-center gap-2 cursor-pointer text-sm text-ink/70">
                <input type="checkbox" checked={!!carrier.services?.[sl]} onChange={() => toggleService(sl)} className="w-4 h-4 accent-royal-500" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th className="text-left py-2 text-xs font-semibold text-ink/45 pr-3">Category name</th>
                <th className="text-left py-2 text-xs font-semibold text-ink/45 pr-3">Max kg</th>
                {enabledServices.map(([sl, label]) => (
                  <th key={sl} className="text-left py-2 text-xs font-semibold text-ink/45 pr-3">{label} £</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carrier.categories.map((cat) => (
                <tr key={cat.id} className="border-b border-rule/60">
                  <td className="py-2 pr-3">
                    <input value={cat.name} onChange={(e) => updateCatField(cat.id, 'name', e.target.value)} className="input text-sm w-full sm:w-[160px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="number" value={cat.maxKg} onChange={(e) => updateCatField(cat.id, 'maxKg', e.target.value)} className="input text-sm w-full sm:w-[70px]" />
                  </td>
                  {enabledServices.map(([sl]) => (
                    <td key={sl} className="py-2 pr-3">
                      <input type="number" value={cat.rates[sl] || 0} onChange={(e) => updateRate(cat.id, sl, e.target.value)} className="input text-sm w-full sm:w-[80px]" />
                    </td>
                  ))}
                  <td className="py-2">
                    <button className="btn btn-danger btn-xs" onClick={() => delCat(cat.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary btn-sm mt-4" onClick={addCat}>+ Add weight category</button>

        <MultiParcel carrier={carrier} onChange={updateCarrier} />
        <HelmServices carrier={carrier} onChange={updateCarrier} />
      </div>
      <RateHistory versions={versions.filter(v => v.ref === selCarrier)} me={me} onChanged={onVersionsChanged} />
    </div>
  )
}

/** More than one parcel in an order: DHL charges first + subsequent, DPD single or multi */
function MultiParcel({ carrier, onChange }) {
  const m = carrier.multi || { rule: 'same' }
  const set = (patch) => onChange({ ...carrier, multi: { ...m, ...patch } })
  return (
    <div className="mt-6 pt-5 border-t border-rule">
      <div className="text-sm font-semibold text-ink">More than one parcel in an order</div>
      <div className="text-xs text-ink/55 mt-0.5 mb-3">How {carrier.name} charges when one order goes as 2 or more parcels. Used for 2-parcel listings in the Calculator and, in the P&L, for the parcels each order actually went in.</div>
      <div className="space-y-2">
        {MULTI_RULES.map(r => (
          <label key={r.id} className="flex items-start gap-2.5 cursor-pointer text-sm text-ink/80">
            <input type="radio" name={`multi-${carrier.name}`} className="mt-1 accent-royal-500" checked={(m.rule || 'same') === r.id} onChange={() => set({ rule: r.id })} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      {(m.rule === 'subsequent' || m.rule === 'all') && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <label className="text-xs text-ink/55" htmlFor="multi-rate">{m.rule === 'subsequent' ? 'Each extra parcel £' : 'Each parcel when 2 or more £'}</label>
          <input id="multi-rate" type="number" step="0.01" min="0" className="input text-sm w-[100px]" value={m.rate ?? ''} onChange={e => set({ rate: parseFloat(e.target.value) || 0 })} />
          <span className="text-xs text-ink/45">Same at every weight</span>
        </div>
      )}
      <div className="text-xs text-royal-700 mt-2">{multiExample(carrier)}</div>
    </div>
  )
}

/** The HELM services these rates are for, so the P&L can cost the parcels HELM actually booked */
function HelmServices({ carrier, onChange }) {
  const list = carrier.helmServices || []
  const [name, setName] = useState('')
  const set = (next) => onChange({ ...carrier, helmServices: next })
  return (
    <div className="mt-6 pt-5 border-t border-rule">
      <div className="text-sm font-semibold text-ink">HELM services</div>
      <div className="text-xs text-ink/55 mt-0.5 mb-3">The service names HELM books labels on for {carrier.name}, and which of the rates above each one costs.</div>
      {list.length === 0 && <div className="text-xs text-ink/45 mb-2">None yet.</div>}
      <div className="space-y-2">
        {list.map((h, i) => (
          <div key={h.name} className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink min-w-[200px]">{h.name}</span>
            <select className="input text-sm w-auto" value={h.service} onChange={e => set(list.map((x, j) => j === i ? { ...x, service: e.target.value } : x))}>
              {Object.entries(SERVICE_LABELS).filter(([sl]) => carrier.services?.[sl]).map(([sl, label]) => <option key={sl} value={sl}>{label} rate</option>)}
            </select>
            <button className="btn btn-danger btn-xs" aria-label={`Remove ${h.name}`} onClick={() => set(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <input className="input text-sm max-w-[260px]" placeholder="Service name, exactly as in HELM" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-secondary btn-sm" disabled={!name.trim() || list.some(h => h.name.toLowerCase() === name.trim().toLowerCase())}
          onClick={() => { set([...list, { name: name.trim(), service: carrier.services?.nextday ? 'nextday' : 'standard' }]); setName('') }}>Add</button>
      </div>
    </div>
  )
}

/** Every saved version of this carrier's rates and the date each applies from */
function RateHistory({ versions, me, onChanged }) {
  const isAdmin = me?.role === 'admin'
  const [editing, setEditing] = useState(null)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  if (!versions.length) return null
  return (
    <div className="card mt-4">
      <div className="text-sm font-semibold text-ink">Rate history</div>
      <div className="text-xs text-ink/55 mt-0.5 mb-3">Each order in the P&L is costed at the rates in force on its date.{isAdmin ? ' Change a date if a rate really started earlier or later.' : ''}</div>
      <div className="divide-y divide-rule/70">
        {versions.map(v => (
          <div key={v.id} className="py-2.5 flex items-start gap-3 flex-wrap">
            <div className="min-w-[120px]">
              <div className="text-sm font-semibold text-ink tabular-nums">From {fmtDate(v.effective_from)}</div>
              <div className="text-[11px] text-ink/45">Saved {fmtDate(v.created_at)}{v.created_by ? ` by ${v.created_by}` : ''}</div>
            </div>
            <div className="flex-1 min-w-[220px] text-sm text-ink/75">
              {v.summary}{v.note ? <span className="text-ink/50"> · {v.note}</span> : null}
              {(v.history || []).map((h, i) => <div key={i} className="text-[11px] text-ink/45">Date moved {fmtDate(h.from)} → {fmtDate(h.to)} by {h.by || 'someone'} on {fmtDate(h.at)}</div>)}
            </div>
            {isAdmin && (editing === v.id ? (
              <div className="flex items-center gap-2">
                <input type="date" className="input text-sm w-auto" value={date} max={londonToday()} onChange={e => setDate(e.target.value)} aria-label="Applies from" />
                <button className="btn btn-primary btn-xs" disabled={!date || busy} onClick={async () => {
                  setBusy(true)
                  try {
                    await setCostVersionDate(v, date, me?.name || null)
                    logActivity({ user_name: me?.name || null, entity_type: 'settings', entity_id: v.ref, entity_name: 'Carrier rates', action: `Rates date moved to ${fmtDate(date)}`, detail: `${v.summary} (was from ${fmtDate(v.effective_from)})`, source: 'settings' })
                    setEditing(null); await onChanged?.()
                  } finally { setBusy(false) }
                }}>Save date</button>
                <button className="btn btn-secondary btn-xs" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-xs" onClick={() => { setEditing(v.id); setDate(v.effective_from) }}>Change date</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Saving changed rates: from when do they apply? Today unless an admin picks an earlier date */
function RatesFromModal({ changes, saving, isAdmin, onCancel, onSave }) {
  const today = londonToday()
  const [from, setFrom] = useState(today)
  const [note, setNote] = useState('')
  const past = from < today
  return (
    <Modal title="When do these rates apply from?" description="Orders before this date keep the rates they were costed at." onClose={onCancel}>
      <div className="space-y-1.5 mb-4">
        {changes.map(c => <div key={`${c.kind || 'carrier'}-${c.id}`} className="text-sm text-ink/75">• {c.summary}</div>)}
      </div>
      <label className="label" htmlFor="rates-from">Applies from</label>
      <input id="rates-from" type="date" className="input text-base sm:text-sm" value={from} max={today} disabled={!isAdmin} onChange={e => setFrom(e.target.value || today)} />
      {!isAdmin && <div className="text-xs text-ink/45 mt-1">Only an admin can set an earlier date.</div>}
      {past && <div className="text-xs text-warn mt-1">Orders from {fmtDate(from)} onwards will be re-costed at these rates in the P&L.</div>}
      <label className="label mt-3" htmlFor="rates-note">Note (optional)</label>
      <input id="rates-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. DHL price rise letter" />
      <div className="flex gap-2 pt-4">
        <button className="btn btn-secondary flex-1 justify-center" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary flex-1 justify-center" disabled={saving} onClick={() => onSave(from, note.trim())}>{saving ? 'Saving…' : `Save, from ${fmtDate(from)}`}</button>
      </div>
    </Modal>
  )
}

/**
 * Pallet carriers (v2.77.0): Farrall's price sheet. A price per postcode band, service and pallet size or count;
 * pallets are worked out from the order's weight; the fuel surcharge is a % on top. Saving a change asks from when it
 * applies, like parcel carrier rates, so earlier orders keep what they really cost.
 */
function PalletSettings({ settings, saved, onUpdateSettings, versions = [], me, onVersionsChanged }) {
  const carriers = settings.palletCarriers || {}
  const ids = Object.keys(carriers)
  const [sel, setSel] = useState(ids[0] || '')
  const c = carriers[sel]
  const [showRates, setShowRates] = useState(false)
  const [q, setQ] = useState({ postcode: '', kg: '', service: '' })
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [sheet, setSheet] = useState(null)          // a new price sheet being checked: { reading } | { error } | { title, bands, problems, diff }
  const fileRef = React.useRef(null)
  const isAdmin = me?.role === 'admin'
  if (!c) return <div className="card text-sm text-ink/60">No pallet carrier is set up yet.</div>
  const update = (patch) => onUpdateSettings({ ...settings, palletCarriers: { ...carriers, [sel]: { ...c, ...patch } } })
  const setSize = (id, maxKg) => update({ sizes: c.sizes.map(s => (s.id === id ? { ...s, maxKg: parseFloat(maxKg) || 0 } : s)) })
  const unsaved = JSON.stringify(saved?.palletCarriers?.[sel]) !== JSON.stringify(c)
  const services = [...new Set(c.bands.flatMap(b => Object.keys(b.rates || {})))].sort()
  const cols = [c.sizes[0]?.label || 'Quarter', c.sizes[1]?.label || 'Half', c.sizes[2]?.label || 'Full', '2 pallets', '3 pallets', '4 pallets', '5 pallets', 'Each, over 5']
  const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`)
  const price = async () => {
    setQuoting(true); setQuote(null)
    try { setQuote(await palletQuote(q.postcode.trim(), parseFloat(q.kg) || 0, q.service || null)) }
    catch (e) { setQuote({ ok: false, why: e?.message || 'Couldn’t price it' }) }
    finally { setQuoting(false) }
  }
  const readSheet = async (file) => {
    if (!file) return
    setSheet({ reading: true, name: file.name })
    try {
      const r = await readPalletSheetFile(file)
      setSheet({ ...r, name: file.name, diff: diffPalletSheets(c.bands, r.bands) })
    } catch (e) { setSheet({ error: e?.message || 'Couldn’t read that file', name: file.name }) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const useSheet = () => { update({ bands: sheet.bands, sheet: sheet.title }); setSheet(null); setShowRates(true) }
  return (
    <div>
      {ids.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {ids.map(id => <button key={id} className={`btn btn-sm ${id === sel ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSel(id)}>{carriers[id].name}</button>)}
        </div>
      )}
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-semibold text-ink">{c.name}</div>
            <div className="text-xs text-ink/55 mt-0.5">Pallet deliveries · prices from “{c.sheet}” · {c.bands.length} postcode bands</div>
          </div>
          {isAdmin && (
            <div>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => readSheet(e.target.files?.[0])} aria-label="New price sheet (PDF)" />
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} /> Upload a new price sheet</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="label" htmlFor="pal-fuel">Fuel surcharge (%)</label>
            <input id="pal-fuel" type="number" min="0" step="0.5" inputMode="decimal" className="input text-base sm:text-sm w-32" value={c.fuelPct ?? 0}
              onChange={e => update({ fuelPct: parseFloat(e.target.value) || 0 })} />
            <div className="text-xs text-ink/50 mt-1">Added on top of every pallet price. When you save a change you choose the date it applies from.</div>
          </div>
          <div>
            <label className="label" htmlFor="pal-svc">Usual service</label>
            <select id="pal-svc" className="input text-base sm:text-sm w-32" value={c.defaultService || '24hr'} onChange={e => update({ defaultService: e.target.value })}>
              {services.filter(s => s !== '72hr').map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="text-xs text-ink/50 mt-1">Where a postcode has no price for it, the next fastest service is used.</div>
          </div>
        </div>
        <div className="mt-5">
          <div className="text-sm font-semibold text-ink">Pallets from the weight</div>
          <div className="text-xs text-ink/55 mt-0.5 mb-2">A standard pallet (1.2m × 1m). Over a full pallet’s weight, the order goes on 2, 3… pallets.</div>
          <div className="flex flex-wrap gap-3">
            {c.sizes.map(s => (
              <div key={s.id}>
                <label className="label" htmlFor={`pal-${s.id}`}>{s.label} — up to (kg)</label>
                <input id={`pal-${s.id}`} type="number" min="0" inputMode="decimal" className="input text-base sm:text-sm w-32" value={s.maxKg} onChange={e => setSize(s.id, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="text-sm font-semibold text-ink">Price a pallet</div>
        <div className="text-xs text-ink/55 mt-0.5 mb-3">{unsaved ? 'Uses the saved settings — save your changes first to price with them.' : 'Check a postcode and weight against the price sheet.'}</div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="pq-pc">Postcode</label><input id="pq-pc" className="input text-base sm:text-sm w-32 uppercase" value={q.postcode} onChange={e => setQ({ ...q, postcode: e.target.value })} placeholder="M14 5AB" /></div>
          <div><label className="label" htmlFor="pq-kg">Weight (kg)</label><input id="pq-kg" type="number" min="0" inputMode="decimal" className="input text-base sm:text-sm w-28" value={q.kg} onChange={e => setQ({ ...q, kg: e.target.value })} placeholder="500" /></div>
          <div><label className="label" htmlFor="pq-svc">Service</label>
            <select id="pq-svc" className="input text-base sm:text-sm w-28" value={q.service} onChange={e => setQ({ ...q, service: e.target.value })}>
              <option value="">Usual</option>{services.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <button className="btn btn-secondary" disabled={quoting || q.postcode.trim().length < 2 || !(parseFloat(q.kg) > 0)} onClick={price}>{quoting ? 'Pricing…' : 'Price it'}</button>
        </div>
        {quote && (quote.ok ? (
          <div className="mt-3 text-sm text-ink" aria-live="polite">
            <b className="tabular-nums">{money(quote.total)}</b> — {quote.size}, {quote.service}, band {quote.band}
            <span className="text-ink/55"> · {money(quote.base)} + {quote.fuel_pct}% fuel ({money(quote.fuel)})</span>
          </div>
        ) : <div className="mt-3 text-sm text-loss" role="alert">{quote.why}</div>)}
      </div>

      <div className="card mt-4">
        <button className="flex items-center justify-between w-full text-left" onClick={() => setShowRates(v => !v)} aria-expanded={showRates}>
          <span><span className="text-sm font-semibold text-ink">Price sheet</span>
            <span className="block text-xs text-ink/55 mt-0.5">Before the fuel surcharge. To change the prices, upload the carrier’s new sheet (PDF) above.</span></span>
          <Icon name={showRates ? 'chevronDown' : 'chevronRight'} size={16} />
        </button>
        {showRates && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs tabular-nums">
              <thead><tr className="text-left text-ink/50">
                <th className="py-1.5 pr-3 font-medium">Band</th><th className="py-1.5 pr-3 font-medium">Postcodes</th><th className="py-1.5 pr-3 font-medium">Service</th>
                {cols.map(h => <th key={h} className="py-1.5 pl-3 font-medium text-right whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {c.bands.flatMap(b => Object.entries(b.rates || {}).sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([svc, r], i) => (
                  <tr key={`${b.id}-${svc}`} className={i === 0 ? 'border-t border-rule/70' : ''}>
                    <td className="py-1.5 pr-3 font-semibold text-ink align-top">{i === 0 ? b.id : ''}</td>
                    <td className="py-1.5 pr-3 text-ink/65 align-top max-w-[260px]">{i === 0 ? b.postcodes : ''}</td>
                    <td className="py-1.5 pr-3 text-ink/65">{svc}</td>
                    {r ? r.map((v, k) => <td key={k} className="py-1.5 pl-3 text-right text-ink/80">{money(v)}</td>)
                      : <td colSpan={8} className="py-1.5 pl-3 text-right text-ink/45">Price on application</td>}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <RateHistory versions={versions.filter(v => v.ref === sel)} me={me} onChanged={onVersionsChanged} />
      {sheet && <SheetReview sheet={sheet} current={c} cols={cols} onCancel={() => setSheet(null)} onUse={useSheet} />}
    </div>
  )
}

/**
 * A new price sheet, read and checked before it's used: how many bands, what moved against the prices in use, a few
 * postcodes priced both ways, and anything that couldn't be read. Nothing is saved here — "Use these prices" puts them
 * in the unsaved changes, and saving asks the date they apply from (so earlier orders keep the old prices).
 */
function SheetReview({ sheet, current, cols, onCancel, onUse }) {
  const money = (n) => (n == null ? 'P.O.A' : `£${Number(n).toFixed(2)}`)
  if (sheet.reading) return <Modal title="Reading the price sheet…" description={sheet.name} onClose={onCancel}><Spinner /></Modal>
  if (sheet.error) return (
    <Modal title="Couldn’t read that file" description={sheet.name} onClose={onCancel}>
      <div className="text-sm text-loss" role="alert">{sheet.error}</div>
      <div className="text-xs text-ink/55 mt-2">It needs to be the carrier’s price sheet as a PDF with text in it (not a photo or scan).</div>
      <div className="pt-4"><button className="btn btn-secondary w-full justify-center" onClick={onCancel}>Close</button></div>
    </Modal>
  )
  const d = sheet.diff, bad = sheet.problems.length > 0 || sheet.bands.length < 10
  const svc = current.defaultService || '24hr'
  const samples = ['TF9 2DU', 'M14 5AB', 'B1 1AA', 'SW11 2AB', 'EH1 1AA', 'CF10 1AA'].map(pc => {
    const o = bandFor(current.bands, pc), n = bandFor(sheet.bands, pc)
    const pick = (b) => (b ? (b.rates?.[svc] || Object.values(b.rates || {}).find(Boolean) || null) : null)
    return { pc, from: pick(o)?.[2] ?? null, to: pick(n)?.[2] ?? null, band: n?.id || '—' }
  })
  return (
    <Modal title={bad ? 'This sheet can’t be used yet' : 'Check the new price sheet'} description={`${sheet.title} · ${sheet.bands.length} postcode bands read from ${sheet.name}`} onClose={onCancel} maxWidth="max-w-2xl">
      {sheet.problems.length > 0 && (
        <div className="rounded-card border border-loss/40 bg-loss/5 p-3 mb-3" role="alert">
          <div className="text-sm font-semibold text-ink">Couldn’t read all of it — nothing has been changed</div>
          <ul className="text-xs text-ink/70 mt-1 space-y-0.5 list-disc pl-4">{sheet.problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
          {sheet.problems.length > 12 && <div className="text-xs text-ink/50 mt-1">…and {sheet.problems.length - 12} more</div>}
        </div>
      )}
      {!bad && (d.identical ? <div className="text-sm text-ink/70">These are the same prices as the ones in use. Nothing to change.</div> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[['Prices up', d.up], ['Prices down', d.down], ['Unchanged', d.same], ['Average move', `${d.avgPct >= 0 ? '+' : ''}${d.avgPct.toFixed(1)}%`]].map(([k, v]) => (
              <div key={k} className="rounded-card border border-rule bg-white p-2.5"><div className="text-base font-semibold text-ink tabular-nums">{v}</div><div className="text-[11px] text-ink/50">{k}</div></div>
            ))}
          </div>
          {(d.added.length > 0 || d.removed.length > 0 || d.postcodes > 0) && (
            <div className="text-xs text-warn">
              {[d.added.length && `New bands: ${d.added.join(', ')}`, d.removed.length && `Bands no longer on the sheet: ${d.removed.join(', ')}`, d.postcodes && `${d.postcodes} band${d.postcodes === 1 ? ' has' : 's have'} different postcodes`].filter(Boolean).join(' · ')}
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-ink mb-1">A full pallet, {svc}, before fuel</div>
            <table className="w-full text-xs tabular-nums">
              <thead><tr className="text-left text-ink/50"><th className="py-1 font-medium">To</th><th className="py-1 font-medium">Band</th><th className="py-1 font-medium text-right">Now</th><th className="py-1 font-medium text-right">New sheet</th></tr></thead>
              <tbody>{samples.map(s => (
                <tr key={s.pc} className="border-t border-rule/70"><td className="py-1 text-ink/80">{s.pc}</td><td className="py-1 text-ink/60">{s.band}</td>
                  <td className="py-1 text-right text-ink/60">{money(s.from)}</td><td className={`py-1 text-right ${s.to !== s.from ? 'font-semibold text-ink' : 'text-ink/60'}`}>{money(s.to)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {d.moves.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-ink mb-1">Biggest changes</div>
              <div className="text-xs text-ink/70 space-y-0.5 tabular-nums">
                {d.moves.slice(0, 6).map((m, i) => <div key={i}>Band {m.id}, {m.svc}{m.col != null ? `, ${cols[m.col]}` : ''}: {m.col != null ? `${money(m.from)} → ${money(m.to)} (${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}%)` : `${m.from} → ${m.to}`}</div>)}
              </div>
            </div>
          )}
          <div className="text-xs text-ink/55">Nothing is saved yet. “Use these prices” adds them to your unsaved changes; when you save, you choose the date they apply from. The fuel surcharge stays as it is.</div>
        </div>
      ))}
      <div className="flex gap-2 pt-4">
        <button className="btn btn-secondary flex-1 justify-center" onClick={onCancel}>{bad || d.identical ? 'Close' : 'Cancel'}</button>
        {!bad && !d.identical && <button className="btn btn-primary flex-1 justify-center" onClick={onUse}>Use these prices</button>}
      </div>
    </Modal>
  )
}

function PackagingSettings({ settings, onNavigate }) {
  const n = (settings?.packaging || []).length
  return (
    <div className="card flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div className="font-semibold">Packaging types</div>
        <div className="text-sm text-ink/60 mt-0.5">{n} type{n !== 1 ? 's' : ''}. They’re built on the Packaging page now, from real packaging items — so their cost is worked out, not typed in.</div>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('packaging')}>Open Packaging</button>
    </div>
  )
}

function RoutingSettings({ settings, onUpdateSettings }) {
  const { routingRules, carriers } = settings
  const svcLabels = { standard: 'Standard', nextday: 'Next Day', prime: 'Prime' }

  const updateRules = (rules) => onUpdateSettings({ ...settings, routingRules: rules })
  const addRule = () => updateRules([...routingRules, {
    id: 'r' + Date.now(), priority: routingRules.length + 1,
    serviceLevel: 'standard', letterbox: false, weightMax: 2, carrierId: Object.keys(carriers)[0],
  }])
  const updateRule = (id, k, v) => updateRules(routingRules.map((r) => r.id === id ? { ...r, [k]: v } : r))
  const delRule = (id) => updateRules(routingRules.filter((r) => r.id !== id).map((r, i) => ({ ...r, priority: i + 1 })))
  const moveUp = (id) => {
    const idx = routingRules.findIndex((r) => r.id === id)
    if (idx === 0) return
    const arr = [...routingRules];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
    updateRules(arr.map((r, i) => ({ ...r, priority: i + 1 })))
  }
  const moveDown = (id) => {
    const idx = routingRules.findIndex((r) => r.id === id)
    if (idx === routingRules.length - 1) return
    const arr = [...routingRules];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
    updateRules(arr.map((r, i) => ({ ...r, priority: i + 1 })))
  }

  return (
    <div>
      <div className="card mb-4">
        <InfoBox title="Routing logic">Rules are applied in priority order. The tool selects the cheapest eligible carrier that matches; the calculator can still override the recommendation.</InfoBox>
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold">Routing rules</div>
          <button className="btn btn-secondary btn-sm" onClick={addRule}>+ Add rule</button>
        </div>

        <div className="space-y-3">
          {routingRules.map((rule) => (
            <div key={rule.id} className="border border-rule rounded-[6px] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-royal-500">Priority {rule.priority}</span>
                <div className="flex gap-1">
                  <button className="btn btn-xs btn-secondary" onClick={() => moveUp(rule.id)}>↑</button>
                  <button className="btn btn-xs btn-secondary" onClick={() => moveDown(rule.id)}>↓</button>
                  <button className="btn btn-danger btn-xs" onClick={() => delRule(rule.id)}>✕</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-end">
                <div style={{ minWidth: 120 }}>
                  <label className="label">Service level</label>
                  <select value={rule.serviceLevel} onChange={(e) => updateRule(rule.id, 'serviceLevel', e.target.value)} className="input text-sm">
                    {Object.entries(svcLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <label className="label">Max weight (kg)</label>
                  <input type="number" value={rule.weightMax} onChange={(e) => updateRule(rule.id, 'weightMax', parseFloat(e.target.value) || 0)} className="input text-sm" />
                </div>
                <div style={{ minWidth: 140 }}>
                  <label className="label">Use carrier</label>
                  <select value={rule.carrierId} onChange={(e) => updateRule(rule.id, 'carrierId', e.target.value)} className="input text-sm">
                    {Object.entries(carriers).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="pb-1">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-ink/70">
                    <input type="checkbox" checked={!!rule.letterbox} onChange={(e) => updateRule(rule.id, 'letterbox', e.target.checked)} className="w-4 h-4 accent-royal-500" />
                    Letterbox only
                  </label>
                </div>
              </div>
            </div>
          ))}
          {routingRules.length === 0 && (
            <div className="text-center py-8 text-ink/45 text-sm">No rules yet — add one to enable smart carrier selection</div>
          )}
        </div>
      </div>
    </div>
  )
}


function TeamSettings({ me, profiles = [], onSaveProfile }) {
  const [name, setName] = React.useState(me?.name || '')
  const [role, setRole] = React.useState(me?.role || 'member')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { setName(me?.name || ''); setRole(me?.role || 'member') }, [me])

  const save = async () => {
    setSaving(true)
    await onSaveProfile(name.trim(), me?.role || 'member')
    setSaving(false)
  }

  const changed = name.trim() !== (me?.name || '')

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="text-sm font-semibold text-ink/80 mb-1">Your profile</div>
        <div className="text-xs text-ink/45 mb-4">
          Your name is recorded against everything you do — products you add, listings you push
          live, prices and costs you change.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Display name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Taimoor" />
          </div>
          <div>
            <label className="label">Role</label>
            <div className="input bg-paper text-ink/70 flex items-center justify-between">
              <span>{{ admin: 'Admin', manager: 'Manager', hunter: 'Product hunter' }[role] || 'Custom access'}</span>
              <span className="text-xs text-ink/45">set by an admin</span>
            </div>
            <div className="text-xs text-ink/45 mt-1">Your role and sections are managed in Team &amp; Access.</div>
          </div>
        </div>

        <div className="text-xs text-ink/45 mt-3">Signed in as {me?.email}</div>

        {changed && (
          <button className="btn btn-primary btn-sm mt-3" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        )}
      </div>

      <div className="card">
        <div className="text-sm font-semibold text-ink/80 mb-1">Team</div>
        <div className="text-xs text-ink/45 mb-3">
          Everyone who has set up a profile. Add new logins in Supabase under Authentication → Users.
        </div>
        {profiles.length === 0 ? (
          <div className="text-sm text-ink/45">No profiles set up yet</div>
        ) : (
          <div className="space-y-1.5">
            {profiles.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-paper rounded-[5px]">
                <div className="text-sm font-medium text-ink/80">
                  {p.display_name || 'Unnamed'}
                  {p.id === me?.id && <span className="text-xs text-royal-500 ml-2">you</span>}
                </div>
                <span className="text-xs font-medium text-ink/55 bg-white px-2 py-0.5 rounded-full border border-rule">
                  {p.role || 'member'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The database checking itself: are the numbers consistent, and do the key jobs (saving and cancelling orders,
 * Goods In following a PO, stock and alerts, who sees costs) still work? The work checks are really done, then
 * undone. It also runs every morning at 6:15 and messages Taimoor only if something fails.
 */
function DbChecks() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(null)
  const run = async () => {
    setBusy(true); setErr('')
    try { setRows(await runDbChecks()); setAt(new Date()) } catch (e) { setErr(e?.message || 'Couldn’t run the checks') } finally { setBusy(false) }
  }
  React.useEffect(() => { run() }, [])
  const bad = (rows || []).filter(r => !r.ok)
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="title-case text-sm font-semibold text-ink">Database checks</div>
          <div className="text-xs text-ink/55">Runs every morning at 6:15 — you get a ClickUp message only if something fails. Nothing is changed by running it.</div>
        </div>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={run}><Icon name="check" size={13} /> {busy ? "Checking…" : "Run again"}</button>
      </div>
      {err && <div className="text-sm text-loss mb-2">{err}</div>}
      {!rows ? <Spinner /> : (
        <>
          <div className={`text-sm font-medium mb-2 ${bad.length ? 'text-loss' : 'text-gain'}`}>
            {bad.length ? `${bad.length} of ${rows.length} checks need a look` : `All ${rows.length} checks passed`}{at ? ` · ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
          <div className="divide-y divide-rule/70 border border-rule rounded-[6px] overflow-hidden">
            {rows.map((r, i) => (
              <div key={i} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0"><div className="text-ink">{r.name}</div>{r.detail && <div className="text-xs text-ink/55">{r.detail}</div>}</div>
                <StatusBadge tone={r.ok ? 'live' : 'alert'}>{r.ok ? 'OK' : 'Check'}</StatusBadge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
