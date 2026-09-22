import React, { useState, useEffect, useCallback, useMemo } from 'react'
import CalculatorPage, { EMPTY_CALC } from './components/CalculatorPage'
import DashboardPage from './components/DashboardPage'
import SavedPage from './components/SavedPage'
import BuildMonthPage from './components/BuildMonthPage'
import SettingsPage from './components/SettingsPage'
import OverheadsPage from './components/OverheadsPage'
import LiveProductsPage from './components/LiveProductsPage'
import BulkUploadPage from './components/BulkUploadPage'
import PortfolioPage from './components/PortfolioPage'
import StockItemsPage from './components/StockItemsPage'
import FamiliesPage from './components/FamiliesPage'
import ProposedChangesPage from './components/ProposedChangesPage'
import ApprovalsPage from './components/ApprovalsPage'
import SuppliersPage from './components/SuppliersPage'
import HunterPage from './components/HunterPage'
import { VERSION, BUILD_TIME } from './version'
import { parseHeliumExport } from './lib/hunter'
import { heliumDateFromFile } from './lib/hunts'
import { feeProposals, listProposals, cheaperSupplierProposals, rowsFromCatalogue, carrierProposals, supplierForName } from './lib/proposals'
import { LinksProvider } from './components/Links'
import { fillFromProducts, calcFromProduct } from './lib/autofill'
import ShippingPage from './components/ShippingPage'
import ArchivePage from './components/ArchivePage'
import ReviewPage from './components/ReviewPage'
import LoginPage from './components/LoginPage'
import { Icon } from './components/UI'
import { supabase } from './lib/supabase'
import { calcProduct } from './lib/calc'
import {
  loadSettings, saveSettings,
  loadProducts, saveProduct, updateProduct, deleteProduct, EditConflict, logActivity, loadActivity, loadSettingsRow,
  loadMonths, saveMonth, updateMonth, deleteMonth,
  loadOverheads, saveOverheads,
  loadLiveProducts, pushProductLive, updateLiveProductStatus, removeLiveProduct,
  loadPriceHistory, logPriceChange,
  loadCostHistory, logCostChange,
  loadStockItems, saveStockItem, updateStockItem, deleteStockItem,
  loadProfiles, upsertProfile,
  loadSuppliers, updateSupplier, loadSupplierProducts, saveSupplierProducts,
  logPriceListImport, loadPriceListImports,
  loadProposedChanges, addProposedChanges, decideProposedChanges,
  loadMarketListings, saveMarketListings, loadAsinMatches, saveAsinMatch, deleteAsinMatch,
  loadHunts, createHunt, updateHunt, loadHuntItems, updateHuntItems,
  loadSyncStatus, triggerSupplierSync,
  loadCatalogueForStock, loadCatalogueForHunt, loadCatalogueStats,
} from './lib/db'

const NAV_GROUPS = [
  { label: 'Overview', items: [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
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
    { id: 'brands', icon: 'tag', label: 'Brands' },
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
  ] },
]

// Old destinations still work: they land on where that job lives now
const REDIRECTS = {
  review: ['approvals', 'listings'],
  changes: ['approvals', 'changes'],
  pricelists: ['suppliers', null],
}

const NAV = NAV_GROUPS.flatMap(group => group.items)

export default function App() {
  const [session, setSession] = useState(undefined)
  // Page lives in the URL hash so refresh, back/forward and bookmarks all work
  const VALID_PAGES = NAV.map(n => n.id)
  const parseHash = () => {
    const raw = (window.location.hash || '').replace(/^#\/?/, '')
    const [h, qs] = raw.split('?')
    const focus = new URLSearchParams(qs || '').get('focus') || null
    if (REDIRECTS[h]) return { page: REDIRECTS[h][0], focus: focus || REDIRECTS[h][1] }
    return { page: VALID_PAGES.includes(h) ? h : 'dashboard', focus }
  }
  const [page, setPageState] = useState(() => parseHash().page)
  const [focusId, setFocusId] = useState(() => parseHash().focus)

  const setPage = useCallback((next) => {
    setPageState(next)
    setFocusId(null)
    const target = `#/${next}`
    if (window.location.hash !== target) window.location.hash = target
  }, [])

  // Jump to a specific record on another page
  const navigateTo = useCallback((requested, requestedId) => {
    const [nextPage, id] = REDIRECTS[requested]
      ? [REDIRECTS[requested][0], requestedId || REDIRECTS[requested][1]]
      : [requested, requestedId]
    setPageState(nextPage)
    setFocusId(id || null)
    window.location.hash = id ? `#/${nextPage}?focus=${id}` : `#/${nextPage}`
  }, [])

  // Respond to back/forward and manual hash edits
  useEffect(() => {
    const onHashChange = () => {
      const { page: p, focus } = parseHash()
      setPageState(p); setFocusId(focus)
    }
    window.addEventListener('hashchange', onHashChange)
    // Normalise the URL on first load
    if (!window.location.hash) window.location.replace(`#/${parseHash().page}`)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Scroll to top only on a genuine page change
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [page])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [settings, setSettings] = useState(null)
  const [savedProducts, setSavedProducts] = useState([])
  const [months, setMonths] = useState([])
  const [overheads, setOverheads] = useState([])
  const [liveProducts, setLiveProducts] = useState([])
  const [priceHistory, setPriceHistory] = useState([])
  const [costHistory, setCostHistory] = useState([])
  const [stockItems, setStockItems] = useState([])

  // The version of each record this portal last read or wrote. A deliberate
  // edit is only saved if nobody else has saved that record in the meantime —
  // our own saves move the version too, so they never look like someone else's.
  const versions = React.useRef(new Map())
  const seedVersions = (rows, prefix) => rows.forEach(r => {
    const k = prefix + r.id
    if (r.updated_at && !versions.current.has(k)) versions.current.set(k, r.updated_at)
  })
  const writeProduct = React.useCallback(async (id, data, { check = false } = {}) => {
    const row = await updateProduct(id, data, check ? versions.current.get('p' + id) : undefined)
    if (row?.updated_at) versions.current.set('p' + id, row.updated_at)
    return row
  }, [])
  const writeStockItem = React.useCallback(async (id, data, { check = false } = {}) => {
    const row = await updateStockItem(id, data, check ? versions.current.get('s' + id) : undefined)
    if (row?.updated_at) versions.current.set('s' + id, row.updated_at)
    return row
  }, [])
  const [suppliers, setSuppliers] = useState([])
  const [supplierProducts, setSupplierProducts] = useState([])
  const [priceImports, setPriceImports] = useState([])
  const [proposals, setProposals] = useState([])
  const [marketListings, setMarketListings] = useState([])
  const [asinMatches, setAsinMatches] = useState([])
  const [hunts, setHunts] = useState([])
  const [huntItems, setHuntItems] = useState([])
  const [syncStatus, setSyncStatus] = useState({ states: [], runs: [] })
  const [catalogueStats, setCatalogueStats] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  // Browsers discard background tabs to save memory and reload them on return.
  // We can't stop that, so we keep in-progress work in sessionStorage and put
  // it straight back — a reload becomes invisible instead of destructive.
  const WORKSPACE_KEY = 'gg.workspace.v1'
  const restored = (() => {
    try { return JSON.parse(sessionStorage.getItem(WORKSPACE_KEY) || 'null') } catch { return null }
  })()

  const [calc, setCalc] = useState(restored?.calc || EMPTY_CALC)
  const [loadedProductId, setLoadedProductId] = useState(restored?.loadedProductId || null)
  const [loadedProductName, setLoadedProductName] = useState(restored?.loadedProductName || '')

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(open => !open)
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Who's signed in — used to stamp every logged action
  const me = useMemo(() => {
    if (!session?.user) return null
    const prof = profiles.find(p => p.id === session.user.id)
    const email = session.user.email || ''
    return {
      id: session.user.id,
      email,
      name: prof?.display_name || email.split('@')[0] || 'Unknown',
      role: prof?.role || 'member',
    }
  }, [session, profiles])

  // Everything significant goes in one audit trail: who, what, when, and to what
  // Reads the current user at the moment of logging, so handlers created
  // before sign-in finished still record who did it
  const meRef = React.useRef(me)
  meRef.current = me
  const log = useCallback((entry) => {
    logActivity({ user_name: meRef.current?.name || null, ...entry,
      entity_id: entry.entity_id != null ? String(entry.entity_id) : null })
  }, [])

  const nameFor = useCallback((userId, fallback) => {
    if (!userId) return fallback || null
    const prof = profiles.find(p => p.id === userId)
    return prof?.display_name || fallback || 'Unknown'
  }, [profiles])

  const stamp = useCallback(() => ({
    userId: me?.id || null,
    userName: me?.name || null,
    at: new Date().toISOString(),
  }), [me])

  useEffect(() => {
    try {
      sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify({ calc, loadedProductId, loadedProductName }))
    } catch { /* private mode or quota — not worth interrupting anyone over */ }
  }, [calc, loadedProductId, loadedProductName])

  // Tabs are often frozen without warning; this is the last reliable moment to save
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify({ calc, loadedProductId, loadedProductName }))
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', save)
    window.addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', save)
      window.removeEventListener('pagehide', save)
    }
  }, [calc, loadedProductId, loadedProductName])

  const toastTimer = React.useRef(null)
  const showToast = (msg, type = 'success', action = null) => {
    clearTimeout(toastTimer.current)
    setToast({ msg, type, action })
    toastTimer.current = setTimeout(() => setToast(null), action ? 8000 : 3500)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      // Returning to the tab fires TOKEN_REFRESHED / SIGNED_IN with a brand-new
      // session object for the same person. Reacting to those would reload every
      // table, so only a real change of user is allowed through.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      setSession(prev => {
        if (prev?.user?.id && prev.user.id === next?.user?.id) return prev
        return next
      })
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setLoading(false); return }
    async function init() {
      setLoading(true)
      try {
        const [s, p, m, o, lp, ph, ch, sti, prof, sup, spr, imp, pc, ml, am, hs, hi, ss] = await Promise.all([
          loadSettings(), loadProducts(), loadMonths(), loadOverheads(), loadLiveProducts(), loadPriceHistory(), loadCostHistory(), loadStockItems(), loadProfiles(),
          loadSuppliers(), loadCatalogueStats(), loadPriceListImports(), loadProposedChanges(),
          loadMarketListings(), loadAsinMatches(), loadHunts(), loadHuntItems(), loadSyncStatus()
        ])
        setSettings(s)
        setSavedProducts(p)
        seedVersions(p, 'p')
        setMonths(m)
        setOverheads(o)
        setLiveProducts(lp)
        setPriceHistory(ph)
        setCostHistory(ch)
        setStockItems(sti)
        seedVersions(sti, 's')
        setProfiles(prof)
        setSuppliers(sup)
        setCatalogueStats(spr)
        // Only the catalogue lines that match your own stock
        setSupplierProducts(await loadCatalogueForStock(sti))
        setPriceImports(imp)
        setProposals(pc)
        setMarketListings(ml)
        setAsinMatches(am)
        setHunts(hs)
        setHuntItems(hi)
        setSyncStatus(ss)
      } catch {
        showToast('Failed to load data.', 'error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [session?.user?.id])

  const settingsVersion = React.useRef(null)
  const handleUpdateSettings = useCallback(async (newSettings) => {
    try {
      if (!settingsVersion.current) settingsVersion.current = (await loadSettingsRow())?.updated_at || null
      const row = await saveSettings(newSettings, settingsVersion.current)
      settingsVersion.current = row?.updated_at || null
      setSettings(newSettings)
      log({ entity_type: 'settings', entity_name: 'Carriers, packaging and routing', action: 'Settings saved' })
      showToast('Settings saved')
    } catch (e) {
      if (e?.conflict && e.latest) {
        settingsVersion.current = e.latest.updated_at
        setSettings(e.latest.value)
        showToast('Someone else saved Settings while you were editing. Their version is loaded — reapply your change and save again.', 'error')
      } else showToast('Failed to save settings', 'error')
    }
  }, [])

  const handleUpdateOverheads = useCallback(async (newOverheads) => {
    setOverheads(newOverheads)
    try { await saveOverheads(newOverheads); showToast('Overheads saved') }
    catch { showToast('Failed to save overheads', 'error') }
  }, [])

  const handleSaveProduct = useCallback(async (product) => {
    try {
      const s = stamp()
      const row = await saveProduct({
        ...product,
        createdBy: s.userId, createdByName: s.userName, createdAt: s.at,
      })
      setSavedProducts((prev) => [row, ...prev])
      log({ entity_type: 'listing', entity_id: row.id, entity_name: product.name, action: 'Created' })
      showToast(`"${product.name}" saved`)
      return row
    } catch { showToast('Failed to save product', 'error'); return null }
  }, [stamp])

  const handleUpdateProduct = useCallback(async (id, product) => {
    try {
      const existing = savedProducts.find(p => p.id === id)
      const before = existing?.data

      product = { ...product, lastEditedBy: meRef.current?.id || null, lastEditedByName: meRef.current?.name || null }
      try {
        await writeProduct(id, product, { check: true })
      } catch (e) {
        if (!e?.conflict) throw e
        // Someone else saved it first — show their version rather than overwrite it
        const latest = e.latest
        if (latest) {
          versions.current.set('p' + id, latest.updated_at)
          setSavedProducts(prev => prev.map(p => p.id === id ? latest : p))
        }
        const who = latest?.data?.lastEditedByName
        showToast(`${who ? who : 'Someone'} changed "${existing?.name || 'this listing'}" while you were editing. Their version is loaded — check it, then save your change again.`, 'error')
        return false
      }
      setSavedProducts((prev) => prev.map((p) =>
        p.id === id ? { ...p, name: product.name, data: product } : p
      ))

      // Log a cost change if the effective cost actually moved
      if (before) {
        const costOf = (d) => {
          const q = parseInt(d.bundleQty) || 1
          return q > 1 ? (parseFloat(d.costPerItem) || 0) * q : (parseFloat(d.costPrice) || 0)
        }
        const oldCost = costOf(before)
        const newCost = costOf(product)
        if (Math.abs(oldCost - newCost) > 0.001) {
          const rOld = calcProduct(before, settings.carriers, settings.packaging)
          const rNew = calcProduct(product, settings.carriers, settings.packaging)
          const entry = await logCostChange({
            saved_product_id: id,
            old_cost: oldCost,
            new_cost: newCost,
            old_margin: rOld.margin,
            new_margin: rNew.margin,
            sell_price: rNew.sellPrice,
            supplier_name: product.supplierName || null,
            is_bundle: (parseInt(product.bundleQty) || 1) > 1,
            bundle_qty: parseInt(product.bundleQty) || 1,
            note: null,
            user_id: me?.id || null,
            user_name: me?.name || null,
          })
          if (entry) setCostHistory(prev => [entry, ...prev])
        }
      }

      log({ entity_type: 'listing', entity_id: id, entity_name: product.name, action: 'Edited', detail: before ? Object.keys(product).filter(k => !['lastEditedBy','lastEditedByName'].includes(k) && JSON.stringify(product[k]) !== JSON.stringify(before[k])).slice(0, 8).join(', ') : null })
      showToast(`"${product.name}" updated`)
    } catch { showToast('Failed to update product', 'error') }
  }, [savedProducts, settings, me])

  // Committing a new live price — this is the only thing that writes price history
  const handleUpdateLivePrice = useCallback(async (savedProductId, updatedProduct, change) => {
    try {
      await writeProduct(savedProductId, updatedProduct)
      setSavedProducts((prev) => prev.map((p) =>
        p.id === savedProductId ? { ...p, data: updatedProduct } : p
      ))

      if (change) {
        const entry = await logPriceChange({
          saved_product_id: savedProductId,
          old_price: change.oldPrice,
          new_price: change.newPrice,
          old_margin: change.oldMargin,
          new_margin: change.newMargin,
          old_profit: change.oldProfit,
          new_profit: change.newProfit,
          cost_price: change.costPrice,
          source: 'live',
          note: change.note || null,
          user_id: me?.id || null,
          user_name: me?.name || null,
        })
        if (entry) setPriceHistory(prev => [entry, ...prev])
      }

      log({ entity_type: 'listing', entity_id: savedProductId, entity_name: updatedProduct.name, action: 'Price changed', detail: `to £${parseFloat(updatedProduct.sellPrice).toFixed(2)}` })
      showToast(`Live price set to £${parseFloat(updatedProduct.sellPrice).toFixed(2)}`)
    } catch { showToast('Failed to update price', 'error') }
  }, [me])

  const handleRenameProduct = useCallback(async (id, newName) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      await writeProduct(id, { ...row.data, name: newName })
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, name: newName, data: { ...p.data, name: newName } } : p))
      log({ entity_type: 'listing', entity_id: id, entity_name: newName, action: 'Renamed' })
      showToast('Product renamed')
    } catch { showToast('Failed to rename', 'error') }
  }, [savedProducts])

  const handleDeleteProduct = useCallback(async (id) => {
    try {
      await deleteProduct(id)
      setSavedProducts((prev) => prev.filter((p) => p.id !== id))
      log({ entity_type: 'listing', entity_id: id, action: 'Deleted' })
      showToast('Product deleted')
    } catch { showToast('Failed to delete product', 'error') }
  }, [])

  const handleSaveMonth = useCallback(async (month) => {
    try {
      const row = await saveMonth(month)
      setMonths((prev) => [row, ...prev])
      showToast(`"${month.name}" created`)
      return row
    } catch { showToast('Failed to save month', 'error') }
  }, [])

  const handleUpdateMonth = useCallback(async (id, month) => {
    setMonths((prev) => prev.map((m) => m.id === id ? { ...m, data: month, name: month.name } : m))
    try { await updateMonth(id, month) }
    catch { showToast('Failed to save month', 'error') }
  }, [])

  const handleRenameMonth = useCallback(async (id, newName) => {
    try {
      const row = months.find(m => m.id === id)
      if (!row) return
      const updated = { ...(row.data || row), name: newName }
      await updateMonth(id, updated)
      setMonths(prev => prev.map(m => m.id === id ? { ...m, name: newName, data: updated } : m))
      showToast('Month renamed')
    } catch { showToast('Failed to rename', 'error') }
  }, [months])

  const handleDeleteMonth = useCallback(async (id) => {
    try {
      await deleteMonth(id)
      setMonths((prev) => prev.filter((m) => m.id !== id))
      showToast('Month deleted')
    } catch { showToast('Failed to delete month', 'error') }
  }, [])

  const handleLoadProduct = useCallback((row) => {
    const data = { name: row.name, ...row.data }
    // Older listings may be missing supplier details their products already hold
    setCalc({ ...EMPTY_CALC, ...data, ...fillFromProducts(data, data.components, stockItems) })
    setLoadedProductId(row.id)
    setLoadedProductName(row.name)
    setPage('calculator')
  }, [stockItems])

  // Start a new listing from a product (optionally as a multipack), already filled in
  const handleCreateListing = useCallback((si, qty = 1) => {
    setCalc({ ...EMPTY_CALC, serviceLevel: 'nextday', ...calcFromProduct(si, qty) })
    setLoadedProductId(null)
    setLoadedProductName('')
    navigateTo('calculator')
    showToast(`New listing for ${qty > 1 ? `${qty} × ` : ''}"${si.name}" — add a price and check the fee`)
  }, [navigateTo])

  // Live product handlers
  const handlePushLive = useCallback(async (savedProductId, productName) => {
    try {
      // Check if already live
      if (liveProducts.find(lp => lp.saved_product_id === savedProductId && lp.status !== 'removed')) {
        showToast('This product is already live', 'error')
        return
      }
      const row = await pushProductLive(savedProductId)
      setLiveProducts(prev => [row, ...prev])
      // Record who pushed it live on the listing itself
      const saved = savedProducts.find(p => p.id === savedProductId)
      if (saved) {
        const s = stamp()
        const updated = { ...(saved.data || {}), liveBy: s.userId, liveByName: s.userName, liveAt: s.at }
        await writeProduct(savedProductId, updated)
        setSavedProducts(prev => prev.map(p => p.id === savedProductId ? { ...p, data: updated } : p))
      }
      log({ entity_type: 'listing', entity_id: savedProductId, entity_name: productName, action: 'Went live' })
      showToast(`"${productName}" is now live.`)
    } catch { showToast('Failed to push live', 'error') }
  }, [liveProducts, savedProducts, stamp])

  const handleLiveStatusChange = useCallback(async (id, status) => {
    try {
      await updateLiveProductStatus(id, status)
      setLiveProducts(prev => prev.map(lp => lp.id === id ? { ...lp, status } : lp))
      showToast(status === 'live' ? 'Listing set to live' : 'Listing paused')
    } catch { showToast('Failed to update status', 'error') }
  }, [])

  const handleRemoveLive = useCallback(async (id) => {
    try {
      await removeLiveProduct(id)
      setLiveProducts(prev => prev.filter(lp => lp.id !== id))
      log({ entity_type: 'listing', entity_id: liveProducts.find(l => l.id === id)?.saved_product_id || id, action: 'Removed from live' })
      showToast('Removed from live listings')
    } catch { showToast('Failed to remove', 'error') }
  }, [])

  // Review workflow
  const handleSendReview = useCallback(async (id, name) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      const s = stamp()
      const updated = { ...(row.data || {}), reviewStatus: 'review',
        submittedBy: s.userId, submittedByName: s.userName, submittedAt: s.at }
      await writeProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      log({ entity_type: 'listing', entity_id: id, entity_name: name, action: 'Sent for review' })
      showToast(`"${name}" sent to review`)
    } catch { showToast('Failed to send to review', 'error') }
  }, [savedProducts, stamp])

  // editedData: the reviewer's changes, approved in the same step so they're never lost
  const handleApproveReview = useCallback(async (id, name, editedData = null) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return false
      const base = editedData || row.data || {}
      if (!base.feeVerified && !window.confirm(
        `The Amazon fee for "${name}" hasn't been verified yet.\n\nEverything about this listing's margin depends on it. Approve anyway?`)) return false
      const s = stamp()
      const updated = { ...base, reviewStatus: 'approved', reviewNote: '',
        reviewedBy: s.userId, reviewedByName: s.userName, reviewedAt: s.at }
      if (editedData) {
        const changed = Object.keys(editedData).filter(k => JSON.stringify(editedData[k]) !== JSON.stringify(row.data?.[k]))
        if (changed.length) log({ entity_type: 'listing', entity_id: id, entity_name: name, action: 'Edited during review', detail: changed.join(', '),
          before: Object.fromEntries(changed.map(k => [k, row.data?.[k] ?? null])), after: Object.fromEntries(changed.map(k => [k, editedData[k] ?? null])) })
      }
      await writeProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      // Approval is a buying decision, not a listing decision — stock still has
      // to be ordered, so going live stays a separate, manual step.
      log({ entity_type: 'listing', entity_id: id, entity_name: name, action: 'Approved' })
      showToast(`"${name}" approved — ready to order`, 'success', { label: 'View', run: () => navigateTo('saved', id) })
      return true
    } catch { showToast('Failed to approve', 'error'); return false }
  }, [savedProducts, stamp, navigateTo])

  const handleSendBackReview = useCallback(async (id, note) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      const s = stamp()
      const updated = { ...(row.data || {}), reviewStatus: 'none', reviewNote: note || '',
        reviewedBy: s.userId, reviewedByName: s.userName, reviewedAt: s.at }
      await writeProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      log({ entity_type: 'listing', entity_id: id, action: 'Sent back', detail: note || null })
      showToast('Sent back to Saved Listings')
    } catch { showToast('Failed to send back', 'error') }
  }, [savedProducts])

  // Bulk import
  const handleBulkImport = useCallback(async (items, onProgress) => {
    const newSaved = []
    const newLive = []
    let done = 0
    let failed = 0

    for (const { product, pushLive } of items) {
      try {
        const row = await saveProduct(product)
        newSaved.push(row)
        if (pushLive) {
          const live = await pushProductLive(row.id)
          newLive.push(live)
        }
      } catch { failed++ }
      done++
      onProgress?.(done, items.length)
    }

    setSavedProducts(prev => [...newSaved.reverse(), ...prev])
    if (newLive.length) setLiveProducts(prev => [...newLive.reverse(), ...prev])

    const liveMsg = newLive.length ? `, ${newLive.length} pushed live` : ''
    const failMsg = failed ? `, ${failed} failed` : ''
    showToast(`${newSaved.length} product${newSaved.length !== 1 ? 's' : ''} imported${liveMsg}${failMsg}`, failed ? 'error' : 'success')
    if (newSaved.length) setPage('saved')
  }, [])

  // ── Products ──────────────────────────────────────────────────────────
  const handleAddStockItem = useCallback(async (item) => {
    try {
      const s = stamp()
      const row = await saveStockItem({ ...item, createdBy: s.userId, createdByName: s.userName, createdAt: s.at })
      setStockItems(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
      log({ entity_type: 'stock', entity_id: row?.id, entity_name: item.name, action: 'Created' })
      showToast(`"${item.name}" added to products`)
      return row
    } catch { showToast('Failed to add product', 'error'); return null }
  }, [stamp])

  // Editing a product cascades to every listing that uses it
  const handleUpdateStockItem = useCallback(async (id, item) => {
    try {
      const existing = stockItems.find(s => s.id === id)
      const oldCost = parseFloat(existing?.data?.costPrice) || 0
      const newCost = parseFloat(item.costPrice) || 0

      try {
        await writeStockItem(id, item, { check: true })
      } catch (e) {
        if (!e?.conflict) throw e
        if (e.latest) {
          versions.current.set('s' + id, e.latest.updated_at)
          setStockItems(prev => prev.map(s => s.id === id ? e.latest : s))
        }
        showToast(`Someone else changed "${existing?.name}" while you were editing. Their version is loaded — check it, then save again.`, 'error')
        return false
      }
      const nextStock = stockItems.map(s => s.id === id ? { ...s, name: item.name, data: item } : s)
      setStockItems(nextStock)

      // Log a cost change against each affected listing
      if (Math.abs(oldCost - newCost) > 0.0001) {
        const affected = savedProducts.filter(row =>
          Array.isArray(row.data?.components) &&
          row.data.components.some(c => c.stockItemId === id)
        )
        for (const row of affected) {
          const rOld = calcProduct(row.data, settings.carriers, settings.packaging, stockItems)
          const rNew = calcProduct(row.data, settings.carriers, settings.packaging, nextStock)
          const entry = await logCostChange({
            saved_product_id: row.id,
            old_cost: rOld.costPrice,
            new_cost: rNew.costPrice,
            old_margin: rOld.margin,
            new_margin: rNew.margin,
            sell_price: rNew.sellPrice,
            supplier_name: item.supplierName || null,
            is_bundle: (row.data.components || []).reduce((s, c) => s + (parseInt(c.qty) || 0), 0) > 1,
            bundle_qty: (row.data.components || []).reduce((s, c) => s + (parseInt(c.qty) || 0), 0),
            note: `Product "${item.name}" cost changed`,
            user_id: me?.id || null,
            user_name: me?.name || null,
          })
          if (entry) setCostHistory(prev => [entry, ...prev])
        }
        showToast(`"${item.name}" updated — ${affected.length} listing${affected.length !== 1 ? 's' : ''} recalculated`)
      } else {
        log({ entity_type: 'stock', entity_id: id, entity_name: item.name, action: 'Edited' })
        showToast(`"${item.name}" updated`)
      }
    } catch { showToast('Failed to update product', 'error') }
  }, [stockItems, savedProducts, settings, me])

  // A product any listing has ever used is archived, never deleted —
  // deleting it would leave those listings with no cost or weight
  const handleDeleteStockItem = useCallback(async (id) => {
    try {
      const users = savedProducts.filter(r => (r.data?.components || []).some(c => c.stockItemId === id))
      if (users.length) {
        const si = stockItems.find(s => s.id === id)
        const data = { ...(si?.data || {}), archived: true, archivedAt: new Date().toISOString(), archivedBy: me?.name || null }
        await writeStockItem(id, data)
        setStockItems(prev => prev.map(s => s.id === id ? { ...s, data } : s))
        showToast(`Archived rather than deleted — ${users.length} listing${users.length !== 1 ? 's' : ''} use${users.length === 1 ? 's' : ''} it`, 'success',
          { label: 'Undo', run: async () => {
            await writeStockItem(id, si.data)
            setStockItems(prev => prev.map(s => s.id === id ? { ...s, data: si.data } : s))
            showToast(`"${si.name}" restored`)
          } })
        return
      }
      await deleteStockItem(id)
      setStockItems(prev => prev.filter(s => s.id !== id))
      log({ entity_type: 'stock', entity_id: id, action: 'Deleted' })
      showToast('Product deleted')
    } catch { showToast('Failed to delete', 'error') }
  }, [savedProducts, stockItems, me])

  const handleRestoreStockItem = useCallback(async (id) => {
    const si = stockItems.find(s => s.id === id)
    if (!si) return
    const data = { ...si.data, archived: false }
    await writeStockItem(id, data)
    setStockItems(prev => prev.map(s => s.id === id ? { ...s, data } : s))
    log({ entity_type: 'stock', entity_id: id, entity_name: si.name, action: 'Restored' })
    showToast(`"${si.name}" restored`)
  }, [stockItems])

  // One-time migration: create products and link every listing
  const handleRunMigration = useCallback(async (plan) => {
    try {
      showToast('Creating products…')
      const keyToId = new Map()
      const created = []
      for (const s of plan.stockItems) {
        const { _key, ...clean } = s
        const row = await saveStockItem(clean)
        keyToId.set(_key, row.id)
        created.push(row)
      }
      setStockItems(prev => [...prev, ...created].sort((a, b) => a.name.localeCompare(b.name)))

      showToast('Linking listings…')
      const updates = []
      for (const link of plan.links) {
        const row = savedProducts.find(r => r.id === link.productId)
        if (!row) continue
        const components = link.components
          .map(c => ({ stockItemId: keyToId.get(c._key), qty: c.qty }))
          .filter(c => c.stockItemId)
        if (!components.length) continue
        const updated = { ...row.data, components }
        await writeProduct(row.id, updated)
        updates.push({ id: row.id, data: updated })
      }
      setSavedProducts(prev => prev.map(r => {
        const u = updates.find(x => x.id === r.id)
        return u ? { ...r, data: u.data } : r
      }))

      showToast(`Linked ${updates.length} listings to ${created.length} products`)
    } catch { showToast('Migration failed partway — check Products', 'error') }
  }, [savedProducts])

  // ── Archive ──────────────────────────────────────────────────────────────
  const handleRunSweep = useCallback(async (sweep, opts) => {
    try {
      const targets = opts.keepReview
        ? sweep.toArchive.filter(r => (r.data?.reviewStatus || 'none') !== 'review')
        : sweep.toArchive

      showToast(`Archiving ${targets.length} listings…`)
      const stamp = new Date().toISOString()
      const done = []
      for (const row of targets) {
        const updated = { ...(row.data || {}), archived: true, archivedAt: stamp }
        await writeProduct(row.id, updated)
        done.push({ id: row.id, data: updated })
      }
      setSavedProducts(prev => prev.map(r => {
        const d = done.find(x => x.id === r.id)
        return d ? { ...r, data: d.data } : r
      }))

      let removed = 0
      if (opts.removeStock) {
        for (const si of sweep.orphanStock) {
          try { await deleteStockItem(si.id); removed++ } catch { /* keep going */ }
        }
        const gone = new Set(sweep.orphanStock.map(s => s.id))
        setStockItems(prev => prev.filter(s => !gone.has(s.id)))
      }

      showToast(`Archived ${done.length} listings${removed ? `, removed ${removed} products` : ''}`)
    } catch { showToast('Archive sweep failed partway — check the Archive page', 'error') }
  }, [])

  const handleRestoreArchived = useCallback(async (id, name) => {
    try {
      const row = savedProducts.find(r => r.id === id)
      if (!row) return
      const { archived, archivedAt, ...rest } = row.data || {}
      await writeProduct(id, rest)
      setSavedProducts(prev => prev.map(r => r.id === id ? { ...r, data: rest } : r))
      log({ entity_type: 'listing', entity_id: id, entity_name: name, action: 'Restored from archive' })
      showToast(`"${name}" restored`)
    } catch { showToast('Failed to restore', 'error') }
  }, [savedProducts])

  const handleSaveProfile = useCallback(async (displayName, role) => {
    if (!me?.id) return
    const row = await upsertProfile(me.id, displayName, role)
    if (row) {
      setProfiles(prev => {
        const others = prev.filter(p => p.id !== row.id)
        return [...others, row]
      })
      showToast('Profile saved')
    } else {
      showToast('Failed to save profile', 'error')
    }
  }, [me])


  // ── Suppliers, price lists and proposed changes ───────────────────────────
  const handleUpdateSupplier = useCallback(async (id, data) => {
    try {
      await updateSupplier(id, data)
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, data } : s))
      log({ entity_type: 'supplier', entity_id: id, entity_name: suppliers.find(s => s.id === id)?.name, action: 'Terms changed', after: data })
      showToast('Supplier terms saved')
    } catch { showToast('Failed to save supplier', 'error') }
  }, [])

  const raiseProposals = useCallback(async (list) => {
    if (!list.length) return 0
    const added = await addProposedChanges(list)
    if (added.length) setProposals(prev => [...added, ...prev])
    return added.length
  }, [])

  // Shipping review finds cheaper carriers; switching them is proposed, not applied
  const handleProposeCarrier = useCallback(async (items) => {
    try {
      const raised = await raiseProposals(carrierProposals(items, settings.carriers))
      showToast(raised ? `${raised} switch${raised !== 1 ? 'es' : ''} proposed — approve them in Approvals` : 'Already proposed')
    } catch { showToast('Could not propose the switch', 'error') }
  }, [raiseProposals, settings])

  const handleImportList = useCallback(async ({ supplier, rows, listDate, fileName }, onProgress) => {
    try {
      await saveSupplierProducts(supplier.id, rows, listDate, onProgress)
      const [fresh, stats] = await Promise.all([loadCatalogueForStock(stockItems), loadCatalogueStats()])
      setSupplierProducts(fresh)
      setCatalogueStats(stats)

      const list = [
        ...listProposals({ supplier, rows, listDate, stockItems }),
        ...cheaperSupplierProposals({ stockItems, supplierProducts: fresh, suppliers }),
      ]
      const raised = await raiseProposals(list)

      const entry = await logPriceListImport({
        supplier_id: supplier.id, file_name: fileName, list_date: listDate || null,
        imported_by: me?.name || null,
        summary: { products: rows.length, proposals: raised },
      })
      if (entry) setPriceImports(prev => [entry, ...prev])
      log({ entity_type: 'supplier', entity_id: supplier.id, entity_name: supplier.name, action: 'Price list imported', detail: `${rows.length} products, ${raised} changes proposed`, source: fileName })
      showToast(`${rows.length.toLocaleString()} products imported${raised ? ` — ${raised} change${raised !== 1 ? 's' : ''} proposed` : ''}`)
    } catch (e) {
      const why = e?.message ? ` (${e.message})` : ''
      showToast(`Import failed — nothing on your products was changed${why}`, 'error')
    }
  }, [stockItems, suppliers, me, raiseProposals])

  const handleScanForChanges = useCallback(async () => {
    try {
      const liveRows = liveProducts
        .filter(lp => lp.status === 'live')
        .map(lp => ({ saved: savedProducts.find(s => s.id === lp.saved_product_id) }))
        .filter(x => x.saved && !x.saved.data?.archived)
      const list = [
        ...feeProposals(liveRows),
        ...cheaperSupplierProposals({ stockItems, supplierProducts, suppliers }),
      ]
      const raised = await raiseProposals(list)
      showToast(raised ? `${raised} new change${raised !== 1 ? 's' : ''} proposed` : 'Nothing new to propose')
    } catch { showToast('Check failed', 'error') }
  }, [liveProducts, savedProducts, stockItems, supplierProducts, suppliers, raiseProposals])

  // Approving applies the change; rejecting just records the decision
  const handleDecideProposals = useCallback(async (list, status) => {
    const done = []
    let nextSaved = savedProducts
    let nextStock = stockItems
    // Snapshot of everything an approval could touch, so it can be undone
    const beforeSaved = new Map(savedProducts.map(r => [r.id, r]))
    const beforeStock = new Map(stockItems.map(s => [s.id, s]))
    try {
      if (status === 'approved') {
        for (const p of list) {
          const pl = p.payload || {}
          if (p.kind === 'carrier') {
            const row = nextSaved.find(r => r.id === p.target_id)
            if (!row) continue
            const data = { ...row.data, carrierId: pl.toCarrierId, carrierCatId: pl.toCatId }
            await writeProduct(row.id, data)
            nextSaved = nextSaved.map(r => r.id === row.id ? { ...r, data } : r)
          } else if (p.kind === 'referral_fee') {
            const row = nextSaved.find(r => r.id === p.target_id)
            if (!row) continue
            const data = { ...row.data, refFee: String(pl.to) }
            await writeProduct(row.id, data)
            nextSaved = nextSaved.map(r => r.id === row.id ? { ...r, data } : r)
          } else if (p.kind === 'barcode') {
            const si = nextStock.find(s => s.id === p.target_id)
            if (!si) continue
            const data = { ...si.data, barcode: pl.to }
            await writeStockItem(si.id, data)
            nextStock = nextStock.map(s => s.id === si.id ? { ...s, data } : s)
          } else if (p.kind === 'cost' || p.kind === 'cheaper_supplier') {
            const si = nextStock.find(s => s.id === p.target_id)
            if (!si) continue
            const data = p.kind === 'cheaper_supplier'
              ? { ...si.data, costPrice: String(pl.to), supplierName: pl.toSupplier, supplierSku: pl.toSku }
              : { ...si.data, costPrice: String(pl.to) }
            const before = nextStock
            await writeStockItem(si.id, data)
            nextStock = nextStock.map(s => s.id === si.id ? { ...s, data } : s)
            // Record the cost change against every listing it affects
            const affected = nextSaved.filter(r => (r.data?.components || []).some(c => c.stockItemId === si.id))
            for (const row of affected) {
              const rOld = calcProduct(row.data, settings.carriers, settings.packaging, before)
              const rNew = calcProduct(row.data, settings.carriers, settings.packaging, nextStock)
              const entry = await logCostChange({
                saved_product_id: row.id, old_cost: rOld.costPrice, new_cost: rNew.costPrice,
                old_margin: rOld.margin, new_margin: rNew.margin, sell_price: rNew.sellPrice,
                supplier_name: data.supplierName || null,
                note: p.kind === 'cheaper_supplier' ? `Switched to ${pl.toSupplier}` : (p.reason || 'Price list update'),
                user_id: me?.id || null, user_name: me?.name || null,
              })
              if (entry) setCostHistory(prev => [entry, ...prev])
            }
          }
          done.push(p.id)
        }
      } else {
        done.push(...list.map(p => p.id))
      }
      await decideProposedChanges(done, status, me?.name || null)
      setSavedProducts(nextSaved)
      setStockItems(nextStock)
      if (list.some(p => p.kind === 'barcode' || p.kind === 'cheaper_supplier')) {
        loadCatalogueForStock(nextStock).then(setSupplierProducts).catch(() => {})
      }
      const now = new Date().toISOString()
      setProposals(prev => prev.map(p => done.includes(p.id) ? { ...p, status, decided_by: me?.name || null, decided_at: now } : p))
      list.filter(p => done.includes(p.id)).forEach(p => log({ entity_type: p.target_type === 'stock_item' ? 'stock' : 'listing', entity_id: p.target_id, entity_name: p.payload?.listing || p.payload?.stockItem, action: `${status === 'approved' ? 'Approved' : 'Rejected'} ${p.kind.replace('_', ' ')} change`, detail: p.reason, before: p.payload?.from !== undefined ? { value: p.payload.from } : null, after: p.payload?.to !== undefined ? { value: p.payload.to } : null, source: 'proposal' }))
      const undo = status === 'approved' ? { label: 'Undo', run: async () => {
        try {
          const applied = list.filter(p => done.includes(p.id))
          for (const p of applied) {
            if (p.target_type === 'saved_product' && beforeSaved.has(p.target_id)) {
              const was = beforeSaved.get(p.target_id)
              await writeProduct(was.id, was.data)
              setSavedProducts(prev => prev.map(r => r.id === was.id ? { ...r, data: was.data } : r))
            }
            if (p.target_type === 'stock_item' && beforeStock.has(p.target_id)) {
              const was = beforeStock.get(p.target_id)
              await writeStockItem(was.id, was.data)
              setStockItems(prev => prev.map(s => s.id === was.id ? { ...s, data: was.data } : s))
            }
          }
          await decideProposedChanges(done, 'pending', null)
          setProposals(prev => prev.map(p => done.includes(p.id) ? { ...p, status: 'pending', decided_by: null, decided_at: null } : p))
          applied.forEach(p => log({ entity_type: p.target_type === 'stock_item' ? 'stock' : 'listing', entity_id: p.target_id,
            entity_name: p.payload?.listing || p.payload?.stockItem, action: `Undid ${p.kind.replace('_', ' ')} change`, source: 'undo' }))
          showToast(`Undone — ${applied.length} change${applied.length !== 1 ? 's are' : ' is'} back in Approvals`)
        } catch { showToast('Could not undo — nothing further was changed', 'error') }
      } } : null
      showToast(`${done.length} change${done.length !== 1 ? 's' : ''} ${status}`, 'success', undo)
    } catch {
      // Whatever succeeded before the failure has been applied — record those
      if (done.length) {
        await decideProposedChanges(done, status, me?.name || null).catch(() => {})
        setSavedProducts(nextSaved); setStockItems(nextStock)
        setProposals(prev => prev.map(p => done.includes(p.id) ? { ...p, status } : p))
      }
      showToast(`Stopped after ${done.length} — the rest are still waiting`, 'error')
    }
  }, [savedProducts, stockItems, settings, me])

  // ── Hunts ─────────────────────────────────────────────────────────────────
  const handleCreateHunts = useCallback(async (entries) => {
    let first = null
    try {
      for (const e of entries) {
        const now = new Date().toISOString()
        await saveMarketListings(e.listings.map(l => ({ ...l, updated_at: now })))
        const brands = [...new Set(e.listings.map(l => l.brand).filter(Boolean))]
        const hunt = await createHunt(
          { name: e.name.trim() || e.fileName, source_file: e.fileName, created_by: me?.name || null,
            data: { heliumDate: heliumDateFromFile(e.fileName), brands } },
          e.listings.map(l => ({ asin: l.asin, snapshot: { title: l.title, brand: l.brand, data: l.data } })))
        setHunts(prev => [hunt, ...prev])
        setMarketListings(prev => {
          const map = new Map(prev.map(x => [x.asin, x]))
          e.listings.forEach(l => map.set(l.asin, { ...l, updated_at: now }))
          return [...map.values()]
        })
        if (!first) first = hunt
      }
      setHuntItems(await loadHuntItems())
      showToast(entries.length > 1 ? `${entries.length} hunts created` : `"${first.name}" created`)
      if (entries.length === 1 && first) navigateTo('hunter', first.id)
    } catch (e) { showToast(`Could not create the hunt${e?.message ? ` (${e.message})` : ''}`, 'error') }
  }, [me, navigateTo])

  const handleUpdateHunt = useCallback(async (id, patch, { quiet } = {}) => {
    setHunts(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h))
    try {
      await updateHunt(id, patch)
      if (!quiet && patch.status) showToast(patch.status === 'complete' ? 'Hunt marked as finished' : 'Hunt reopened')
    } catch { if (!quiet) showToast('Could not save the hunt', 'error') }
  }, [])

  const handleSetDisposition = useCallback(async (ids, disposition, reason = null, note = null) => {
    const patch = disposition === 'pending'
      ? { disposition, reason: null, note: null, decided_by: null, decided_at: null }
      : { disposition, reason, note, decided_by: me?.name || null, decided_at: new Date().toISOString() }
    setHuntItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, ...patch } : i))
    try {
      await updateHuntItems(ids, patch)
      const byHunt = {}
      huntItems.filter(i => ids.includes(i.id)).forEach(i => { byHunt[i.hunt_id] = (byHunt[i.hunt_id] || 0) + 1 })
      Object.entries(byHunt).forEach(([hid, n]) => log({ entity_type: 'hunt', entity_id: hid, entity_name: hunts.find(h => h.id === hid)?.name,
        action: disposition === 'pending' ? 'Moved back to decide' : disposition === 'skipped' ? 'Skipped' : disposition === 'later' ? 'Saved for later' : 'Updated',
        detail: `${n} product${n !== 1 ? 's' : ''}${reason ? ` — ${reason}` : ''}${note ? `: ${note}` : ''}`, source: 'hunter' }))
      if (ids.length > 1) showToast(`${ids.length} listings ${disposition === 'skipped' ? 'skipped' : 'updated'}`)
    } catch {
      showToast('Could not save that — refreshing', 'error')
      setHuntItems(await loadHuntItems())
    }
  }, [me, huntItems, hunts])

  // ── Online supplier sync ───────────────────────────────────────────────────
  // Compare what the overnight sync found with your products, and raise
  // anything that differs as a proposal. Already-raised and rejected ones are skipped.
  const raiseOnlineProposals = useCallback(async (products, onlyName = null) => {
    const online = suppliers.filter(s => s.data?.sync && (!onlyName || s.name === onlyName))
    const list = []
    for (const s of online) {
      const rows = rowsFromCatalogue(products, s.id)
      if (!rows.length) continue
      list.push(...listProposals({ supplier: s, rows, listDate: new Date().toISOString().slice(0, 10), stockItems }))
    }
    list.push(...cheaperSupplierProposals({ stockItems, supplierProducts: products, suppliers }))
    return raiseProposals(list)
  }, [suppliers, stockItems, raiseProposals])

  const handleSyncNow = useCallback(async (supplierName) => {
    try {
      const res = await triggerSupplierSync(supplierName)
      const r = res?.results?.[0] || {}
      const [fresh, ss, stats] = await Promise.all([loadCatalogueForStock(stockItems), loadSyncStatus(), loadCatalogueStats()])
      setSupplierProducts(fresh)
      setSyncStatus(ss)
      setCatalogueStats(stats)
      const raised = await raiseOnlineProposals(fresh, supplierName)
      if (r.error) showToast(`${supplierName}: ${r.error}`, 'error')
      else if (r.skipped) showToast(`${supplierName} is ${r.skipped}`)
      else showToast(r.done
        ? `${supplierName} synced${raised ? ` — ${raised} change${raised !== 1 ? 's' : ''} proposed` : ''}`
        : `${supplierName}: read to page ${r.pos} — the overnight run will finish the rest`)
    } catch (e) { showToast(`Sync failed${e?.message ? ` (${e.message})` : ''}`, 'error') }
  }, [raiseOnlineProposals, stockItems])

  // ── Product hunter ────────────────────────────────────────────────────────
  const handleImportHelium = useCallback(async (text, fileName) => {
    const { listings, error } = parseHeliumExport(text, fileName)
    if (error) { showToast(error, 'error'); return }
    if (!listings.length) { showToast(`No listings found in ${fileName}`, 'error'); return }
    try {
      const now = new Date().toISOString()
      const rows = listings.map(l => ({ ...l, updated_at: now }))
      await saveMarketListings(rows)
      setMarketListings(prev => {
        const map = new Map(prev.map(x => [x.asin, x]))
        rows.forEach(r => map.set(r.asin, r))
        return [...map.values()]
      })
      showToast(`${listings.length.toLocaleString()} listings imported from ${fileName}`)
    } catch (e) { showToast(`Import failed${e?.message ? ` (${e.message})` : ''}`, 'error') }
  }, [])

  const handleDecideMatch = useCallback(async (asin, status, components) => {
    try {
      if (status === 'clear') {
        await deleteAsinMatch(asin)
        setAsinMatches(prev => prev.filter(m => m.asin !== asin))
        return
      }
      const row = await saveAsinMatch({ asin, status, components, decided_by: me?.name || null, decided_at: new Date().toISOString() })
      setAsinMatches(prev => [...prev.filter(m => m.asin !== asin), row])
      showToast(status === 'confirmed' ? 'Match confirmed — remembered for next time' : 'Marked as not a match')
    } catch { showToast('Could not save that decision', 'error') }
  }, [me])

  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(Ml|G|Kg|L)\b/g, (m, n, u) => n + u.toLowerCase())

  // Creates the product if needed and a listing in the Review Queue
  const handleSendToReview = useCallback(async ({ l, m, ev }, overrides = {}, ctx = {}) => {
    try {
      const s = stamp()
      const components = []
      let nextStock = stockItems
      // Use what was checked and adjusted in the panel, where given
      const comps = overrides.offer
        ? [{ sp: overrides.offer, qty: overrides.qty || m.components[0]?.qty || 1 }]
        : m.components
      for (const c of comps) {
        let si = nextStock.find(x => x.data?.barcode && x.data.barcode === c.sp.barcode)
        if (!si) {
          const supplier = suppliers.find(x => x.id === c.sp.supplier_id)
          const w = parseFloat(overrides.product?.weightKg) || ev.weightKg
          const n = overrides.qty || ev.units
          const unitWeight = w && n ? +(w / n).toFixed(3) : ''
          si = await saveStockItem({
            name: titleCase(c.sp.name), brand: l.brand || '',
            supplierName: supplier?.name || '', supplierSku: c.sp.supplier_sku,
            barcode: c.sp.barcode || '', costPrice: String(c.sp.unit_cost),
            weightKg: String(unitWeight), notes: 'Added by the product hunter',
            createdBy: s.userId, createdByName: s.userName, createdAt: s.at,
          })
          nextStock = [...nextStock, si]
        }
        components.push({ stockItemId: si.id, qty: c.qty })
      }
      const units = components.reduce((n, c) => n + (parseInt(c.qty) || 0), 0)
      const product = {
        ...ev.product,
        ...(overrides.product || {}),
        name: l.title.slice(0, 160), brand: l.brand || '', asin: l.asin,
        ...fillFromProducts({ brand: l.brand || '', name: l.title }, components, nextStock),
        components, bundleQty: String(units || 1), costPrice: '', useComponents: true,
        // Only carry a fee category across if it's genuinely known; otherwise
        // leave it for you to set and verify in the calculator
        feeCategory: overrides.product ? (overrides.product.feeCategory || '') : (ev.feeSource === 'confirmed' ? ev.feeCategory : ''),
        refFee: overrides.product ? (overrides.product.refFee || '15.3') : (ev.feeSource === 'your listing' ? ev.product.refFee : '15.3'),
        reviewStatus: 'review', submittedBy: s.userId, submittedByName: s.userName, submittedAt: s.at,
        createdBy: s.userId, createdByName: s.userName, createdAt: s.at,
        feeVerified: !!overrides.product?.feeVerified,
        hunter: {
          matchedBy: m.tier, sales: l.data.sales, sellers: l.data.sellers,
          amazonSelling: l.data.amazonSelling, marketPrice: l.data.price, at: s.at,
          feeSource: ev.feeSource, guessedCategory: ev.guessedCategory,
          packagingReason: ev.pack?.reason || null,
          huntId: ctx.hunt?.id || null, huntName: ctx.hunt?.name || null,
        },
      }
      const row = await saveProduct(product)
      setStockItems(nextStock.sort((a, b) => a.name.localeCompare(b.name)))
      setSavedProducts(prev => [row, ...prev])
      if (ctx.item?.id) {
        const patch = { disposition: 'sent', saved_product_id: row.id, decided_by: s.userName, decided_at: s.at, reason: null, note: null }
        await updateHuntItems([ctx.item.id], patch)
        setHuntItems(prev => prev.map(i => i.id === ctx.item.id ? { ...i, ...patch } : i))
      }
      // The listing's history records exactly where it came from
      const origin = comps[0]?.sp
      const supplierName = suppliers.find(x => x.id === origin?.supplier_id)?.name || null
      const provenance = {
        huntId: ctx.hunt?.id || null, huntName: ctx.hunt?.name || null, asin: l.asin,
        matchedBy: m.tier, supplier: supplierName, supplierSku: origin?.supplier_sku || null,
        units: comps.reduce((n, c) => n + (c.qty || 0), 0), marketPrice: l.data?.price ?? null,
        feeVerified: !!overrides.product?.feeVerified,
      }
      log({ entity_type: 'listing', entity_id: row.id, entity_name: l.title.slice(0, 120), action: 'Created from product hunter',
        detail: `From hunt "${ctx.hunt?.name || 'unknown'}" · ASIN ${l.asin} · matched by ${m.tier}${supplierName ? ` · ${supplierName}${origin?.supplier_sku ? ` ${origin.supplier_sku}` : ''}` : ''}`,
        after: provenance, source: 'hunter' })
      if (ctx.hunt) log({ entity_type: 'hunt', entity_id: ctx.hunt.id, entity_name: ctx.hunt.name, action: 'Sent to review',
        detail: l.title.slice(0, 120), after: { ...provenance, listingId: row.id }, source: 'hunter' })
      showToast(`"${l.title.slice(0, 40)}…" sent for review`, 'success',
        { label: 'View', run: () => navigateTo('saved', row.id) })
      return true
    } catch (e) { showToast(`Could not create the listing${e?.message ? ` (${e.message})` : ''}`, 'error'); return false }
  }, [stockItems, suppliers, stamp, navigateTo])

  const onlineChecked = React.useRef(false)
  useEffect(() => {
    if (onlineChecked.current || loading || !suppliers.length || !supplierProducts.length || !stockItems.length) return
    onlineChecked.current = true
    raiseOnlineProposals(supplierProducts).catch(() => {})
  }, [loading, suppliers, supplierProducts, stockItems, raiseOnlineProposals])

  // Get from anything to anything: every link chip in the portal uses these
  const links = useMemo(() => ({
    openSupplier: (name) => {
      const s = supplierForName(name, suppliers)
      navigateTo('suppliers', s ? s.id : null)
    },
    openBrand: (name) => navigateTo('brands', encodeURIComponent(name)),
    openProduct: (id) => navigateTo('stock', id),
    openListing: (id) => {
      const isLive = liveProducts.some(lp => lp.saved_product_id === id && lp.status !== 'removed')
      navigateTo(isLive ? 'live' : 'saved', id)
    },
  }), [suppliers, liveProducts, navigateTo])

  const handleSignOut = async () => { await supabase.auth.signOut() }

  if (session === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-paper">
        <div className="w-8 h-8 border-2 border-royal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!session) return <LoginPage />

  // Archived listings are hidden from every working view
  const activeProducts = savedProducts.filter(p => !p.data?.archived)
  const archivedCount = savedProducts.length - activeProducts.length

  const liveCount = liveProducts.filter(lp => lp.status === 'live').length
  const reviewCount = activeProducts.filter(p => (p.data?.reviewStatus || 'none') === 'review').length
  const everLiveIds = new Set(liveProducts.filter(lp => lp.status !== 'removed').map(lp => lp.saved_product_id))
  const savedCount = activeProducts.filter(p => !everLiveIds.has(p.id)).length

  const commandItems = [
    ...NAV.map(item => ({
      key: `page-${item.id}`,
      type: 'Page',
      label: item.label,
      hint: 'Go to page',
      icon: item.icon,
      action: () => setPage(item.id),
    })),
    ...activeProducts.map(row => {
      const hasLiveRecord = everLiveIds.has(row.id)
      return {
        key: `listing-${row.id}`,
        type: hasLiveRecord ? 'Live listing' : 'Saved listing',
        label: row.name,
        hint: row.data?.asin || row.data?.brand || '',
        icon: hasLiveRecord ? 'live' : 'bookmark',
        action: () => navigateTo(hasLiveRecord ? 'live' : 'saved', row.id),
      }
    }),
    ...stockItems.map(row => ({
      key: `stock-${row.id}`,
      type: 'Product',
      label: row.name,
      hint: row.data?.supplierSku || row.data?.supplierName || '',
      icon: 'package',
      action: () => navigateTo('stock', row.id),
    })),
  ]
  const q = commandQuery.trim().toLowerCase()
  const visibleCommands = (q
    ? commandItems.filter(item => `${item.label} ${item.hint} ${item.type}`.toLowerCase().includes(q))
    : commandItems.filter(item => item.type === 'Page')
  ).slice(0, 10)

  const navCountFor = (id) => {
    if (id === 'saved') return savedCount
    if (id === 'approvals') return reviewCount + proposals.filter(p => p.status === 'pending').length
    if (id === 'live') return liveCount
    if (id === 'archive') return archivedCount
    return 0
  }

  return (
    <LinksProvider value={links}>
    <div className="flex min-h-screen bg-paper">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-ink/30 backdrop-blur-[2px] z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-screen w-[258px] bg-white border-r border-rule flex flex-col z-30 transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:sticky lg:top-0 lg:z-auto lg:flex-shrink-0`}>

        <div className="px-5 pt-6 pb-4">
          <img src="/logo.png" alt="Good &amp; General" className="w-full max-w-[158px]" />
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/35 mt-3">Commerce operations</div>
        </div>

        <div className="px-3 pb-4">
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2.5 border border-rule rounded-[5px] bg-paper/55 text-ink/45 hover:border-royal-200 hover:text-royal-600 transition-colors text-left"
            onClick={() => { setCommandQuery(''); setCommandOpen(true) }}
          >
            <Icon name="search" size={15} />
            <span className="text-xs flex-1">Search anything</span>
            <span className="command-kbd">⌘K</span>
          </button>
        </div>

        <nav className="flex-1 px-3 pb-4 overflow-y-auto">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex ? 'pt-4' : ''}>
              <div className="nav-section">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const count = navCountFor(item.id)
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setPage(item.id); setSidebarOpen(false) }}
                      className={`nav-item ${page === item.id ? 'nav-item-active' : ''}`}
                    >
                      <Icon name={item.icon} size={16} className="flex-shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {count > 0 && <span className="nav-count">{count}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-rule">
          {me && (
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-[5px] bg-royal-500 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {me.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{me.name}</div>
                <div className="text-xs text-ink/45 truncate">{me.role === 'member' ? 'Homey International' : me.role}</div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <button onClick={handleSignOut} className="text-xs text-ink/45 hover:text-royal-600 transition-colors">Sign out</button>
            <span className="text-[11px] text-ink/35 tabular-nums"
              title={BUILD_TIME ? `Built ${new Date(BUILD_TIME).toLocaleString('en-GB')}` : ''}>
              v{VERSION}{BUILD_TIME ? ` · ${new Date(BUILD_TIME).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${new Date(BUILD_TIME).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-rule sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="icon-btn -ml-1"><Icon name="menu" size={20} /></button>
          <span className="font-semibold text-ink flex-1">{NAV.find(n => n.id === page)?.label || 'Calculator'}</span>
          <button className="icon-btn -mr-1" onClick={() => { setCommandQuery(''); setCommandOpen(true) }}><Icon name="search" size={18} /></button>
        </div>

        <div className="flex-1 px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-9 xl:px-12 w-full max-w-[1500px]">
          {loading || !settings ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-royal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {page === 'dashboard' && (
                <div>
                <DashboardPage
                  proposals={proposals}
                  suppliers={suppliers}
                  catalogueStats={catalogueStats}
                  syncStatus={syncStatus}
                  hunts={hunts}
                  huntItems={huntItems}
                  savedProducts={activeProducts}
                  liveProducts={liveProducts}
                  stockItems={stockItems}
                  settings={settings}
                  priceHistory={priceHistory}
                  costHistory={costHistory}
                  me={me}
                  onNavigate={navigateTo}
                />
                </div>
              )}
              {page === 'calculator' && (
                <div>
                <CalculatorPage
                  settings={settings}
                  stockItems={stockItems}
                  savedProducts={activeProducts}
                  onCreateStockItem={handleAddStockItem}
                  onSaveProduct={handleSaveProduct}
                  onUpdateProduct={handleUpdateProduct}
                  calc={calc}
                  setCalc={setCalc}
                  loadedProductId={loadedProductId}
                  setLoadedProductId={setLoadedProductId}
                  loadedProductName={loadedProductName}
                  setLoadedProductName={setLoadedProductName}
                />
                </div>
              )}
              {page === 'families' && (
                <div>
                <FamiliesPage
                  onCreateListing={handleCreateListing}
                  savedProducts={activeProducts}
                  liveProducts={liveProducts}
                  stockItems={stockItems}
                  settings={settings}
                  onNavigate={navigateTo}
                />
                </div>
              )}
              {page === 'shipping' && (
                <div>
                <ShippingPage
                  savedProducts={activeProducts}
                  liveProducts={liveProducts}
                  stockItems={stockItems}
                  settings={settings}
                  onNavigate={navigateTo}
                  onProposeCarrier={handleProposeCarrier}
                  pendingCarrier={new Set(proposals.filter(p => p.kind === 'carrier' && p.status === 'pending').map(p => p.target_id))}
                />
                </div>
              )}
              {page === 'approvals' && (
                <div>
                  <ApprovalsPage
                    tab={focusId === 'changes' ? 'changes' : 'listings'}
                    onTab={(t) => navigateTo('approvals', t)}
                    listingCount={reviewCount}
                    changeCount={proposals.filter(p => p.status === 'pending').length}
                    reviewProps={{ savedProducts: activeProducts, stockItems: stockItems, settings: settings, liveProducts: liveProducts, onApprove: handleApproveReview, onSendBack: handleSendBackReview, onLoad: handleLoadProduct , onSaveChanges: handleUpdateProduct}}
                    changesProps={{ proposals: proposals, savedProducts: activeProducts, stockItems: stockItems, settings: settings, onDecide: handleDecideProposals, onScan: handleScanForChanges, onNavigate: navigateTo }}
                  />
                </div>
              )}
              {page === 'hunter' && (
                <div>
                <HunterPage
                  hunts={hunts}
                  huntItems={huntItems}
                  focusId={page === 'hunter' ? focusId : null}
                  liveProducts={liveProducts}
                  onCreateHunts={handleCreateHunts}
                  onUpdateHunt={handleUpdateHunt}
                  onSetDisposition={handleSetDisposition}
                  marketListings={marketListings}
                  loadHuntCatalogue={loadCatalogueForHunt}
                  suppliers={suppliers}
                  asinMatches={asinMatches}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                  onImportHelium={handleImportHelium}
                  onDecideMatch={handleDecideMatch}
                  onSendToReview={handleSendToReview}
                  onNavigate={navigateTo}
                />
                </div>
              )}
              {page === 'stock' && (
                <div>
                <StockItemsPage
                  onNavigate={navigateTo}
                  focusId={focusId}
                  stockItems={stockItems}
                  savedProducts={activeProducts}
                  liveProducts={liveProducts}
                  settings={settings}
                  onAddStockItem={handleAddStockItem}
                  onUpdateStockItem={handleUpdateStockItem}
                  onDeleteStockItem={handleDeleteStockItem}
                  onCreateListing={handleCreateListing}
                  onRestoreStockItem={handleRestoreStockItem}
                  onRunMigration={handleRunMigration}
                />
                </div>
              )}
              {page === 'saved' && (
                <div>
                <SavedPage
                  focusId={focusId}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                  liveProducts={liveProducts}
                  onDelete={handleDeleteProduct}
                  onLoad={handleLoadProduct}
                  onRename={handleRenameProduct}
                  onPushLive={handlePushLive}
                  onLoadActivity={loadActivity}
                  onSendReview={handleSendReview}
                />
                </div>
              )}
              {page === 'live' && (
                <div>
                <LiveProductsPage
                  onNavigate={navigateTo}
                  focusId={focusId}
                  liveProducts={liveProducts}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                  priceHistory={priceHistory}
                  costHistory={costHistory}
                  onStatusChange={handleLiveStatusChange}
                  onRemove={handleRemoveLive}
                  onUpdatePrice={handleUpdateLivePrice}
                />
                </div>
              )}

              {page === 'brands' && (
                <div>
                <PortfolioPage
                  focusId={focusId}
                  onNavigate={navigateTo}
                  groupBy="brand"
                  title="Brands"
                  icon="tag"
                  unlabelled="No brand set"
                  emptyHint="Brands appear here once you have live products with a brand name"
                  liveProducts={liveProducts}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                />
                </div>
              )}
              {page === 'suppliers' && (
                <div>
                <SuppliersPage
                  focusId={focusId}
                  onNavigate={navigateTo}
                  suppliers={suppliers}
                  catalogueStats={catalogueStats}
                  syncStatus={syncStatus}
                  imports={priceImports}
                  stockItems={stockItems}
                  savedProducts={activeProducts}
                  liveProducts={liveProducts}
                  settings={settings}
                  proposals={proposals}
                  onImport={handleImportList}
                  onUpdateSupplier={handleUpdateSupplier}
                  onSyncNow={handleSyncNow}
                />
                </div>
              )}
              {page === 'bulk' && (
                <div>
                <BulkUploadPage
                  stockItems={stockItems}
                  settings={settings}
                  onBulkImport={handleBulkImport}
                />
                </div>
              )}
              {page === 'buildmonth' && (
                <div>
                <BuildMonthPage
                  months={months}
                  settings={settings}
                  stockItems={stockItems}
                  savedProducts={activeProducts}
                  overheads={overheads}
                  onSaveMonth={handleSaveMonth}
                  onUpdateMonth={handleUpdateMonth}
                  onDeleteMonth={handleDeleteMonth}
                  onRenameMonth={handleRenameMonth}
                />
                </div>
              )}
              {page === 'overheads' && (
                <div>
                <OverheadsPage overheads={overheads} onUpdateOverheads={handleUpdateOverheads} />
                </div>
              )}
              {page === 'archive' && (
                <div>
                <ArchivePage
                  savedProducts={savedProducts}
                  liveProducts={liveProducts}
                  stockItems={stockItems}
                  settings={settings}
                  onRunSweep={handleRunSweep}
                  onRestore={handleRestoreArchived}
                />
                </div>
              )}
              {page === 'settings' && (
                <div>
                <SettingsPage
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  me={me}
                  profiles={profiles}
                  onSaveProfile={handleSaveProfile}
                  onLoadActivity={loadActivity}
                />
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {commandOpen && (
        <div className="fixed inset-0 z-[60] bg-ink/30 backdrop-blur-[2px] flex items-start justify-center px-4 pt-[9vh]" onMouseDown={e => e.target === e.currentTarget && setCommandOpen(false)}>
          <div className="w-full max-w-xl bg-white border border-rule rounded-[7px] shadow-modal overflow-hidden">
            <div className="relative border-b border-rule">
              <Icon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35" />
              <input
                autoFocus
                value={commandQuery}
                onChange={e => setCommandQuery(e.target.value)}
                placeholder="Search pages, listings, ASINs, products…"
                className="w-full bg-white pl-11 pr-12 py-4 text-sm text-ink outline-none placeholder:text-ink/30"
                onKeyDown={e => {
                  if (e.key === 'Enter' && visibleCommands[0]) {
                    visibleCommands[0].action(); setCommandOpen(false); setCommandQuery('')
                  }
                }}
              />
              <span className="command-kbd absolute right-4 top-1/2 -translate-y-1/2">ESC</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {visibleCommands.length ? visibleCommands.map(item => (
                <button
                  key={item.key}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[5px] text-left hover:bg-sky/40 transition-colors"
                  onClick={() => { item.action(); setCommandOpen(false); setCommandQuery('') }}
                >
                  <div className="w-8 h-8 rounded-[5px] bg-paper border border-rule flex items-center justify-center text-ink/55 flex-shrink-0">
                    <Icon name={item.icon} size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{item.label}</div>
                    <div className="text-[11px] text-ink/40 truncate">{item.type}{item.hint ? ` · ${item.hint}` : ''}</div>
                  </div>
                  <Icon name="arrowRight" size={14} className="text-ink/25" />
                </button>
              )) : (
                <div className="px-4 py-10 text-center text-sm text-ink/45">No matching pages or records.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-[5px] text-sm font-medium shadow-modal max-w-md flex items-center gap-4
          ${toast.type === 'error' ? 'bg-loss text-white' : 'bg-ink text-white'}`} role="status">
          <span>{toast.msg}</span>
          {toast.action && (
            <button className="flex-shrink-0 font-semibold underline underline-offset-2 hover:no-underline"
              onClick={() => { setToast(null); toast.action.run() }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
    </LinksProvider>
  )
}
