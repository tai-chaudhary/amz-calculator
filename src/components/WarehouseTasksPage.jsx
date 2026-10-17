import React, { useState, useEffect } from 'react'
import { PageHeader, Icon, StatusBadge, SegmentedControl, EmptyState, Modal } from './UI'
import { StockChange, WhoSelect, useWho } from './InventoryParts'
import { fmtUnits } from '../lib/inventory'
import { invDismissTask } from '../lib/db'

const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Jobs the stock raises for the warehouse: a pick shelf running low with
 * more in overflow. They appear on their own as orders go out, and clear
 * themselves if the shelf gets topped up some other way.
 */
export default function WarehouseTasksPage({ me, inventory, people = [], office = false, focusId, showToast, onRefresh, onNavigate }) {
  const [view, setView] = useState('open')
  const [doing, setDoing] = useState(null)
  const [skipping, setSkipping] = useState(null)
  useEffect(() => {
    onRefresh?.()
    const t = setInterval(() => onRefresh?.(), 60000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tasks = inventory?.tasks || []
  const products = inventory?.products || []
  const open = tasks.filter(t => t.status === 'open').sort((a, b) => String(a.from_location).localeCompare(String(b.from_location), 'en', { numeric: true }))
  const done = tasks.filter(t => t.status !== 'open')
  const shown = view === 'open' ? open : done
  const doingProduct = doing && products.find(p => p.id === doing.product_id)

  return (
    <div>
      <PageHeader eyebrow="Warehouse / tasks" title="Tasks"
        description="Pick shelves to top up from overflow. They’re raised automatically as stock goes out." />
      <div className="overflow-x-auto max-w-full -mx-1 px-1 mb-4">
        <SegmentedControl label="Show" value={view} onChange={setView}
          items={[{ id: 'open', label: 'To do', count: open.length }, { id: 'done', label: 'Done lately', count: done.length }]} />
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="check" title={view === 'open' ? 'Nothing to top up' : 'Nothing done in the last few days'}
          sub={view === 'open' ? 'When a pick shelf gets low and there’s more in overflow, it shows here.' : ''} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {shown.map(t => (
            <div key={t.id} className={`card p-0 overflow-hidden ${focusId === t.id ? 'ring-2 ring-royal-300' : ''}`}>
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-ink/45 tabular-nums">{t.ref} · {when(t.created_at)}</div>
                    <button className="font-semibold text-ink leading-snug text-left hover:underline" onClick={() => onNavigate?.('inventory', t.product_id)}>{t.product_name}</button>
                  </div>
                  {t.status === 'done' ? <StatusBadge tone="live">Done</StatusBadge>
                    : t.status === 'cleared' ? <StatusBadge tone="quiet">Topped up</StatusBadge>
                    : t.status === 'dismissed' ? <StatusBadge tone="quiet">Not needed</StatusBadge>
                    : <StatusBadge tone="paused">To do</StatusBadge>}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-xl font-semibold tabular-nums">{fmtUnits(t.status === 'done' ? t.moved : t.qty)}</span>
                  <span className="text-ink/60">from</span>
                  <b className="tabular-nums">{t.from_location}</b>
                  <span className="text-ink/60">to</span>
                  <b className="tabular-nums">{t.to_location || 'a pick shelf'}</b>
                </div>
                <div className="text-xs text-ink/55 mt-1">{t.why}{t.done_by ? ` · ${t.status === 'done' ? 'moved' : 'closed'} by ${t.done_by}` : ''}{t.note ? ` · ${t.note}` : ''}</div>
              </div>
              {t.status === 'open' && (
                <div className="px-4 pb-3 grid grid-cols-3 gap-2">
                  <button className="btn btn-primary col-span-2 justify-center py-3 sm:py-2" onClick={() => setDoing(t)}><Icon name="check" size={15} /> Done it</button>
                  <button className="btn btn-secondary justify-center py-3 sm:py-2" onClick={() => setSkipping(t)}>Not needed</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {doing && doingProduct && (
        <StockChange mode="move" task={doing} product={doingProduct} from={doing.from_location} to={doing.to_location || ''}
          products={products} locations={inventory?.locations || []} people={people} me={me} office={office} showToast={showToast}
          onClose={() => setDoing(null)} onDone={() => { setDoing(null); onRefresh?.() }} />
      )}
      {skipping && (
        <Skip task={skipping} me={me} people={people} office={office} showToast={showToast}
          onClose={() => setSkipping(null)} onDone={() => { setSkipping(null); onRefresh?.() }} />
      )}
    </div>
  )
}

function Skip({ task, me, people, office, showToast, onClose, onDone }) {
  const [why, setWhy] = useState('')
  const [who, setWho] = useWho(me, people, office)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`${task.ref} isn’t needed`} description={task.product_name} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label" htmlFor="skip-why">Why?</label>
          <input id="skip-why" className="input text-base sm:text-sm" value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. overflow is empty, the shelf was already full" autoFocus /></div>
        <div className="text-xs text-ink/50">If the numbers are wrong, count the shelves in Inventory so it doesn’t ask again.</div>
        <WhoSelect people={people} value={who} onChange={setWho} office={office} me={me} />
        <button className="btn btn-primary w-full justify-center py-3 sm:py-2" disabled={!why.trim() || !who || busy}
          onClick={async () => { setBusy(true); try { await invDismissTask(task.id, why, who); onDone() } catch (e) { showToast?.(e.message, 'error'); setBusy(false) } }}>
          Close the task
        </button>
      </div>
    </Modal>
  )
}
