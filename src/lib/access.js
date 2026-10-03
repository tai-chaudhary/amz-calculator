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
  { label: 'Optimise', items: [
    { id: 'families', icon: 'layers', label: 'Product Families' },
    { id: 'shipping', icon: 'truck', label: 'Shipping' },
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
  ] },
]

export const NAV = NAV_GROUPS.flatMap(g => g.items)

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
    label: 'Product hunter', description: 'Find products, price them and send them for approval.',
    pages: () => ['calculator', 'saved', 'hunter', 'stock', 'live'],
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
