// Reads HELM's orders into the portal, every minute (called by the database).
//
// Kept: each order's lines and what's in them, courier, channel, status,
// dates and tracking numbers. Never kept: anything about the customer — HELM sends names,
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

// ── Tracking numbers ─────────────────────────────────────────────────────────
// Found by what the field is called rather than one fixed name, so it works
// whichever way HELM nests it (on the order, its shipments or parcels).
// Only field names are ever reported back, never values next to customer details.
const TRACK_KEY = /(track|consign|awb|barcode|parcel_?(no|num|number|code))/i
const NOT_TRACK_KEY = /(url|link|status|date|_at$|type|courier|carrier|service|provider|name)/i
function findTracking(obj: any, path = '', out: { path: string, value: string }[] = [], depth = 0) {
  if (obj == null || depth > 6) return out
  if (Array.isArray(obj)) { obj.slice(0, 25).forEach(v => findTracking(v, `${path}[]`, out, depth + 1)); return out }
  if (typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    // Products carry barcodes too (EANs): never look inside the order's items
    if (/^(items|order_items|inventory|products?|lines)$/i.test(k)) continue
    const p = path ? `${path}.${k}` : k
    if ((typeof v === 'string' || typeof v === 'number') && TRACK_KEY.test(k) && !NOT_TRACK_KEY.test(k)
        && !(/(^id$|_id$)/i.test(k) && !/track/i.test(k))) {
      const val = String(v).trim().replace(/\s+/g, '')
      if (/^[A-Z0-9][A-Z0-9-]{7,39}$/i.test(val) && /\d{4}/.test(val)) out.push({ path: p, value: val.toUpperCase() })
    } else if (v && typeof v === 'object') findTracking(v, p, out, depth + 1)
  }
  return out
}
const uniq = <T,>(a: T[]) => [...new Set(a)]
// The layout of a reply, as field names and types only — never the values
function shapeOf(obj: any, path = '', out: string[] = [], depth = 0): string[] {
  if (out.length > 120 || depth > 4 || obj == null) return out
  if (Array.isArray(obj)) { out.push(`${path}[] (${obj.length})`); if (obj.length) shapeOf(obj[0], `${path}[]`, out, depth + 1); return out }
  if (typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k
    if (v && typeof v === 'object') shapeOf(v, p, out, depth + 1)
    else out.push(`${p}: ${v === null ? 'null' : typeof v}`)
  }
  return out
}
// Only a shipment that says it belongs to this order counts: a list that
// ignored the filter must never hand one order another order's number
const belongsTo = (x: any, id: number) => [x?.order_id, x?.order?.id, x?.orderId].some(v => v != null && Number(v) === id)

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

/**
 * Labelled orders' tracking numbers: first whatever is on the order itself,
 * then — for those still without one — HELM's shipments for that order.
 * Which fields and calls worked is kept in helm_sync.tracking_info.
 */
async function addTracking(orders: any[], info: any, maxLookups: number) {
  const paths: Record<string, number> = info.paths || {}
  const note = (found: { path: string }[], via: string) => found.forEach(f => { const k = `${via}:${f.path}`; paths[k] = (paths[k] || 0) + 1 })
  for (const o of orders) {
    const found = findTracking(o)
    note(found, 'order')
    o.__tracking = uniq(found.map(f => f.value))
  }
  // Ways to ask HELM for an order's shipments; the first that answers is remembered
  const ways: [string, (id: number) => [string, Record<string, string | number>]][] = [
    ['orders?includes=shipments', (id) => [`/orders/${id}`, { includes: 'shipments' }]],
    ['shipments?order_id', (id) => ['/shipments', { order_id: id }]],
    ['orders/{id}/shipments', (id) => [`/orders/${id}/shipments`, {}]],
  ]
  // A way counts as working once it has found a number; one that answers but
  // never has one (20 tries) is dropped, so nothing is asked about every minute for ever
  const tried: Record<string, string> = info.ways || {}
  const empty: Record<string, number> = info.empty || {}
  const usable = (name: string) => !tried[name] || tried[name] === 'ok' || tried[name] === 'answers'
  let lookups = 0
  for (const o of orders) {
    if (o.__tracking.length || lookups >= maxLookups) continue
    for (const [name, make] of ways) {
      if (!usable(name)) continue
      lookups++
      try {
        const [path, params] = make(Number(o.id))
        const r = await helm(path, params)
        let body = r?.data ?? r
        if (Array.isArray(body)) body = body.filter((x: any) => belongsTo(x, Number(o.id)))
        if (!info.shapes?.[name]) info.shapes = { ...(info.shapes || {}), [name]: shapeOf(r) }
        const found = findTracking(body)
        o.__checked = true                                     // HELM answered about this order
        note(found, name)
        if (found.length) { tried[name] = 'ok'; o.__tracking = uniq(found.map(f => f.value)); break }
        empty[name] = (empty[name] || 0) + 1
        tried[name] = tried[name] === 'ok' ? 'ok' : empty[name] >= 20 ? 'no tracking in it' : 'answers'
      } catch (e) {
        // Only a clear "no" (400, 404…) rules a way out; busy or down is tried again next time
        if (e instanceof HelmError && e.status >= 400 && e.status < 500 && e.status !== 429) tried[name] = `HTTP ${e.status}`
      }
    }
  }
  // Once: the layout of HELM's recent shipments and of a labelled order (field names
  // only), to see where tracking numbers live and how a shipment points at its order
  if (!info.probed) {
    info.probed = new Date().toISOString()
    try { info.shapes = { ...(info.shapes || {}), 'shipments (latest)': shapeOf(await helm('/shipments', { per_page: 3 })) } }
    catch (e) { info.shapes = { ...(info.shapes || {}), 'shipments (latest)': [String((e as Error)?.message || e).slice(0, 160)] } }
    if (orders[0]) info.shapes = { ...(info.shapes || {}), 'labelled order': shapeOf(orders[0]) }
  }
  // Once more: what a shipment can be asked to include, its full view, and
  // whether the order_id filter works on an order known to have a shipment
  if (!info.probed2) {
    info.probed2 = new Date().toISOString()
    const tracky = (lines: string[]) => lines.filter(l => /track|consign|barcode|parcel|label|package/i.test(l)).slice(0, 40)
    const p2: any = {}
    for (const inc of ['parcels', 'packages', 'labels', 'shipmentParcels', 'consignments', 'trackings']) {
      try { const r = await helm('/shipments', { per_page: 1, includes: inc }); p2[`includes=${inc}`] = tracky(shapeOf(r)) }
      catch (e) { p2[`includes=${inc}`] = e instanceof HelmError ? `HTTP ${e.status}` : 'failed' }
    }
    try {
      const first = (await helm('/shipments', { per_page: 1 }))?.data?.[0]
      if (first?.id) { try { p2['shipments/{id}'] = tracky(shapeOf(await helm(`/shipments/${first.id}`))) } catch (e) { p2['shipments/{id}'] = e instanceof HelmError ? `HTTP ${e.status}` : 'failed' } }
      if (first?.order_id) {
        try { p2['order_id filter on a known shipment'] = ((await helm('/shipments', { order_id: first.order_id }))?.data || []).length } catch (e) { p2['order_id filter on a known shipment'] = e instanceof HelmError ? `HTTP ${e.status}` : 'failed' }
      }
    } catch (e) { p2.error = String((e as Error)?.message || e).slice(0, 160) }
    p2['labelled orders with a HELM shipment'] = `${orders.filter(o => o.active_shipment_exists).length} of ${orders.length}`
    info.probe2 = p2
  }
  info.empty = empty
  info.paths = paths; info.ways = tried; info.lookups = lookups
  info.with_tracking = orders.filter(o => o.__tracking.length).length
  info.labelled = orders.length
  info.at = new Date().toISOString()
}

async function sync(opts: { backfillDays?: number } = {}) {
  if (!TOKEN) throw new Error('HELM_API_TOKEN is not set in the function secrets')
  const started = Date.now()
  const seen = new Map<number, any>()

  // 1. Everything not labelled yet
  for (const status of ACTIVE) for (const o of await listAll({ status })) seen.set(Number(o.id), o)

  // 2. Labelled recently (HELM "Despatched"): may not be uploaded to the portal yet
  //    (a backfill reaches further back, for tracking numbers on labels already uploaded)
  const back = Math.min(14, Math.max(0, Number(opts.backfillDays) || 0))
  const since = Date.now() - (back ? back * 24 : 36) * 3600_000
  const pages = back ? 12 : 2
  let recent: any[] = []
  try { recent = await listAll({ status: 8, sort_by: 'despatched_at', sort_direction: 'desc' }, pages) }
  catch { recent = await listAll({ status: 8, sort_by: 'updated_at', sort_direction: 'desc' }, pages).catch(() => []) }
  const labelled: any[] = []
  for (const o of recent) {
    const t = Date.parse(o.despatched_at || o.updated_at || '')
    if (t && t >= since) { seen.set(Number(o.id), o); labelled.push(o) }
  }

  // 2b. Their tracking numbers. Never allowed to stop the sync itself
  const { data: syncRow } = await db.from('helm_sync').select('tracking_info').eq('id', 1).maybeSingle()
  const info: any = { ...(syncRow?.tracking_info || {}) }
  // Already found (or already looked for and HELM had none)
  const known = new Set<number>()
  const ids = labelled.map(o => Number(o.id))
  for (let i = 0; i < ids.length; i += 200) {
    const { data: have } = await db.from('helm_orders').select('id').in('id', ids.slice(i, i + 200)).not('tracking', 'is', null)
    for (const r of have || []) known.add(Number(r.id))
  }
  try { await addTracking(labelled.filter(o => !known.has(Number(o.id))), info, back ? 300 : 15) }
  catch (e) { info.error = String((e as Error)?.message || e).slice(0, 200) }

  // 3. Orders we were following that have dropped out of the lists: look each one up
  const { data: following } = await db.from('helm_orders').select('id, status, closed_reason').is('closed_at', null)
  const { data: cleared } = await db.from('helm_orders').select('id').eq('closed_reason', 'cleared')
  const clearedIds = new Set((cleared || []).map(r => Number(r.id)))
  const missing = (following || []).filter(k => !seen.has(Number(k.id)) && k.status !== 8).slice(0, 60)
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
  // Tracking saved on its own, only where found, so a quiet minute never blanks one already known
  for (const o of labelled.filter(x => x.__tracking?.length || x.__checked)) {
    await db.from('helm_orders').update({ tracking: o.__tracking || [] }).eq('id', Number(o.id))
  }
  // Labelled orders that fell out of HELM's recent list stay as they are: they wait for their upload

  // Check the labels' tracking numbers against HELM's: verify, put right, or fill in
  const { data: applied } = await db.rpc('dispatch_apply_helm_tracking', { p_days: Math.max(30, back) })
  info.applied = applied || null
  await db.from('helm_sync').update({ tracking_info: info }).eq('id', 1)

  return { fetched: rows.length, gone: gone.length, tracking: { found: info.with_tracking, of: info.labelled, applied }, ms: Date.now() - started }
}

Deno.serve(async (req) => {
  const key = req.headers.get('x-notify-key')
  const { data: real } = await db.rpc('notify_key')
  if (!key || !real || key !== real) return json({ error: 'Not allowed' }, 403)
  const now = new Date().toISOString()
  let body: any = {}
  try { body = await req.json() } catch { /* the minute-by-minute call sends nothing */ }
  try {
    const r = await sync({ backfillDays: body?.backfill_days })
    await db.from('helm_sync').update({ last_run: now, last_ok: new Date().toISOString(), last_error: null, fetched: r.fetched, ms: r.ms }).eq('id', 1)
    return json({ ok: true, ...r })
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500)
    await db.from('helm_sync').update({ last_run: now, last_error: msg }).eq('id', 1)
    return json({ ok: false, error: msg }, 500)
  }
})
