// helm-tags v1 (15-11-2026): keeps each HELM order's TAGS (helm_orders.tags) — the owner tags every Prime order
// "Prime" in HELM and wants the tags, and a Prime / not Prime split, in the portal.
//
// A job of its own, every 5 minutes, so nothing in helm-sync (which Dispatch depends on every minute) changed. It asks
// HELM for orders with ONLY their tags (includes=tags.tag) — no items, no addresses, nothing about a customer — and
// saves the tag names through helm_orders_set_tags(), which only writes where they changed. It never creates an
// order: one helm-sync has not saved yet gets its tags on the next run.
//   Open orders (every status before the label) and the labelled orders of the last 36 hours, each run.
//   { "backfill_days": 14 } reaches further back through the labelled orders, once, by hand.
import { createClient } from 'npm:@supabase/supabase-js@2'

const TOKEN = Deno.env.get('HELM_API_TOKEN') || ''
const COMPANY = Deno.env.get('HELM_COMPANY_ID') || '1932'
const BASE = `https://app-api.helmwms.app/api/v2/companies/${COMPANY}`
const ACTIVE = [2, 3, 4, 5, 6, 7, 10, 11, 12]

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function helm(params: Record<string, string | number>): Promise<any> {
  const url = new URL(`${BASE}/orders`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } })
    if (res.status === 429) { await sleep(Math.min(10, parseInt(res.headers.get('Retry-After') || '2', 10)) * 1000); continue }
    const text = await res.text()
    if (!res.ok) throw new Error(`HELM ${res.status}: ${text.slice(0, 160)}`)
    return text ? JSON.parse(text) : null
  }
  throw new Error('HELM is busy (too many requests)')
}
async function listAll(params: Record<string, string | number>, maxPages: number) {
  const out: any[] = []
  let cursor = ''
  for (let page = 0; page < maxPages; page++) {
    const r = await helm({ ...params, per_page: 250, includes: 'tags.tag', ...(cursor ? { cursor } : {}) })
    out.push(...(r?.data || []))
    cursor = r?.meta?.next_cursor || ''
    if (!cursor) break
  }
  return out
}
// The tag names on an order; null when HELM did not send the list at all (never mistaken for "no tags")
const tagsOf = (o: any): string[] | null => (Array.isArray(o?.tags)
  ? [...new Set<string>(o.tags.map((t: any) => String(t?.tag?.name ?? t?.name ?? '').trim()).filter(Boolean))].slice(0, 20) : null)

async function run(backfillDays: number) {
  if (!TOKEN) throw new Error('HELM_API_TOKEN is not set in the function secrets')
  const started = Date.now()
  const seen = new Map<number, string[]>()
  const take = (orders: any[]) => { for (const o of orders) { const t = tagsOf(o); if (t && Number(o.id)) seen.set(Number(o.id), t) } }
  for (const status of ACTIVE) take(await listAll({ status }, 20))
  const back = Math.min(14, Math.max(0, backfillDays || 0))
  const since = Date.now() - (back ? back * 24 : 36) * 3600_000
  const recent = await listAll({ status: 8, sort_by: 'despatched_at', sort_direction: 'desc' }, back ? 14 : 2)
  take(recent.filter(o => { const t = Date.parse(o.despatched_at || o.updated_at || ''); return t && t >= since }))
  const rows = [...seen].map(([id, tags]) => ({ id, tags }))
  let changed = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db.rpc('helm_orders_set_tags', { p: rows.slice(i, i + 500) })
    if (error) throw new Error(`Saving tags: ${error.message}`)
    changed += Number(data) || 0
  }
  return { read: rows.length, tagged: rows.filter(r => r.tags.length).length, changed, ms: Date.now() - started }
}

Deno.serve(async (req) => {
  const key = req.headers.get('x-notify-key')
  const { data: real } = await db.rpc('notify_key')
  if (!key || !real || key !== real) return json({ error: 'Not allowed' }, 403)
  let body: any = {}
  try { body = await req.json() } catch { /* the scheduled call sends nothing */ }
  try { return json({ ok: true, ...(await run(Number(body?.backfill_days) || 0)) }) }
  catch (e) { return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 500) }, 500) }
})
