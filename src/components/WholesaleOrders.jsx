import React, { useState, useEffect, useMemo } from 'react'
import { Icon, SuggestInput, Flag, StatusBadge, SearchInput, EmptyState, Spinner } from './UI'
import { QtyInput } from './CareParts'
import { useInventoryProducts } from './ManualParcel'
import { supabase } from '../lib/supabase'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { fmtDate, londonToday } from '../lib/dates'

/**
 * Wholesale orders (Oct 2026): bulk orders we drop-ship — e.g. de-icing salt for Stone & Surfaces — collected and
 * labelled on the pallet by GForce, not by us. Each order is typed in (customer, postcode, order reference, the SSD
 * number, product, quantity, pallets); the portal makes a 6×4 label for each pallet with the SSD number huge, and the
 * labels go through Dispatch exactly like any other batch: stamped, printed, packed, dispatched, substitutes, stock.
 */
export const WHOLESALE_CARRIER = 'GForce'
const blank = () => ({ customer: '', postcode: '', ref: '', ssd: '', product: null, typed: '', qty: 1, pallets: 1 })

/** One 4×6 label per pallet: who it's for, what's on it, and the SSD number as big as it will go. */
export async function wholesaleLabelsPdf(orders, account) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const W = 288, H = 432, M = 16, black = rgb(0, 0, 0), white = rgb(1, 1, 1)
  const clean = (t) => String(t || '').replace(/[^\x20-\x7E£]/g, '')
  const fit = (font, t, max, size) => { let s = size; while (s > 8 && font.widthOfTextAtSize(t, s) > max) s -= 1; return s }
  const wrap = (font, t, size, max) => { const out = []; let line = ''; for (const w of clean(t).split(/\s+/)) { const n = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(n, size) <= max || !line) line = n; else { out.push(line); line = w } } if (line) out.push(line); return out }
  const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-')
  for (const o of orders) {
    for (let p = 1; p <= o.pallets; p++) {
      const page = doc.addPage([W, H])
      const top = (y) => H - y                          // measure from the top, like reading it
      // Band: GForce collection, the account
      page.drawRectangle({ x: 0, y: top(44), width: W, height: 44, color: black })
      const head = 'GFORCE COLLECTION', hs = 13
      page.drawText(head, { x: M, y: top(27), size: hs, font: bold, color: white })
      const acc = clean(account).toUpperCase(), room = W - 2 * M - bold.widthOfTextAtSize(head, hs) - 10, as = fit(bold, acc, room, 10)
      page.drawText(acc, { x: W - M - bold.widthOfTextAtSize(acc, as), y: top(26), size: as, font: bold, color: white })
      // The SSD number, huge
      page.drawText('SSD', { x: M, y: top(62), size: 11, font: bold, color: black })
      const ssd = clean(o.ssd).toUpperCase()
      const big = fit(bold, ssd, W - 2 * M, 84)
      page.drawText(ssd, { x: (W - bold.widthOfTextAtSize(ssd, big)) / 2, y: top(70 + big * 0.85), size: big, font: bold, color: black })
      // A line, with the right-hand third underneath left clear for the portal's stamp
      page.drawLine({ start: { x: M, y: top(152) }, end: { x: W - M, y: top(152) }, thickness: 1.5, color: black })
      // Who it's for (left of the stamp)
      let y = 170
      for (const line of wrap(bold, o.customer.toUpperCase(), 15, W * 0.6).slice(0, 3)) { page.drawText(line, { x: M, y: top(y), size: 15, font: bold, color: black }); y += 17 }
      const pc = clean(o.postcode).toUpperCase()
      page.drawText(pc, { x: M, y: top(y + 22), size: fit(bold, pc, W * 0.6, 30), font: bold, color: black })
      // What's on the pallet
      y = 268
      page.drawLine({ start: { x: M, y: top(y - 12) }, end: { x: W - M, y: top(y - 12) }, thickness: 0.8, color: black })
      for (const line of wrap(bold, o.productName, 13, W - 2 * M).slice(0, 3)) { page.drawText(line, { x: M, y: top(y + 4), size: 13, font: bold, color: black }); y += 16 }
      // The order's quantity shared across its pallets (the first ones take any odd units)
      const share = Math.floor(o.qty / o.pallets) + (p <= o.qty % o.pallets ? 1 : 0)
      const qty = o.pallets > 1 ? `QTY ${share}` : `QTY ${o.qty}`
      page.drawText(qty, { x: M, y: top(y + 38), size: 38, font: bold, color: black })
      const pal = o.pallets > 1 ? `PALLET ${p} OF ${o.pallets}` : 'PALLET 1 OF 1'
      page.drawText(pal, { x: W - M - bold.widthOfTextAtSize(pal, 12), y: top(y + 22), size: 12, font: bold, color: black })
      if (o.pallets > 1) { const tot = `ORDER TOTAL ${o.qty}`; page.drawText(tot, { x: W - M - reg.widthOfTextAtSize(tot, 10), y: top(y + 38), size: 10, font: reg, color: black }) }
      // Order reference and date along the bottom
      page.drawLine({ start: { x: M, y: top(H - 40) }, end: { x: W - M, y: top(H - 40) }, thickness: 0.8, color: black })
      page.drawText(clean(`Order ${o.ref}`), { x: M, y: top(H - 22), size: 11, font: reg, color: black })
      page.drawText(date, { x: W - M - reg.widthOfTextAtSize(date, 11), y: top(H - 22), size: 11, font: reg, color: black })
    }
  }
  return doc.save()
}

/** The form: as many orders as are on today's collection sheet. */
export function WholesaleOrdersModal({ inventory = null, me, onLog, onClose, onStarted }) {
  const [account, setAccount] = useState(() => { try { return localStorage.getItem('gg-wholesale-account') || 'Stone & Surfaces' } catch { return 'Stone & Surfaces' } })
  const [rows, setRows] = useState([blank()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const picker = useInventoryProducts()
  const products = useMemo(() => (inventory?.products?.length ? inventory.products : picker).filter(p => p.kind !== 'packaging' && p.code)
    .map(p => ({ id: p.id, code: p.code, label: p.name, sub: p.code })), [inventory, picker])
  const set = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const problem = (r) => !r.customer.trim() ? 'customer' : !r.postcode.trim() ? 'postcode' : !r.ref.trim() ? 'order reference' : !r.ssd.trim() ? 'SSD number' : !r.product ? 'product' : null
  const filled = rows.filter(r => r.customer || r.ref || r.ssd || r.product)
  const firstProblem = filled.map(problem).find(Boolean)
  const dupSsd = (() => { const seen = new Set(); for (const r of filled) { const k = r.ssd.trim().toUpperCase(); if (k && seen.has(k)) return k; seen.add(k) } return null })()
  const ok = filled.length > 0 && !firstProblem && !dupSsd && account.trim()
  const pallets = filled.reduce((t, r) => t + r.pallets, 0)

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      try { localStorage.setItem('gg-wholesale-account', account.trim()) } catch { /* private mode */ }
      const orders = filled.map(r => ({ ...r, productName: r.product.label }))
      const bytes = await wholesaleLabelsPdf(orders, account.trim())
      const file = new File([bytes], `wholesale-${account.trim().replace(/\W+/g, '-')}-${londonToday()}.pdf`, { type: 'application/pdf' })
      // The orders as Dispatch would have read them off labels and packing slips: one label per pallet
      let page = 0
      const preset = orders.map(o => {
        const labels = Array.from({ length: o.pallets }, () => ({ pageIndex: page++, carrier: WHOLESALE_CARRIER, service: 'Pallet collection', ref: o.ssd.trim().toUpperCase(),
          refs: [o.ssd.trim().toUpperCase()], tracking: o.ssd.trim().toUpperCase(), postcode: o.postcode.trim().toUpperCase(), customer: o.customer.trim(), stamp: {} }))
        return { labels, slip: { pageIndex: null, channelRef: o.ref.trim(), helmOrder: '', slipId: o.ssd.trim().toUpperCase(), customer: o.customer.trim(), postcode: o.postcode.trim().toUpperCase(),
          items: [{ code: o.product.code, name: o.product.label, qty: o.qty }], wholesale: account.trim() } }
      })
      const { startJob } = await import('../lib/dispatchJobs')
      startJob(file, { title: `Wholesale · ${account.trim()} · ${WHOLESALE_CARRIER}`, me, onLog, preset: { orders: preset, pageCount: page } })
      onStarted?.(orders.length)
    } catch (e) { setErr(e?.message || 'Couldn’t make the labels'); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-3" role="dialog" aria-label="Wholesale orders">
      <div className="bg-white rounded-[10px] shadow-modal w-full max-w-5xl max-h-[94vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-rule flex items-start justify-between gap-3">
          <div><div className="modal-title font-semibold text-base text-ink">Wholesale orders</div>
            <div className="text-xs text-ink/55 mt-0.5">Collected and labelled by {WHOLESALE_CARRIER}. A 6×4 label is made for each pallet — the SSD number big — and they go into Dispatch as a batch.</div></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="max-w-xs"><label className="label" htmlFor="ws-acc">For (the wholesale customer)</label>
            <input id="ws-acc" className="input" value={account} onChange={e => setAccount(e.target.value)} /></div>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="card p-3 grid grid-cols-2 lg:grid-cols-12 gap-2 items-end">
                <div className="col-span-2 lg:col-span-3"><label className="label">Deliver to</label><input className="input text-base sm:text-sm" value={r.customer} onChange={e => set(i, { customer: e.target.value })} placeholder="Customer name" /></div>
                <div className="lg:col-span-1"><label className="label">Postcode</label><input className="input text-base sm:text-sm uppercase" value={r.postcode} onChange={e => set(i, { postcode: e.target.value })} /></div>
                <div className="lg:col-span-2"><label className="label">Order reference</label><input className="input text-base sm:text-sm" value={r.ref} onChange={e => set(i, { ref: e.target.value })} /></div>
                <div className="col-span-2 lg:col-span-2"><label className="label">SSD number</label><input className="input text-base sm:text-sm font-mono font-semibold uppercase" value={r.ssd} onChange={e => set(i, { ssd: e.target.value })} /></div>
                <div className="col-span-2 lg:col-span-2"><label className="label">Product</label>
                  <SuggestInput value={r.product ? r.product.label : r.typed} onChange={v => set(i, { typed: v, product: null })} options={products} placeholder="Find the product"
                    onPick={o => o && set(i, { product: o, typed: o.label })} /></div>
                <div><label className="label">Qty</label><QtyInput className="input w-full text-base sm:text-sm" value={r.qty} onChange={n => set(i, { qty: n })} /></div>
                <div className="flex items-end gap-1"><div className="flex-1"><label className="label">Pallets</label><QtyInput className="input w-full text-base sm:text-sm" value={r.pallets} onChange={n => set(i, { pallets: Math.min(20, n) })} /></div>
                  {rows.length > 1 && <button className="btn btn-ghost btn-xs mb-1" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} aria-label="Remove this order"><Icon name="close" size={13} /></button>}</div>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={() => setRows(rs => [...rs, { ...blank(), product: rs[rs.length - 1]?.product || null, typed: rs[rs.length - 1]?.product?.label || '' }])}><Icon name="plus" size={14} /> Add another order</button>
          </div>
          {err && <div className="text-sm text-loss">{err}</div>}
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-rule pt-3">
            <div className="text-sm text-ink/70">{filled.length} order{filled.length === 1 ? '' : 's'} · {pallets} label{pallets === 1 ? '' : 's'}
              {firstProblem && <span className="text-loss"> · add the {firstProblem}</span>}{dupSsd && <span className="text-loss"> · SSD {dupSsd} is in twice</span>}</div>
            <button className="btn btn-primary" disabled={!ok || busy} onClick={submit}><Icon name="upload" size={14} /> {busy ? 'Making the labels…' : 'Make labels and add to Dispatch'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Everything sent through GForce: what, who for, the SSD number, and where it's got to. */
export function WholesaleLog() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [days, setDays] = useState(60)
  useEffect(() => {
    setRows(null)
    const since = new Date(Date.now() - days * 864e5).toISOString()
    supabase.from('dispatch_labels').select('id, status, customer, postcode, channel_ref, tracking, items, created_at, printed_at, dispatched_at, dispatched_by_name, seq, batch:dispatch_batches(code, ship_date, carrier)')
      .eq('carrier', WHOLESALE_CARRIER).gte('created_at', since).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => setRows(data || []))
  }, [days])
  const list = smartFilter(rows || [], q, r => hay(r.tracking, r.channel_ref, r.customer, r.postcode, (r.items || []).map(i => i.name)), { keepOrder: true })
  const units = list.reduce((t, r) => t + (r.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0), 0)
  const exportCsv = () => exportRowsToCsv(stampedName('wholesale-gforce'), list, [
    { header: 'Date', value: r => r.batch?.ship_date }, { header: 'SSD', value: r => r.tracking }, { header: 'Order', value: r => r.channel_ref },
    { header: 'Customer', value: r => r.customer }, { header: 'Postcode', value: r => r.postcode }, { header: 'Product', value: r => (r.items || []).map(i => i.name).join('; ') },
    { header: 'Qty', value: r => (r.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0) }, { header: 'Status', value: r => r.status },
    { header: 'Dispatched', value: r => (r.dispatched_at || '').slice(0, 16).replace('T', ' ') }, { header: 'Batch', value: r => `${r.batch?.code || ''} #${r.seq}` },
  ])
  return (
    <div className="space-y-3">
      <div className="filter-bar">
        <select className="input text-sm w-auto" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">
          <option value={14}>Last 14 days</option><option value={60}>Last 60 days</option><option value={365}>Last year</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} /> Export</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="SSD, order, customer, postcode, product" className="w-full sm:w-72 sm:ml-auto" />
      </div>
      {!rows ? <Spinner /> : !list.length ? <div className="surface"><EmptyState icon="truck" title={`Nothing sent through ${WHOLESALE_CARRIER} yet`} sub="Add wholesale orders from the ⋯ menu." /></div> : (
        <>
          <div className="text-xs text-ink/55">{list.length} pallet label{list.length === 1 ? '' : 's'} · {units} units · {list.filter(r => r.status === 'dispatched').length} collected</div>
          <div className="card p-0 overflow-hidden">
            {list.map(r => (
              <div key={r.id} className="px-4 py-3 border-b border-rule last:border-0 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink"><b className="font-mono">SSD {r.tracking}</b> · {r.customer} · {r.postcode}</div>
                  <div className="text-xs text-ink/60 truncate">{(r.items || []).map(i => `${i.qty} × ${i.name}`).join(', ')}</div>
                  <div className="text-[11px] text-ink/45">Order {r.channel_ref} · {r.batch?.code} #{r.seq} · {fmtDate(r.batch?.ship_date)}{r.dispatched_at ? ` · collected ${fmtDate(r.dispatched_at)}${r.dispatched_by_name ? ` (${r.dispatched_by_name})` : ''}` : ''}</div>
                </div>
                <StatusBadge tone={r.status === 'dispatched' ? 'live' : r.status === 'held' ? 'alert' : 'warn'}>{r.status === 'dispatched' ? 'Collected' : r.status}</StatusBadge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
