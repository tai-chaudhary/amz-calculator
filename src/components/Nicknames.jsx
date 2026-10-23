import React, { useState, useMemo } from 'react'
import { Modal, Icon, SearchInput, SegmentedControl, Flag } from './UI'
import { setNickname } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { nicknameMissing, patchNickname } from '../lib/nicknames'
import { suggestNicknames, suggestNicknameFor } from '../lib/nickSuggest'

/** Save one product's nickname, keeping the on-screen swap and search up to date straight away. */
export async function saveNickname(si, nick, me) {
  const r = await setNickname(si.id, nick, me?.name)
  patchNickname({ stock_item_id: si.id, name: si.name, stamp_name: null, code: si.data?.sku || null, nickname: r?.nickname || null })
  return r?.nickname || null
}

/**
 * Products → Nicknames: every product with a box for its nickname, saving as you go. "No nickname yet"
 * shows what's left; each box starts with a suggestion (brand, main word, size) — tick it to keep it.
 */
export function NicknamesPanel({ stockItems = [], me, showToast, onChanged, onClose }) {
  const [view, setView] = useState('missing')
  const [q, setQ] = useState('')
  const [saved, setSaved] = useState({})          // id → nickname saved this session
  const items = stockItems.filter(si => !si.data?.archived)
  const nickOf = (si) => (si.id in saved ? saved[si.id] : si.data?.nickname || '')
  const list = smartFilter(items.filter(si => view === 'all' || !nickOf(si)), q, si => hay(si.name, si.data?.sku, si.data?.brand, nickOf(si)))
    .slice(0, 300)
  const missing = items.filter(si => !nickOf(si)).length
  // Suggestions worked out across the whole catalogue, so no two are the same — nor the same as a nickname already given
  const suggestions = useMemo(() => {
    const m = suggestNicknames(items.map(si => ({ id: si.id, name: si.name, brand: si.data?.brand || '' })))
    const taken = new Set(items.map(si => (si.data?.nickname || '').toLowerCase()).filter(Boolean))
    for (const [id, n] of m) if (taken.has(n.toLowerCase()) && !items.find(si => si.id === id && (si.data?.nickname || '').toLowerCase() === n.toLowerCase())) m.set(id, '')
    return m
  }, [stockItems]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Nicknames" description="Short everyday names. People who switch Nicknames on see these instead of the full name, and label stamps use them." onClose={() => { onChanged?.(); onClose() }} maxWidth="max-w-3xl">
      <div className="space-y-3" data-no-nick>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl value={view} onChange={setView} label="Show"
            items={[{ id: 'missing', label: `No nickname yet ${missing}` }, { id: 'all', label: `All ${items.length}` }]} />
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Find a product" className="w-full sm:w-64 sm:ml-auto" />
        </div>
        <div className="border border-rule rounded-[6px] divide-y divide-rule/70 max-h-[60vh] overflow-y-auto bg-white">
          {list.length === 0 ? <div className="px-4 py-6 text-sm text-ink/55 text-center">{view === 'missing' ? 'Every product has a nickname.' : 'Nothing matches.'}</div>
            : list.map(si => <NickRow key={si.id} si={si} suggestion={suggestions.get(si.id) || ''} current={nickOf(si)} me={me} showToast={showToast} onSaved={(n) => setSaved(m => ({ ...m, [si.id]: n }))} />)}
        </div>
        <div className="text-xs text-ink/50">Saves as you go. A nickname must be unique, and should keep the size or variety (500ml, 2kg, Terracotta) so a stamp never mixes products up.</div>
      </div>
    </Modal>
  )
}

function NickRow({ si, suggestion = '', current, me, showToast, onSaved }) {
  const [val, setVal] = useState(current || suggestion)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const missing = nicknameMissing(si.name, val)
  const dirty = (val || '').trim() !== (current || '')
  const save = async () => {
    if (!dirty || busy) return
    setBusy(true); setErr('')
    try { const n = await saveNickname(si, val.trim(), me); onSaved(n); setVal(n || '') }
    catch (e) { setErr(e?.message || 'Couldn’t save') }
    finally { setBusy(false) }
  }
  return (
    <div className="px-3 py-2.5 grid grid-cols-1 sm:grid-cols-[1fr_260px] gap-2 items-center">
      <div className="min-w-0">
        <div className="text-sm text-ink leading-snug">{si.name}</div>
        {si.data?.sku && <div className="text-[11px] text-ink/40 font-mono">{si.data.sku}</div>}
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <input className={`input text-base sm:text-sm flex-1 ${!current && val === suggestion ? 'text-ink/55' : ''}`} value={val}
            onChange={e => { setVal(e.target.value); setErr('') }} onBlur={() => { if (current || val !== suggestion) save() }}
            onKeyDown={e => e.key === 'Enter' && save()} placeholder="Nickname" aria-label={`Nickname for ${si.name}`} />
          {dirty ? <button className="btn btn-primary btn-xs" disabled={busy || !val.trim()} onClick={save} title="Keep this nickname"><Icon name="check" size={13} /></button>
            : current ? <Icon name="check" size={15} className="text-gain" /> : null}
        </div>
        {err ? <div className="text-[11px] text-loss mt-1">{err}</div>
          : missing.length > 0 && val.trim() ? <div className="mt-1"><Flag tone="amber" icon="alert">Leaves out {missing.join(', ')}</Flag></div> : null}
      </div>
    </div>
  )
}

/** On the Product page: the nickname, clearly labelled, edited in place. */
export function NicknameLine({ si, me, canEdit, showToast, onChanged, stockItems = [] }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(si.data?.nickname || '')
  const [busy, setBusy] = useState(false)
  const nick = si.data?.nickname || ''
  const missing = nicknameMissing(si.name, val)
  if (!editing) return (
    <div className="flex items-center gap-2 mt-1.5 flex-wrap" data-no-nick>
      <Flag tone="blue" icon="tag">Nickname</Flag>
      {nick ? <span className="text-sm font-semibold text-royal-700">{nick}</span> : <span className="text-sm text-ink/45">None yet</span>}
      {canEdit && <button className="btn btn-ghost btn-xs" onClick={() => { setVal(nick || suggestNicknameFor({ id: si.id, name: si.name, brand: si.data?.brand || '' }, stockItems.filter(x => !x.data?.archived).map(x => ({ id: x.id, name: x.name, brand: x.data?.brand || '' })))); setEditing(true) }}><Icon name="edit" size={12} /> {nick ? 'Change' : 'Add'}</button>}
    </div>
  )
  return (
    <div className="mt-1.5" data-no-nick>
      <div className="flex items-center gap-2 flex-wrap">
        <input className="input text-base sm:text-sm w-64" value={val} onChange={e => setVal(e.target.value)} autoFocus placeholder="Nickname" />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
          setBusy(true)
          try { await saveNickname(si, val.trim(), me); showToast?.(val.trim() ? `Nickname saved: ${val.trim()}` : 'Nickname removed'); setEditing(false); onChanged?.() }
          catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') }
          finally { setBusy(false) }
        }}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {missing.length > 0 && val.trim() && <div className="mt-1"><Flag tone="amber" icon="alert">Leaves out {missing.join(', ')} — stamps could mix it up</Flag></div>}
    </div>
  )
}
