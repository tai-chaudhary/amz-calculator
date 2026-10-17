import React, { useState, useMemo } from 'react'
import { Icon, Modal, StatusBadge } from './UI'
import {
  cleanLocation, locationProblem, byLocation, ADD_REASONS, REMOVE_REASONS, needsNote, fmtUnits, matchesProduct,
} from '../lib/inventory'
import { invMove, invAdjust, invSetCount } from '../lib/db'

export const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
export const rememberedWho = () => { try { return localStorage.getItem('sr-who') || '' } catch { return '' } }
export const rememberWho = (n) => { try { if (n) localStorage.setItem('sr-who', n) } catch { /* fine */ } }

/** Who's doing it — the warehouse shares one login, so it's asked and remembered on the phone. */
export function useWho(me, people, office) {
  const start = office ? me?.name || '' : (people.includes(rememberedWho()) ? rememberedWho() : people.includes(me?.name) ? me?.name : '')
  const [who, setWho] = useState(start)
  return [who, (n) => { setWho(n); rememberWho(n) }]
}

export function WhoSelect({ people, value, onChange, office, me, label = 'Who’s doing it?', id = 'inv-who' }) {
  const names = office && me?.name && !people.includes(me.name) ? [me.name, ...people] : people
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input text-base sm:text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose your name</option>
        {names.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  )
}

export function PickBadge({ pickable }) {
  return pickable ? <StatusBadge tone="brand">Pick</StatusBadge> : <StatusBadge tone="quiet">Overflow</StatusBadge>
}

export function HelmFlag({ p }) {
  if (p.in_helm) return null
  return <StatusBadge tone="paused">Add to HELM</StatusBadge>
}

/** A shelf typed in: tidied as you go, checked, with the product's own shelves to tap. */
export function LocationInput({ value, onChange, suggestions = [], locations = [], id = 'inv-loc', label = 'Shelf', autoFocus, exclude }) {
  const clean = cleanLocation(value)
  const problem = value ? locationProblem(value) : null
  const known = clean && locations.find(l => l.code === clean)
  const chips = suggestions.filter(s => s.code !== exclude)
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {chips.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {chips.map(s => (
            <button key={s.code} type="button" onClick={() => onChange(s.code)}
              className={`px-2.5 py-1.5 rounded-[5px] border text-xs tabular-nums ${clean === s.code ? 'border-royal-500 bg-royal-500 text-white' : 'border-rule bg-white text-ink hover:border-royal-300'}`}>
              <b>{s.code}</b>{s.qty != null ? ` · ${fmtUnits(s.qty)}` : ''}{s.pickable ? ' · pick' : ''}
            </button>
          ))}
        </div>
      )}
      <input id={id} className="input text-base sm:text-sm uppercase tabular-nums" value={value} autoFocus={autoFocus}
        autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="e.g. A-10-0-1"
        onChange={e => onChange(e.target.value)} onBlur={() => clean && clean !== value && onChange(clean)} />
      {value && problem && <div className="text-xs text-loss mt-1">{problem}</div>}
      {clean && !problem && (
        <div className="text-xs text-ink/50 mt-1">
          {known ? (known.pickable ? 'A pick shelf' : 'An overflow shelf') : 'A shelf not used yet — it’ll be added'}
        </div>
      )}
    </div>
  )
}

/** Find a product by name, code or shelf. */
export function ProductSearch({ products, onPick, autoFocus, placeholder = 'Product name, code or shelf', id = 'inv-psearch' }) {
  const [q, setQ] = useState('')
  const found = useMemo(() => (q.trim() ? products.filter(p => matchesProduct(p, q)).slice(0, 8) : []), [products, q])
  return (
    <div>
      <input id={id} className="input text-base sm:text-sm" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" />
      {found.length > 0 && (
        <div className="mt-2 border border-rule rounded-[6px] bg-white divide-y divide-rule/70 overflow-hidden">
          {found.map(p => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-2.5 hover:bg-sky/25" onClick={() => { onPick(p); setQ('') }}>
              <div className="text-sm text-ink">{p.name}</div>
              <div className="text-xs text-ink/50 tabular-nums">{p.code} · {fmtUnits(p.on_hand)} on hand{p.locations?.length ? ` · ${p.locations.map(l => l.code).join(', ')}` : ''}</div>
            </button>
          ))}
        </div>
      )}
      {q.trim() && !found.length && <div className="text-sm text-ink/55 mt-2">Nothing matches “{q.trim()}”.</div>}
    </div>
  )
}

const shelvesOf = (p) => [...(p?.locations || [])].sort((a, b) => (b.pickable - a.pickable) || byLocation(a, b))

/**
 * Every by-hand stock change in one sheet: move, add, remove or count.
 * mode: move | add | remove | count. Adding and removing need a reason.
 */
export function StockChange({ mode: startMode, product, from: startFrom, to: startTo, task, products = [], locations = [], people = [], me, office,
  onClose, onDone, showToast }) {
  const [mode, setMode] = useState(startMode || 'move')
  const [p, setP] = useState(product || null)
  const shelves = shelvesOf(p)
  const [from, setFrom] = useState(startFrom || (mode === 'move' ? shelves.find(s => !s.pickable && s.qty > 0)?.code || shelves.find(s => s.qty > 0)?.code || '' : ''))
  const [to, setTo] = useState(startTo || '')
  const [qty, setQty] = useState(task ? String(task.qty || '') : '')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [newPickable, setNewPickable] = useState(null)
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const shelf = mode === 'move' ? cleanLocation(to) : cleanLocation(from || to)
  const fromRow = shelves.find(s => s.code === from)
  const reasons = mode === 'add' ? ADD_REASONS : REMOVE_REASONS
  const isNew = shelf && !locations.some(l => l.code === shelf)
  const n = num(qty)
  const problems = []
  if (!p) problems.push('Choose a product')
  if (mode === 'move') {
    if (!fromRow) problems.push('Choose where it’s coming from')
    if (!shelf) problems.push('Enter where it’s going')
    if (shelf && shelf === from) problems.push('That’s the same shelf')
    if (!(n > 0)) problems.push('Enter how many')
    if (fromRow && n > fromRow.qty) problems.push(`Only ${fmtUnits(fromRow.qty)} on ${from}`)
  } else if (mode === 'count') {
    if (!shelf) problems.push('Enter the shelf you counted')
    if (qty === '' || n < 0) problems.push('Enter what you counted')
  } else {
    if (!shelf) problems.push('Enter the shelf')
    if (!(n > 0)) problems.push('Enter how many')
    if (!reason) problems.push('Choose why')
    if (needsNote(reason, reasons) && !note.trim()) problems.push('Add a note')
    if (mode === 'remove') { const row = shelves.find(s => s.code === shelf); if (row && n > row.qty) problems.push(`Only ${fmtUnits(row.qty)} on ${shelf}`) }
  }
  if (isNew && newPickable == null && mode !== 'remove') problems.push('Say whether the new shelf is for picking')
  if (!who) problems.push('Choose your name')

  const save = async () => {
    setBusy(true); setError('')
    try {
      if (mode === 'move') {
        await invMove({ productId: p.id, from, to: shelf, qty: n, by: who, note: note.trim() || null, toPickable: isNew ? newPickable : null, taskId: task?.id || null })
        showToast?.(`Moved ${fmtUnits(n)} to ${shelf}`)
      } else if (mode === 'count') {
        const diff = await invSetCount({ productId: p.id, location: shelf, counted: n, note: note.trim(), by: who })
        showToast?.(diff ? `${shelf} set to ${fmtUnits(n)} (${diff > 0 ? '+' : ''}${fmtUnits(diff)})` : `${shelf} was already right`)
      } else {
        await invAdjust({ productId: p.id, location: shelf, qty: mode === 'add' ? n : -n, reason, note: note.trim(), by: who, pickable: isNew ? newPickable : null })
        showToast?.(`${mode === 'add' ? 'Added' : 'Removed'} ${fmtUnits(n)} ${mode === 'add' ? 'to' : 'from'} ${shelf}`)
      }
      onDone?.()
    } catch (e) { setError(e.message || 'That didn’t save — try again'); setBusy(false) }
  }

  const TITLES = { move: 'Move stock', add: 'Add stock by hand', remove: 'Remove stock by hand', count: 'Count a shelf' }
  const DESCS = {
    move: 'From one shelf to another. Nothing is added or taken away.',
    add: 'Deliveries go through Goods In. Use this for anything else, and say why.',
    remove: 'Sales come off automatically when they’re despatched. Use this for anything else, and say why.',
    count: 'Set a shelf to what’s really on it. The difference is recorded.',
  }

  return (
    <Modal title={task ? `${task.ref} · top up the pick shelf` : TITLES[mode]} description={task ? task.why : DESCS[mode]} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {!task && !startMode && (
          <div className="grid grid-cols-4 gap-1 p-1 bg-paper rounded-[6px]">
            {['move', 'add', 'remove', 'count'].map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setReason('') }}
                className={`py-2 text-xs rounded-[4px] ${mode === m ? 'bg-white shadow-card text-ink font-semibold' : 'text-ink/55'}`}>
                {{ move: 'Move', add: 'Add', remove: 'Remove', count: 'Count' }[m]}
              </button>
            ))}
          </div>
        )}

        {p ? (
          <div className="p-3 rounded-[6px] border border-royal-200 bg-sky/30 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-ink">{p.name}</div>
              <div className="text-xs text-ink/55 tabular-nums">{p.code} · {fmtUnits(p.on_hand)} on hand</div>
            </div>
            {!product && <button className="btn btn-secondary btn-xs" onClick={() => setP(null)}>Change</button>}
          </div>
        ) : (
          <div><div className="label">Product</div><ProductSearch products={products} onPick={setP} autoFocus /></div>
        )}

        {p && mode === 'move' && (
          <>
            <div>
              <div className="label">From</div>
              {shelves.filter(s => s.qty > 0).length ? (
                <div className="flex gap-1.5 flex-wrap">
                  {shelves.filter(s => s.qty > 0).map(s => (
                    <button key={s.code} type="button" onClick={() => setFrom(s.code)}
                      className={`px-2.5 py-2 rounded-[5px] border text-xs tabular-nums ${from === s.code ? 'border-royal-500 bg-royal-500 text-white' : 'border-rule bg-white text-ink'}`}>
                      <b>{s.code}</b> · {fmtUnits(s.qty)}{s.pickable ? ' · pick' : ''}
                    </button>
                  ))}
                </div>
              ) : <div className="text-sm text-ink/55">There’s nothing on a shelf to move.</div>}
            </div>
            <LocationInput id="inv-to" label="To" value={to} onChange={setTo} locations={locations} exclude={from}
              suggestions={shelves.filter(s => s.code !== from)} />
          </>
        )}
        {p && mode !== 'move' && (
          <LocationInput id="inv-at" label={mode === 'count' ? 'Shelf counted' : mode === 'add' ? 'Put it on' : 'Take it from'}
            value={from} onChange={setFrom} locations={locations} suggestions={shelves} />
        )}

        {isNew && mode !== 'remove' && (
          <div>
            <div className="label">Is {shelf} a pick shelf?</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`btn justify-center py-2.5 ${newPickable === true ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewPickable(true)}>Yes, picked from</button>
              <button type="button" className={`btn justify-center py-2.5 ${newPickable === false ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewPickable(false)}>No, overflow</button>
            </div>
          </div>
        )}

        {p && (
          <div>
            <label className="label" htmlFor="inv-qty">{mode === 'count' ? 'How many are there?' : 'How many?'}</label>
            <input id="inv-qty" type="number" inputMode="numeric" min="0" className="input text-base sm:text-sm tabular-nums w-40" value={qty} onChange={e => setQty(e.target.value)} />
            {mode === 'move' && fromRow && <button type="button" className="btn btn-ghost btn-xs ml-2" onClick={() => setQty(String(fromRow.qty))}>All {fmtUnits(fromRow.qty)}</button>}
          </div>
        )}

        {(mode === 'add' || mode === 'remove') && p && (
          <div>
            <div className="label">Why by hand?</div>
            <div className="space-y-1.5">
              {reasons.map(r => (
                <label key={r.id} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[6px] border cursor-pointer ${reason === r.id ? 'border-royal-400 bg-sky/30' : 'border-rule bg-white'}`}>
                  <input type="radio" name="inv-reason" className="mt-0.5" checked={reason === r.id} onChange={() => setReason(r.id)} />
                  <span><span className="text-sm text-ink">{r.id}</span>{r.hint && <span className="block text-xs text-ink/50">{r.hint}</span>}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {p && (
          <div>
            <label className="label" htmlFor="inv-note">Note{(mode === 'add' || mode === 'remove') && needsNote(reason, reasons) ? '' : ' (optional)'}</label>
            <input id="inv-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        )}

        <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} />

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={busy || problems.length > 0} onClick={save}
            title={problems[0] || ''}>
            <Icon name="check" size={15} /> {busy ? 'Saving…' : mode === 'move' ? (task ? 'Moved' : 'Move') : mode === 'count' ? 'Save count' : mode === 'add' ? 'Add' : 'Remove'}
          </button>
        </div>
        {problems.length > 0 && !busy && <div className="text-xs text-ink/45 -mt-2">{problems[0]}</div>}
      </div>
    </Modal>
  )
}
