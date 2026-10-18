import { sortKey, guessUnits, normRef } from './dispatch'
import { supabase } from './supabase'
import { DEFAULT_CARRIERS, DEFAULT_PACKAGING, DEFAULT_ROUTING_RULES } from './defaults'

// ── Settings ──────────────────────────────────────────────────────────────────

export async function loadSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('key', 'app_settings')
    .single()

  if (error || !data) {
    // Warehouse-only people can't read cost settings — just the dispatch part
    let dispatch
    try { const r = await supabase.rpc('dispatch_settings'); dispatch = r.data || undefined } catch { /* defaults */ }
    return {
      carriers: DEFAULT_CARRIERS,
      packaging: DEFAULT_PACKAGING,
      routingRules: DEFAULT_ROUTING_RULES,
      ...(dispatch && Object.keys(dispatch).length ? { dispatch } : {}),
    }
  }
  return data.value
}

export async function saveSettings(settings, expectedUpdatedAt) {
  if (expectedUpdatedAt) {
    const { data, error } = await supabase.from('settings').update({ value: settings })
      .eq('key', 'app_settings').eq('updated_at', expectedUpdatedAt).select().maybeSingle()
    if (error) throw error
    if (!data) {
      const { data: latest } = await supabase.from('settings').select('*').eq('key', 'app_settings').maybeSingle()
      throw new EditConflict(latest)
    }
    return data
  }
  const { data, error } = await supabase.from('settings')
    .upsert({ key: 'app_settings', value: settings }, { onConflict: 'key' }).select().maybeSingle()
  if (error) throw error
  return data
}

export async function loadSettingsRow() {
  const { data } = await supabase.from('settings').select('updated_at').eq('key', 'app_settings').maybeSingle()
  return data
}

// ── Activity log ───────────────────────────────────────────────────────────────

/** Records what happened. Never blocks or fails the action it describes. */
export async function logActivity(entry) {
  try { await supabase.from('activity_log').insert(entry) } catch { /* the log must never break the work */ }
}

export async function loadActivity({ entityId, limit = 200 } = {}) {
  let q = supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(limit)
  if (entityId) q = q.eq('entity_id', String(entityId))
  const { data, error } = await q
  if (error) return []
  return data || []
}

// ── Saved Products ─────────────────────────────────────────────────────────────

export async function loadProducts() {
  const { data, error } = await supabase
    .from('saved_products')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveProduct(product) {
  const { data, error } = await supabase
    .from('saved_products')
    .insert({ name: product.name, data: product })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Raised when someone else saved the same thing after you opened it. */
export class EditConflict extends Error {
  constructor(latest) { super('Changed by someone else while you were editing'); this.conflict = true; this.latest = latest }
}

/**
 * Saves a listing. Pass the updated_at you loaded it with, and the save is
 * refused if anyone has saved it since — instead of silently overwriting them.
 */
export async function updateProduct(id, product, expectedUpdatedAt) {
  let q = supabase.from('saved_products').update({ name: product.name, data: product }).eq('id', id)
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await q.select().maybeSingle()
  if (error) throw error
  if (!data && expectedUpdatedAt) {
    const { data: latest } = await supabase.from('saved_products').select('*').eq('id', id).maybeSingle()
    throw new EditConflict(latest)
  }
  return data
}

export async function deleteProduct(id) {
  const { error } = await supabase
    .from('saved_products')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Overheads ──────────────────────────────────────────────────────────────────

export async function loadOverheads() {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('key', 'overheads')
    .single()
  if (error || !data) return []
  return data.value
}

export async function saveOverheads(overheads) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'overheads', value: overheads }, { onConflict: 'key' })
  if (error) throw error
}

// ── Months ─────────────────────────────────────────────────────────────────────

export async function loadMonths() {
  const { data, error } = await supabase
    .from('months')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveMonth(month) {
  const { data, error } = await supabase
    .from('months')
    .insert({ name: month.name, data: month })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMonth(id, month) {
  const { error } = await supabase
    .from('months')
    .update({ name: month.name, data: month })
    .eq('id', id)
  if (error) throw error
}

export async function deleteMonth(id) {
  const { error } = await supabase
    .from('months')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Live Products ──────────────────────────────────────────────────────────────

export async function loadLiveProducts() {
  const { data, error } = await supabase
    .from('live_products')
    .select('*')
    .order('went_live_at', { ascending: false })
  if (error) return []   // table may not exist yet — don't break the app
  return data || []
}

export async function pushProductLive(savedProductId) {
  const { data, error } = await supabase
    .from('live_products')
    .insert({ saved_product_id: savedProductId, status: 'live', went_live_at: new Date().toISOString() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLiveProductStatus(id, status) {
  const { error } = await supabase
    .from('live_products')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function removeLiveProduct(id) {
  const { error } = await supabase
    .from('live_products')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Price History ──────────────────────────────────────────────────────────────

export async function loadPriceHistory() {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(1000)
  if (error) return []   // table may not exist yet
  return data || []
}

export async function logPriceChange(entry) {
  const { data, error } = await supabase
    .from('price_history')
    .insert(entry)
    .select()
    .single()
  if (error) return null // never block a price change because logging failed
  return data
}

// ── Cost History ───────────────────────────────────────────────────────────────

export async function loadCostHistory() {
  const { data, error } = await supabase
    .from('cost_history')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(1000)
  if (error) return []
  return data || []
}

export async function logCostChange(entry) {
  const { data, error } = await supabase
    .from('cost_history')
    .insert(entry)
    .select()
    .single()
  if (error) return null
  return data
}

// ── Products (parent products) ──────────────────────────────────────────────

export async function loadStockItems() {
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .order('name', { ascending: true })
  if (error) return []
  return data || []
}

export async function saveStockItem(item) {
  const { data, error } = await supabase
    .from('stock_items')
    .insert({ name: item.name, data: item })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateStockItem(id, item, expectedUpdatedAt) {
  let q = supabase.from('stock_items').update({ name: item.name, data: item }).eq('id', id)
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await q.select().maybeSingle()
  if (error) throw error
  if (!data && expectedUpdatedAt) {
    const { data: latest } = await supabase.from('stock_items').select('*').eq('id', id).maybeSingle()
    throw new EditConflict(latest)
  }
  return data
}

export async function deleteStockItem(id) {
  const { error } = await supabase.from('stock_items').delete().eq('id', id)
  if (error) throw error
}

// ── Profiles ───────────────────────────────────────────────────────────────────

export async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('*')
  if (error) return []
  return data || []
}

export async function upsertProfile(id, displayName, role = 'member') {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id, display_name: displayName, role }, { onConflict: 'id' })
    .select()
    .single()
  if (error) return null
  return data
}

// ── Suppliers & price lists ────────────────────────────────────────────────────

export async function loadSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('*').order('name')
  if (error) return []
  return data || []
}

/** A company you pay: a stock supplier, a carrier, an agency, an accountant. */
export async function createSupplier(name, data) {
  const { data: row, error } = await supabase.from('suppliers').insert({ name, data }).select().single()
  if (error) throw error
  return row
}

export async function updateSupplier(id, data) {
  const { error } = await supabase.from('suppliers').update({ data }).eq('id', id)
  if (error) throw error
}

/** Loads every stored price-list line. Paged, since lists run to thousands of rows. */
export async function loadSupplierProducts() {
  const all = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, supplier_sku, barcode, name, unit_cost, data, list_date')
      .range(from, from + size - 1)
    if (error) return all
    all.push(...(data || []))
    if (!data || data.length < size) break
  }
  return all
}

/** Upserts a parsed price list in batches, keyed on supplier + supplier SKU. */
export async function saveSupplierProducts(supplierId, rows, listDate, onProgress) {
  // The database refuses to update the same row twice in one statement
  const unique = [...new Map(rows.map(r => [r.sku.toLowerCase(), r])).values()]
  rows = unique
  const batch = 500
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map(r => ({
      supplier_id: supplierId,
      supplier_sku: r.sku,
      barcode: r.barcode || null,
      name: r.name,
      unit_cost: r.unitCost,
      data: r.data,
      list_date: listDate,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('supplier_products').upsert(chunk, { onConflict: 'supplier_id,supplier_sku' })
    if (error) throw error
    onProgress?.(Math.min(i + batch, rows.length), rows.length)
  }
}

export async function logPriceListImport(entry) {
  const { data, error } = await supabase.from('price_list_imports').insert(entry).select().single()
  if (error) return null
  return data
}

export async function loadPriceListImports() {
  const { data, error } = await supabase.from('price_list_imports').select('*').order('created_at', { ascending: false }).limit(50)
  if (error) return []
  return data || []
}

// ── Proposed changes ──────────────────────────────────────────────────────────

export async function loadProposedChanges() {
  const { data, error } = await supabase
    .from('proposed_changes').select('*')
    .order('created_at', { ascending: false }).limit(2000)
  if (error) return []
  return data || []
}

/**
 * Adds proposals, skipping any already raised — including ones you rejected,
 * so the same suggestion doesn't keep coming back.
 */
export async function addProposedChanges(list) {
  if (!list.length) return []
  const { data, error } = await supabase
    .from('proposed_changes')
    .upsert(list, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select()
  if (error) throw error
  return data || []
}

export async function decideProposedChanges(ids, status, decidedBy) {
  const { error } = await supabase
    .from('proposed_changes')
    .update({ status, decided_by: decidedBy, decided_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

// ── Product hunter ─────────────────────────────────────────────────────────────

/**
 * Every row of a large table. The first page also says how many rows there
 * are, so the rest are fetched side by side rather than one after another.
 * A page that fails is left out, as the page-by-page version used to.
 */
async function loadAllPages(table, columns, orderBy, size = 1000) {
  const page = (i, opts) => supabase.from(table).select(columns, opts).order(orderBy).range(i * size, (i + 1) * size - 1)
  const first = await page(0, { count: 'exact' })
  if (first.error) return []
  const all = [...(first.data || [])]
  const total = first.count ?? all.length
  if (all.length < size || total <= size) return all
  const rest = await Promise.all(
    Array.from({ length: Math.ceil(total / size) - 1 }, (_, i) => page(i + 1).then(r => r.error ? [] : (r.data || []))))
  return all.concat(...rest)
}

export async function loadMarketListings() {
  return loadAllPages('market_listings', '*', 'asin')
}

export async function saveMarketListings(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = [...new Map(rows.slice(i, i + 500).map(r => [r.asin, r])).values()]
    const { error } = await supabase.from('market_listings').upsert(chunk, { onConflict: 'asin' })
    if (error) throw error
  }
}

export async function loadAsinMatches() {
  const { data, error } = await supabase.from('asin_matches').select('*')
  if (error) return []
  return data || []
}

export async function saveAsinMatch(entry) {
  const { data, error } = await supabase.from('asin_matches').upsert(entry, { onConflict: 'asin' }).select().single()
  if (error) throw error
  return data
}

export async function deleteAsinMatch(asin) {
  const { error } = await supabase.from('asin_matches').delete().eq('asin', asin)
  if (error) throw error
}

// ── Hunts ──────────────────────────────────────────────────────────────────────

export async function loadHunts() {
  const { data, error } = await supabase.from('hunts').select('*').order('created_at', { ascending: false })
  if (error) return []
  return data || []
}

export async function createHunt(hunt, items) {
  const { data, error } = await supabase.from('hunts').insert(hunt).select().single()
  if (error) throw error
  const rows = items.map(i => ({ ...i, hunt_id: data.id }))
  for (let k = 0; k < rows.length; k += 500) {
    const { error: e2 } = await supabase.from('hunt_items').insert(rows.slice(k, k + 500))
    if (e2) throw e2
  }
  return data
}

export async function updateHunt(id, patch) {
  const { error } = await supabase.from('hunts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function loadHuntItems() {
  return loadAllPages('hunt_items', 'id, hunt_id, asin, disposition, reason, note, saved_product_id, decided_by, decided_at', 'id')
}

/** Updates many items at once; each keeps its own id. */
export async function updateHuntItems(ids, patch) {
  for (let k = 0; k < ids.length; k += 200) {
    const { error } = await supabase.from('hunt_items').update(patch).in('id', ids.slice(k, k + 200))
    if (error) throw error
  }
}

// ── Online supplier sync ───────────────────────────────────────────────────────

export async function loadSyncStatus() {
  const [st, runs] = await Promise.all([
    supabase.from('sync_state').select('supplier_id, state, updated_at'),
    supabase.from('sync_runs').select('*').order('finished_at', { ascending: false }).limit(60),
  ])
  return { states: st.data || [], runs: runs.data || [] }
}

/** Runs one chunk of a supplier's sync now. The scheduled job carries on from there. */
export async function triggerSupplierSync(supplierName) {
  const { data, error } = await supabase.functions.invoke('supplier-sync', {
    body: { supplier: supplierName, force: true },
  })
  if (error) throw error
  return data
}

// ── Catalogue slices ───────────────────────────────────────────────────────────
// The full supplier catalogue runs to tens of thousands of lines. The portal
// only ever needs the lines that match something specific, so it asks for those.

const CATALOGUE_COLS = 'id, supplier_id, supplier_sku, barcode, name, unit_cost, data, list_date'

async function inChunks(column, values, extra = (q) => q) {
  const out = []
  const list = [...new Set(values.filter(Boolean))]
  for (let i = 0; i < list.length; i += 150) {
    const { data, error } = await extra(supabase.from('supplier_products').select(CATALOGUE_COLS).in(column, list.slice(i, i + 150)))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}
const uniqueById = (rows) => [...new Map(rows.map(r => [r.id, r])).values()]

/** Catalogue lines for the products you stock — by supplier code and by barcode. */
export async function loadCatalogueForStock(stockItems) {
  const skus = stockItems.map(s => String(s.data?.supplierSku || '').trim()).filter(Boolean)
  const barcodes = stockItems.map(s => s.data?.barcode).filter(Boolean)
  const [bySku, byBarcode] = await Promise.all([inChunks('supplier_sku', skus), inChunks('barcode', barcodes)])
  return uniqueById([...bySku, ...byBarcode])
}

/** Catalogue lines a hunt could match: its barcodes, and its brands' products by name. */
export async function loadCatalogueForHunt(listings) {
  const barcodes = listings.flatMap(l => l.data?.barcodes || [])
  const brands = [...new Set(listings.map(l => String(l.brand || '').trim()).filter(b => b.length >= 3))]
  const byBarcode = await inChunks('barcode', barcodes)
  const byBrand = []
  for (const b of brands) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('supplier_products').select(CATALOGUE_COLS)
        .ilike('name', `%${b.replace(/[%_]/g, '')}%`).range(from, from + 999)
      if (error) throw error
      byBrand.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  return uniqueById([...byBarcode, ...byBrand])
}

export async function loadCatalogueStats() {
  const { data, error } = await supabase.rpc('supplier_catalogue_stats')
  if (error) return []
  return data || []
}

// ── People and access ──────────────────────────────────────────────────────────
// Creating accounts and changing access needs a privileged key, so it happens
// on the server. The portal only ever asks; the server checks you're an admin.

export async function adminUsers(payload) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload })
  if (error) {
    // The function's own message (e.g. "only the last admin") is in the response body
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message || 'Could not reach the server')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// ── Purchase orders ────────────────────────────────────────────────────────────

export async function loadPurchaseOrders() {
  const [orders, items, issues] = await Promise.all([
    supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
    supabase.from('purchase_order_items').select('*'),
    supabase.from('purchase_issues').select('*').order('reported_at', { ascending: false }),
  ])
  const byPo = {}
  ;(items.data || []).forEach(i => { (byPo[i.po_id] = byPo[i.po_id] || []).push(i) })
  return {
    orders: (orders.data || []).map(o => ({ ...o, items: byPo[o.id] || [] })),
    issues: issues.data || [],
  }
}

export async function nextPoNumber() {
  const { data, error } = await supabase.rpc('next_po_number')
  if (error) throw error
  return data
}

/** Saves an order and its lines together, so the two can't drift apart. */
export async function nextCreditNumber() {
  const { data, error } = await supabase.rpc('next_credit_number')
  if (error) throw error
  return data
}

export async function savePurchaseOrder(po, items) {
  const { items: _drop, ...row } = po
  const { data, error } = await supabase.from('purchase_orders').upsert(row).select().single()
  if (error) throw error
  if (items) {
    const { error: delErr } = await supabase.from('purchase_order_items').delete().eq('po_id', data.id)
    if (delErr) throw delErr
    if (items.length) {
      const rows = items.map(({ id: _i, ...it }) => ({ ...it, po_id: data.id }))
      const { error: insErr } = await supabase.from('purchase_order_items').insert(rows)
      if (insErr) throw insErr
    }
  }
  const { data: saved } = await supabase.from('purchase_order_items').select('*').eq('po_id', data.id)
  return { ...data, items: saved || [] }
}

export async function updatePurchaseOrder(id, patch) {
  const { data, error } = await supabase.from('purchase_orders').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function updatePoItem(id, patch) {
  const { data, error } = await supabase.from('purchase_order_items').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function saveIssue(issue) {
  const { data, error } = await supabase.from('purchase_issues').upsert(issue).select().single()
  if (error) throw error
  return data
}

// Proformas and invoices live in a private store; links are short-lived
export async function uploadPurchaseDoc(file, poNumber, kind) {
  const safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-60)
  const path = `${poNumber}/${kind}-${Date.now()}-${safe}`
  const { error } = await supabase.storage.from('purchase-docs').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function purchaseDocUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('purchase-docs').createSignedUrl(path, 60 * 30)
  if (error) return null
  return data?.signedUrl || null
}

// ── Stock requests ────────────────────────────────────────────────────────────
// The warehouse asks for stock; the office orders it. Nothing here carries a price.

export async function loadStockRequests() {
  const [r, e, p] = await Promise.all([
    supabase.from('stock_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('stock_request_events').select('*').order('at', { ascending: true }),
    supabase.rpc('request_progress'),
  ])
  if (r.error) throw r.error
  const events = {}
  ;(e.data || []).forEach(x => { (events[x.request_id] = events[x.request_id] || []).push(x) })
  const progress = {}
  ;(p.data || []).forEach(x => { progress[x.request_id] = x })
  return (r.data || []).map(x => ({ ...x, events: events[x.id] || [], progress: progress[x.id] || null }))
}

/** Products to ask for: names and codes, never prices. */
export async function loadRequestProducts() {
  const { data, error } = await supabase.rpc('request_products')
  if (error) return []
  return data || []
}

export async function createStockRequest(row) {
  const { data, error } = await supabase.from('stock_requests').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateStockRequest(id, patch) {
  const { data, error } = await supabase.from('stock_requests').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function addRequestEvent(request_id, by_name, action, detail = null) {
  try { await supabase.from('stock_request_events').insert({ request_id, by_name, action, detail }) } catch { /* the timeline must never block the work */ }
}

export async function requestsOnPo(poId) {
  const { data } = await supabase.from('stock_requests').select('id, ref, po_id, po_item_id, status').eq('po_id', poId)
  return data || []
}

export async function uploadRequestPhoto(file) {
  const safe = String(file.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_').slice(-60)
  const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safe}`
  const { error } = await supabase.storage.from('request-photos').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function requestPhotoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('request-photos').createSignedUrl(path, 60 * 30)
  if (error) return null
  return data?.signedUrl || null
}

// ── ClickUp messages ──────────────────────────────────────────────────────────

/** Queue a message for ClickUp. Fire and forget: a message never blocks the work. */
export function queueNotification(event, payload) {
  supabase.rpc('queue_notification', { p_event: event, p_payload: payload }).then(() => {}, () => {})
}

export async function notifyAdmin(payload) {
  const { data, error } = await supabase.functions.invoke('notify', { body: payload })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message || 'Could not reach the server')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function setClickupToken(token) {
  const { data, error } = await supabase.rpc('set_clickup_token', { p_token: token })
  if (error) throw error
  return data
}

export async function loadNotificationRules() {
  const { data, error } = await supabase.from('notification_rules').select('*')
  if (error) throw error
  return data || []
}

export async function saveNotificationRule(event, patch) {
  const { error } = await supabase.from('notification_rules').update({ ...patch, updated_at: new Date().toISOString() }).eq('event', event)
  if (error) throw error
}

export async function loadNotificationLog(limit = 25) {
  const { data } = await supabase.from('notification_outbox').select('*').order('created_at', { ascending: false }).limit(limit)
  return data || []
}

// ── Goods in ──────────────────────────────────────────────────────────────────
// Orders come through a function that hands back names, quantities and
// confirmed dates only — the warehouse can't read purchase orders directly.

export async function loadGoodsIn() {
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const [o, d] = await Promise.all([
    supabase.rpc('goods_in_orders'),
    supabase.from('goods_in_deliveries').select('*')
      .or(`received_at.gte."${since}",office_status.eq.open,put_away_at.is.null`)
      .order('received_at', { ascending: false }),
  ])
  if (o.error) throw o.error
  return { orders: o.data || [], deliveries: d.data || [] }
}

export async function bookInDelivery(poId, lines, delivery) {
  const { data, error } = await supabase.rpc('book_in_delivery', { p_po_id: poId, p_lines: lines, p_delivery: delivery })
  if (error) throw error
  return data
}

export async function logUnexpectedDelivery(row) {
  const { data, error } = await supabase.from('goods_in_deliveries')
    .insert({ ...row, kind: 'unexpected', has_problems: true, office_status: 'open' }).select().single()
  if (error) throw error
  return data
}

export async function updateDelivery(id, patch) {
  const { data, error } = await supabase.from('goods_in_deliveries').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function uploadGoodsInPhoto(file, kind = 'photo') {
  const safe = String(file.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_').slice(-60)
  const path = `${new Date().toISOString().slice(0, 10)}/${kind}-${Date.now()}-${safe}`
  const { error } = await supabase.storage.from('goods-in-photos').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function goodsInPhotoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('goods-in-photos').createSignedUrl(path, 60 * 30)
  if (error) return null
  return data?.signedUrl || null
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function loadDispatchMappings() {
  const { data, error } = await supabase.from('dispatch_mappings').select('*').order('label_name')
  if (error) throw error
  return data || []
}

export async function saveDispatchMapping(mapping) {
  const row = { ...mapping, updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('dispatch_mappings').upsert(row, { onConflict: 'item_key' }).select().single()
  if (error) throw error
  return data
}

export async function deleteDispatchMapping(id) {
  const { error } = await supabase.from('dispatch_mappings').delete().eq('id', id)
  if (error) throw error
}

/** Batches for a run of days, newest first, each with how many of its labels are dispatched. */
export async function loadDispatchBatches({ from, to } = {}) {
  let q = supabase.from('dispatch_batches')
    .select('*, upload:dispatch_uploads(id, code, ship_date, picker, title, file_name, uploaded_by_name, created_at, storage_path)')
    .order('ship_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
  if (from) q = q.gte('ship_date', from)
  if (to) q = q.lte('ship_date', to)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function loadBatchLabels(batchIds) {
  const ids = [].concat(batchIds).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.from('dispatch_labels').select('*').in('batch_id', ids).order('seq')
  if (error) throw error
  return data || []
}

export async function loadHeldLabels() {
  const { data, error } = await supabase.from('dispatch_labels')
    .select('*, upload:dispatch_uploads(id, code, file_name, storage_path, uploaded_by_name, created_at)')
    .eq('status', 'held').order('created_at', { ascending: false }).order('page_index').limit(1000)
  if (error) throw error
  return data || []
}

export async function loadDispatchUploads({ limit = 100 } = {}) {
  const { data, error } = await supabase.from('dispatch_uploads').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/** Labels for ⌘K: anything from the last fortnight, plus anything still waiting. */
export async function loadDispatchIndex() {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString()
  const cols = 'id, batch_id, seq, channel_ref, helm_order, postcode, customer, tracking, label_name, status, created_at'
  const [recent, waiting, batches] = await Promise.all([
    supabase.from('dispatch_labels').select(cols).gte('created_at', since).order('created_at', { ascending: false }).limit(3000),
    supabase.from('dispatch_labels').select(cols).in('status', ['held', 'ready']).lt('created_at', since).limit(1000),
    supabase.from('dispatch_batches').select('id, code, ship_date, label_name, carrier, service, label_count, printed_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(500),
  ])
  const helm = await supabase.rpc('helm_search_index').then(r => r.data || []).catch(() => [])
  return { labels: [...(recent.data || []), ...(waiting.data || [])], batches: batches.data || [], helm }
}

export async function downloadDispatchFile(path) {
  const { data, error } = await supabase.storage.from('dispatch-labels').download(path)
  if (error) throw error
  return new Uint8Array(await data.arrayBuffer())
}

/** Product groups inside a batch: they all carry the batch's number. */
async function insertGroups(shipDate, groups) {
  const rows = groups.map(g => ({
    upload_id: g.uploadId, code: g.code, ship_date: shipDate, label_name: g.label_name, contents: g.contents,
    carrier: g.carrier, service: g.service, label_count: g.labels.length, order_count: g.orderCount,
    sort_key: g.sort_key || sortKey({ carrier: g.carrier, service: g.service, label_name: g.label_name, items: g.labels?.[0]?.items || [] }),
  }))
  if (!rows.length) return []
  const { data, error } = await supabase.from('dispatch_batches').insert(rows).select()
  if (error) throw error
  return data
}

/**
 * Saves an upload: the file itself, every label (batched or held), and the
 * batches. If anything fails part-way the upload is removed again, so a file
 * is either fully in or not at all.
 */
export async function saveDispatchUpload({ file, bytes, pageCount, batches, held, me, shipDate, picker, title }) {
  const safe = String(file.name || 'labels.pdf').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `${shipDate}/${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from('dispatch-labels')
    .upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' })
  if (upErr) throw upErr

  const labelCount = batches.reduce((s, b) => s + b.labels.length, 0) + held.reduce((s, o) => s + Math.max(1, o.labels.length), 0)
  // The file is the batch: it takes the next number for the day (B1, B2…)
  let upload = null
  for (let attempt = 0; attempt < 4 && !upload; attempt++) {
    const { data: code, error: codeErr } = await supabase.rpc('next_dispatch_upload_code', { d: shipDate })
    if (codeErr) throw codeErr
    const { data, error } = await supabase.from('dispatch_uploads').insert({
      file_name: file.name, storage_path: path, pages: pageCount, code, ship_date: shipDate,
      picker: picker || null, title: title || null,
      orders: batches.reduce((s, b) => s + b.orders.length, 0) + held.length,
      labels: labelCount, held: held.length, uploaded_by: me?.id || null, uploaded_by_name: me?.name || null,
    }).select().single()
    if (!error) upload = data
    else if (error.code !== '23505') throw error   // someone took that number a moment ago — take the next
  }
  if (!upload) throw new Error('Couldn\'t number the batch — try again')

  try {
    const saved = await insertGroups(shipDate, batches.map(b => ({ ...b, uploadId: upload.id, code: upload.code, orderCount: b.orders.length })))
    const rowFor = (o, l, extra) => ({
      upload_id: upload.id, page_index: l.pageIndex, order_key: o.orderKey, slip_page: o.slip?.pageIndex ?? null,
      channel_ref: o.slip?.channelRef || null, helm_order: o.slip?.helmOrder || null, slip_id: o.slip?.slipId || null,
      label_ref: l.ref || null, carrier: l.carrier || null, service: l.service || null, tracking: l.tracking || null,
      customer: l.customer || o.slip?.customer || null, postcode: l.postcode || o.slip?.postcode || null,
      items: o.slip?.items || [], stamp: l.stamp || {},
      ...(o.slip?.manual ? { reason: o.slip.reason || 'manual', note: o.slip.note || null, original_ref: o.slip.originalRef || null } : {}),
      ...extra,
    })
    const rows = []
    batches.forEach((b, i) => b.labels.forEach(l => rows.push(rowFor(l.order, l, {
      batch_id: saved[i].id, seq: l.seq, label_name: b.label_name, status: 'ready',
    }))))
    for (const o of held) {
      const reason = o.holdReason || o.problems.filter(p => p.level !== 'check').map(p => p.text).join('; ') || 'Held back at upload'
      const labels = o.labels.length ? o.labels : [{ pageIndex: o.slip?.pageIndex ?? 0, noLabel: true }]
      labels.forEach(l => rows.push(rowFor(o, l, {
        status: 'held', hold_reason: reason, label_name: o.mapping?.label_name || null,
        ...(l.noLabel ? { stamp: { noLabel: true } } : {}),
      })))
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await supabase.from('dispatch_labels').insert(rows.slice(i, i + 500))
      if (e) throw e
    }
    // Item codes seen for the first time get a first guess at their units
    await ensureItemUnits([...batches.flatMap(b => b.orders.flatMap(o => o.slip?.items || [])), ...held.flatMap(o => o.slip?.items || [])], me).catch(() => {})
    // Orders held from an earlier upload and uploaded again now: the new copy takes over
    const refs = [...new Set(batches.flatMap(b => b.orders.flatMap(o => [o.slip?.channelRef, o.slip?.helmOrder, o.slip?.slipId])).filter(Boolean))]
    for (let i = 0; i < refs.length; i += 150) {
      const quoted = refs.slice(i, i + 150).map(r => `"${String(r).replace(/"/g, '')}"`).join(',')
      await supabase.from('dispatch_labels').update({ status: 'cancelled', hold_reason: `Uploaded again in ${upload.code}` })
        .eq('status', 'held').neq('upload_id', upload.id)
        .or(`channel_ref.in.(${quoted}),helm_order.in.(${quoted}),slip_id.in.(${quoted})`)
    }
    // Tell the team in ClickUp (never holds up the upload)
    queueNotification('batch_uploaded', {
      code: upload.code, ship_date: shipDate, orders: upload.orders, labels: upload.labels, held: held.length,
      by: me?.name || null, picker: picker || null,
      stamps: batches.map(b => ({ name: b.label_name, orders: b.orders.length })).sort((a, b) => b.orders - a.orders),
    })
    return { upload, batches: saved }
  } catch (e) {
    await supabase.from('dispatch_uploads').delete().eq('id', upload.id)
    throw e
  }
}

/**
 * Held labels back into their own batch, once fixed. If that batch already has
 * the same product waiting to print, they join it; if it's been printed, they
 * go in as a new product line under the same batch number, so only the new
 * labels print.
 */
export async function releaseHeldLabels(groups, shipDate) {
  const saved = []
  for (const g of groups) {
    const { data: open } = await supabase.from('dispatch_batches').select('*')
      .eq('upload_id', g.uploadId).eq('label_name', g.label_name).eq('carrier', g.carrier).eq('service', g.service)
      .is('printed_at', null).limit(1)
    let target = open?.[0]
    let first = 1
    if (target) {
      first = (target.label_count || 0) + 1
      const { data, error } = await supabase.from('dispatch_batches')
        .update({ label_count: target.label_count + g.labels.length, order_count: (target.order_count || 0) + g.orderCount })
        .eq('id', target.id).select().single()
      if (error) throw error
      target = data
    } else {
      const [made] = await insertGroups(shipDate, [g])
      target = made
    }
    for (const [i, l] of g.labels.entries()) {
      const stamp = { ...(l.stamp || {}) }
      const { error } = await supabase.from('dispatch_labels').update({
        batch_id: target.id, seq: first + i, label_name: g.label_name, status: 'ready', hold_reason: null,
        carrier: g.carrier, service: g.service, stamp,
        // A label with no slip, now told what it is
        ...(l.newItems ? { items: l.newItems, reason: l.reason || 'manual', note: l.note || null, original_ref: l.original_ref || null } : {}),
      }).eq('id', l.id).eq('status', 'held')
      if (error) throw error
    }
    saved.push(target)
  }
  return saved
}

export async function cancelDispatchLabels(ids, reason) {
  const { error } = await supabase.from('dispatch_labels').update({ status: 'cancelled', hold_reason: reason || 'Cancelled' }).in('id', ids)
  if (error) throw error
}

/**
 * Records a print against the batch and its labels; the first print is the one
 * that counts as "printed". person is who's printing it — the one who'll pick,
 * pack and dispatch those labels — asked at the printer because the warehouse
 * shares one login.
 */
export async function markBatchesPrinted(batches, me, person = null) {
  const now = new Date().toISOString()
  const who = person || me?.name || null
  for (const b of batches) {
    const patch = { print_count: (b.print_count || 0) + 1 }
    if (!b.printed_at) Object.assign(patch, { printed_at: now, printed_by_name: who })
    await supabase.from('dispatch_batches').update(patch).eq('id', b.id)
  }
  const ids = batches.map(b => b.id)
  if (ids.length) {
    await supabase.from('dispatch_labels').update({ printed_at: now, printed_by_name: who })
      .in('batch_id', ids).is('printed_at', null)
    // The person printing takes on any labels nobody has yet
    if (person) await supabase.from('dispatch_labels').update({ packer: person }).in('batch_id', ids).is('packer', null)
    // …and becomes the batch's picker, if nobody is yet
    const uploads = [...new Set(batches.map(b => b.upload_id).filter(Boolean))]
    if (person && uploads.length) await supabase.from('dispatch_uploads').update({ picker: person }).in('id', uploads).is('picker', null)
  }
  return now
}

export async function loadDispatchLabel(id) {
  const { data, error } = await supabase.from('dispatch_labels').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

const LABEL_WITH_BATCH = '*, batch:dispatch_batches(id, code, ship_date, label_name, contents, carrier, service, label_count, order_count, printed_at, upload:dispatch_uploads(storage_path, uploaded_by_name, file_name))'

/** How far each batch has got: labels still to go, gone, and cancelled. */
export async function loadBatchStats(batchIds) {
  const ids = [].concat(batchIds).filter(Boolean)
  const stats = new Map(ids.map(id => [id, { ready: 0, packed: 0, dispatched: 0, cancelled: 0 }]))
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('dispatch_labels').select('batch_id, status, packed_at').in('batch_id', ids.slice(i, i + 100)).limit(20000)
    if (error) throw error
    for (const r of data || []) {
      const s = stats.get(r.batch_id)
      if (!s || !(r.status in s)) continue
      s[r.status]++
      if (r.status === 'ready' && r.packed_at) s.packed++
    }
  }
  return stats
}

/** Every label still waiting to go, with its batch — Close day and Delayed Dispatch read from this. */
export async function loadOpenLabels() {
  const { data, error } = await supabase.from('dispatch_labels').select(LABEL_WITH_BATCH)
    .eq('status', 'ready').not('batch_id', 'is', null).order('created_at').limit(5000)
  if (error) throw error
  return (data || []).filter(l => l.batch)
}

/**
 * Marks a batch dispatched, all but the label numbers left over. Only labels
 * still waiting are touched, so running it twice changes nothing.
 */
export async function dispatchBatch(batchId, leftover = [], me) {
  let q = supabase.from('dispatch_labels')
    .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by_name: me?.name || null })
    .eq('batch_id', batchId).eq('status', 'ready')
  if (leftover.length) q = q.not('seq', 'in', `(${leftover.join(',')})`)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data || []).length
}

export async function dispatchLabelIds(ids, me) {
  if (!ids.length) return 0
  const { data, error } = await supabase.from('dispatch_labels')
    .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by_name: me?.name || null })
    .in('id', ids).eq('status', 'ready').select('id')
  if (error) throw error
  return (data || []).length
}

/** Finding one label: order reference, postcode, customer or tracking number. */
export async function searchDispatchLabels(query) {
  const q = String(query || '').trim().replace(/[%,()*]/g, ' ').trim()
  if (q.length < 2) return []
  const pc = q.replace(/\s+/g, '')
  const like = `%${q}%`
  const ors = ['channel_ref', 'helm_order', 'customer', 'tracking', 'label_ref', 'slip_id'].map(c => `${c}.ilike.${like}`)
  ors.push(`postcode.ilike.%${pc.length > 4 ? `${pc.slice(0, -3)}%${pc.slice(-3)}` : pc}%`)
  const { data, error } = await supabase.from('dispatch_labels').select(LABEL_WITH_BATCH)
    .or(ors.join(',')).neq('status', 'held').order('created_at', { ascending: false }).limit(40)
  if (error) throw error
  return data || []
}

export async function markLabelReprinted(label, reason, me, person = null) {
  const { error } = await supabase.from('dispatch_labels').update({
    reprint_count: (label.reprint_count || 0) + 1, last_reprinted_at: new Date().toISOString(),
    last_reprinted_by_name: person || me?.name || null, last_reprint_reason: reason || null,
    ...(person && !label.packer ? { packer: person } : {}),
  }).eq('id', label.id)
  if (error) throw error
}

/** Every label in a day's batches, for the export. */
export async function loadDayLabels(shipDate) {
  const { data: batches, error } = await supabase.from('dispatch_batches').select('id').eq('ship_date', shipDate)
  if (error) throw error
  const ids = (batches || []).map(b => b.id)
  if (!ids.length) return []
  const { data, error: e2 } = await supabase.from('dispatch_labels').select(LABEL_WITH_BATCH).in('batch_id', ids).order('batch_id').order('seq').limit(20000)
  if (e2) throw e2
  return data || []
}

/** Orders from a new file that are already in an earlier batch, so nothing ships twice. */
export async function findExistingOrders(refs) {
  const list = [...new Set(refs.filter(Boolean))]
  const found = []
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150)
    const quoted = chunk.map(r => `"${String(r).replace(/"/g, '')}"`).join(',')
    const { data, error } = await supabase.from('dispatch_labels')
      .select('channel_ref, helm_order, slip_id, status, upload:dispatch_uploads(code, ship_date, file_name)')
      .or(`channel_ref.in.(${quoted}),helm_order.in.(${quoted}),slip_id.in.(${quoted})`)
      .not('status', 'in', '(cancelled,held)').limit(2000)
    if (error) throw error
    found.push(...(data || []))
  }
  return found
}

/**
 * Ready for dispatch: packed, labelled and waiting for collection — all of a
 * product's labels except any numbers not packed yet. Only printed labels
 * still waiting are touched.
 */
export async function packBatch(batchId, notPacked = [], me) {
  let q = supabase.from('dispatch_labels')
    .update({ packed_at: new Date().toISOString(), packed_by_name: me?.name || null })
    .eq('batch_id', batchId).eq('status', 'ready').is('packed_at', null).not('printed_at', 'is', null)
  if (notPacked.length) q = q.not('seq', 'in', `(${notPacked.join(',')})`)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data || []).length
}

// ── Units and the dashboard ───────────────────────────────────────────────────

export async function loadItemUnits() {
  const { data, error } = await supabase.from('dispatch_item_units').select('*').order('base_product')
  if (error) throw error
  return data || []
}

export async function saveItemUnits(rows, me) {
  const list = rows.map(r => ({
    code_key: r.code_key || normRef(r.code), code: r.code, name: r.name || null,
    base_product: String(r.base_product || r.code).trim(), units: Math.max(1, parseInt(r.units, 10) || 1),
    confirmed: r.confirmed !== false, updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
    ...(r.components ? { components: r.components } : {}), ...(r.source ? { source: r.source } : {}),
  }))
  if (!list.length) return []
  const out = []
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from('dispatch_item_units').upsert(list.slice(i, i + 200), { onConflict: 'code_key' }).select()
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}
/** First sight of an item code: store a guess (marked unconfirmed) so the dashboard can count it. */
export async function ensureItemUnits(items, me) {
  const seen = new Map()
  for (const it of items) {
    const k = normRef(it.code)
    if (!k || seen.has(k)) continue
    const g = guessUnits(it)
    seen.set(k, { code_key: k, code: it.code, name: it.name || null, base_product: g.base_product, units: g.units, confirmed: false, updated_by_name: me?.name || null })
  }
  if (!seen.size) return
  await supabase.from('dispatch_item_units').upsert([...seen.values()], { onConflict: 'code_key', ignoreDuplicates: true })
}

/** Every label in batches dispatching between two days, with what the dashboard needs. */
export async function loadDashboardLabels({ from, to }) {
  const { data: groups, error } = await supabase.from('dispatch_batches')
    .select('id, code, ship_date, carrier, upload:dispatch_uploads(picker)').gte('ship_date', from).lte('ship_date', to).limit(5000)
  if (error) throw error
  const byId = new Map((groups || []).map(g => [g.id, g]))
  const ids = [...byId.keys()]
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: e } = await supabase.from('dispatch_labels')
      .select('id, batch_id, upload_id, order_key, status, items, carrier, reason, reprint_count, printed_at, dispatched_at, created_at, packer, label_name, printed_by_name')
      .in('batch_id', ids.slice(i, i + 150)).limit(20000)
    if (e) throw e
    for (const l of data || []) out.push({ ...l, batch: byId.get(l.batch_id), upload: byId.get(l.batch_id)?.upload })
  }
  return out
}

/** Every label for one ship day, for the Orders tab: where each order is up to. */
export async function loadDayOrders(date) {
  const { data: groups, error } = await supabase.from('dispatch_batches').select('id, code, label_name').eq('ship_date', date).limit(2000)
  if (error) throw error
  const byId = new Map((groups || []).map(g => [g.id, g]))
  const ids = [...byId.keys()]
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: e } = await supabase.from('dispatch_labels')
      .select('id, batch_id, upload_id, order_key, status, items, label_name, customer, postcode, channel_ref, printed_at, packed_at, dispatched_at')
      .in('batch_id', ids.slice(i, i + 150)).limit(20000)
    if (e) throw e
    for (const l of data || []) out.push({ ...l, batch: byId.get(l.batch_id) })
  }
  return out
}

/** Who's been sent what before at these postcodes — replacements are nearly always for someone we've shipped to. */
export async function findCustomerHistory(postcodes) {
  const list = [...new Set(postcodes.filter(Boolean))]
  if (!list.length) return []
  const { data, error } = await supabase.from('dispatch_labels')
    .select('postcode, customer, items, label_name, channel_ref, created_at, status, upload:dispatch_uploads(code, ship_date)')
    .in('postcode', list).neq('status', 'cancelled').not('items', 'eq', '[]')
    .order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return data || []
}

// ── Inventory ─────────────────────────────────────────────────────────────────
// Stock only changes through database functions, so every change carries a
// name and, when it's done by hand, a reason. No prices anywhere.

const rpc = async (fn, args = {}) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message || 'Something went wrong')
  return data
}

export const loadInventory = () => rpc('inv_overview')
export const loadProductOrders = (productId) => rpc('inv_product_orders', { p_product: productId })
export const loadDespatchDays = (from, to) => rpc('inv_despatch_days', { p_from: from, p_to: to })

export async function loadMovements({ productId, location, kinds, since, limit = 200 } = {}) {
  let q = supabase.from('inv_movements').select('*, product:inv_products(id, code, name)').order('at', { ascending: false }).limit(limit)
  if (productId) q = q.eq('product_id', productId)
  if (location) q = q.eq('location', location)
  if (kinds?.length) q = q.in('kind', kinds)
  if (since) q = q.gte('at', since)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export const invMove = ({ productId, from, to, qty, by, note = null, toPickable = null, taskId = null }) =>
  rpc('inv_move', { p_product: productId, p_from: from || '', p_to: to, p_qty: qty, p_by: by, p_note: note, p_to_pickable: toPickable, p_task: taskId })
export const invAdjust = ({ productId, location, qty, reason, note, by, pickable = null }) =>
  rpc('inv_adjust', { p_product: productId, p_location: location || '', p_qty: qty, p_reason: reason, p_note: note || '', p_by: by, p_pickable: pickable })
export const invSetCount = ({ productId, location, counted, note, by }) =>
  rpc('inv_set_count', { p_product: productId, p_location: location, p_counted: counted, p_note: note || '', p_by: by })
export const invAssign = ({ productId, location, assign, by }) =>
  rpc('inv_assign', { p_product: productId, p_location: location, p_assign: assign, p_by: by })
export const invSaveLocation = ({ code, pickable, note, by }) =>
  rpc('inv_save_location', { p_code: code, p_pickable: pickable, p_note: note || '', p_by: by })
export const invSaveProduct = (id, fields, by) => rpc('inv_save_product', { p_id: id || null, p: fields, p_by: by })
export const invDismissTask = (id, note, by) => rpc('inv_dismiss_task', { p_task: id, p_note: note || '', p_by: by })
export const invPutAwayPlan = (deliveryId) => rpc('inv_put_away_plan', { p_delivery: deliveryId })
export const invPutAway = (deliveryId, lines, by) => rpc('inv_put_away', { p_delivery: deliveryId, p_lines: lines, p_by: by })
export const invImportCount = (rows, countedAt, by) => rpc('inv_import_count', { p_rows: rows, p_counted_at: countedAt, p_by: by })
export const invImportSales = (source, rows, skus, by) => rpc('inv_import_sales', { p_source: source, p_rows: rows, p_skus: skus, p_by: by })
export const invSaveSku = (source, sku, items, by) => rpc('inv_save_sku', { p_source: source, p_sku: sku, p_items: items, p_by: by })
export const loadHelmItems = () => rpc('inv_helm_items')

/** Slip items of dispatched orders, by marketplace order number (normalised). */
export async function loadSlipsByRef(refs) {
  const out = {}
  for (let i = 0; i < refs.length; i += 500) Object.assign(out, await rpc('inv_orders_by_ref', { p_refs: refs.slice(i, i + 500) }) || {})
  return out
}

export async function loadChannelSkus(source = 'amazon') {
  const { data, error } = await supabase.from('inv_channel_skus').select('*').eq('source', source).order('sku')
  if (error) throw error
  return data || []
}

export async function loadChannelSkuTotals(source = 'amazon') {
  const { data, error } = await supabase.from('inv_channel_sales').select('sku, units, day').eq('source', source).limit(20000)
  if (error) throw error
  const m = new Map()
  let from = null, to = null
  for (const r of data || []) {
    m.set(r.sku, (m.get(r.sku) || 0) + Number(r.units))
    if (!from || r.day < from) from = r.day
    if (!to || r.day > to) to = r.day
  }
  return { totals: m, from, to }
}

// Damages, cycle counts, value
export const invReportDamage = ({ productId, location, qty, reason, note, photo, by }) =>
  rpc('inv_report_damage', { p_product: productId, p_location: location || '', p_qty: qty, p_reason: reason, p_note: note || '', p_photo: photo || '', p_by: by })
export const invResolveDamage = (id, action, location, note, by) =>
  rpc('inv_resolve_damage', { p_id: id, p_action: action, p_location: location || '', p_note: note || '', p_by: by })
export async function loadDamages({ since, status } = {}) {
  let q = supabase.from('inv_damages').select('*, product:inv_products(id, code, name)').order('reported_at', { ascending: false }).limit(500)
  if (since) q = q.gte('reported_at', since)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
export const invCountShelf = (location, counts, note, by, taskId = null) =>
  rpc('inv_count_shelf', { p_location: location, p_counts: counts, p_note: note || '', p_by: by, p_task: taskId })
export const invSetCountPlan = (perDay) => rpc('inv_set_count_plan', { p_per_day: perDay })
export const loadInventoryValue = () => rpc('inv_value')
export const invSetCost = (productId, cost, by) => rpc('inv_set_cost', { p_product: productId, p_cost: cost, p_by: by })

// ── HELM orders (read every minute by the helm-sync function) ──
export const loadHelmNewOrders = () => rpc('helm_new_orders')
export const clearHelmOrder = (id, by) => rpc('helm_clear_order', { p_id: id, p_by: by || null })
export const setHelmCutoffs = (cutoffs, by) => rpc('helm_set_cutoffs', { p_cutoffs: cutoffs, p_by: by || null })

// ── Pick lists and substitutes ──
/** Products to pick for these batches (labels still to go, or dispatched too), with their shelves and any substitutes. */
export const loadPickList = (batchIds, { includeDispatched = false } = {}) =>
  rpc('dispatch_pick_list', { p_batches: batchIds, p_all: includeDispatched })
/** Every active product, for choosing what was sent instead. */
export const loadProductPicker = () => rpc('inv_product_picker')
/**
 * Record what went instead of `productId` on these orders ([{ upload_id, order_key }]).
 * `ratio` is substitute units per unit ordered. A null `subId` takes the substitute back off.
 */
export const setSubstitute = (orders, productId, subId, ratio, by, note = null) =>
  rpc('dispatch_set_substitute', { p_orders: orders, p_product: productId, p_sub: subId, p_ratio: ratio, p_by: by || null, p_note: note })
export async function loadSubstitutes({ from, to, uploadIds } = {}) {
  let q = supabase.from('dispatch_substitutes').select('*').order('created_at', { ascending: false }).limit(2000)
  if (from) q = q.gte('created_at', `${from}T00:00:00`)
  if (to) q = q.lt('created_at', `${to}T23:59:59.999`)
  if (uploadIds?.length) q = q.in('upload_id', uploadIds)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ── Delivery tracking (helm_parcels, filled by the helm-tracking edge function) ──
const PARCEL_COLUMNS = 'id, shipment_id, order_id, order_ref, channel, items, carrier, service, shipment_status, parcel_no, parcels, tracking, tracking_url, status, shipped_at, expected_at, collected_at, delivered_at, problem_at, returned_at, last_event_at, last_event, events'

export async function loadParcels({ from } = {}) {
  const size = 1000
  const page = (i, opts) => {
    let q = supabase.from('helm_parcels').select(PARCEL_COLUMNS, opts).order('shipped_at', { ascending: false }).range(i * size, (i + 1) * size - 1)
    if (from) q = q.gte('shipped_at', `${from}T00:00:00`)
    return q
  }
  const first = await page(0, { count: 'exact' })
  if (first.error) throw first.error
  const all = [...(first.data || [])]
  const total = first.count ?? all.length
  if (total <= size) return all
  const rest = await Promise.all(Array.from({ length: Math.ceil(total / size) - 1 }, (_, i) => page(i + 1).then(r => r.error ? [] : (r.data || []))))
  return all.concat(...rest)
}

/** Parcels still on their way, enough to count the late ones for the menu. */
export async function loadOpenParcels() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const { data, error } = await supabase.from('helm_parcels')
    .select('id, shipment_status, tracking, status, shipped_at, delivered_at')
    .gte('shipped_at', since).not('status', 'in', '(7,12,14)')
  if (error) return []
  return data || []
}

export async function loadTrackingSync() {
  const { data } = await supabase.from('helm_tracking_sync').select('*').eq('id', 1).maybeSingle()
  return data || null
}

// ── Item codes: every slip code is one of our SKUs, or what a person verified it to be ──
/** What each code is: Map(normRef(code) → { status: own|verified|unverified|unknown|broken, items, kind, wanted_name, … }) */
export async function loadCodeInfo(codes) {
  const list = [...new Set((codes || []).filter(Boolean).map(String))]
  const out = new Map()
  for (let i = 0; i < list.length; i += 500) {
    const rows = await rpc('dispatch_code_info', { p_codes: list.slice(i, i + 500) })
    for (const r of rows || []) out.set(normRef(r.code), r)
  }
  return out
}
/** Products a code can be linked to: SKU, name, shelves, stock. */
export const loadLinkCandidates = () => rpc('inv_link_candidates')
/** Every verified code. */
export const loadCodeLinks = () => rpc('inv_code_links')
export async function loadCodeLog(limit = 200) {
  const { data, error } = await supabase.from('inv_code_log').select('*').order('at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}
/** Verify (or change) what a code is. items: [{ code: our SKU, qty }]; kind: 'same' | 'substitute' */
export const linkCode = (code, name, items, kind, wanted, by) =>
  rpc('inv_link_code', { p_code: code, p_name: name || null, p_items: items, p_kind: kind, p_wanted: wanted || null, p_by: by })
export async function loadDespatchErrors() {
  const { data, error } = await supabase.from('inv_despatch_errors').select('*').is('resolved_at', null).order('at', { ascending: false }).limit(100)
  if (error) return []
  return data || []
}
