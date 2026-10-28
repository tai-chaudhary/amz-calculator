import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Icon, StatusBadge, Spinner } from './UI'
import { notifyAdmin, setClickupToken, loadNotificationRules, saveNotificationRule, loadNotificationLog } from '../lib/db'

/** What each message is for. Order here is the order on screen. */
const EVENTS = [
  { group: 'Dispatch', items: [
    { id: 'batch_uploaded', title: 'Batch uploaded', when: 'Someone uploads a batch of labels', example: 'Jignesh uploaded B3 for today: 30 orders, 76 labels' },
    { id: 'returns_to_match', title: 'Returns to match', when: 'Daily at 4:45pm: returns the warehouse logged that aren’t matched to an order yet', example: '2 returns still to match to an order' },
    { id: 'print_station_offline', title: 'Print Station offline', when: 'Prints have waited over 2 minutes with the Print Station off (at most every 15 minutes)', example: 'The Print Station is offline — 2 prints waiting since 14:32' },
    { id: 'labels_not_uploaded', title: 'Labels not uploaded', when: '3:30pm, if HELM made labels today that aren’t in Dispatch', example: '2 labels made in HELM today, not uploaded to Dispatch — #20451 · Evri, #20457 · DHL' },
    { id: 'day_closed', title: 'Day closed', when: 'The day is closed on Dispatch', example: 'Day closed — 212 of 216 orders dispatched · 4 left over' },
  ] },
  { group: 'Stock requests', items: [
    { id: 'request_raised', title: 'Stock requested', when: 'The warehouse asks for stock', example: 'SR-0014 — Ankesh needs Sponge 6pk · Out of stock' },
    { id: 'request_ordered', title: 'Request ordered', when: 'A request goes on a purchase order', example: 'SR-0014 is on order — PO-… from Pricecheck, 48 ordered' },
    { id: 'request_declined', title: 'Request not ordered', when: 'The office says no to a request', example: 'SR-0014 isn’t being ordered — Reason: discontinued' },
  ] },
  { group: 'Alerts', items: [
    { id: 'stock_negative', title: 'Stock below zero', when: 'A shelf’s stock goes below zero (it’s allowed — someone needs to count it)', example: 'Scola Clear PVA Glue 5L on C-2-0-3 is now -1' },
    { id: 'portal_error', title: 'Portal errors', when: 'Someone hits an error in the portal (each error at most every 6 hours) — a direct message to Taimoor', example: 'Portal error — Sagar on goods-in (v2.69.0)' },
    { id: 'db_check_failed', title: 'Database check failed', when: '6:15am, only if a database check fails — a direct message to Taimoor', example: 'Morning database check: 1 problem (of 18 checks)' },
  ] },
  { group: 'Goods in', items: [
    { id: 'delivery_confirmed', title: 'Delivery date confirmed', when: 'A delivery date is confirmed or changed on a stock or packaging order', example: 'Pricecheck PO-… arriving Tue 20 Oct' },
    { id: 'delivery_booked', title: 'Delivery booked in', when: 'A delivery is booked in at goods in', example: 'GI-0003 from Pricecheck booked in by Sagar: 380 units ✅ All OK' },
    { id: 'goods_in_problem', title: 'Problems at goods in', when: 'Something arrives damaged, wrong or missing', example: '2 damaged, 4 missing on PO-… — in Delivery Problems' },
    { id: 'unexpected_delivery', title: 'Arrived with no order', when: 'Something turns up that isn’t on an order', example: 'GI-0004 from Kite — needs matching to an order' },
  ] },
]

/** ClickUp messages: connect once, then choose which events post where. Admins only. */
export default function NotificationsPage({ showToast }) {
  const [status, setStatus] = useState(null)        // null = loading
  const [channels, setChannels] = useState([])
  const [rules, setRules] = useState([])
  const [log, setLog] = useState([])
  const [token, setToken] = useState('')
  const [editingToken, setEditingToken] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const [st, r, l] = await Promise.all([notifyAdmin({ action: 'status' }).catch(e => ({ connected: false, error: e.message })), loadNotificationRules(), loadNotificationLog()])
      setStatus(st); setRules(r); setLog(l)
      if (st.connected) notifyAdmin({ action: 'channels' }).then(x => setChannels(x.channels || [])).catch(() => setChannels([]))
    } catch (e) { showToast?.(e.message || 'Could not load', 'error'); setStatus({ connected: false }) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const run = async (key, fn) => { setBusy(key); try { await fn() } catch (e) { showToast?.(e.message || 'Something went wrong', 'error') } finally { setBusy('') } }
  const ruleOf = (id) => rules.find(r => r.event === id) || { event: id, enabled: false }
  const update = (id, patch) => run(id, async () => {
    await saveNotificationRule(id, patch)
    setRules(rs => rs.map(r => (r.event === id ? { ...r, ...patch } : r)))
  })

  if (!status) return <Spinner />
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Tools / notifications" title="ClickUp messages"
        description="The portal posts to your ClickUp channels when things happen, so the team doesn’t have to check. No prices are ever included." />

      {/* Connection */}
      <div className="card mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="title-case text-sm font-semibold text-ink">ClickUp connection</div>
            {status.connected ? (
              <div className="text-sm text-ink/65 mt-0.5">Connected to <b>{status.workspace}</b>{status.user ? <> — messages post as <b>{status.user}</b></> : ''}</div>
            ) : (
              <div className="text-sm text-ink/65 mt-0.5">Not connected. {status.error && status.error !== 'ClickUp isn’t connected yet' ? <span className="text-loss">{status.error}</span> : null}</div>
            )}
          </div>
          <StatusBadge tone={status.connected ? 'live' : 'paused'} dot>{status.connected ? 'Connected' : 'Not connected'}</StatusBadge>
        </div>
        {(!status.connected || editingToken) ? (
          <div className="mt-3">
            <label className="label" htmlFor="cu-token">ClickUp API token</label>
            <div className="flex gap-2 flex-wrap">
              <input id="cu-token" type="password" autoComplete="off" className="input flex-1 min-w-[220px]" value={token} onChange={e => setToken(e.target.value)} placeholder="pk_…" />
              <button className="btn btn-primary btn-sm" disabled={busy === 'token' || !token.trim()}
                onClick={() => run('token', async () => { await setClickupToken(token.trim()); setToken(''); setEditingToken(false); showToast?.('ClickUp connected'); await load() })}>
                {busy === 'token' ? 'Saving…' : 'Connect'}
              </button>
              {editingToken && <button className="btn btn-secondary btn-sm" onClick={() => setEditingToken(false)}>Cancel</button>}
            </div>
            <div className="text-xs text-ink/50 mt-1.5">
              In ClickUp: your avatar → Settings → Apps → API Token → Generate, then paste it here. Messages appear as whoever owns the token.
              It’s stored encrypted and can’t be read back, not even by admins.
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mt-3">
            <button className="btn btn-secondary btn-sm" onClick={() => setEditingToken(true)}>Replace token</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === 'token'}
              onClick={() => { if (window.confirm('Disconnect ClickUp? No more messages will be sent until it’s connected again.')) run('token', async () => { await setClickupToken(''); showToast?.('ClickUp disconnected'); await load() }) }}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* What goes where */}
      {EVENTS.map(g => (
        <section key={g.group} className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/50 mb-2">{g.group}</h2>
          <div className="card p-0 overflow-hidden">
            {g.items.map(ev => {
              const r = ruleOf(ev.id)
              const known = channels.some(c => c.id === r.channel_id)
              return (
                <div key={ev.id} className="px-4 py-3 border-b border-rule last:border-0">
                  <div className="flex items-start gap-3">
                    <label className="pt-0.5 cursor-pointer">
                      <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={!!r.enabled} disabled={busy === ev.id}
                        onChange={e => update(ev.id, { enabled: e.target.checked })} aria-label={`Send “${ev.title}” messages`} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{ev.title}</div>
                      <div className="text-xs text-ink/55">{ev.when}</div>
                      <div className="text-xs text-ink/40 italic mt-0.5 truncate">e.g. {ev.example}</div>
                      <div className="flex gap-2 mt-2 flex-wrap items-center">
                        <select className="input text-sm py-1.5 w-auto max-w-full" disabled={!r.enabled || !status.connected || busy === ev.id}
                          value={known ? r.channel_id : ''} aria-label={`Channel for ${ev.title}`}
                          onChange={e => { const c = channels.find(x => x.id === e.target.value); if (c) update(ev.id, { channel_id: c.id, channel_name: c.name }) }}>
                          <option value="">{String(r.channel_name || '').startsWith('dm:') ? `Direct message to ${r.channel_name.slice(3)}` : r.channel_name ? `# ${r.channel_name}` : 'Choose a channel'}</option>
                          {channels.map(c => <option key={c.id} value={c.id}># {c.name}</option>)}
                        </select>
                        <button className="btn btn-secondary btn-xs" disabled={!r.enabled || !status.connected || busy === `test-${ev.id}`}
                          onClick={() => run(`test-${ev.id}`, async () => { const x = await notifyAdmin({ action: 'test', event: ev.id }); showToast?.(`Test sent to #${x.channel}`); load() })}>
                          {busy === `test-${ev.id}` ? 'Sending…' : 'Send test'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* What went */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/50">Recent messages</h2>
          <button className="btn btn-ghost btn-xs" onClick={load}><Icon name="clock" size={12} /> Refresh</button>
        </div>
        <div className="card p-0 overflow-hidden">
          {log.length === 0 ? <div className="px-4 py-6 text-sm text-ink/50 text-center">Nothing sent yet.</div> : log.map(m => (
            <div key={m.id} className="px-4 py-2.5 border-b border-rule/70 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{EVENTS.flatMap(g => g.items).find(e => e.id === m.event)?.title || m.event}{m.channel_name ? <span className="text-ink/50"> → {String(m.channel_name).startsWith('dm:') ? `DM to ${m.channel_name.slice(3)}` : `#${m.channel_name}`}</span> : ''}</span>
                {m.sent_at && !m.error ? <StatusBadge tone="live">Sent</StatusBadge>
                  : m.error === 'Switched off' ? <StatusBadge tone="quiet">Switched off</StatusBadge>
                  : m.attempts >= 5 ? <StatusBadge tone="alert">Failed</StatusBadge> : <StatusBadge tone="paused">{m.attempts ? 'Retrying' : 'Sending'}</StatusBadge>}
              </div>
              <div className="text-xs text-ink/45">{new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              {m.error && m.error !== 'Switched off' && <div className="text-xs text-loss mt-0.5">{m.error}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
