import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { smartFilter, matches, hay } from '../lib/match'
import { Icon, StatusBadge, SearchInput, EmptyState, Spinner } from './UI'
import VerifyCode, { CodesToVerify, useCandidates } from './VerifyCode'
import { loadCodesToVerify, loadCodeLinks, loadCodeLog, loadDespatchErrors, linkCode } from '../lib/db'
import { normRef } from '../lib/dispatch'
import { canDo } from '../lib/access'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/** A row from the database as the verify list wants it. */
export const asCode = (r) => ({
  code: r.code, name: r.name || r.title || '', orders: r.orders, status: r.status, suggest: r.items || [],
  offer: Array.isArray(r.suggest) && r.suggest.length ? { items: r.suggest, kind: r.suggest_kind || 'same', wanted: r.suggest_wanted || '' } : null,
})

/**
 * Item codes: what every packing-slip code is in our inventory. Codes on open
 * orders still waiting for someone to verify them, the ones we send something
 * else for by default (so the office can sort the listing), every verified
 * code, and the history of every change.
 */
export default function ItemCodes({ me, showToast, onCount }) {
  const [toVerify, setToVerify] = useState(null)
  const [links, setLinks] = useState([])
  const [log, setLog] = useState([])
  const [errors, setErrors] = useState([])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const products = useCandidates()
  const bySku = useMemo(() => new Map((products || []).map(p => [normRef(p.code), p])), [products])
  const allowed = canDo(me, 'link-codes')

  const load = useCallback(async () => {
    try {
      const [v, l, g, e] = await Promise.all([loadCodesToVerify(), loadCodeLinks(), loadCodeLog(200), loadDespatchErrors()])
      setToVerify((v || []).map(asCode)); setLinks(l || []); setLog(g || []); setErrors(e || [])
      onCount?.((v || []).length)
    } catch (e) { showToast?.(`Couldn't load item codes — ${e?.message || 'try again'}`, 'error'); setToVerify([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const describe = (items) => (items || []).map(i => `${i.qty} × ${bySku.get(normRef(i.code))?.name || i.code}`).join(' + ')
  const instead = links.filter(l => l.kind === 'substitute')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = smartFilter(links, q, l => hay(l.code, l.title, describe(l.items), l.wanted_name))

  const remove = async (l) => {
    if (!window.confirm(`Take away what ${l.code} is? Orders with it will wait in On hold until someone verifies it again.`)) return
    try { await linkCode(l.code, l.title, [], 'same', null, me?.name || me?.email); showToast?.(`${l.code} is no longer verified`); load() }
    catch (e) { showToast?.(e?.message || 'Couldn\'t change it', 'error') }
  }

  if (!toVerify) return <Spinner />
  return (
    <div className="space-y-6">
      {errors.length > 0 && (
        <div className="panel-alert text-sm">
          <div className="font-semibold text-ink">{errors.length === 1 ? 'Stock didn\'t come off for 1 dispatched order' : `Stock didn't come off for ${errors.length} dispatched orders`}</div>
          <div className="text-xs text-ink/60 mt-1">{errors.slice(0, 5).map(e => `${when(e.at)} — ${e.error}`).join(' · ')}</div>
        </div>
      )}

      <section>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="title-case text-sm font-semibold text-ink">To verify {toVerify.length > 0 && <span className="text-loss">· {toVerify.length}</span>}</h3>
          {!allowed && toVerify.length > 0 && <span className="text-xs text-ink/50">Only people trusted to link item codes can verify</span>}
        </div>
        {toVerify.length === 0 ? (
          <div className="surface px-4 py-6 text-sm text-ink/55 text-center">Every code on an open order is one of our SKUs or verified.</div>
        ) : (
          <>
            <p className="text-xs text-ink/55 mb-2">Codes on open orders that aren't our SKUs and nobody has verified. Their orders wait in On hold once uploaded — busiest first.</p>
            <CodesToVerify codes={toVerify} me={me} showToast={showToast} onVerified={load} />
          </>
        )}
      </section>

      {instead.length > 0 && (
        <section>
          <h3 className="title-case text-sm font-semibold text-ink mb-1">Sent instead, every time <span className="text-warn">· {instead.length}</span></h3>
          <p className="text-xs text-ink/55 mb-2">Listings where we send a different product. Source the right one, or change the listing.</p>
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
            {instead.map(l => (
              <div key={l.code} className="px-3 py-2.5">
                <div className="text-sm text-ink">Listing: <b>{l.wanted_name}</b></div>
                <div className="text-xs text-warn mt-0.5">We send {describe(l.items)}</div>
                <div className="text-[11px] text-ink/45 font-mono mt-0.5 break-all">{l.code} · verified by {l.verified_by} {when(l.verified_at)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h3 className="title-case text-sm font-semibold text-ink">Verified codes · {links.length}</h3>
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Code, listing or product" className="w-full sm:w-64" />
        </div>
        {links.length === 0 ? (
          <div className="surface px-4 py-6 text-sm text-ink/55 text-center">None yet. Codes that are our own SKUs don't need verifying.</div>
        ) : (
          <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
            {shown.map(l => (
              <div key={l.code} className="px-3 py-2.5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-ink/45 font-mono break-all">{l.code}</div>
                  {l.title && <div className="text-xs text-ink/55">{l.title}</div>}
                  <div className="text-sm text-ink mt-0.5">= {describe(l.items)}</div>
                  <div className="text-[11px] text-ink/45 mt-0.5">
                    {l.kind === 'substitute' && <span className="text-warn">Sent instead of {l.wanted_name} · </span>}
                    {l.verified_by} · {when(l.verified_at)}
                  </div>
                </div>
                {allowed && (
                  <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                    <button className="btn btn-secondary btn-xs" onClick={() => setEditing(l)}>Change</button>
                    <button className="btn btn-ghost btn-xs text-loss" onClick={() => remove(l)}>Remove</button>
                  </div>
                )}
              </div>
            ))}
            {!shown.length && <div className="px-3 py-3 text-sm text-ink/50">Nothing matches.</div>}
          </div>
        )}
      </section>

      <section>
        <button className="text-sm font-semibold text-ink flex items-center gap-1.5" onClick={() => setShowLog(s => !s)} aria-expanded={showLog}>
          <Icon name={showLog ? 'chevronDown' : 'chevronRight'} size={14} /> History of changes · {log.length}
        </button>
        {showLog && (
          log.length === 0 ? <div className="text-sm text-ink/50 mt-2">Nothing yet.</div> : (
            <div className="mt-2 border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
              {log.map(g => (
                <div key={g.id} className="px-3 py-2 text-xs">
                  <span className="text-ink/45">{when(g.at)}</span> · <b className="text-ink">{g.by_name}</b> {g.action}{' '}
                  <span className="font-mono text-ink/70 break-all">{g.code}</span>
                  {g.action !== 'removed' && <> = {describe(g.items)}{g.kind === 'substitute' ? <span className="text-warn"> (instead of {g.wanted_name})</span> : null}</>}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      {editing && (
        <VerifyCode code={editing.code} slipName={editing.title || ''} me={me} showToast={showToast}
          initial={{ items: editing.items, kind: editing.kind, wanted: editing.wanted_name || '' }}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}
