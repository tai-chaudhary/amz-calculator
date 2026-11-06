// Sends the portal's messages to ClickUp chat channels.
//
// Called by the database (with its own key) whenever a message is queued, and
// every few minutes to retry anything that didn't go. Admins also call it from
// the portal to check the connection, list channels and send a test.
// The ClickUp token lives in the vault and never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-key',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const PORTAL = 'https://amz-calculator.vercel.app'
const API = 'https://api.clickup.com/api'
// Every message is labelled, so nobody mistakes it for a person writing
const LABEL = '🤖 **G&G Portal**'

// ── ClickUp ────────────────────────────────────────────────────────────────

async function token() {
  const { data } = await db.rpc('clickup_token')
  return (data as string | null) || null
}

async function cu(path: string, init: RequestInit = {}) {
  const t = await token()
  if (!t) throw new Error('ClickUp isn’t connected yet')
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: t, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${body?.err || body?.message || body?.error || text.slice(0, 200)}`)
  return body
}

let workspaceCache: { id: string, name: string } | null = null
async function workspace() {
  if (workspaceCache) return workspaceCache
  const r = await cu('/v2/team')
  const team = (r?.teams || [])[0]
  if (!team) throw new Error('No ClickUp workspace found for this token')
  workspaceCache = { id: String(team.id), name: team.name }
  return workspaceCache
}

async function channels() {
  const ws = await workspace()
  const out: { id: string, name: string }[] = []
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const r = await cu(`/v3/workspaces/${ws.id}/chat/channels?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const list = r?.data || r?.channels || []
    for (const c of list) if (c?.id && c?.name) out.push({ id: String(c.id), name: String(c.name) })
    cursor = r?.next_cursor || r?.nextCursor || ''
    if (!cursor || !list.length) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// A direct message to one person: channel_name "dm:<name or email>" (e.g. dm:Taimoor)
async function dmChannel(who: string) {
  const ws = await workspace()
  const r = await cu('/v2/team')
  const team = (r?.teams || []).find((t: any) => String(t.id) === ws.id) || (r?.teams || [])[0]
  const want = norm(who)
  const m = (team?.members || []).map((x: any) => x.user).find((u: any) => u && (norm(u.username).includes(want) || norm(u.email).includes(want)))
  if (!m) throw new Error(`No ClickUp member called “${who}”`)
  const me = await cu('/v2/user').catch(() => null)
  const self = me?.user && String(me.user.id) === String(m.id)
  let made: any = null
  for (const ids of self ? [[], [Number(m.id)]] : [[Number(m.id)], []]) {
    try { made = await cu(`/v3/workspaces/${ws.id}/chat/channels/direct_message`, { method: 'POST', body: JSON.stringify({ user_ids: ids }) }); break } catch (e) { made = e }
  }
  if (made instanceof Error) throw made
  const id = made?.data?.id || made?.id || made?.channel?.id
  if (!id) throw new Error('ClickUp didn’t return a direct message')
  return { id: String(id), name: `DM to ${m.username || who}` }
}

async function channelFor(rule: any, list?: { id: string, name: string }[]) {
  if (rule?.channel_id) return { id: rule.channel_id, name: rule.channel_name || rule.channel_id }
  if (String(rule?.channel_name || '').startsWith('dm:')) {
    const dm = await dmChannel(String(rule.channel_name).slice(3))
    await db.from('notification_rules').update({ channel_id: dm.id }).eq('event', rule.event)
    return { id: dm.id, name: rule.channel_name }
  }
  const all = list || await channels()
  const want = norm(rule?.channel_name)
  const hit = all.find(c => norm(c.name) === want) || all.find(c => want && (norm(c.name).includes(want) || want.includes(norm(c.name))))
  if (!hit) throw new Error(`No ClickUp channel called “${rule?.channel_name || '?'}”`)
  await db.from('notification_rules').update({ channel_id: hit.id, channel_name: hit.name }).eq('event', rule.event)
  return hit
}

async function post(channelId: string, content: string) {
  const ws = await workspace()
  return cu(`/v3/workspaces/${ws.id}/chat/channels/${channelId}/messages`, {
    method: 'POST', body: JSON.stringify({ type: 'message', content: `${LABEL}\n${content}`, content_format: 'text/md' }),
  })
}

// ── Messages ───────────────────────────────────────────────────────────────

const n = (v: unknown) => (Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : 0)
const day = (d?: string | null) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '')
const todayLondon = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const whenDay = (d?: string | null) => (!d ? '' : String(d).slice(0, 10) === todayLondon() ? `today (${day(d)})` : day(d))
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
const URGENCY: Record<string, string> = { out: '🔴 Out of stock', running_low: '🟠 Running low', low: '⚪ Not urgent' }
const linesOf = (lines: any[] = [], max = 8) => {
  const xs = lines.filter(l => n(l.arrived ?? l.qty) > 0 || l.damaged || l.short || l.wrong_qty)
  const shown = xs.slice(0, max).map(l => `• ${n(l.arrived ?? l.qty)} × ${l.name}`)
  return shown.join('\n') + (xs.length > max ? `\n• …and ${xs.length - max} more` : '')
}

/** The day's orders by stage, worked out from the labels themselves. */
async function daySummary(date: string) {
  const { data: batches } = await db.from('dispatch_batches').select('id, label_name').eq('ship_date', date)
  const ids = (batches || []).map(b => b.id)
  const labels: any[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('dispatch_labels').select('upload_id, order_key, id, status, label_name, printed_at, packed_at')
      .in('batch_id', ids.slice(i, i + 150)).limit(20000)
    labels.push(...(data || []))
  }
  const orders = new Map<string, any[]>()
  let held = 0
  for (const l of labels) {
    if (l.status === 'cancelled') continue
    if (l.status === 'held') { held++; continue }
    const k = `${l.upload_id}|${l.order_key || l.id}`
    if (!orders.has(k)) orders.set(k, [])
    orders.get(k)!.push(l)
  }
  const stamps = new Map<string, { total: number, gone: number }>()
  let total = 0, gone = 0
  for (const ls of orders.values()) {
    const name = ls.find(l => l.label_name)?.label_name || 'Not named'
    const sent = ls.every(l => l.status === 'dispatched')
    total++; if (sent) gone++
    const s = stamps.get(name) || { total: 0, gone: 0 }
    s.total++; if (sent) s.gone++
    stamps.set(name, s)
  }
  return { total, gone, held, stamps: [...stamps.entries()].sort((a, b) => b[1].total - a[1].total) }
}

async function compose(event: string, p: any): Promise<string> {
  switch (event) {
    case 'batch_uploaded': {
      const stamps = (p.stamps || []).slice(0, 10).map((s: any) => `• ${s.orders} × ${s.name}`).join('\n')
      return `📦 **New batch uploaded** — ${p.by || 'Someone'} uploaded **${p.code || 'a batch'}** for ${whenDay(p.ship_date)}: **${plural(n(p.orders), 'order')}**, ${plural(n(p.labels), 'label')}` +
        (p.picker && p.picker !== p.by ? ` (picked by ${p.picker})` : '') +
        (stamps ? `\n${stamps}${(p.stamps || []).length > 10 ? `\n• …and ${(p.stamps || []).length - 10} more` : ''}` : '') +
        (n(p.held) ? `\n⚠️ ${plural(n(p.held), 'order')} on hold — need a look before printing` : '')
    }
    case 'day_closed': {
      const s = await daySummary(p.date)
      const rows = s.stamps.slice(0, 12).map(([name, v]) => `• ${name}: ${v.gone}${v.gone !== v.total ? ` of ${v.total}` : ''}`).join('\n')
      const left = s.total - s.gone
      const lefts = (p.left_list || []).slice(0, 15).map((l: any) => `• ${l.batch} #${l.seq} ${l.stamp || ''}${l.order ? ` (${l.order})` : ''}`).join('\n')
      return `✅ **Day closed — ${day(p.date)}** by ${p.by || 'someone'}\n**${s.gone}** of ${plural(s.total, 'order')} dispatched` +
        (left ? ` · **${left} left over**` : ' · everything went 🎉') + (s.held ? ` · ${s.held} on hold` : '') +
        (lefts ? `\n⚠️ **Left over — send first tomorrow:**\n${lefts}` : '') +
        (n(p.subs) ? `\n🔁 ${plural(n(p.subs), 'substitute')} logged` : '') +
        (rows ? `\n${rows}` : '')
    }
    case 'request_raised':
      return `🙋 **Stock request ${p.ref}** — ${p.by || 'The warehouse'} needs **${p.product}**\n${URGENCY[p.urgency] || ''}` +
        (n(p.qty) ? ` · about ${n(p.qty)} wanted` : '') + (p.in_products === false ? ' · not in Products yet' : '') +
        (p.note ? `\n“${p.note}”` : '') + `\n${PORTAL}/#/requests?focus=${p.id}`
    case 'request_ordered':
      return `🛒 **${p.ref} is on order** — ${p.product}${p.by ? ` (asked for by ${p.by})` : ''}\n${p.po_number} from ${p.supplier || 'the supplier'}` +
        (n(p.qty) ? ` · ${n(p.qty)} ordered` : '') +
        (p.delivery_date ? ` · arriving ${day(p.delivery_date)}` : ' · delivery date to follow')
    case 'request_declined':
      return `🚫 **${p.ref} isn’t being ordered** — ${p.product}${p.reason ? `\nReason: ${p.reason}` : ''}`
    case 'delivery_confirmed': {
      const lines = (p.lines || []).slice(0, 8).map((l: any) => `• ${n(l.qty)} × ${l.name}`).join('\n')
      return `🚚 **Delivery ${p.was ? 'date changed' : 'confirmed'}** — ${p.supplier || 'Supplier'} ${p.po_number} arriving **${day(p.date)}**` +
        (p.was ? ` (was ${day(p.was)})` : '') + (p.note ? `\n${p.note}` : '') + (lines ? `\n${lines}` : '')
    }
    case 'delivery_booked': {
      const units = (p.lines || []).reduce((t: number, l: any) => t + n(l.arrived), 0)
      const extra = [p.cartons && plural(n(p.cartons), 'carton'), p.pallets && plural(n(p.pallets), 'pallet')].filter(Boolean).join(', ')
      return `📥 **Delivery booked in** — ${p.ref} from ${p.supplier || 'supplier'} (${p.po_number || 'no PO'}) by ${p.by || 'someone'}: ${plural(units, 'unit')}${extra ? `, ${extra}` : ''}` +
        `\n${p.problems ? '⚠️ Problems reported — the office has the details' : '✅ All OK'} · ready to put away`
    }
    case 'goods_in_problem': {
      const issues = (p.lines || []).flatMap((l: any) => [
        n(l.damaged) && `• ${n(l.damaged)} damaged × ${l.name}`,
        n(l.wrong_qty) && `• ${n(l.wrong_qty)} wrong item × ${l.name}`,
        l.short && `• ${n(l.short_qty)} missing × ${l.name}`,
        l.note && `  “${l.note}”`,
      ]).filter(Boolean).join('\n')
      return `⚠️ **Problems at goods in** — ${p.ref} · ${p.supplier || 'supplier'} ${p.po_number || ''}${p.signed_unchecked ? ' (signed unchecked)' : ' (⚠️ not signed unchecked)'}` +
        (issues ? `\n${issues}` : '') + `\nIn Delivery Problems with photos: ${PORTAL}/#/goods-in?focus=${p.id}`
    }
    case 'unexpected_delivery':
      return `❓ **Arrived with no order** — ${p.ref} from ${p.supplier || 'unknown sender'}, logged by ${p.by || 'someone'}` +
        (linesOf(p.lines) ? `\n${linesOf(p.lines)}` : '') + (p.note ? `\n“${p.note}”` : '') +
        `\nNeeds matching to an order: ${PORTAL}/#/goods-in?focus=${p.id}`
    case 'labels_not_uploaded': {
      const list = (p.orders || []) as any[]
      const rows = list.slice(0, 25).map((o: any) => `• ${o.order}${o.carrier ? ` · ${String(o.carrier).split(' ')[0]}` : ''}`).join('\n')
      return `🏷️ **${plural(list.length, 'label')} made in HELM today, not uploaded to Dispatch** (3:30pm check)\n${rows}` +
        (list.length > 25 ? `\n• …and ${list.length - 25} more` : '') + `\nUpload them: ${PORTAL}/#/dispatch`
    }
    case 'print_station_offline': {
      const jobs = ((p.jobs || []) as any[]).slice(0, 8).map((j: any) => `• ${j.title}${j.by ? ` — ${j.by}` : ''}`).join('\n')
      return `🖨️ **The Print Station is offline — ${plural(n(p.waiting), 'print')} waiting** since ${p.since ? new Date(p.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'a while'}` +
        (jobs ? `\n${jobs}` : '') + `\nOpen the Print Station on the warehouse Mac (desktop shortcut) and they'll print straight away.`
    }
    case 'returns_to_match': {
      const list = ((p.returns || []) as any[])
      const rows = list.slice(0, 15).map((r: any) => `• ${r.ref}${r.tracking ? ` · ${r.tracking}` : ''} — ${((r.items || []) as any[]).map((i: any) => `${i.qty || 1} × ${i.name}`).join(', ') || 'products not set'}`).join('\n')
      return `📦 **${plural(n(p.count), 'return')} still to match to an order**\n${rows}` + (list.length > 15 ? `\n• …and ${list.length - 15} more` : '') +
        `\nThe office finds the order for each: ${PORTAL}/#/customer-care`
    }
    case 'stock_negative':
      return `🔻 **Stock below zero** — ${p.product || 'A product'}${p.code ? ` (${p.code})` : ''} on **${p.location || '?'}** is now **${n(p.qty)}**` +
        (p.by || p.kind ? `\nLast change: ${[p.kind && String(p.kind).replace(/_/g, ' '), p.ref, p.by && `by ${p.by}`].filter(Boolean).join(' · ')}` : '') +
        `\nCount the shelf and correct it: ${PORTAL}/#/inventory`
    case 'portal_error':
      return `🐞 **Portal error** — ${p.who || 'someone'} on ${p.page || 'a page'} (v${p.version || '?'})` +
        (n(p.count) > 1 ? ` · seen ${n(p.count)} times since ${day(p.first_at)}` : '') +
        `\n\`${String(p.message || '').slice(0, 300)}\`` + (p.stack ? `\n\`\`\`\n${String(p.stack).slice(0, 500)}\n\`\`\`` : '')
    case 'db_check_failed': {
      const rows = ((p.failed || []) as any[]).slice(0, 12).map((x: any) => `• ${x.name}${x.detail ? ` — ${x.detail}` : ''}`).join('\n')
      return `🧪 **Morning database check: ${plural(((p.failed || []) as any[]).length, 'problem')}** (of ${n(p.total)} checks)\n${rows}\nRun it again in Settings → Database checks: ${PORTAL}/#/settings`
    }
    default:
      return `Portal: ${event}`
  }
}

const SAMPLES: Record<string, any> = {
  returns_to_match: { count: 2, returns: [{ ref: 'RT-0004', tracking: 'H00ABC123', items: [{ name: 'Pyrex Glass Measuring Jug 500ml', qty: 1 }] }, { ref: 'RT-0005', tracking: 'JD014600', items: [] }] },
  print_station_offline: { waiting: 2, since: new Date().toISOString(), jobs: [{ title: 'B4-POSTER PAINT', by: 'Ankesh' }, { title: 'reprint-B2-14', by: 'Sagar' }] },
  labels_not_uploaded: { orders: [{ order: '#20451', carrier: 'Evri' }, { order: '#20457', carrier: 'DHL' }] },
  batch_uploaded: { by: 'Jignesh', code: 'B3', ship_date: todayLondon(), orders: 30, labels: 76, held: 1, stamps: [{ name: 'SPONGE 6', orders: 18 }, { name: 'MOP HEAD 2', orders: 12 }] },
  request_raised: { ref: 'SR-TEST', product: 'Test product', qty: 48, urgency: 'running_low', by: 'Ankesh', note: 'This is a test message', in_products: true, id: '' },
  request_ordered: { ref: 'SR-TEST', product: 'Test product', by: 'Ankesh', po_number: 'PO-TEST', supplier: 'Test supplier', qty: 48 },
  request_declined: { ref: 'SR-TEST', product: 'Test product', reason: 'This is a test message' },
  delivery_confirmed: { po_number: 'PO-TEST', supplier: 'Test supplier', date: todayLondon(), note: 'Test — AM delivery, 2 pallets', lines: [{ name: 'Test product', qty: 48 }] },
  delivery_booked: { ref: 'GI-TEST', supplier: 'Test supplier', po_number: 'PO-TEST', by: 'Sagar', cartons: 3, lines: [{ name: 'Test product', arrived: 48 }], problems: false },
  goods_in_problem: { ref: 'GI-TEST', supplier: 'Test supplier', po_number: 'PO-TEST', signed_unchecked: true, id: '', lines: [{ name: 'Test product', arrived: 46, damaged: 2, short: true, short_qty: 2 }] },
  stock_negative: { product: 'Test product', code: 'TEST-1', location: 'C-2-0-3', qty: -1, by: 'Sagar', kind: 'despatch', ref: 'B3' },
  portal_error: { message: 'Test error — nothing is broken', page: 'settings', who: 'Taimoor', version: '2.69.0', count: 1 },
  db_check_failed: { total: 18, failed: [{ name: 'Test check', detail: 'nothing is wrong — this is a test' }] },
  unexpected_delivery: { ref: 'GI-TEST', supplier: 'Test sender', by: 'Sagar', id: '', lines: [{ name: 'Test product', arrived: 10 }] },
}

// ── Sending ────────────────────────────────────────────────────────────────

async function sendRow(row: any, list?: { id: string, name: string }[]) {
  const { data: rule } = await db.from('notification_rules').select('*').eq('event', row.event).maybeSingle()
  if (!rule || !rule.enabled) {
    await db.from('notification_outbox').update({ sent_at: new Date().toISOString(), error: 'Switched off' }).eq('id', row.id)
    return
  }
  try {
    const ch = await channelFor(rule, list)
    const message = await compose(row.event, row.payload || {})
    await post(ch.id, message)
    await db.from('notification_outbox').update({ sent_at: new Date().toISOString(), error: null, channel_name: ch.name, message, attempts: row.attempts + 1 }).eq('id', row.id)
  } catch (e) {
    await db.from('notification_outbox').update({ attempts: row.attempts + 1, error: String((e as Error)?.message || e).slice(0, 500) }).eq('id', row.id)
  }
}

async function callerAdmin(req: Request) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await db.auth.getUser(jwt)
  if (!data?.user) return null
  const { data: p } = await db.from('profiles').select('id, role, active, display_name').eq('id', data.user.id).maybeSingle()
  return p && p.role === 'admin' && p.active !== false ? p : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const body = await req.json().catch(() => ({}))

  // From the database: send one, or retry what's waiting
  const key = req.headers.get('x-notify-key')
  if (key) {
    const { data: real } = await db.rpc('notify_key')
    if (!real || key !== real) return json({ error: 'Bad key' }, 403)
    if (body.id) {
      const { data: row } = await db.from('notification_outbox').select('*').eq('id', body.id).maybeSingle()
      if (row && !row.sent_at) await sendRow(row)
      return json({ ok: true })
    }
    const cutoff = new Date(Date.now() - 60000).toISOString()
    const { data: rows } = await db.from('notification_outbox').select('*').is('sent_at', null).lt('attempts', 5).lt('created_at', cutoff).order('created_at').limit(30)
    for (const row of rows || []) await sendRow(row)
    return json({ ok: true, tried: (rows || []).length })
  }

  // From an admin in the portal
  const me = await callerAdmin(req)
  if (!me) return json({ error: 'Only an admin can manage ClickUp messages' }, 403)
  try {
    if (body.action === 'status') {
      if (!(await token())) return json({ connected: false })
      const [ws, user] = await Promise.all([workspace(), cu('/v2/user')])
      return json({ connected: true, workspace: ws.name, user: user?.user?.username || user?.user?.email || null })
    }
    if (body.action === 'channels') return json({ channels: await channels() })
    if (body.action === 'test') {
      const event = String(body.event || '')
      const { data: rule } = await db.from('notification_rules').select('*').eq('event', event).maybeSingle()
      if (!rule) return json({ error: 'Unknown event' }, 400)
      const ch = await channelFor(rule)
      const sample = event === 'day_closed' ? { date: todayLondon(), by: me.display_name } : SAMPLES[event] || {}
      const message = `🧪 _Test from the portal (${me.display_name})_\n` + await compose(event, sample)
      await post(ch.id, message)
      return json({ ok: true, channel: ch.name })
    }
    return json({ error: `Unknown action “${body.action}”` }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400)
  }
})
