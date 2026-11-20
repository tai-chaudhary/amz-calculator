// helm-courier v1 (19-11-2026, v2.109.0): sets an OPEN order's courier service in HELM, from the Off Shore page.
//
// The ONE place the portal writes to HELM (the owner approved it on 19 Nov 2026 after a test: PATCH
// /orders/{id}/preferred-courier-service answers 204 on an open order and 422 on a despatched one). It only:
//   • acts for a signed-in user who may open the Off Shore page (helm_courier_allowed)
//   • sets a service that is listed against a carrier in Cost Settings (helmServices[].helmId) — nothing else
//   • touches an order that is open in HELM (not despatched, not cancelled, not locked), read fresh from HELM first
// and writes a line to helm_courier_changes for every try, worked or not. No customer details are read or kept.
import { createClient } from 'npm:@supabase/supabase-js@2'

const TOKEN = Deno.env.get('HELM_API_TOKEN') || ''
const COMPANY = Deno.env.get('HELM_COMPANY_ID') || '1932'
const BASE = `https://app-api.helmwms.app/api/v2/companies/${COMPANY}`
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function helm(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (!TOKEN) return json({ ok: false, error: 'HELM_API_TOKEN is not set' }, 500)
  // who is asking: their own session decides (helm_courier_allowed runs as them)
  const auth = req.headers.get('authorization') || ''
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: me } = await user.rpc('helm_courier_allowed')
  if (!me?.ok) return json({ ok: false, error: 'Not allowed' }, 403)

  const body = await req.json().catch(() => ({}))
  const orderId = Number(body?.order_id)
  const serviceId = Number(body?.courier_service_id)
  const ref = String(body?.ref || '').slice(0, 60) || null
  if (!orderId || !serviceId) return json({ ok: false, error: 'An order and a service are needed' }, 400)

  const log = (ok: boolean, note: string, from: number | null = null) =>
    admin.rpc('helm_courier_log', { p: { order_id: orderId, order_ref: ref, from_service: from, to_service: serviceId, by_name: me.name || null, ok, note } })

  // the service must be one set against a carrier in Cost Settings
  const { data: st } = await admin.from('settings').select('value').eq('key', 'app_settings').maybeSingle()
  const allowed = new Set<number>()
  for (const c of Object.values((st?.value?.carriers || {}) as Record<string, any>)) for (const s of (c?.helmServices || [])) if (Number(s?.helmId)) allowed.add(Number(s.helmId))
  if (!allowed.has(serviceId)) { await log(false, 'Service not set against a carrier in Cost Settings'); return json({ ok: false, error: 'That service is not set against a carrier in Cost Settings' }, 400) }

  // the order, fresh from HELM: still open, not locked
  const got = await helm(`/orders/${orderId}`)
  if (got.status !== 200) { await log(false, `HELM ${got.status} reading the order`); return json({ ok: false, error: `HELM could not find the order (${got.status})` }, 400) }
  const o = got.body?.data || got.body || {}
  const from = Number(o?.preferred_courier_service?.courier_service_id ?? o?.preferred_courier_service_id) || null
  const status = Number(o?.status ?? o?.status_id)
  // HELM's open statuses (as helm-tags): anything else is despatched, cancelled or not started
  if (![2, 3, 4, 5, 6, 7, 10, 11, 12].includes(status) || o?.despatched_at) { await log(false, `Order not open (status ${status})`, from); return json({ ok: false, error: 'This order is no longer open in HELM' }, 409) }
  if (o?.is_locked) { await log(false, 'Order locked in HELM', from); return json({ ok: false, error: 'This order is locked in HELM (someone is working on it)' }, 409) }
  if (from === serviceId) { await log(true, 'Already set', from); return json({ ok: true, unchanged: true }) }

  const put = await helm(`/orders/${orderId}/preferred-courier-service`, { method: 'PATCH', body: JSON.stringify({ courier_service_id: serviceId }) })
  if (put.status >= 200 && put.status < 300) { await log(true, `HELM ${put.status}`, from); return json({ ok: true, from }) }
  const msg = put.body?.message || put.body?.error || `HELM ${put.status}`
  await log(false, `HELM ${put.status}: ${String(msg).slice(0, 200)}`, from)
  return json({ ok: false, error: `HELM said: ${msg}` }, 400)
})
