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

export async function saveSettings(settings) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'app_settings', value: settings }, { onConflict: 'key' })
  if (error) throw error
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

export async function updateProduct(id, product) {
  const { error } = await supabase
    .from('saved_products')
    .update({ name: product.name, data: product, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
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

// ── Stock Items (parent products) ──────────────────────────────────────────────

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

export async function updateStockItem(id, item) {
  const { error } = await supabase
    .from('stock_items')
    .update({ name: item.name, data: item })
    .eq('id', id)
  if (error) throw error
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
