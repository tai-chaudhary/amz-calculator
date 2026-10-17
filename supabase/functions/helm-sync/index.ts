// Reads HELM's orders into the portal, every minute (called by the database).
//
// Kept: each order's lines and what's in them, courier, channel, status and
// dates. Never kept: anything about the customer — HELM sends names,
// addresses, phones and emails with every order, and they're dropped here.
// The HELM key lives in this function's secrets (HELM_API_TOKEN) and is never
// sent anywhere but HELM.
import { createClient } from 'npm:@supabase/supabase-js@2'

const TOKEN = Deno.env.get('HELM_API_TOKEN') || ''
const COMPANY = Deno.env.get('HELM_COMPANY_ID') || '1932'
const BASE = `https://app-api.helmwms.app/api/v2/companies/${COMPANY}`
const INCLUDES = 'items,items.inventory,channel,preferredCourierService.courierService.courier'
// Everything before the label: New Order, Processing, Picking, Partially picked, Picked, Packing, Sorting, Sorted, Back order
const ACTIVE = [2, 3, 4, 5, 6, 7, 10, 11, 12]

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

class HelmError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }

async function helm(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } })
    if (res.status === 429) { await sleep(Math.min(10, parseInt(res.headers.get('Retry-After') || '2', 10)) * 1000); continue }
    const text = await res.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!res.ok) throw new HelmError(res.status, `HELM ${res.status}: ${body?.detail || body?.title || text.slice(0, 160)}`)
    return body
  }
  throw new HelmError(429, 'HELM is busy (too many requests)')
}

async function listAll(params: Record<string, string | number>, maxPages = 20) {
  const out: any[] = []
  let cursor = ''
  for (let page = 0; page < maxPages; page++) {
    const r = await helm('/orders', { ...params, per_page: 250, includes: INCLUDES, ...(cursor ? { cursor } : {}) })
    out.push(...(r?.data || []))
    cursor = r?.meta?.next_cursor || ''
    if (!cursor) break
  }
  return out
}

// The warehouse just says Evri or DHL, however it was bought
function carrierOf(o: any) {
  const pcs = o.preferred_courier_service
  const svc = pcs?.courier_service
  const words = [svc?.name, svc?.shipping_service_id, svc?.courier?.name, svc?.courier?.friendly_courier_name].filter(Boolean).join(' ')
  if (/evri|hermes/i.test(words)) return { carrier: 'Evri', service: svc?.name || '' }
  if (/dhl/i.test(words)) return { carrier: 'DHL', service: svc?.name || '' }
  if (/royal\s*mail/i.test(words)) return { carrier: 'Royal Mail', service: svc?.name || '' }
  if (/parcelforce/i.test(words)) return { carrier: 'Parcelforce', service: svc?.name || '' }
  return { carrier: svc?.courier?.friendly_courier_name || svc?.courier?.name || '', service: svc?.name || '' }
}

const CHANNELS: Record<string, string> = { amazonsp: 'Amazon', amazon: 'Amazon', ebay: 'eBay', tiktok: 'TikTok', tiktokshop: 'TikTok', shopify: 'Shopify', woocommerce: 'WooCommerce', manual: 'Manual' }

function toRow(o: any) {
  const items: any[] = (o.items || []).filter((i: any) => !i.is_service_charge && !i.deleted_at)
  const codeOf = (i: any) => i.inventory?.code || i.channel_product_sku || ''
  // The lines as on the packing slip: top level only (a bundle is one line)
  const lines = items.filter(i => !i.order_item_parent_id)
    .map(i => ({ code: codeOf(i), qty: Number(i.quantity) || 0, name: String(i.name || '').trim() }))
    .filter(i => i.code && i.qty > 0)
  // What's actually in it: every real product, bundles opened into their parts
  const units = items.filter(i => !Number(i.is_group))
    .map(i => ({ code: codeOf(i), qty: Number(i.total_quantity ?? i.quantity) || 0, name: String(i.name || '').trim() }))
    .filter(i => i.code && i.qty > 0)
  const keys = [...new Set([o.order_number, o.remote_id, o.remote_alt_id, o.primary_reference_id, o.external_order_id]
    .map(norm).filter(k => k.length >= 5))]
  const provider = String(o.channel?.provider || '').toLowerCase()
  const { carrier, service } = carrierOf(o)
  const status = Number(o.status)
  return {
    id: Number(o.id),
    order_number: o.order_number || null,
    ref: o.remote_id || o.primary_reference_id || o.order_number || null,
    keys,
    channel: CHANNELS[provider] || o.channel?.name || provider || null,
    carrier: carrier || null,
    service: service || null,
    status,
    is_hold: !!o.is_hold,
    items: lines,
    units,
    order_date: o.order_date || o.created_at || null,
    ship_by: o.despatch_target_date || null,     // HELM's despatch target, when it has one
    labelled_at: status === 8 ? (o.despatched_at || o.updated_at || new Date().toISOString()) : null,
    last_seen: new Date().toISOString(),
    closed_at: status === 9 || status === 1 ? (o.cancelled_at || new Date().toISOString()) : null,
    closed_reason: status === 9 ? 'cancelled' : status === 1 ? 'draft' : null,
  }
}

async function sync() {
  if (!TOKEN) throw new Error('HELM_API_TOKEN is not set in the function secrets')
  const started = Date.now()
  const seen = new Map<number, any>()

  // 1. Everything not labelled yet
  for (const status of ACTIVE) for (const o of await listAll({ status })) seen.set(Number(o.id), o)

  // 2. Labelled recently (HELM "Despatched"): may not be uploaded to the portal yet
  const since = Date.now() - 36 * 3600_000
  let recent: any[] = []
  try { recent = await listAll({ status: 8, sort_by: 'despatched_at', sort_direction: 'desc' }, 2) }
  catch { recent = await listAll({ status: 8, sort_by: 'updated_at', sort_direction: 'desc' }, 2).catch(() => []) }
  for (const o of recent) {
    const t = Date.parse(o.despatched_at || o.updated_at || '')
    if (t && t >= since) seen.set(Number(o.id), o)
  }

  // 3. Orders we were following that have dropped out of the lists: look each one up
  const { data: known } = await db.from('helm_orders').select('id, status, closed_reason').is('closed_at', null)
  const { data: cleared } = await db.from('helm_orders').select('id').eq('closed_reason', 'cleared')
  const clearedIds = new Set((cleared || []).map(r => Number(r.id)))
  const missing = (known || []).filter(k => !seen.has(Number(k.id)) && k.status !== 8).slice(0, 60)
  const gone: number[] = []
  for (const k of missing) {
    try {
      const r = await helm(`/orders/${k.id}`, { includes: INCLUDES })
      const o = r?.data || r
      if (o?.id) seen.set(Number(o.id), o)
    } catch (e) {
      if (e instanceof HelmError && e.status === 404) gone.push(Number(k.id))
    }
  }

  const rows = [...seen.values()].map(toRow).filter(r => r.id && !clearedIds.has(r.id))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('helm_orders').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) throw new Error(`Saving orders: ${error.message}`)
  }
  if (gone.length) await db.from('helm_orders').update({ closed_at: new Date().toISOString(), closed_reason: 'gone' }).in('id', gone)
  // Labelled orders that fell out of HELM's recent list stay as they are: they wait for their upload

  return { fetched: rows.length, gone: gone.length, ms: Date.now() - started }
}

Deno.serve(async (req) => {
  const key = req.headers.get('x-notify-key')
  const { data: real } = await db.rpc('notify_key')
  if (!key || !real || key !== real) return json({ error: 'Not allowed' }, 403)
  const now = new Date().toISOString()
  try {
    const r = await sync()
    await db.from('helm_sync').update({ last_run: now, last_ok: new Date().toISOString(), last_error: null, fetched: r.fetched, ms: r.ms }).eq('id', 1)
    return json({ ok: true, ...r })
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500)
    await db.from('helm_sync').update({ last_run: now, last_error: msg }).eq('id', 1)
    return json({ ok: false, error: msg }, 500)
  }
})
