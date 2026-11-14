import { useEffect, useState } from 'react'
import { loadLaunchBoard } from './db'

/**
 * Launch stages for approved listings that aren't live yet (v2.73.0+), worked out by the database from stock on
 * hand, purchase orders and Goods In (listing_launch_board). One shared copy for every page that shows listings,
 * refreshed when asked or after 60 seconds.
 */
export const STAGES = [
  { id: 'needs_order', label: 'Needs ordering', tone: 'alert', hint: 'Approved, but no stock and nothing ordered yet' },
  { id: 'ordered', label: 'Ordered', tone: 'paused', hint: 'Its products are on a sent purchase order' },
  { id: 'arriving', label: 'Arriving', tone: 'info', hint: 'The delivery has started coming in at Goods In' },
  { id: 'ready', label: 'Ready to go live', tone: 'brand', hint: 'The stock is in — push it live' },
  { id: 'no_products', label: 'No product linked', tone: 'quiet', hint: 'Link its products in the Calculator' },
]
export const stageInfo = (id) => STAGES.find(s => s.id === id) || null
// When a listing has sat too long in its stage (days since approval)
export const LATE_DAYS = { needs_order: 7, ordered: 14, ready: 2 }
export const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null)
export const isLate = (row) => LATE_DAYS[row?.stage] != null && daysSince(row?.approved_at) > LATE_DAYS[row.stage]

let cache = { at: 0, rows: null, pending: null }
const listeners = new Set()
export function refreshLaunch() {
  cache.pending = cache.pending || loadLaunchBoard()
    .then(rows => { cache = { at: Date.now(), rows: rows || [], pending: null }; listeners.forEach(f => f(cache.rows)); return cache.rows })
    .catch(() => { cache.pending = null; return cache.rows || [] })
  return cache.pending
}

/** { rows, byId, reload } — byId maps a listing id to its launch row */
export function useLaunch(refreshKey) {
  const [rows, setRows] = useState(cache.rows)
  useEffect(() => {
    listeners.add(setRows)
    if (!cache.rows || Date.now() - cache.at > 60e3 || refreshKey !== undefined) refreshLaunch()
    return () => listeners.delete(setRows)
  }, [refreshKey])
  const byId = new Map((rows || []).map(r => [r.id, r]))
  return { rows, byId, reload: refreshLaunch }
}
