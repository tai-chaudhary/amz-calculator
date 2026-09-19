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
import ArchivePage from './components/ArchivePage'
import ReviewPage from './components/ReviewPage'
import LoginPage from './components/LoginPage'
import { supabase } from './lib/supabase'
import {
  loadSettings, saveSettings,
  loadProducts, saveProduct, updateProduct, deleteProduct,
  loadMonths, saveMonth, updateMonth, deleteMonth,
  loadOverheads, saveOverheads,
  loadLiveProducts, pushProductLive, updateLiveProductStatus, removeLiveProduct,
  loadPriceHistory, logPriceChange,
  loadCostHistory, logCostChange,
  loadStockItems, saveStockItem, updateStockItem, deleteStockItem,
  loadProfiles, upsertProfile,
} from './lib/db'

const NAV = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'calculator', icon: '🧮', label: 'Calculator' },
  { id: 'stock', icon: '📦', label: 'Stock Items' },
  { id: 'saved', icon: '💾', label: 'Saved Listings' },
  { id: 'review', icon: '🔍', label: 'Review Queue' },
  { id: 'live', icon: '🟢', label: 'Live Products' },
  { id: 'brands', icon: '🏷', label: 'Brands' },
  { id: 'suppliers', icon: '🚚', label: 'Suppliers' },
  { id: 'bulk', icon: '📤', label: 'Bulk Upload' },
  { id: 'buildmonth', icon: '📅', label: 'Build a Month' },
  { id: 'overheads', icon: '💼', label: 'Overheads' },
  { id: 'archive', icon: '🗄', label: 'Archive' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  // Page lives in the URL hash so refresh, back/forward and bookmarks all work
  const VALID_PAGES = NAV.map(n => n.id)
  const parseHash = () => {
    const raw = (window.location.hash || '').replace(/^#\/?/, '')
    const [h, qs] = raw.split('?')
    const focus = new URLSearchParams(qs || '').get('focus') || null
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
  const navigateTo = useCallback((nextPage, id) => {
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
  const [settings, setSettings] = useState(null)
  const [savedProducts, setSavedProducts] = useState([])
  const [months, setMonths] = useState([])
  const [overheads, setOverheads] = useState([])
  const [liveProducts, setLiveProducts] = useState([])
  const [priceHistory, setPriceHistory] = useState([])
  const [costHistory, setCostHistory] = useState([])
  const [stockItems, setStockItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [calc, setCalc] = useState(EMPTY_CALC)
  const [loadedProductId, setLoadedProductId] = useState(null)
  const [loadedProductName, setLoadedProductName] = useState('')

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

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      // Token refreshes fire on tab focus with a brand-new object. Only update
      // when the actual user changes, otherwise every refocus reloads the app.
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
        const [s, p, m, o, lp, ph, ch, sti, prof] = await Promise.all([
          loadSettings(), loadProducts(), loadMonths(), loadOverheads(), loadLiveProducts(), loadPriceHistory(), loadCostHistory(), loadStockItems(), loadProfiles()
        ])
        setSettings(s)
        setSavedProducts(p)
        setMonths(m)
        setOverheads(o)
        setLiveProducts(lp)
        setPriceHistory(ph)
        setCostHistory(ch)
        setStockItems(sti)
        setProfiles(prof)
      } catch {
        showToast('Failed to load data.', 'error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [session?.user?.id])

  const handleUpdateSettings = useCallback(async (newSettings) => {
    setSettings(newSettings)
    try { await saveSettings(newSettings); showToast('Settings saved') }
    catch { showToast('Failed to save settings', 'error') }
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
      showToast(`"${product.name}" saved`)
    } catch { showToast('Failed to save product', 'error') }
  }, [stamp])

  const handleUpdateProduct = useCallback(async (id, product) => {
    try {
      const existing = savedProducts.find(p => p.id === id)
      const before = existing?.data

      await updateProduct(id, product)
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

      showToast(`"${product.name}" updated`)
    } catch { showToast('Failed to update product', 'error') }
  }, [savedProducts, settings, me])

  // Committing a new live price — this is the only thing that writes price history
  const handleUpdateLivePrice = useCallback(async (savedProductId, updatedProduct, change) => {
    try {
      await updateProduct(savedProductId, updatedProduct)
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

      showToast(`Live price set to £${parseFloat(updatedProduct.sellPrice).toFixed(2)}`)
    } catch { showToast('Failed to update price', 'error') }
  }, [me])

  const handleRenameProduct = useCallback(async (id, newName) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      await updateProduct(id, { ...row.data, name: newName })
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, name: newName, data: { ...p.data, name: newName } } : p))
      showToast('Product renamed')
    } catch { showToast('Failed to rename', 'error') }
  }, [savedProducts])

  const handleDeleteProduct = useCallback(async (id) => {
    try {
      await deleteProduct(id)
      setSavedProducts((prev) => prev.filter((p) => p.id !== id))
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
    setCalc({ ...EMPTY_CALC, ...row.data })
    setLoadedProductId(row.id)
    setLoadedProductName(row.name)
    setPage('calculator')
  }, [])

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
        await updateProduct(savedProductId, updated)
        setSavedProducts(prev => prev.map(p => p.id === savedProductId ? { ...p, data: updated } : p))
      }
      showToast(`"${productName}" is now live! 🟢`)
    } catch { showToast('Failed to push live', 'error') }
  }, [liveProducts, savedProducts, stamp])

  const handleLiveStatusChange = useCallback(async (id, status) => {
    try {
      await updateLiveProductStatus(id, status)
      setLiveProducts(prev => prev.map(lp => lp.id === id ? { ...lp, status } : lp))
      showToast(status === 'live' ? 'Listing set to live 🟢' : 'Listing paused ⏸')
    } catch { showToast('Failed to update status', 'error') }
  }, [])

  const handleRemoveLive = useCallback(async (id) => {
    try {
      await removeLiveProduct(id)
      setLiveProducts(prev => prev.filter(lp => lp.id !== id))
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
      await updateProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      showToast(`"${name}" sent to review 🔍`)
    } catch { showToast('Failed to send to review', 'error') }
  }, [savedProducts, stamp])

  const handleApproveReview = useCallback(async (id, name) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      const s = stamp()
      const updated = { ...(row.data || {}), reviewStatus: 'approved', reviewNote: '',
        reviewedBy: s.userId, reviewedByName: s.userName, reviewedAt: s.at }
      await updateProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      // Push live if not already
      if (!liveProducts.find(lp => lp.saved_product_id === id)) {
        const live = await pushProductLive(id)
        setLiveProducts(prev => [live, ...prev])
      }
      showToast(`"${name}" approved and live 🟢`)
    } catch { showToast('Failed to approve', 'error') }
  }, [savedProducts, liveProducts, stamp])

  const handleSendBackReview = useCallback(async (id, note) => {
    try {
      const row = savedProducts.find(p => p.id === id)
      if (!row) return
      const s = stamp()
      const updated = { ...(row.data || {}), reviewStatus: 'none', reviewNote: note || '',
        reviewedBy: s.userId, reviewedByName: s.userName, reviewedAt: s.at }
      await updateProduct(id, updated)
      setSavedProducts(prev => prev.map(p => p.id === id ? { ...p, data: updated } : p))
      showToast('Sent back to Saved Products')
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

  // ── Stock items ──────────────────────────────────────────────────────────
  const handleAddStockItem = useCallback(async (item) => {
    try {
      const s = stamp()
      const row = await saveStockItem({ ...item, createdBy: s.userId, createdByName: s.userName, createdAt: s.at })
      setStockItems(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
      showToast(`"${item.name}" added to stock items`)
      return row
    } catch { showToast('Failed to add stock item', 'error'); return null }
  }, [stamp])

  // Editing a stock item cascades to every listing that uses it
  const handleUpdateStockItem = useCallback(async (id, item) => {
    try {
      const existing = stockItems.find(s => s.id === id)
      const oldCost = parseFloat(existing?.data?.costPrice) || 0
      const newCost = parseFloat(item.costPrice) || 0

      await updateStockItem(id, item)
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
            note: `Stock item "${item.name}" cost changed`,
            user_id: me?.id || null,
            user_name: me?.name || null,
          })
          if (entry) setCostHistory(prev => [entry, ...prev])
        }
        showToast(`"${item.name}" updated — ${affected.length} listing${affected.length !== 1 ? 's' : ''} recalculated`)
      } else {
        showToast(`"${item.name}" updated`)
      }
    } catch { showToast('Failed to update stock item', 'error') }
  }, [stockItems, savedProducts, settings, me])

  const handleDeleteStockItem = useCallback(async (id) => {
    try {
      await deleteStockItem(id)
      setStockItems(prev => prev.filter(s => s.id !== id))
      showToast('Stock item deleted')
    } catch { showToast('Failed to delete', 'error') }
  }, [])

  // One-time migration: create stock items and link every listing
  const handleRunMigration = useCallback(async (plan) => {
    try {
      showToast('Creating stock items…')
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
        await updateProduct(row.id, updated)
        updates.push({ id: row.id, data: updated })
      }
      setSavedProducts(prev => prev.map(r => {
        const u = updates.find(x => x.id === r.id)
        return u ? { ...r, data: u.data } : r
      }))

      showToast(`Linked ${updates.length} listings to ${created.length} stock items`)
    } catch { showToast('Migration failed partway — check Stock Items', 'error') }
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
        await updateProduct(row.id, updated)
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

      showToast(`Archived ${done.length} listings${removed ? `, removed ${removed} stock items` : ''}`)
    } catch { showToast('Archive sweep failed partway — check the Archive page', 'error') }
  }, [])

  const handleRestoreArchived = useCallback(async (id, name) => {
    try {
      const row = savedProducts.find(r => r.id === id)
      if (!row) return
      const { archived, archivedAt, ...rest } = row.data || {}
      await updateProduct(id, rest)
      setSavedProducts(prev => prev.map(r => r.id === id ? { ...r, data: rest } : r))
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

  const handleSignOut = async () => { await supabase.auth.signOut() }

  if (session === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-paper">
        <div className="w-8 h-8 border-2 border-royal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!session) return <LoginPage />

  const mainNavItems = NAV.slice(0, 11)
  const configNavItems = NAV.slice(11)
  // Archived listings are hidden from every working view
  const activeProducts = savedProducts.filter(p => !p.data?.archived)
  const archivedCount = savedProducts.length - activeProducts.length

  const liveCount = liveProducts.filter(lp => lp.status === 'live').length
  const reviewCount = activeProducts.filter(p => (p.data?.reviewStatus || 'none') === 'review').length

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-ink/30 backdrop-blur-[2px] z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-screen w-60 bg-white border-r border-rule flex flex-col z-30 transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:sticky lg:top-0 lg:z-auto lg:flex-shrink-0`}>

        <div className="px-5 pt-6 pb-5">
          <img src="/logo.png" alt="Good &amp; General" className="w-full max-w-[150px]" />
          <div className="text-xs text-ink/45 mt-2.5">Margin &amp; listings</div>
        </div>

        <nav className="flex-1 px-3 pb-4 space-y-0.5 overflow-y-auto">
          {mainNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setPage(item.id); setSidebarOpen(false) }}
              className={`nav-item ${page === item.id ? 'nav-item-active' : ''}`}
            >
              <span className="w-4 text-center opacity-90">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'live' && liveCount > 0 && (
                <span className={`ml-auto text-xs font-semibold px-1.5 rounded ${page === item.id ? 'bg-white/20 text-white' : 'bg-gain/10 text-gain'}`}>{liveCount}</span>
              )}
              {item.id === 'review' && reviewCount > 0 && (
                <span className={`ml-auto text-xs font-semibold px-1.5 rounded ${page === item.id ? 'bg-white/20 text-white' : 'bg-warn/10 text-warn'}`}>{reviewCount}</span>
              )}
            </button>
          ))}

          <div className="pt-4">
            <div className="nav-section">Settings</div>
            {configNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { setPage(item.id); setSidebarOpen(false) }}
                className={`nav-item ${page === item.id ? 'nav-item-active' : ''}`}
              >
                <span className="w-4 text-center opacity-90">{item.icon}</span>
                <span>{item.label}</span>
                {item.id === 'archive' && archivedCount > 0 && (
                  <span className={`ml-auto text-xs font-semibold px-1.5 rounded ${page === item.id ? 'bg-white/20 text-white' : 'bg-ink/5 text-ink/50'}`}>{archivedCount}</span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-rule">
          {me && (
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-full bg-royal-500 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {me.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{me.name}</div>
                <div className="text-xs text-ink/45 truncate">{me.role === 'member' ? 'Homey International' : me.role}</div>
              </div>
            </div>
          )}
          <button onClick={handleSignOut} className="text-xs text-ink/45 hover:text-royal-600 transition-colors">Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600 text-xl">☰</button>
          <span className="font-semibold text-slate-800">{NAV.find(n => n.id === page)?.label || 'Calculator'}</span>
        </div>

        <div className="flex-1 px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-9 w-full max-w-[1400px]">
          {loading || !settings ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-royal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div style={{display: page === 'dashboard' ? 'block' : 'none'}}>
                <DashboardPage
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
              <div style={{display: page === 'calculator' ? 'block' : 'none'}}>
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
              <div style={{display: page === 'stock' ? 'block' : 'none'}}>
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
                  onRunMigration={handleRunMigration}
                />
              </div>
              <div style={{display: page === 'saved' ? 'block' : 'none'}}>
                <SavedPage
                  onNavigate={navigateTo}
                  focusId={focusId}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                  liveProducts={liveProducts}
                  onDelete={handleDeleteProduct}
                  onLoad={handleLoadProduct}
                  onRename={handleRenameProduct}
                  onPushLive={handlePushLive}
                  onSendReview={handleSendReview}
                />
              </div>
              <div style={{display: page === 'live' ? 'block' : 'none'}}>
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
              <div style={{display: page === 'review' ? 'block' : 'none'}}>
                <ReviewPage
                  onNavigate={navigateTo}
                  focusId={focusId}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                  liveProducts={liveProducts}
                  onApprove={handleApproveReview}
                  onSendBack={handleSendBackReview}
                  onLoad={handleLoadProduct}
                />
              </div>
              <div style={{display: page === 'brands' ? 'block' : 'none'}}>
                <PortfolioPage
                  onNavigate={navigateTo}
                  groupBy="brand"
                  title="Brands"
                  icon="🏷"
                  unlabelled="No brand set"
                  emptyHint="Brands appear here once you have live products with a brand name"
                  liveProducts={liveProducts}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                />
              </div>
              <div style={{display: page === 'suppliers' ? 'block' : 'none'}}>
                <PortfolioPage
                  onNavigate={navigateTo}
                  groupBy="supplierName"
                  title="Suppliers"
                  icon="🚚"
                  unlabelled="No supplier set"
                  emptyHint="Suppliers appear here once you have live products with a supplier name"
                  liveProducts={liveProducts}
                  savedProducts={activeProducts}
                  stockItems={stockItems}
                  settings={settings}
                />
              </div>
              <div style={{display: page === 'bulk' ? 'block' : 'none'}}>
                <BulkUploadPage
                  stockItems={stockItems}
                  settings={settings}
                  onBulkImport={handleBulkImport}
                />
              </div>
              <div style={{display: page === 'buildmonth' ? 'block' : 'none'}}>
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
              <div style={{display: page === 'overheads' ? 'block' : 'none'}}>
                <OverheadsPage overheads={overheads} onUpdateOverheads={handleUpdateOverheads} />
              </div>
              <div style={{display: page === 'archive' ? 'block' : 'none'}}>
                <ArchivePage
                  onNavigate={navigateTo}
                  focusId={focusId}
                  savedProducts={savedProducts}
                  liveProducts={liveProducts}
                  stockItems={stockItems}
                  settings={settings}
                  onRunSweep={handleRunSweep}
                  onRestore={handleRestoreArchived}
                />
              </div>
              <div style={{display: page === 'settings' ? 'block' : 'none'}}>
                <SettingsPage
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  me={me}
                  profiles={profiles}
                  onSaveProfile={handleSaveProfile}
                />
              </div>
            </>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-modal
          ${toast.type === 'error' ? 'bg-loss text-white' : 'bg-ink text-white'}`} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  )
}
