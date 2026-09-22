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
    return {
      carriers: DEFAULT_CARRIERS,
      packaging: DEFAULT_PACKAGING,
      routingRules: DEFAULT_ROUTING_RULES,
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

export async function loadMarketListings() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('market_listings').select('*').range(from, from + 999)
    if (error) return all
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
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
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('hunt_items')
      .select('id, hunt_id, asin, disposition, reason, note, saved_product_id, decided_by, decided_at')
      .range(from, from + 999)
    if (error) return all
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
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
