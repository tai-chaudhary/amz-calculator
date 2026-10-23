// Reads online wholesalers' public catalogues into supplier_products.
//
// Runs in short chunks and remembers where it got to, so a large catalogue
// is read over several runs rather than all at once. Polite by design:
// one request at a time, a pause between each, a nightly cap per supplier,
// and it backs off if a site says it's busy.
import { createClient } from 'npm:@supabase/supabase-js@2'

const UA = 'HomeyInternational-CatalogueSync/1.0 (price and stock checks for our own trade orders)'
const DEFAULT_BUDGET_MS = 50_000
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

// The scheduler sends the private key; the portal sends a signed-in user's token
async function authorised(req: Request) {
  const key = req.headers.get('x-sync-key')
  if (key) {
    const { data } = await admin.rpc('supplier_sync_key')
    return !!data && data === key
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data, error } = await admin.auth.getUser(token)
  return !error && !!data?.user
}

function normBarcode(v: unknown) {
  let b = String(v ?? '').replace(/\D/g, '')
  if (!b) return null
  if (b.length === 14 && b.startsWith('0')) b = b.slice(1)
  if (b.length === 11 || b.length === 12) b = b.padStart(13, '0')
  return [8, 13, 14].includes(b.length) ? b : null
}

async function upsertRows(rows: Record<string, unknown>[]) {
  // The database won't update the same product twice in one statement
  const unique = [...new Map(rows.map(r => [String(r.supplier_sku).toLowerCase(), r])).values()]
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await admin.from('supplier_products')
      .upsert(unique.slice(i, i + 500), { onConflict: 'supplier_id,supplier_sku' })
    if (error) throw new Error(`Saving products: ${error.message}`)
  }
}

// Progress is saved after every page, so a run that gets cut off carries on
// from where it stopped next time instead of starting again
async function saveState(s: any, st: any) {
  st.lockedUntil = new Date(Date.now() + 70_000).toISOString()
  await admin.from('sync_state').upsert({ supplier_id: s.id, state: st, updated_at: new Date().toISOString() })
}

// Wholesale sites often price by the case: "Ant Killer 200g - Case of 12"
function caseSizeOf(title: string) {
  const m = String(title || '').match(/\b(?:case|outer)\s+of\s+(\d{1,4})\b/i)
  return m ? parseInt(m[1]) : 1
}

// Turn the price a site shows into a per-item cost comparable with your own:
// divided by the case size, and without VAT where the site includes it
function unitCostFrom(shown: number, title: string, cfg: any) {
  const caseSize = caseSizeOf(title)
  const exVat = cfg.pricesIncludeVat ? shown / 1.2 : shown
  return { unit: +(exVat / caseSize).toFixed(4), caseSize, shown, vatIncluded: !!cfg.pricesIncludeVat }
}

// ── Shopify stores publish their catalogue as data ──────────────────────────
async function runShopify(s: any, cfg: any, st: any, deadline: number, cap: number) {
  const c = st.cycle
  const today = new Date().toISOString().slice(0, 10)
  while (Date.now() < deadline - 8000 && c.nightCount < cap) {
    const page = c.pos + 1
    const res = await fetch(`${cfg.base}/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (res.status === 429 || res.status >= 500) {
      c.errors++
      if (c.errors > 20) throw new Error(`${cfg.base} keeps answering ${res.status} — stopping for now`)
      await sleep(8000)
      continue
    }
    // Shopify only pages through the first 100 pages; beyond that it refuses.
    // That's the end of what we can read in bulk — watched products fill the gap.
    if (res.status === 400 && page > 1) { c.done = true; c.capped = true; return }
    if (!res.ok) throw new Error(`HTTP ${res.status} reading ${cfg.base}`)
    const products = (await res.json()).products || []
    c.nightCount++
    if (!products.length) { c.done = true; return }

    const now = new Date().toISOString()
    const rows: Record<string, unknown>[] = []
    for (const p of products) {
      for (const v of p.variants || []) {
        const price = parseFloat(v.price)
        if (!(price > 0)) continue
        const name = p.title + (v.title && v.title !== 'Default Title' ? ` - ${v.title}` : '')
        const cost = unitCostFrom(price, name, cfg)
        rows.push({
          supplier_id: s.id,
          supplier_sku: String(v.sku || '').trim() || `V${v.id}`,
          barcode: normBarcode(v.barcode),
          name,
          unit_cost: cost.unit,
          list_date: today,
          updated_at: now,
          data: {
            source: 'online', url: `${cfg.base}/products/${p.handle}`,
            shownPrice: cost.shown, caseSize: cost.caseSize, vatIncluded: cost.vatIncluded,
            vendor: p.vendor || null, productType: p.product_type || null,
            available: !!v.available, stock: v.available ? null : 0,
            weightKg: v.grams ? +(v.grams / 1000).toFixed(3) : null,
            siteUpdated: v.updated_at || p.updated_at || null,
            flags: v.available ? [] : ['out of stock'],
          },
        })
      }
    }
    await upsertRows(rows)
    c.seen += rows.length
    c.pos = page
    await saveState(s, st)
    await sleep(700)
  }
}

// ── Other shops: product pages listed in their sitemap ──────────────────────
function locsWithLastmod(xml: string) {
  const out: { loc: string; lastmod: string | null }[] = []
  for (const block of xml.split(/<\/url>|<\/sitemap>/i)) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1]
    if (loc) out.push({ loc, lastmod: block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] || null })
  }
  return out
}

function productFromHtml(html: string) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const found: any[] = []
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1].trim())
      const walk = (x: any) => {
        if (!x || typeof x !== 'object') return
        if (Array.isArray(x)) return x.forEach(walk)
        const t = x['@type']
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) found.push(x)
        if (x['@graph']) walk(x['@graph'])
      }
      walk(j)
    } catch { /* malformed block on their page — skip it */ }
  }
  const p = found[0]
  if (!p) return null
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers
  const price = parseFloat(offer?.price ?? offer?.lowPrice)
  return {
    name: String(p.name || '').trim(),
    sku: String(p.sku || p.mpn || '').trim(),
    barcode: normBarcode(p.gtin13 || p.gtin || p.gtin14 || p.gtin12 || p.gtin8),
    price: Number.isFinite(price) ? price : null,
    available: offer?.availability ? /InStock/i.test(String(offer.availability)) : null,
    brand: typeof p.brand === 'string' ? p.brand : p.brand?.name || null,
  }
}

async function runSitemap(s: any, cfg: any, st: any, deadline: number, cap: number) {
  const c = st.cycle
  if (!c.urls) {
    const first = await (await fetch(`${cfg.base}/sitemap.xml`, { headers: { 'User-Agent': UA } })).text()
    let entries = locsWithLastmod(first)
    if (/<sitemapindex/i.test(first)) {
      const all: typeof entries = []
      for (const sm of entries) {
        all.push(...locsWithLastmod(await (await fetch(sm.loc, { headers: { 'User-Agent': UA } })).text()))
        await sleep(600)
      }
      entries = all
    }
    // Product pages are single-level paths; category pages start "wholesale-"
    const origin = new URL(cfg.base).origin
    entries = entries.filter(e => {
      try {
        const u = new URL(e.loc)
        const parts = u.pathname.split('/').filter(Boolean)
        return u.origin === origin && parts.length === 1 && !parts[0].startsWith('wholesale-')
      } catch { return false }
    })
    const lastmods: Record<string, string> = {}
    entries.forEach(e => { if (e.lastmod) lastmods[e.loc] = e.lastmod })
    const prev = st.lastmods || null
    // With dates to compare, only re-read pages that changed since last time
    const urls = prev && Object.keys(lastmods).length
      ? entries.filter(e => !e.lastmod || prev[e.loc] !== e.lastmod).map(e => e.loc)
      : entries.map(e => e.loc)
    c.urls = urls
    c.total = urls.length
    c.sitemapTotal = entries.length
    c.newLastmods = lastmods
    c.noPrice = 0
  }

  const today = new Date().toISOString().slice(0, 10)
  const rows: Record<string, unknown>[] = []
  while (c.pos < c.urls.length && Date.now() < deadline - 8000 && c.nightCount < cap) {
    const url = c.urls[c.pos]
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }).catch(() => null)
    if (res && (res.status === 429 || res.status === 503)) {
      c.errors++
      if (c.errors > 30) throw new Error(`${cfg.base} is asking us to slow down — stopping for now`)
      await sleep(15000)
      continue
    }
    c.pos++
    c.nightCount++
    if (!res || !res.ok) { c.errors++; await sleep(500); continue }
    const p = productFromHtml(await res.text())
    if (p?.name) {
      if (p.price === null) c.noPrice++
      rows.push({
        supplier_id: s.id,
        supplier_sku: p.sku || new URL(url).pathname.replace(/^\//, ''),
        barcode: p.barcode,
        name: p.name,
        unit_cost: p.price,
        list_date: today,
        updated_at: new Date().toISOString(),
        data: {
          source: 'online', url, brand: p.brand, available: p.available,
          stock: p.available === false ? 0 : null,
          flags: [...(p.available === false ? ['out of stock'] : []), ...(p.price === null ? ['no price shown'] : [])],
        },
      })
      c.seen++
    }
    if (rows.length >= 100) { await upsertRows(rows.splice(0)); await saveState(s, st) }
    await sleep(400)
  }
  if (rows.length) await upsertRows(rows)
  if (c.pos >= c.urls.length) {
    st.lastmods = c.newLastmods
    c.done = true
  }
}


// ── Products you stock from this supplier, looked up one by one ─────────────
// Bulk reading can't reach every product on very large stores, and these are
// the ones that matter most — so each is checked directly by its code.
async function runWatched(s: any, cfg: any, deadline: number) {
  const aliases = [s.name, ...(s.data?.aliases || [])].map((a: string) => a.toLowerCase())
  const { data: items } = await admin.from('stock_items').select('id, name, data')
  const mine = (items || []).filter((i: any) =>
    aliases.includes(String(i.data?.supplierName || '').toLowerCase()) && String(i.data?.supplierSku || '').trim())
  const today = new Date().toISOString().slice(0, 10)
  let found = 0, missing = 0
  for (const it of mine) {
    if (Date.now() > deadline - 6000) break
    const sku = String(it.data.supplierSku).trim()
    const { data: existing } = await admin.from('supplier_products').select('id')
      .eq('supplier_id', s.id).ilike('supplier_sku', sku).eq('list_date', today).limit(1)
    if (existing && existing.length) { found++; continue }
    const q = encodeURIComponent(sku)
    const sr = await fetch(`${cfg.base}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=10`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null)
    await sleep(1000)
    if (!sr || !sr.ok) { missing++; continue }
    const hits = (await sr.json())?.resources?.results?.products || []
    let hit: any = null, variant: any = null
    for (const h of hits) {
      const pr = await fetch(`${cfg.base}/products/${h.handle}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null)
      await sleep(1000)
      if (!pr || !pr.ok) continue
      const prod = (await pr.json()).product
      // Only an exact code match counts — "P586" must not match "HP586"
      const v = (prod?.variants || []).find((x: any) => String(x.sku || '').trim().toLowerCase() === sku.toLowerCase())
      const title = String(prod?.title || '').trim().toLowerCase()
      const titleCode = title === sku.toLowerCase() || title.startsWith(sku.toLowerCase() + ' ')
      if (v || titleCode) { hit = prod; variant = v || prod.variants?.[0]; break }
    }
    if (!hit || !variant) { missing++; continue }
    const name = hit.title + (variant.title && variant.title !== 'Default Title' ? ` - ${variant.title}` : '')
    const cost = unitCostFrom(parseFloat(variant.price), name, cfg)
    await upsertRows([{
      supplier_id: s.id, supplier_sku: sku, barcode: normBarcode(variant.barcode), name,
      unit_cost: cost.unit, list_date: today, updated_at: new Date().toISOString(),
      data: {
        source: 'online', watched: true, url: `${cfg.base}/products/${hit.handle}`,
        shownPrice: cost.shown, caseSize: cost.caseSize, vatIncluded: cost.vatIncluded,
        available: variant.available !== false, stock: variant.available === false ? 0 : null,
        flags: variant.available === false ? ['out of stock'] : [],
      },
    }])
    found++
  }
  return { watched: mine.length, found, missing }
}

// ── One supplier, one chunk ─────────────────────────────────────────────────
async function syncSupplier(s: any, deadline: number, opts: any) {
  const cfg = s.data.sync
  const { data: row } = await admin.from('sync_state').select('state').eq('supplier_id', s.id).maybeSingle()
  const st: any = row?.state || {}
  const now = new Date()

  if (st.lockedUntil && new Date(st.lockedUntil) > now) return { supplier: s.name, skipped: 'already running' }

  if (!st.cycle) {
    const recent = st.lastDoneAt && (now.getTime() - new Date(st.lastDoneAt).getTime()) < 20 * 3600e3
    if (recent && !opts.force) return { supplier: s.name, skipped: 'up to date' }
    st.cycle = { startedAt: now.toISOString(), pos: 0, seen: 0, errors: 0 }
  }
  const today = now.toISOString().slice(0, 10)
  if (st.cycle.night !== today) { st.cycle.night = today; st.cycle.nightCount = 0 }
  const cap = opts.maxPages ?? (opts.force ? Number.MAX_SAFE_INTEGER : (cfg.nightlyPages || 100))

  st.lockedUntil = new Date(Date.now() + 70_000).toISOString()
  await admin.from('sync_state').upsert({ supplier_id: s.id, state: st, updated_at: now.toISOString() })

  let error: string | null = null
  try {
    if (cfg.kind === 'shopify') await runShopify(s, cfg, st, deadline, cap)
    else if (cfg.kind === 'sitemap') await runSitemap(s, cfg, st, deadline, cap)
  } catch (e) { error = String((e as Error)?.message || e) }

  const c = st.cycle
  // Once the bulk read is done, make sure every product you stock was covered
  if (c.done && !error && cfg.kind === 'shopify') {
    try { c.watched = await runWatched(s, cfg, deadline + 15000) } catch (e) { error = `Watched products: ${(e as Error).message}` }
  }
  const progress = { pos: c.pos, total: c.total ?? null, seen: c.seen, errors: c.errors, noPrice: c.noPrice ?? null,
    capped: !!c.capped, watched: c.watched ?? null }
  st.lastChunk = { at: new Date().toISOString(), ...progress, error }
  delete st.lockedUntil

  if (c.done || error) {
    await admin.from('sync_runs').insert({
      supplier_id: s.id, status: error ? 'error' : 'done', error,
      stats: { ...progress, sitemapTotal: c.sitemapTotal ?? null }, started_at: c.startedAt,
      finished_at: new Date().toISOString(),
    })
  }
  if (c.done) { st.lastDoneAt = new Date().toISOString(); delete st.cycle }
  // Keep the big URL list out of saved state once it's finished with
  await admin.from('sync_state').upsert({ supplier_id: s.id, state: st, updated_at: new Date().toISOString() })
  return { supplier: s.name, ...progress, done: !!c.done, error }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (!(await authorised(req))) return json({ error: 'Not authorised' }, 401)
  const opts = await req.json().catch(() => ({}))
  const started = Date.now()
  const deadline = started + Math.min(opts.budgetMs || DEFAULT_BUDGET_MS, DEFAULT_BUDGET_MS)

  const { data: suppliers, error } = await admin.from('suppliers').select('id, name, data')
  if (error) return json({ error: error.message }, 500)
  const targets = (suppliers || []).filter((s: any) => s.data?.sync &&
    (!opts.supplier || s.id === opts.supplier || s.name === opts.supplier))

  const results = []
  for (const s of targets) {
    if (Date.now() > deadline - 10000) break
    results.push(await syncSupplier(s, deadline, opts))
  }
  return json({ results, ms: Date.now() - started })
})
