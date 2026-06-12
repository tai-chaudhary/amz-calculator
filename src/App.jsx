import React, { useState, useEffect, useCallback } from 'react'
import CalculatorPage, { EMPTY_CALC } from './components/CalculatorPage'
import SavedPage from './components/SavedPage'
import BuildMonthPage from './components/BuildMonthPage'
import SettingsPage from './components/SettingsPage'
import OverheadsPage from './components/OverheadsPage'
import RecycleBinPage from './components/RecycleBinPage'
import LoginPage from './components/LoginPage'
import { supabase } from './lib/supabase'
import {
  loadSettings, saveSettings,
  loadProducts, saveProduct, updateProduct, deleteProduct,
  loadMonths, saveMonth, updateMonth, deleteMonth,
  loadOverheads, saveOverheads,
  loadBin, moveToBin, restoreFromBin, permanentlyDelete,
} from './lib/db'

const NAV = [
  { id: 'calculator', icon: '🧮', label: 'Calculator' },
  { id: 'saved', icon: '💾', label: 'Saved Products' },
  { id: 'buildmonth', icon: '📅', label: 'Build a Month' },
  { id: 'overheads', icon: '💼', label: 'Overheads' },
  { id: 'recyclebin', icon: '🗑', label: 'Recycle Bin' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading, null = logged out
  const [page, setPage] = useState('calculator')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settings, setSettings] = useState(null)
  const [savedProducts, setSavedProducts] = useState([])
  const [months, setMonths] = useState([])
  const [overheads, setOverheads] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [binItems, setBinItems] = useState([])
  const [calc, setCalc] = useState(EMPTY_CALC)
  const [loadedProductId, setLoadedProductId] = useState(null)
  const [loadedProductName, setLoadedProductName] = useState('')

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load data once logged in
  useEffect(() => {
    if (!session) { setLoading(false); return }
    async function init() {
      setLoading(true)
      try {
        const [s, p, m, o, b] = await Promise.all([loadSettings(), loadProducts(), loadMonths(), loadOverheads(), loadBin()])
        setSettings(s)
        setSavedProducts(p)
        setMonths(m)
        setOverheads(o)
        setBinItems(b)
      } catch {
        showToast('Failed to load data.', 'error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [session])

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
      const row = await saveProduct(product)
      setSavedProducts((prev) => [row, ...prev])
      showToast(`"${product.name}" saved`)
    } catch { showToast('Failed to save product', 'error') }
  }, [])

  const handleUpdateProduct = useCallback(async (id, product) => {
    try {
      await updateProduct(id, product)
      setSavedProducts((prev) => prev.map((p) => p.id === id ? { ...p, name: product.name, data: product } : p))
      showToast(`"${product.name}" updated`)
    } catch { showToast('Failed to update product', 'error') }
  }, [])

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
    if (!window.confirm('Move this product to the recycle bin?')) return
    try {
      const row = savedProducts.find(p => p.id === id)
      if (row) await moveToBin({ name: row.name, type: 'product', data: row })
      await deleteProduct(id)
      setSavedProducts((prev) => prev.filter((p) => p.id !== id))
      setBinItems((prev) => [{ id: Date.now(), name: row?.name, data: row, deleted_at: new Date().toISOString() }, ...prev])
      showToast('Moved to recycle bin')
    } catch { showToast('Failed to delete product', 'error') }
  }, [savedProducts])

  const handleRestoreFromBin = useCallback(async (row) => {
    try {
      const restored = await restoreFromBin(row.id, row.data || row)
      setSavedProducts((prev) => [restored, ...prev])
      setBinItems((prev) => prev.filter(b => b.id !== row.id))
      showToast(`"${row.name}" restored`)
    } catch { showToast('Failed to restore', 'error') }
  }, [])

  const handlePermanentDelete = useCallback(async (id) => {
    try {
      await permanentlyDelete(id)
      setBinItems((prev) => prev.filter(b => b.id !== id))
      showToast('Permanently deleted')
    } catch { showToast('Failed to delete', 'error') }
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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  // Auth loading
  if (session === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Not logged in
  if (!session) return <LoginPage />

  // Data loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-sm text-slate-500">Loading your data…</div>
        </div>
      </div>
    )
  }

  const mainNavItems = NAV.slice(0, 5)
  const configNavItems = NAV.slice(5)

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed lg:sticky top-0 left-0 h-screen z-30 lg:z-auto
        flex flex-col bg-slate-900 text-white transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        w-56 flex-shrink-0
      `}>
        <div className="px-4 py-5 border-b border-white/10">
          <div className="font-semibold text-base text-white">📦 Adrian Marsh Ltd</div>
          <div className="text-xs text-slate-400 mt-0.5">Profit Calculator</div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          <div className="text-xs text-slate-500 px-3 pt-3 pb-1.5 uppercase tracking-wider">Main</div>
          {mainNavItems.map((n) => (
            <button
              key={n.id}
              className={`nav-item w-full text-left ${page === n.id ? 'nav-item-active' : ''}`}
              onClick={() => { setPage(n.id); setSidebarOpen(false) }}
            >
              <span className="text-base">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
          <div className="text-xs text-slate-500 px-3 pt-4 pb-1.5 uppercase tracking-wider">Config</div>
          {configNavItems.map((n) => (
            <button
              key={n.id}
              className={`nav-item w-full text-left ${page === n.id ? 'nav-item-active' : ''}`}
              onClick={() => { setPage(n.id); setSidebarOpen(false) }}
            >
              <span className="text-base">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10 flex items-center justify-between">
          <div className="text-xs text-slate-500">Homey International</div>
          <button onClick={handleSignOut} className="text-xs text-slate-400 hover:text-white transition">Sign out</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600 text-xl">☰</button>
          <span className="font-semibold text-sm text-slate-700">{NAV.find((n) => n.id === page)?.label}</span>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {settings && (
            <>
              <div style={{display: page === 'calculator' ? 'block' : 'none'}}>
                <CalculatorPage
                  settings={settings}
                  savedProducts={savedProducts}
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
              <div style={{display: page === 'saved' ? 'block' : 'none'}}>
                <SavedPage
                  savedProducts={savedProducts}
                  settings={settings}
                  onDelete={handleDeleteProduct}
                  onLoad={handleLoadProduct}
                  onRename={handleRenameProduct}
                />
              </div>
              <div style={{display: page === 'buildmonth' ? 'block' : 'none'}}>
                <BuildMonthPage
                  months={months}
                  settings={settings}
                  savedProducts={savedProducts}
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
              <div style={{display: page === 'recyclebin' ? 'block' : 'none'}}>
                <RecycleBinPage
                  binItems={binItems}
                  settings={settings}
                  onRestore={handleRestoreFromBin}
                  onPermanentDelete={handlePermanentDelete}
                />
              </div>
              <div style={{display: page === 'settings' ? 'block' : 'none'}}>
                <SettingsPage settings={settings} onUpdateSettings={handleUpdateSettings} />
              </div>
            </>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg
          ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
