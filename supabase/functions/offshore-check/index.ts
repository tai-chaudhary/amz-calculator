// offshore-check v1 (19-11-2026, v2.109.0): the off shore engine — one place that works out, for every open HELM
// order going to a remote postcode, the cheapest ACTIVE carrier, how many parcels (25kg most each) and what it costs
// over mainland. offshore.js is a copy of src/lib/offshore.js (the P&L uses the same zones).
//
// Two callers:
//   • the cron job 'offshore-check' (x-notify-key): every 15 minutes in the working day; the orders where even the
//     cheapest way is over £10 more than mainland, or that no active carrier can take, go to offshore_alert_queue(),
//     which sends one ClickUp message per order, once.
//   • the Off Shore page (the user's own session; anyone given that page): { view: true } → the orders and their
//     suggestions. £ figures only for people who see costs — the warehouse never sees what anything costs.
// Reads only; never writes to HELM (helm-courier does that, when someone presses the button).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { bestCarrier, unitsOf, zonesOf, areaName, OFFSHORE_ALERT_GBP, isActive, takesPrime, parcelCap } from './offshore.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-key',
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const londonDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

// A listing's weight and how many units are in it (a 2 × 10kg bundle: 20kg, 2 units)
function listingWeight(d: any) {
  const units = Math.max(1, parseInt(d?.bundleQty) || 1)
  const kg = !d?.weightOverride && units > 1 ? (parseFloat(d?.weightPerItem) || 0) * units : parseFloat(d?.weightKg) || 0
  return { kg, units }
}

async function work() {
  const { data: st, error: e1 } = await db.from('settings').select('value').eq('key', 'app_settings').maybeSingle()
  if (e1) throw new Error(`Settings: ${e1.message}`)
  const settings = st?.value || {}
  const carriers = settings.carriers || {}
  const zones = zonesOf(settings)
  const surcharges = settings.carrierSurcharges || []
  const day = londonDay()
  const { data: orders, error: e2 } = await db.rpc('offshore_orders_all')
  if (e2) throw new Error(`Orders: ${e2.message}`)
  const all = (orders || []) as any[]
  const offshore = zones.length ? all.filter(o => o.district && areaName(zones, o.district, day)) : []
  const skus = [...new Set(offshore.flatMap(o => (o.listings || []).map((l: any) => String(l.listing_sku || '').trim())).filter(Boolean))]
  const kgBySku = new Map<string, any>()
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await db.from('saved_products').select('data').in('data->>listingSku', skus.slice(i, i + 200))
    for (const r of data || []) kgBySku.set(String(r.data?.listingSku || '').trim().toLowerCase(), listingWeight(r.data))
  }
  // HELM service names → carrier (to tell whether the order is already on the suggested carrier)
  const svcCarrier = new Map<string, string>()
  for (const [cid, c] of Object.entries(carriers as Record<string, any>)) for (const s of (c?.helmServices || [])) if (s?.name) svcCarrier.set(String(s.name).trim().toLowerCase(), cid)
  const rows = offshore.map(o => {
    const w = unitsOf(o, kgBySku)
    const curCid = svcCarrier.get(String(o.service || '').trim().toLowerCase()) || null
    const r = bestCarrier({ carriers, unitsKg: w.unitsKg, district: o.district, prime: !!o.prime, day, zones, surcharges, currentCarrierName: curCid ? carriers[curCid]?.name : o.carrier })
    const services = r.best ? (carriers[r.best.carrierId]?.helmServices || []).filter((s: any) => Number(s?.helmId)).map((s: any) => ({ id: Number(s.helmId), name: s.name, level: s.service })) : []
    return {
      id: o.id, ref: o.ref, order_number: o.order_number, channel: o.channel, status: o.status, is_hold: o.is_hold,
      order_date: o.order_date, ship_by: o.ship_by, prime: !!o.prime, district: o.district, area: areaName(zones, o.district, day),
      helm_carrier: o.carrier, helm_service: o.service, helm_carrier_id: curCid,
      lines: (o.lines || []).map((l: any) => ({ code: l.code, name: l.product || l.name, qty: l.qty, kg: l.kg })),
      units_kg: w.unitsKg, weight_unknown: w.unknown, weight_from_listing: !!(w as any).fromListing,
      kg: Math.round(w.unitsKg.reduce((a: number, b: number) => a + b, 0) * 100) / 100,
      status_off: r.status, best: r.best, options: r.options, refused: r.refused, services,
      on_best: !!(r.best && curCid === r.best.carrierId),
      delivery_paid: o.delivery_paid,
    }
  })
  const carrierList = Object.entries(carriers as Record<string, any>).map(([id, c]) => ({ id, name: c?.name, active: isActive(c), prime: takesPrime(c), cap: parcelCap(c) }))
  return { day, rows, carriers: carrierList, open: all.length }
}

// strip every £ figure (and the delivery charge paid) for people who don't see costs
function costFree(x: any) {
  const q = (o: any) => (o ? { carrierId: o.carrierId, name: o.name, boxes: o.boxes, zone: o.zone ? { name: o.zone.name } : null, why: o.why } : o)
  return { ...x, rows: x.rows.map((r: any) => ({ ...r, delivery_paid: undefined, best: q(r.best), options: r.options.map(q), refused: r.refused })) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  let body: any = {}
  try { body = await req.json() } catch { /* the scheduled call sends nothing */ }
  try {
    const key = req.headers.get('x-notify-key')
    if (key) {
      const { data: real } = await db.rpc('notify_key')
      if (!real || key !== real) return json({ error: 'Not allowed' }, 403)
      const w = await work()
      const over = w.rows.filter((r: any) => !r.weight_unknown && r.units_kg.length && ((r.best && r.best.extra > OFFSHORE_ALERT_GBP) || r.status_off === 'no-carrier'))
        .map((r: any) => ({ ref: r.ref || r.order_number || String(r.id), district: r.district, area: r.area, extra: r.best ? r.best.extra : null,
          carrier: r.best ? r.best.name : 'no active carrier can take it', parcels: r.best ? r.best.boxes.length : 0, prime: r.prime }))
      if (body?.dry) return json({ ok: true, checked: w.rows.length, over })
      const { data: n, error } = await db.rpc('offshore_alert_queue', { p: over })
      if (error) throw new Error(`Alert: ${error.message}`)
      return json({ ok: true, checked: w.rows.length, over: over.length, alerted: Number(n) || 0 })
    }
    // the page: the user's own session decides
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('authorization') || '' } }, auth: { persistSession: false } })
    const { data: me } = await user.rpc('helm_courier_allowed')
    if (!me?.ok) return json({ ok: false, error: 'Not allowed' }, 403)
    const w = await work()
    return json({ ok: true, costs: !!me.costs, ...(me.costs ? w : costFree(w)) })
  } catch (e) { return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 500) }, 500) }
})
