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

// ── Recycle Bin ────────────────────────────────────────────────────────────────

export async function loadBin() {
  const { data, error } = await supabase
    .from('recycle_bin')
    .select('*')
    .order('deleted_at', { ascending: false })
  if (error) return []
  return data || []
}

export async function moveToBin(item) {
  const { error } = await supabase
    .from('recycle_bin')
    .insert({ name: item.name, type: item.type, data: item, deleted_at: new Date().toISOString() })
  if (error) throw error
}

export async function restoreFromBin(binId, item) {
  // Re-insert into saved_products
  const { data, error } = await supabase
    .from('saved_products')
    .insert({ name: item.name, data: item.data })
    .select()
    .single()
  if (error) throw error
  // Remove from bin
  await supabase.from('recycle_bin').delete().eq('id', binId)
  return data
}

export async function permanentlyDelete(binId) {
  const { error } = await supabase.from('recycle_bin').delete().eq('id', binId)
  if (error) throw error
}
