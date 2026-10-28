/**
 * Who can see what. The list of lockable sections is the portal's own
 * navigation, so a new module appears in the permission checklist the moment
 * it's added — there is no second list to keep in step.
 */

export const NAV_GROUPS = [
  { label: 'Overview', items: [
    // The dashboard summarises the whole business, so it's for admins only
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard', adminOnly: true },
  ] },
  { label: 'Listings', items: [
    { id: 'calculator', icon: 'calculator', label: 'Calculator' },
    { id: 'saved', icon: 'bookmark', label: 'Saved Listings' },
    { id: 'approvals', icon: 'check', label: 'Approvals' },
    { id: 'live', icon: 'live', label: 'Live Products' },
  ] },
  { label: 'Sourcing', items: [
    { id: 'hunter', icon: 'search', label: 'Product Hunter' },
    { id: 'stock', icon: 'package', label: 'Products' },
    { id: 'stock-planning', icon: 'trend', label: 'Stock Planning' },
    { id: 'not-listed', icon: 'eye', label: 'Not Listed' },
    { id: 'suppliers', icon: 'truck', label: 'Suppliers' },
    { id: 'carriers', icon: 'truck', label: 'Carriers' },
    { id: 'companies', icon: 'briefcase', label: 'Companies' },
    { id: 'brands', icon: 'tag', label: 'Brands' },
  ] },
  { label: 'Purchasing', items: [
    { id: 'purchases', icon: 'receipt', label: 'Purchase Orders' },
    { id: 'payments', icon: 'pound', label: 'Pending Payments' },
    { id: 'issues', icon: 'alert', label: 'Delivery Problems' },
  ] },
  { label: 'Warehouse', items: [
    { id: 'dispatch', icon: 'printer', label: 'Dispatch' },
    { id: 'dispatch-dashboard', icon: 'trend', label: 'Post Dispatch' },
    { id: 'requests', icon: 'inbox', label: 'Stock Requests' },
    { id: 'goods-in', icon: 'package', label: 'Goods In' },
    { id: 'inventory', icon: 'box', label: 'Inventory' },
    { id: 'tasks', icon: 'check', label: 'Tasks' },
    { id: 'tracking', icon: 'pin', label: 'Delivery tracking' },
    // Claims with the carriers: its own page, given to whoever raises them (e.g. Jignesh and the office)
    { id: 'claims', icon: 'receipt', label: 'Claims' },
    // The warehouse Mac prints what phones send; anyone printing from a phone can see if it's online
    { id: 'print-station', icon: 'printer', label: 'Print Station' },
    // Any order, and everything that happened to it
    { id: 'order-audit', icon: 'search', label: 'Order Audit' },
  ] },
  { label: 'Customers', items: [
    // Logged by the office and Jignesh: tick it for them in Team & Access
    { id: 'customer-care', icon: 'review', label: 'Cases & Refunds' },
    // The warehouse logs what comes back; the office sees it in Cases & Refunds too
    { id: 'returns', icon: 'inbox', label: 'Returns' },
  ] },
  { label: 'Optimise', items: [
    { id: 'families', icon: 'layers', label: 'Product Families' },
    { id: 'shipping', icon: 'truck', label: 'Shipping' },
    { id: 'packaging', icon: 'box', label: 'Packaging' },
  ] },
  { label: 'Planning', items: [
    { id: 'buildmonth', icon: 'calendar', label: 'Build a Month' },
    { id: 'overheads', icon: 'briefcase', label: 'Overheads' },
  ] },
  { label: 'Tools', items: [
    { id: 'bulk', icon: 'upload', label: 'Bulk Upload' },
    { id: 'archive', icon: 'archive', label: 'Archive' },
    { id: 'settings', icon: 'settings', label: 'Cost Settings' },
    { id: 'team', icon: 'user', label: 'Team & Access', adminOnly: true },
    { id: 'notifications', icon: 'send', label: 'ClickUp messages', adminOnly: true },
  ] },
]

export const NAV = NAV_GROUPS.flatMap(g => g.items)

/**
 * Things a person can be trusted to do, beyond the pages they open. Ticked
 * per person in Team & Access, like a page; admins can always do them.
 */
export const CAPABILITIES = [
  { id: 'link-codes', icon: 'swap', label: 'Link item codes',
    description: 'Say what a packing-slip code is in our inventory. Every order with that code takes that stock and gets that stamp from then on, so only for people who know the products well.' },
  { id: 'cancel-labels', icon: 'close', label: 'Cancel labels',
    description: 'Take a label uploaded by mistake out of its batch, or a whole batch. The office can always do this; tick it for warehouse staff trusted to. Dispatched labels can never be cancelled.' },
]
export const isCapability = (id) => CAPABILITIES.some(c => c.id === id)
/** Can this person do this (a capability, not a page)? */
export function canDo(me, id) {
  if (!me || me.active === false) return false
  return me.role === 'admin' || (Array.isArray(me.permissions) && me.permissions.includes(id))
}

/** Nothing is open to everyone — access is whatever an admin has ticked. */
export const ALWAYS_OPEN = []

/** The sections an admin can grant or withhold. */
export const LOCKABLE = NAV.filter(n => !n.adminOnly && !ALWAYS_OPEN.includes(n.id))

/**
 * Starting points. Choosing a role ticks its boxes; every box can then be
 * changed by hand, and the person keeps whatever is ticked.
 */
export const ROLES = {
  admin: {
    label: 'Admin', description: 'Everything, including cost settings and managing people.',
    pages: () => LOCKABLE.map(p => p.id),
  },
  manager: {
    label: 'Manager', description: 'Everything day to day. No cost settings, no managing people.',
    pages: () => LOCKABLE.filter(p => p.id !== 'settings').map(p => p.id),
  },
  hunter: {
    label: 'Product hunter', description: 'Find products, price them and send them for approval. Needs Purchasing access to see costs.',
    pages: () => ['calculator', 'saved', 'hunter', 'stock', 'live'],
  },
  warehouse: {
    label: 'Warehouse', description: 'Dispatch, stock requests, goods in, inventory, tasks and delivery tracking. Never sees what anything costs.',
    pages: () => ['dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'tracking'],
  },
  accounts: {
    label: 'Accounts', description: 'Pending payments only — pay orders and file invoices.',
    pages: () => ['payments'],
  },
  member: {
    label: 'Custom', description: 'Only the sections you tick below.',
    pages: () => [],
  },
}

export const roleLabel = (role) => ROLES[role]?.label || 'Custom'

/** Can this person open this section? Admins can open everything. */
export function canAccess(me, pageId) {
  if (!me || me.active === false) return false
  if (me.role === 'admin') return true
  const page = NAV.find(n => n.id === pageId)
  if (page?.adminOnly) return false
  if (ALWAYS_OPEN.includes(pageId)) return true
  return Array.isArray(me.permissions) && me.permissions.includes(pageId)
}

/** The navigation this person should see. */
export function visibleNav(me) {
  return NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => canAccess(me, i.id)) }))
    .filter(g => g.items.length)
}

export const pageLabel = (id) => NAV.find(n => n.id === id)?.label || id

/**
 * Where this person lands. Admins get the dashboard; everyone else starts on
 * the first section they've been given, in menu order.
 */
export function landingPage(me) {
  if (canAccess(me, 'dashboard')) return 'dashboard'
  const first = visibleNav(me)[0]?.items?.[0]?.id
  return first || null
}

/**
 * Costs (unit costs, margins, purchase orders, stock value) are for Purchasing only:
 * anyone without Purchase Orders, Pending Payments or Delivery Problems never sees one. Admins always do.
 * public.sees_costs() in the database uses the same list — npm test checks they match.
 */
export const PURCHASING = ['purchases', 'payments', 'issues']
/** Pages that work without costs. Any other page is built on costs, so it needs Purchasing access too. */
export const COST_FREE = ['dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'tracking',
  'print-station', 'order-audit', 'claims', 'customer-care', 'returns']
/** Does this page only work for someone who sees costs? (New pages do, until listed above — the safe default.) */
export const needsCosts = (id) => !COST_FREE.includes(id) && !PURCHASING.includes(id)
/** The ticked Purchasing sections — the reason someone sees costs (empty = they see none) */
export const costPages = (permissions = []) => permissions.filter(p => PURCHASING.includes(p))
export const seesCosts = (me) => !!me && me.active !== false &&
  (me.role === 'admin' || (Array.isArray(me.permissions) && me.permissions.some(p => PURCHASING.includes(p))))
/** The office: approves new products and owns every product's name and SKU (public.can_approve_products()) */
export const canApproveProducts = (me) => seesCosts(me) || canDo(me, 'link-codes')
/** Cancelling labels: someone with Dispatch who is the office, or is ticked "Cancel labels" (public.can_cancel_labels()) */
export const canCancelLabels = (me) => canAccess(me, 'dispatch') && (seesCosts(me) || canDo(me, 'cancel-labels'))
