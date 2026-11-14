// Delivery tracking from HELM.
// Every half hour: the last 30 days of shipments, each parcel's tracking
// status and history, saved to helm_parcels for the Delivery tracking page.
// Read only towards HELM. No customer details are kept: no names, addresses,
// phone numbers or emails, and courier messages are cleaned of anything that
// could name a person or a place.
// Body: { days?: number (max 45), fetch_orders?: number, probe?: true } — probe returns field names
// and counts only, saving nothing.
import { createClient } from 'npm:@supabase/supabase-js@2'

const TOKEN = Deno.env.get('HELM_API_TOKEN') || ''
const COMPANY = Deno.env.get('HELM_COMPANY_ID') || '1932'
const BASE = `https://app-api.helmwms.app/api/v2/companies/${COMPANY}`
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const BASE_INCLUDES = 'parcels.tracking.timeline,courierService.courier'

async function helm(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) { const e: any = new Error(`HELM ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e }
  return text ? JSON.parse(text) : null
}
function shapeOf(obj: any, path = '', out: string[] = [], depth = 0): string[] {
  if (out.length > 200 || depth > 6 || obj == null) return out
  if (Array.isArray(obj)) { out.push(`${path}[] (${obj.length})`); if (obj.length) shapeOf(obj[0], `${path}[]`, out, depth + 1); return out }
  if (typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k
    if (v && typeof v === 'object') shapeOf(v, p, out, depth + 1)
    else out.push(`${p}: ${v === null ? 'null' : typeof v}`)
  }
  return out
}

const STATUS: Record<number, string> = { 1: 'BOOKED', 2: 'COLLECTED', 3: 'AT_HUB', 4: 'IN_TRANSIT', 5: 'OUT_FOR_DELIVERY', 6: 'FAILED_ATTEMPT', 7: 'DELIVERED', 8: 'ON_HOLD', 9: 'ADDRESS_ISSUE', 10: 'RETURNED_TO_SENDER', 11: 'TRACKING_EXPIRED', 12: 'CANCELLED', 13: 'AWAITING_CUSTOMER_COLLECTION', 14: 'TRACKING_NOT_SUPPORTED' }

// Courier messages are mostly fixed text ("ArrivedAtCarrierFacility"), but some
// say who signed or where it was left. Keep the useful part, drop the rest.
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi
function clean(text: unknown): string | null {
  let t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  t = t.replace(/\b(signed(?: for)? by|received by|left with|delivered to|handed to|collected by|accepted by|recipient|name|contact)\b\s*[:\-]?\s*.*/i, '$1 …')
  t = t.replace(POSTCODE, '…').replace(/\S+@\S+/g, '…').replace(/\+?\d[\d ]{8,}\d/g, '…')
  return t.slice(0, 120)
}

// Some couriers put the postcode in the tracking link: take it out
function safeUrl(u: unknown): string | null {
  try {
    const url = new URL(String(u || ''))
    for (const [k, v] of [...url.searchParams]) if (/post|zip|name|mail|phone/i.test(k) || new RegExp(POSTCODE.source, 'i').test(v)) url.searchParams.delete(k)
    return url.toString()
  } catch { return null }
}

const CHANNELS: Record<string, string> = { amazonsp: 'Amazon', amazon: 'Amazon', ebay: 'eBay', tiktok: 'TikTok', tiktokshop: 'TikTok', shopify: 'Shopify', woocommerce: 'WooCommerce', manual: 'Manual' }

function itemsOf(o: any) {
  if (!o) return null
  const items: any[] = (o.items || []).filter((i: any) => !i.is_service_charge && !i.deleted_at && !i.order_item_parent_id)
  const lines = items.map(i => ({ code: i.inventory?.code || i.channel_product_sku || '', qty: Number(i.quantity) || 0, name: String(i.name || '').trim() }))
    .filter(i => (i.code || i.name) && i.qty > 0)
  return lines.length ? lines : null
}

function rowsOf(s: any) {
  const courier = s.courier_service?.courier
  const carrier = courier?.friendly_courier_name || courier?.name || (s.courier_id ? `Courier ${s.courier_id}` : null)
  const base = {
    shipment_id: Number(s.id),
    order_id: s.order_id ? Number(s.order_id) : null,
    order_ref: null as string | null,
    channel: null as string | null,
    items: null as any,
    carrier,
    service: s.courier_service?.name || s.courier_service?.friendly_name || null,
    shipment_status: s.status == null ? null : Number(s.status),
    shipped_at: s.created_at || null,
    expected_at: s.excepted_delivery_date || s.expected_delivery_date || null,
  }
  return (s.parcels || []).map((p: any, i: number) => {
    const t = p.tracking || null
    const events = (t?.timeline || [])
      .map((e: any) => ({ s: Number(e.status) || null, at: e.created_at, d: clean(e.description) }))
      .filter((e: any) => e.at)
      .sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at))
    const last = events[events.length - 1]
    const first = (codes: number[]) => events.find((e: any) => codes.includes(e.s))?.at || null
    return {
      id: Number(p.id) || Number(s.id) * 100 + i,
      ...base,
      parcel_no: i + 1,
      parcels: (s.parcels || []).length,
      tracking: t?.code || p.tracking_code || null,
      tracking_url: safeUrl(t?.url || t?.carrier_url),
      status: t?.status == null ? null : Number(t.status),
      collected_at: first([2, 3, 4, 5, 6, 7]),
      delivered_at: first([7]) || (Number(t?.status) === 7 ? (s.delivered_date || last?.at || null) : null),
      problem_at: first([6, 8, 9, 10]),
      returned_at: first([10]),
      last_event_at: last?.at || null,
      last_event: last ? [STATUS[last.s as number] || last.s, last.d].filter(Boolean).join(' · ') : null,
      events,
      synced_at: new Date().toISOString(),
    }
  })
}

Deno.serve(async (req) => {
  const key = req.headers.get('x-notify-key')
  const { data: real } = await db.rpc('notify_key')
  if (!key || !real || key !== real) return json({ error: 'Not allowed' }, 403)
  const body = await req.json().catch(() => ({}))
  const days = Math.min(Math.max(Number(body?.days) || 30, 1), 45)
  const out: any = { days }
  try {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
    const list: any[] = []
    let cursor = ''
    for (let page = 0; page < 40; page++) {
      const r = await helm('/shipments', { per_page: 250, includes: BASE_INCLUDES, created_at_from: since, ...(cursor ? { cursor } : {}) })
      list.push(...(r?.data || [])); cursor = r?.meta?.next_cursor || ''
      if (!cursor) break
    }
    out.shipments = list.length
    if (body?.probe) {
      out.shape = shapeOf(list.find((s: any) => s.parcels?.length) || list[0])
        .filter(f => !/address|name|phone|email|postcode|city|street|county|line_?\d/i.test(f) || /courier|service|items\[\]\.name|channel\.name/i.test(f))
      return json(out)
    }
    const rows = list.flatMap(rowsOf)
    // HELM won't send the order with the shipment, so the lines come from (in turn) the
    // orders the portal already has, what was saved on an earlier run, and HELM's order
    // itself — a few dozen a run, lines only, until every parcel has them.
    const known: Record<number, any> = {}
    const need = () => [...new Set(rows.filter(r => r.order_id && !known[r.order_id]).map(r => r.order_id as number))]
    for (const [table, cols] of [['helm_orders', 'id, ref, channel, items'], ['helm_parcels', 'order_id, order_ref, channel, items']]) {
      const ids = need()
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await db.from(table).select(cols).in(table === 'helm_orders' ? 'id' : 'order_id', ids.slice(i, i + 300)).not('items', 'is', null)
        for (const o of (data || []) as any[]) known[o.id ?? o.order_id] ||= { ref: o.ref ?? o.order_ref, channel: o.channel, items: o.items }
      }
    }
    const fetchNow = need().slice(0, Number(body?.fetch_orders) || 60)
    for (let i = 0; i < fetchNow.length; i += 6) {
      await Promise.all(fetchNow.slice(i, i + 6).map(async id => {
        try {
          const r = await helm(`/orders/${id}`, { includes: 'items,items.inventory,channel' })
          const o = r?.data || r
          const provider = String(o?.channel?.provider || '').toLowerCase()
          known[id] = { ref: o?.remote_id || o?.primary_reference_id || o?.order_number || null, channel: CHANNELS[provider] || o?.channel?.name || provider || null, items: itemsOf(o) }
        } catch { /* try again next run */ }
      }))
    }
    out.orders_fetched = fetchNow.length
    for (const r of rows) {
      const o = r.order_id ? known[r.order_id] : null
      if (o) { r.items = o.items; r.order_ref = o.ref; r.channel = o.channel }
    }
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await db.from('helm_parcels').upsert(rows.slice(i, i + 400), { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    out.parcels = rows.length
    out.with_items = rows.filter(r => r.items).length
    await db.from('helm_tracking_sync').upsert({ id: 1, last_run: new Date().toISOString(), last_ok: new Date().toISOString(), last_error: null, parcels: rows.length })
  } catch (e) {
    out.error = String(e)
    if (!body?.probe) await db.from('helm_tracking_sync').upsert({ id: 1, last_run: new Date().toISOString(), last_error: out.error.slice(0, 300) })
  }
  return json(out)
})
