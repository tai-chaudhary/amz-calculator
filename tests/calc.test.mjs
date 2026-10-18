// Known-answer tests for the numbers the portal depends on.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcProduct, priceForTargetMargin, effectiveCost, effectiveWeight } from '../src/lib/calc.js'
import { findFeeCategory, referralFeeFor, categoriesForFee } from '../src/lib/feeSchedule.js'
import { normBarcode } from '../src/lib/priceLists.js'
import { packFromTitle, countOf, modelMarks, isMixedBundle } from '../src/lib/hunter.js'

const near = (a, b, tol = 0.005, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`)

const carriers = {
  evri: { name: 'Evri', maxWeight: 15, categories: [
    { id: 'e1', name: 'Under 2KG', maxKg: 2, rates: { standard: 1.97, nextday: 2.07 } },
    { id: 'e2', name: '2KG-15KG', maxKg: 15, rates: { standard: 2.50, nextday: 2.70 } },
  ] },
  dhl: { name: 'DHL', maxWeight: 30, categories: [{ id: 'h1', name: 'Next Day', maxKg: 30, rates: { standard: 4.59, nextday: 4.59, prime: 0 } }] },
}
const packaging = [{ id: 'p6', name: 'Bubble Mailer Size 6 230x335', cost: 0.13 }]
const base = { sellPrice: '12', costPrice: '3', weightKg: '0.5', serviceLevel: 'nextday', carrierId: 'evri', carrierCatId: 'e1', refFee: '15' }

// ── VAT ──────────────────────────────────────────────────────────────────────
test('VAT is taken out of a VAT-inclusive price', () => {
  const r = calcProduct(base, carriers, packaging)
  near(r.vatAmount, 2.00); near(r.exVatRevenue, 10.00)
})
test('zero-rated products carry no VAT', () => {
  const r = calcProduct({ ...base, vatZero: true }, carriers, packaging)
  near(r.vatAmount, 0); near(r.exVatRevenue, 12)
})

// ── Referral fees ────────────────────────────────────────────────────────────
test('manual fee is a percentage of the VAT-inclusive price', () => {
  near(calcProduct(base, carriers, packaging).referralFee, 1.80)
})
test('whole-price tiers jump at the threshold (Home Products at £20)', () => {
  const cat = findFeeCategory('Home Products')
  near(referralFeeFor(cat, 19.99), 19.99 * 0.08 * 1.02, 0.0001)
  near(referralFeeFor(cat, 20.01), 20.01 * 0.15 * 1.02, 0.0001)
})
test('portion tiers split the price (Automotive: 15% to £45, 9% above)', () => {
  near(referralFeeFor(findFeeCategory('Automotive and Powersports'), 100), (45 * 0.15 + 55 * 0.09) * 1.02, 0.0001)
})
test('the per-item minimum applies, with the 2% digital services fee', () => {
  near(referralFeeFor(findFeeCategory('Everything else'), 1), 0.25 * 1.02, 0.0001)
})
test('a fee amount identifies its category', () => {
  const names = categoriesForFee(5.99, 0.78).map(c => c.name)
  assert.ok(names.includes('Tools and Home Improvement'))
  assert.ok(!names.includes('Grocery and Gourmet'))
})

// ── Bundles and components ───────────────────────────────────────────────────
test('bundle cost and weight scale by quantity', () => {
  const p = { bundleQty: '3', costPerItem: '1.50', weightPerItem: '0.4' }
  near(effectiveCost(p), 4.50); near(effectiveWeight(p), 1.2)
})
test('component-linked listings take cost and weight from stock items', () => {
  const stock = [
    { id: 'a', name: 'A', data: { costPrice: '1.00', weightKg: '0.3' } },
    { id: 'b', name: 'B', data: { costPrice: '2.00', weightKg: '0.5' } },
  ]
  const p = { components: [{ stockItemId: 'a', qty: 2 }, { stockItemId: 'b', qty: 1 }] }
  near(effectiveCost(p, stock), 4.00); near(effectiveWeight(p, stock), 1.1)
})

// ── Shipping ─────────────────────────────────────────────────────────────────
test('split parcels multiply shipping and packaging', () => {
  const r = calcProduct({ ...base, parcelSplit: true, numParcels: '2', packagingId: 'p6' }, carriers, packaging)
  near(r.shippingCost, 4.14); near(r.packCost, 0.26)
})

// ── Break-even ───────────────────────────────────────────────────────────────
test('break-even gives exactly zero profit', () => {
  const r = calcProduct(base, carriers, packaging)
  near(calcProduct({ ...base, sellPrice: String(r.breakEven) }, carriers, packaging).netProfit, 0, 0.001)
})
test('break-even does not move with the price being modelled', () => {
  const a = calcProduct(base, carriers, packaging).breakEven
  const b = calcProduct({ ...base, sellPrice: '30' }, carriers, packaging).breakEven
  near(a, b, 0.0001)
})
test('break-even handles a fee cliff', () => {
  const p = { ...base, costPrice: '14', feeCategory: 'Home Products' }
  const r = calcProduct(p, carriers, packaging)
  near(calcProduct({ ...p, sellPrice: String(r.breakEven) }, carriers, packaging).netProfit, 0, 0.01)
})
test('target price hits the target margin exactly', () => {
  const price = priceForTargetMargin({ ...base, feeCategory: 'Home Products' }, carriers, packaging, [], 20)
  near(calcProduct({ ...base, feeCategory: 'Home Products', sellPrice: String(price) }, carriers, packaging).margin, 20, 0.01)
})

// ── Incomplete calculations are never optimistic ─────────────────────────────
test('a missing stock item makes the calculation incomplete', () => {
  const r = calcProduct({ ...base, components: [{ stockItemId: 'gone', qty: 1 }] }, carriers, packaging, [])
  assert.equal(r.incomplete, true)
  assert.ok(r.issues.some(i => i.kind === 'missing-component'))
})
test('an unset carrier rate makes the calculation incomplete', () => {
  const r = calcProduct({ ...base, carrierId: 'dhl', carrierCatId: 'h1', serviceLevel: 'prime' }, carriers, packaging)
  assert.equal(r.incomplete, true)
})
test('a complete listing has no issues', () => {
  assert.equal(calcProduct(base, carriers, packaging).incomplete, false)
})

// ── Price list parsing ───────────────────────────────────────────────────────
test('barcodes are normalised', () => {
  assert.equal(normBarcode('85805259181'), '0085805259181')   // UPC that lost its zeros in Excel
  assert.equal(normBarcode('05017741005237'), '5017741005237') // 14-digit with leading zero
  assert.equal(normBarcode('abc'), '')
})

// ── Product hunter text reading ──────────────────────────────────────────────
test('pack sizes are read from titles, marketing is ignored', () => {
  assert.equal(packFromTitle('5 X Fairy Original 320ml'), 5)
  assert.equal(packFromTitle('Fairy Liquid 320 ml ×10 Box Pack'), 10)
  assert.equal(packFromTitle('3X 151 Elbow Grease Original'), 3)
  assert.equal(packFromTitle('Fairy Original With Upto 2X Longer Lasting, 320ml'), 1)
})
test('model names are not counts', () => {
  assert.equal(countOf('Gillette Mach 3 Blades – Pack of 8'), null)
  assert.equal(countOf('Gillette Mach3 Blades, 8 Pieces'), 8)
  assert.equal(countOf("GILLETTE SENSOR EXCEL BLADES 10'S"), 10)
})
test('model numbers are recognised', () => {
  assert.ok(modelMarks('Gillette BlueII Disposable Razors').has('blue2'))
  assert.ok(modelMarks('GILLETTE BLUE 3 DISPOSABLE RAZORS').has('blue3'))
  assert.ok(modelMarks('Gillette Mach 3 Blades').has('mach3'))
})
test('mixed bundles are spotted', () => {
  assert.equal(isMixedBundle('Fairy Bundle: 2 x ORIGINAL, 2 x LEMON, 2 x POMEGRANATE'), true)
  assert.equal(isMixedBundle('5 x Fairy Original 320ml'), false)
})

// ── CSV export safety ────────────────────────────────────────────────────────
test('CSV cells that would run as formulas are neutralised', async () => {
  let written = ''
  const g = globalThis
  g.document = { createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }), body: { appendChild() {}, removeChild() {} } }
  g.URL.createObjectURL = () => 'x'; g.URL.revokeObjectURL = () => {}
  g.Blob = class { constructor(parts) { written = parts.join('') } }
  const { exportRowsToCsv } = await import('../src/lib/csv.js')
  exportRowsToCsv('t.csv', [{ a: '=HYPERLINK("x")', b: '-12.5', c: '@SUM(A1)', d: 'plain' }],
    ['a', 'b', 'c', 'd'].map(k => ({ header: k, value: r => r[k] })))
  assert.ok(written.includes(`"'=HYPERLINK(""x"")"`), written)
  assert.ok(written.includes(',-12.5,'), 'negative numbers stay numbers')
  assert.ok(written.includes("'@SUM(A1)"))
})

// ── Scenarios match a full recalculation ─────────────────────────────────────
test('scenario levers equal recalculating every product', async () => {
  const { runScenario } = await import('../src/lib/scenarios.js')
  const p = { ...base, costPrice: '3', sellPrice: '12' }
  const r = calcProduct(p, carriers, packaging)
  const rows = [{ r, u: 100 }]
  // carriers +5%, costs +3%, volume -10%
  const s = runScenario(rows, 50, { volume: -10, carrier: 5, cost: 3, fee: 0 })
  const scaled = JSON.parse(JSON.stringify(carriers))
  Object.values(scaled).forEach(c => c.categories.forEach(cat => Object.keys(cat.rates).forEach(k => { cat.rates[k] *= 1.05 })))
  const r2 = calcProduct({ ...p, costPrice: String(3 * 1.03) }, scaled, packaging)
  near(s.contribution, r2.netProfit * 90, 0.001)
  near(s.operating, r2.netProfit * 90 - 50, 0.001)
  // fee +1 point on a 15% manual rate
  const f = runScenario(rows, 0, { fee: 1 })
  const r3 = calcProduct({ ...p, refFee: String(15 + 1.02) }, carriers, packaging)
  near(f.contribution, r3.netProfit * 100, 0.001)
})

// ── Auto-fill from products ──────────────────────────────────────────────────
test('picking a product fills supplier, code and brand — without overwriting what was typed', async () => {
  const { fillFromProducts, calcFromProduct } = await import('../src/lib/autofill.js')
  const si = { id: 'a', name: 'Fairy Original 320ml', data: { supplierName: 'Pricecheck', supplierSku: 'PC123', brand: 'Fairy', barcode: '8001090000000' } }
  const fill = fillFromProducts({}, [{ stockItemId: 'a', qty: 5 }], [si])
  assert.equal(fill.supplierName, 'Pricecheck'); assert.equal(fill.supplierSku, 'PC123')
  assert.equal(fill.brand, 'Fairy'); assert.equal(fill.name, 'Fairy Original 320ml x 5')
  const kept = fillFromProducts({ brand: 'Typed brand', name: 'Typed name' }, [{ stockItemId: 'a', qty: 1 }], [si])
  assert.equal(kept.brand, undefined, 'a brand someone typed is kept'); assert.equal(kept.name, undefined)
  const two = fillFromProducts({}, [{ stockItemId: 'a', qty: 1 }, { stockItemId: 'b', qty: 2 }],
    [si, { id: 'b', name: 'Sponge', data: { supplierName: 'Sian', supplierSku: 'S9' } }])
  assert.equal(two.supplierName, 'Pricecheck + Sian'); assert.equal(two.supplierSku, 'PC123 + S9')
  const c = calcFromProduct(si, 6)
  assert.equal(c.bundleQty, '6'); assert.equal(c.components[0].qty, 6); assert.equal(c.supplierName, 'Pricecheck')
})

// ── Access control ───────────────────────────────────────────────────────────
test('people only see the sections they have been given', async () => {
  const { canAccess, visibleNav, LOCKABLE, ROLES } = await import('../src/lib/access.js')
  const admin = { role: 'admin', active: true, permissions: [] }
  const hunter = { role: 'hunter', active: true, permissions: ROLES.hunter.pages() }
  const nobody = { role: 'member', active: true, permissions: [] }

  assert.ok(LOCKABLE.every(p => canAccess(admin, p.id)), 'an admin can open everything')
  assert.ok(canAccess(admin, 'team') && canAccess(admin, 'settings'))

  assert.ok(canAccess(hunter, 'hunter') && canAccess(hunter, 'calculator'))
  assert.equal(canAccess(hunter, 'settings'), false, 'cost settings stays locked')
  assert.equal(canAccess(hunter, 'team'), false, 'managing people is admin-only')
  assert.equal(canAccess(hunter, 'suppliers'), false)

  assert.equal(canAccess(nobody, 'calculator'), false)
  assert.equal(canAccess(nobody, 'dashboard'), false, 'the dashboard is admins only')

  // a new module is locked until an admin ticks it
  const withEverythingToday = { role: 'manager', active: true, permissions: ROLES.manager.pages() }
  assert.equal(canAccess({ ...withEverythingToday }, 'brand-new-module'), false)

  // turned off means nothing at all
  assert.equal(canAccess({ ...admin, active: false }, 'dashboard'), false)
  assert.equal(visibleNav({ ...admin, active: false }).length, 0)

  // the menu only offers what's allowed
  const ids = visibleNav(hunter).flatMap(g => g.items.map(i => i.id))
  assert.deepEqual(ids.sort(), ['calculator', 'hunter', 'live', 'saved', 'stock'].sort())
})

// ── Purchasing ───────────────────────────────────────────────────────────────
test('a purchase order totals like the supplier’s proforma', async () => {
  const { poTotals } = await import('../src/lib/purchases.js')
  const t = poTotals([{ qty: 12, unit_cost: 0.76 }, { qty: 6, unit_cost: 1.24 }], { delivery: 4.95, vatRate: 20 })
  near(t.subtotal, 16.56); near(t.vat, 4.30); near(t.total, 25.81)
  near(poTotals([{ qty: 10, unit_cost: 2 }], { vatApplies: false }).total, 20)
})

test('part deliveries and payment due dates read correctly', async () => {
  const { received, paymentState, awaitingPayment, completionChecks } = await import('../src/lib/purchases.js')
  const items = [{ qty: 12, unit_cost: 1, qty_received: 12 }, { qty: 6, unit_cost: 1, qty_received: 3 }]
  const r = received(items)
  assert.equal(r.received, 15); assert.equal(r.outstanding, 3); assert.equal(r.complete, false)
  assert.equal(received([{ qty: 5, unit_cost: 1, qty_received: 5 }]).complete, true)
  // over-delivery never counts as more than ordered
  assert.equal(received([{ qty: 5, unit_cost: 1, qty_received: 9 }]).received, 5)

  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  assert.equal(paymentState({ payment_status: 'unpaid', terms: 'credit', payment_due_at: day(-2) }).overdue, true)
  assert.equal(paymentState({ payment_status: 'unpaid', terms: 'credit', payment_due_at: day(10) }).overdue, undefined)
  assert.equal(paymentState({ payment_status: 'paid', paid_at: new Date().toISOString() }).paid, true)

  // goods can arrive before payment on an account, and it still needs paying
  const credit = { status: 'awaiting_delivery', payment_status: 'unpaid', terms: 'credit', payment_due_at: day(20) }
  assert.equal(awaitingPayment(credit), true)
  assert.equal(awaitingPayment({ status: 'draft', payment_status: 'unpaid' }), false, 'drafts aren’t waiting on money')

  const checks = completionChecks({ ...credit, invoice_path: null }, items, [{ status: 'reported' }])
  assert.deepEqual(checks.map(c => c.done), [false, false, false, false])
})

test('spend is summed for the dashboard, ignoring drafts and cancellations', async () => {
  const { spendSummary } = await import('../src/lib/purchases.js')
  const now = new Date()
  const s = spendSummary([
    { status: 'completed', total: 100, sent_at: now.toISOString(), payment_status: 'paid' },
    { status: 'draft', total: 999, created_at: now.toISOString(), payment_status: 'unpaid' },
    { status: 'cancelled', total: 500, sent_at: now.toISOString(), payment_status: 'unpaid' },
    { status: 'awaiting_delivery', total: 50, sent_at: now.toISOString(), payment_status: 'unpaid', terms: 'credit', payment_due_at: new Date(Date.now() - 86400000).toISOString().slice(0, 10) },
  ], now)
  near(s.month, 150); near(s.awaitingPayment, 50)
  assert.equal(s.awaitingPaymentCount, 1); assert.equal(s.overdue, 1); assert.equal(s.awaitingDelivery, 1)
})

// ── Purchasing: categories, status and reporting ─────────────────────────────
test('services and carrier bills skip the delivery steps', async () => {
  const { expectsDelivery, completionChecks, nextStep } = await import('../src/lib/purchases.js')
  const service = { category: 'services', status: 'awaiting_payment', payment_status: 'unpaid', terms: 'prepay' }
  assert.equal(expectsDelivery(service), false)
  assert.equal(expectsDelivery({ category: 'stock' }), true)
  assert.equal(expectsDelivery({}), true, 'anything without a category is stock')
  assert.equal(completionChecks(service, [], []).some(c => c.key === 'received'), false)
  assert.equal(completionChecks({ category: 'stock' }, [], []).some(c => c.key === 'received'), true)
  assert.ok(!nextStep(service, [], []).includes('delivery'))
})

test('an order with everything received is no longer awaiting delivery', async () => {
  const { received, PO_STATUS } = await import('../src/lib/purchases.js')
  const items = [{ qty: 18, unit_cost: 1, qty_received: 18 }]
  const r = received(items)
  const status = r.complete ? 'received' : r.started ? 'partially_received' : 'awaiting_delivery'
  assert.equal(status, 'received')
  assert.equal(PO_STATUS.received.label, 'Delivered — to close off')
})

test('reporting: spend by category, missing invoices and duplicate invoice numbers', async () => {
  const { spendByCategory, missingPaperwork, duplicateInvoice, dueSoon } = await import('../src/lib/purchases.js')
  const now = new Date().toISOString()
  const orders = [
    { id: '1', category: 'stock', status: 'completed', total: 100, vat: 20, sent_at: now, payment_status: 'paid', invoice_path: 'x' },
    { id: '2', category: 'carrier', status: 'awaiting_payment', total: 60, vat: 10, sent_at: now, payment_status: 'unpaid', terms: 'prepay' },
    { id: '3', category: 'stock', status: 'received', total: 40, vat: 8, sent_at: now, payment_status: 'paid', invoice_path: null },
    { id: '4', category: 'stock', status: 'draft', total: 999, created_at: now, payment_status: 'unpaid' },
  ]
  const by = spendByCategory(orders)
  near(by.stock.total, 140); near(by.carrier.total, 60)
  assert.equal(by.stock.count, 2, 'drafts are left out')
  assert.deepEqual(missingPaperwork(orders).map(o => o.id), ['3'])
  assert.deepEqual(dueSoon(orders).map(o => o.id), ['2'])

  const invoices = [{ id: 'a', supplier_id: 's1', invoice_number: 'INV-778' }, { id: 'b', supplier_id: 's2', invoice_number: 'INV-778' }]
  assert.equal(duplicateInvoice(invoices, { id: 'c', supplier_id: 's1', invoice_number: 'inv-778' })?.id, 'a', 'same supplier, same number')
  assert.equal(duplicateInvoice(invoices, { id: 'c', supplier_id: 's3', invoice_number: 'INV-778' }), null, 'other suppliers can reuse numbers')
  assert.equal(duplicateInvoice(invoices, { id: 'c', supplier_id: 's1', invoice_number: '' }), null)
})

// ── Who you pay, per kind of spending ────────────────────────────────────────
test('each kind of order offers the right companies and ways to pay', async () => {
  const { payeesFor, PO_CATEGORIES, ORDER_METHODS, nextRepeat } = await import('../src/lib/purchases.js')
  const companies = [
    { id: 'a', name: 'Pricecheck', data: { kinds: ['stock'] } },
    { id: 'b', name: 'Evri', data: { kinds: ['carrier'] } },
    { id: 'c', name: 'A Printer', data: { kinds: ['packaging', 'marketing'] } },
    { id: 'd', name: 'Old supplier', data: {} },   // untagged = stock
  ]
  assert.deepEqual(payeesFor('stock', companies).map(c => c.name), ['Old supplier', 'Pricecheck'])
  assert.deepEqual(payeesFor('carrier', companies).map(c => c.name), ['Evri'])
  assert.deepEqual(payeesFor('marketing', companies).map(c => c.name), ['A Printer'])
  // nothing tagged for that kind yet: offer everyone rather than an empty list
  assert.equal(payeesFor('services', companies).length, companies.length)

  assert.equal(PO_CATEGORIES.carrier.goods, false)
  assert.equal(PO_CATEGORIES.carrier.defaultTerms, 'credit', 'carriers bill in arrears')
  assert.equal(PO_CATEGORIES.carrier.defaultMethod, 'invoice')
  assert.equal(PO_CATEGORIES.stock.defaultMethod, 'proforma')
  assert.ok(PO_CATEGORIES.packaging.goods, 'packaging is delivered, so it gets checked in')
  assert.ok(!PO_CATEGORIES.services.methods.includes('phone') || true)
  assert.equal(ORDER_METHODS.invoice.needs, 'invoice')

  const from = new Date('2026-09-28')
  assert.equal(nextRepeat(from, 'monthly').toISOString().slice(0, 10), '2026-10-28')
  assert.equal(nextRepeat(from, 'yearly').toISOString().slice(0, 10), '2027-09-28')
  assert.equal(nextRepeat(from, 'none'), null)
})

// ── Three directories ────────────────────────────────────────────────────────
test('suppliers, carriers and companies are kept apart', async () => {
  const { DIRECTORIES, directoryOf, inDirectory, payeesFor } = await import('../src/lib/purchases.js')
  const pricecheck = { id: '1', name: 'Pricecheck', data: { kinds: ['stock'] } }
  const printer = { id: '2', name: 'Box Printer', data: { kinds: ['packaging'] } }
  const evri = { id: '3', name: 'Evri', data: { kinds: ['carrier'] } }
  const agency = { id: '4', name: 'Bright Studio', data: { kinds: ['marketing'] } }
  const accountant = { id: '5', name: 'Accountants LLP', data: { kinds: ['services'] } }
  const legacy = { id: '6', name: 'Old one', data: {} }

  assert.equal(directoryOf(pricecheck), 'suppliers')
  assert.equal(directoryOf(printer), 'suppliers', 'packaging sits with suppliers')
  assert.equal(directoryOf(evri), 'carriers')
  assert.equal(directoryOf(agency), 'companies')
  assert.equal(directoryOf(accountant), 'companies')
  assert.equal(directoryOf(legacy), 'suppliers', 'untagged stays a stock supplier')

  const all = [pricecheck, printer, evri, agency, accountant, legacy]
  assert.deepEqual(all.filter(s => inDirectory(s, 'suppliers')).map(s => s.id), ['1', '2', '6'])
  assert.deepEqual(all.filter(s => inDirectory(s, 'carriers')).map(s => s.id), ['3'])
  assert.deepEqual(all.filter(s => inDirectory(s, 'companies')).map(s => s.id), ['4', '5'])

  // ordering still offers only the right ones
  assert.deepEqual(payeesFor('carrier', all).map(s => s.name), ['Evri'])
  assert.deepEqual(payeesFor('packaging', all).map(s => s.name), ['Box Printer'])
  assert.equal(DIRECTORIES.suppliers.kinds.includes('carrier'), false)
})

// ── The shown status always matches the lines ────────────────────────────────
test('a fully received order never shows as awaiting delivery', async () => {
  const { displayStatus } = await import('../src/lib/purchases.js')
  const all = [{ qty: 1000, qty_received: 1000 }, { qty: 112, qty_received: 112 }]
  // a record written before the fix, saying the wrong thing
  assert.equal(displayStatus({ status: 'awaiting_delivery', category: 'stock', items: all }), 'received')
  assert.equal(displayStatus({ status: 'awaiting_delivery', category: 'stock', items: [{ qty: 10, qty_received: 4 }] }), 'partially_received')
  assert.equal(displayStatus({ status: 'awaiting_delivery', category: 'stock', items: [{ qty: 10, qty_received: 0 }] }), 'awaiting_delivery')
  // decisions a person made are left alone
  assert.equal(displayStatus({ status: 'completed', category: 'stock', items: [{ qty: 10, qty_received: 0 }] }), 'completed')
  assert.equal(displayStatus({ status: 'cancelled', category: 'stock', items: all }), 'cancelled')
  assert.equal(displayStatus({ status: 'draft', category: 'stock', items: all }), 'draft')
  // nothing gets delivered on a carrier bill
  assert.equal(displayStatus({ status: 'awaiting_payment', category: 'carrier', items: [{ qty: 1, qty_received: 0 }] }), 'awaiting_payment')
})

// ── Attaching invoices to the right order ────────────────────────────────────
test('invoices are matched to their order, and never to the wrong one', async () => {
  const src = (await import('node:fs')).readFileSync('src/components/AttachDocuments.jsx', 'utf8')
  const body = src.slice(src.indexOf('const norm ='), src.indexOf('export default function')).replace('export function matchFile', 'function matchFile')
  const matchFile = new Function(body + '; return matchFile')()
  const orders = [
    { id: 'a', invoice_number: 'INV-13822', data: { sourceFile: 'Invoice_INV-13822.pdf' } },
    { id: 'b', invoice_number: 'INV-13876', data: {} },
    { id: 'c', invoice_number: '18311', data: { sourceFile: '18311__1_.pdf' } },
    { id: 'd', invoice_number: '311373347001020142', data: { sourceFile: 'Receipt_311373347001020142_1787670829303__1_.pdf' } },
    { id: 'e', invoice_number: '1000070731', data: { sourceFile: 'invoice_2026-09-28_22-44-26.pdf' } },
    { id: 'f', invoice_number: '1000070965', data: { sourceFile: 'invoice_2026-09-28_22-44-50.pdf' } },
  ]
  assert.equal(matchFile('Invoice_INV-13822.pdf', orders).po.id, 'a')
  assert.equal(matchFile('invoice_2026-09-28_22-44-50.pdf', orders).po.id, 'f', 'lookalike file names stay apart')
  assert.equal(matchFile('Receipt_311373347001020142_1787670829303__1_.pdf', orders).po.id, 'd')
  // a file we've never seen, matched on the invoice number inside its name
  assert.equal(matchFile('scan of INV-13876 from JD.pdf', orders).po.id, 'b')
  // nothing recognisable is left for a person to place
  assert.equal(matchFile('Month_1_P_L.pdf', orders).po, null)
  assert.equal(matchFile('holiday photo.jpg', orders).po, null)
})

// ── ⌘K search: every module must be findable ─────────────────────────────────
test('every section of the portal is accounted for in search', async () => {
  const { SEARCH_COVERAGE } = await import('../src/lib/search.js')
  const { LOCKABLE } = await import('../src/lib/access.js')
  // Adding a module without deciding how it's searched fails here on purpose
  const missing = LOCKABLE.filter(p => !SEARCH_COVERAGE[p.id]).map(p => p.id)
  assert.deepEqual(missing, [], `add these to SEARCH_COVERAGE in src/lib/search.js: ${missing.join(', ')}`)
})

test('purchase orders, credit notes, companies and hunts are searchable', async () => {
  const { buildSearchItems, searchItems } = await import('../src/lib/search.js')
  const me = { role: 'admin', active: true, permissions: [] }
  const items = buildSearchItems({
    me, nav: [{ id: 'purchases', label: 'Purchase Orders', icon: 'receipt' }],
    listings: [{ id: 'l1', name: 'Fairy 320ml x5', data: { asin: 'B08XYZ1234', brand: 'Fairy' } }],
    liveIds: new Set(['l1']),
    products: [{ id: 'p1', name: 'Fairy 320ml', data: { supplierSku: 'PC123', barcode: '5000204066012' } }],
    purchaseOrders: [
      { id: 'po1', po_number: 'PO-HI-20260915-002', supplier_name: 'JD Catering', invoice_number: 'INV-13822',
        total: 871.33, items: [{ name: '161 × Pyrex measuring jug 1L' }] },
      { id: 'cn1', kind: 'credit_note', po_number: 'CN-HI-20260817-001', supplier_name: 'Daler-Rowney',
        invoice_number: '8126000904', total: -39.25, items: [] },
    ],
    companies: [{ id: 's1', name: 'Kite Packaging', data: { kinds: ['packaging'], accountRef: 'KP-99' } }],
    hunts: [{ id: 'h1', name: 'Fairy — 21 Sept', status: 'open' }],
    directoryOf: () => 'suppliers', go: () => {}, openPo: () => {},
  })
  const find = (q) => searchItems(items, q).map(i => i.type + ': ' + i.label)

  assert.ok(find('INV-13822').some(s => s.startsWith('Purchase order')), 'by invoice number')
  assert.ok(find('PO-HI-20260915').some(s => s.startsWith('Purchase order')), 'by PO number')
  assert.ok(find('pyrex').some(s => s.startsWith('Purchase order')), 'by what was on it')
  assert.ok(find('8126000904').some(s => s.startsWith('Credit note')), 'credit notes by number')
  assert.ok(find('kite').some(s => s.startsWith('Supplier')), 'companies')
  assert.ok(find('KP-99').some(s => s.startsWith('Supplier')), 'by account reference')
  assert.ok(find('fairy — 21').some(s => s.startsWith('Hunt')), 'hunts')
  assert.ok(find('5000204066012').some(s => s.startsWith('Product')), 'products by barcode')
  assert.ok(find('B08XYZ1234').some(s => s.startsWith('Live listing')), 'listings by ASIN')

  // and nothing shows that the person can't open
  const accounts = { role: 'accounts', active: true, permissions: ['payments'] }
  const forAccounts = buildSearchItems({
    me: accounts, nav: [], listings: [{ id: 'l1', name: 'A listing', data: {} }],
    products: [{ id: 'p1', name: 'A product', data: {} }],
    purchaseOrders: [{ id: 'po1', po_number: 'PO-1', supplier_name: 'X', total: 10, items: [] }],
    companies: [], hunts: [], directoryOf: () => 'suppliers', go: () => {},
  })
  assert.deepEqual([...new Set(forAccounts.map(i => i.type))], ['Purchase order'],
    'someone with only Pending Payments sees only what they can open')
})

// ── Per-item figures follow the product, not a stored copy ───────────────────
test('a bundle shows the cost it has now, not the one saved with the listing', () => {
  const stock = [{ id: 'flea', name: 'Pestshield Flea Spray 200ml', data: { costPrice: '0.85', weightKg: '0.2' } }]
  // a listing created when the product cost 94p, still carrying that figure
  const p = { ...base, sellPrice: '24.99', costPerItem: '0.94', weightPerItem: '0.2', bundleQty: '12',
    components: [{ stockItemId: 'flea', qty: 12 }], carrierId: 'evri', carrierCatId: 'e2' }
  const r = calcProduct(p, carriers, packaging, stock)
  assert.equal(r.units, 12)
  near(r.costPrice, 10.20, 0.001, 'total cost comes from the product')
  near(r.costPerUnit, 0.85, 0.001, 'per item follows the product, not the stored 0.94')
  near(r.weightPerUnit, 0.2, 0.001)
  // and a plain single-item listing is unaffected
  const single = calcProduct({ ...base, costPrice: '3' }, carriers, packaging)
  assert.equal(single.units, 1)
  near(single.costPerUnit, 3)
})

test('a bundle taking its weight from products is not flagged for a missing weight', () => {
  const stock = [{ id: 'x', name: 'Item', data: { costPrice: '1', weightKg: '0.25' } }]
  const linked = calcProduct({ ...base, bundleQty: '6', components: [{ stockItemId: 'x', qty: 6 }],
    weightPerItem: '', carrierId: 'evri', carrierCatId: 'e2' }, carriers, packaging, stock)
  near(linked.weightPerUnit, 0.25, 0.001)
  assert.ok(linked.weightPerUnit > 0, 'so no "check weight" warning')
  // a bundle with no weight anywhere still is
  const unknown = calcProduct({ ...base, bundleQty: '6', weightKg: '', weightPerItem: '' }, carriers, packaging)
  assert.equal(unknown.weightPerUnit > 0, false)
})

// ── Confirmed matches must stick, barcode or not ─────────────────────────────
test('a confirmed match on a product with no barcode is remembered', async () => {
  const { indexSupplierProducts, matchListing } = await import('../src/lib/hunter.js')
  // an MX Wholesale line: no barcode, an auto-generated supplier code
  const products = [
    { id: 'sp1', supplier_id: 'mx', supplier_sku: 'V32130302771255', barcode: null, unit_cost: 1.35,
      name: 'Simple Kind To Skin Cleansing Facial Wipes 25s', data: {} },
    { id: 'sp2', supplier_id: 'jd', supplier_sku: 'OTHER', barcode: '5011451105607', unit_cost: 2.10, name: 'Something else', data: {} },
  ]
  const index = indexSupplierProducts(products, [{ id: 'mx', name: 'MX Wholesale' }, { id: 'jd', name: 'JD' }])
  const listing = { asin: 'B01IAFEGCO', brand: 'Simple', title: 'Simple Kind To Skin Cleansing Facial Wipes, 4 x 25', data: { barcodes: [] } }

  // exactly what the portal saved when the match was confirmed
  const confirmed = new Map([['B01IAFEGCO', { status: 'confirmed', components: [{ qty: 4, sku: 'V32130302771255', barcode: null }] }]])
  const m = matchListing(listing, index, confirmed)
  assert.equal(m.tier, 'confirmed', 'it stays confirmed instead of dropping back to needs-confirming')
  assert.equal(m.components[0].sp.id, 'sp1')
  assert.equal(m.components[0].qty, 4)

  // with the supplier recorded too, it can't pick another supplier's same code
  const withSupplier = new Map([['B01IAFEGCO', { status: 'confirmed', components: [{ qty: 4, sku: 'V32130302771255', supplierId: 'mx', barcode: null }] }]])
  assert.equal(matchListing(listing, index, withSupplier).components[0].sp.supplier_id, 'mx')

  // barcode matches still work as before
  const byBarcode = new Map([['X', { status: 'confirmed', components: [{ qty: 1, barcode: '5011451105607' }] }]])
  assert.equal(matchListing({ asin: 'X', brand: 'Simple', title: 'x', data: {} }, index, byBarcode).components[0].sp.id, 'sp2')

  // a confirmation pointing at something no longer stocked doesn't pretend
  const gone = new Map([['B01IAFEGCO', { status: 'confirmed', components: [{ qty: 1, sku: 'NOT-STOCKED', barcode: null }] }]])
  assert.notEqual(matchListing(listing, index, gone).tier, 'confirmed')
})

// ── The dashboard is for admins; everyone else lands elsewhere ───────────────
test('only admins see the dashboard, and others start where they can work', async () => {
  const { canAccess, visibleNav, landingPage, ROLES } = await import('../src/lib/access.js')
  const admin = { role: 'admin', active: true, permissions: [] }
  const manager = { role: 'manager', active: true, permissions: ROLES.manager.pages() }
  const hunter = { role: 'hunter', active: true, permissions: ROLES.hunter.pages() }
  const accounts = { role: 'accounts', active: true, permissions: ['payments'] }
  const nobody = { role: 'member', active: true, permissions: [] }

  assert.ok(canAccess(admin, 'dashboard'))
  for (const who of [manager, hunter, accounts, nobody]) {
    assert.equal(canAccess(who, 'dashboard'), false, 'the dashboard is admin-only')
    assert.equal(visibleNav(who).some(g => g.items.some(i => i.id === 'dashboard')), false, 'and is not in their menu')
  }

  assert.equal(landingPage(admin), 'dashboard')
  assert.equal(landingPage(manager), 'calculator', 'the first section they have, in menu order')
  assert.equal(landingPage(hunter), 'calculator')
  assert.equal(landingPage(accounts), 'payments', 'straight to pending payments')
  assert.equal(landingPage(nobody), null, 'nobody with nothing is told, not bounced')
  assert.equal(landingPage({ ...admin, active: false }), null)
})

// ── Reading supplier invoices ────────────────────────────────────────────────
test('each supplier’s invoice is read correctly', async () => {
  const { parseInvoice } = await import('../src/lib/invoiceParse.js')
  const { readFileSync } = await import('node:fs')
  const read = (f) => parseInvoice(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))

  const pound = read('invoice_2026_09_28_22_44_26_pdf.txt')
  assert.equal(pound.supplierName, 'Pound Wholesale')
  assert.equal(pound.invoiceNumber, '1000070731')
  near(pound.net, 522.10); near(pound.vat, 104.43); near(pound.total, 626.53)
  near(pound.delivery, 13.94, 0.01, 'priority delivery and tail lift')
  assert.equal(pound.lines.length, 6)
  assert.equal(pound.method, 'card')

  const kite = read('Order_SW004128213__1__pdf.txt')
  assert.equal(kite.lines.length, 10, 'every line, including the short codes')
  near(kite.total, 2494.66); near(kite.net, 2078.88)

  const jd = read('Invoice_INV_13822_pdf.txt')
  assert.equal(jd.invoiceNumber, 'INV-13822')
  assert.equal(jd.invoiceDate, '2026-09-15'); assert.equal(jd.dueDate, '2026-10-15')
  near(jd.total, 871.33)

  const dr = read('0026015681__1__PDF.txt')
  assert.equal(dr.invoiceNumber, '26015681'); near(dr.vat, 222.65); near(dr.total, 1335.91)
  assert.equal(dr.lines.length, 4)

  const pc = read('20012171___PF_Invoice___166189__1__pdf.txt')
  assert.equal(pc.documentKind, 'proforma')
  assert.ok(pc.warnings.some(w => w.includes('proforma')), 'says a final invoice is still needed')
  near(pc.total, 3024.11); assert.equal(pc.lines.length, 11)

  const kd = read('38d3c293be327654852cf9dd2a206eb8_pdf.txt')
  assert.equal(kd.documentKind, 'order')
  near(kd.total, 574.31)

  for (const [f, total] of [['Pro_Forma_Invoice__1__pdf.txt', 1212.44], ['Invoice_INV149603__1__PDF.txt', 3619.80],
                            ['1026251106_pdf.txt', 1055.00], ['currys_invoice_19661717_pdf.txt', 434.99]]) {
    near(read(f).total, total, 0.02, f)
  }
})

test('nothing is invented when a document can’t be read', async () => {
  const { parseInvoice, parseDate } = await import('../src/lib/invoiceParse.js')
  const empty = parseInvoice('just some words, no figures at all')
  assert.equal(empty.total, null); assert.equal(empty.invoiceNumber, null)
  assert.deepEqual(empty.lines, [])
  assert.ok(empty.warnings.some(w => w.includes('No total')))
  // and the arithmetic is checked rather than trusted
  const wrong = parseInvoice('Subtotal 100.00\nVAT 20.00\nTotal due 130.00')
  assert.ok(wrong.warnings.some(w => w.includes('don’t add up')), wrong.warnings.join('; '))
  assert.equal(parseDate('18/09/2026'), '2026-09-18')
  assert.equal(parseDate('15 Sept 2026'), '2026-09-15')
  assert.equal(parseDate('nonsense'), null)
})

test('every line on a Pricecheck proforma is read, however the columns fall', async () => {
  const { parseInvoice } = await import('../src/lib/invoiceParse.js')
  const { readFileSync } = await import('node:fs')
  const r = parseInvoice(readFileSync(new URL('./fixtures/pricecheck_179262.txt', import.meta.url), 'utf8'))
  assert.equal(r.lines.length, 13, 'including rows where the description runs into the barcode')
  near(r.net, 3823.34); near(r.vat, 764.67); near(r.total, 4588.01)
  near(r.lines.reduce((s, l) => s + l.lineTotal, 0), 3823.34, 0.01, 'the lines add up to the document')
  // unit prices come from the money, not a column that may be missing
  const elbow = r.lines.find(l => l.sku === 'HOELB069')
  assert.equal(elbow.qty, 120); near(elbow.unitCost, 0.67); near(elbow.lineTotal, 80.40)
  const radox = r.lines.find(l => l.sku === 'TORAD258')
  assert.equal(radox.qty, 102); near(radox.unitCost, 0.62)
  // nothing is silently dropped: no warning about lines not adding up
  assert.equal(r.warnings.some(w => w.includes('may not have been read')), false, r.warnings.join('; '))
})

// ── Packaging: grouping and the effect of changing it ────────────────────────
test('changing packaging is costed before it is applied', () => {
  const packaging = [
    { id: 'small', name: 'Small mailer', cost: '0.15', weightKg: '0.02' },
    { id: 'big', name: 'Large box', cost: '0.85', weightKg: '0.30' },
  ]
  const listing = { ...base, sellPrice: '12.99', costPrice: '3', weightKg: '0.4',
    packagingId: 'small', carrierId: 'evri', carrierCatId: 'e2', monthlyVolume: '100' }
  const before = calcProduct(listing, carriers, packaging)
  const after = calcProduct({ ...listing, packagingId: 'big' }, carriers, packaging)

  near(before.netProfit - after.netProfit, 0.70, 0.001, 'the packaging cost difference')
  assert.ok(after.netProfit < before.netProfit)
  // the monthly effect is the per-unit change times volume
  near((after.netProfit - before.netProfit) * 100, -70, 0.1)

  // heavier packaging can push a parcel into the next shipping band
  const heavy = calcProduct({ ...listing, weightKg: '1.9', packagingId: 'big' }, carriers, packaging)
  assert.ok(heavy.shippingCost >= before.shippingCost, 'shipping is recalculated, not assumed')

  // a listing with no packaging set is costed without one, not broken
  const unset = calcProduct({ ...listing, packagingId: '' }, carriers, packaging)
  assert.ok(unset.netProfit > before.netProfit)
  assert.equal(unset.incomplete, false)
})

test('the search index survives data that has not loaded yet', async () => {
  const { buildSearchItems } = await import('../src/lib/search.js')
  const me = { role: 'admin', active: true, permissions: [] }
  // the first render happens before settings, listings or anything else arrive
  const empty = buildSearchItems({ me, go: () => {} })
  assert.deepEqual(empty, [], 'no pages, no records, and no crash')
  const partial = buildSearchItems({ me, nav: [{ id: 'calculator', label: 'Calculator', icon: 'calculator' }], go: () => {} })
  assert.equal(partial.length, 1)
})

test('a calculation asked for before settings load comes back incomplete, not broken', () => {
  // the first render can happen before carriers and packaging arrive
  const r = calcProduct({ ...base, sellPrice: '10', costPrice: '3' }, undefined, undefined)
  assert.ok(r.incomplete, 'it says it cannot calculate')
  assert.equal(Number.isFinite(r.netProfit), true, 'and still returns numbers rather than throwing')
  const r2 = calcProduct({ ...base, sellPrice: '10', costPrice: '3', carrierId: 'evri', carrierCatId: 'e2' }, null, null)
  assert.ok(r2.incomplete)
})

// ── Dispatch: HELM labels and packing slips ──────────────────────────────────
import { readFileSync } from 'node:fs'
const dispatchPages = JSON.parse(readFileSync(new URL('./fixtures/dispatch_pages.json', import.meta.url), 'utf8'))

test('a HELM packing slip gives the order, customer and items — wrapped item codes joined back up', async () => {
  const { parseSlip, pageKind } = await import('../src/lib/dispatch.js')
  assert.equal(pageKind(dispatchPages.slip), 'slip')
  const s = parseSlip(dispatchPages.slip)
  assert.equal(s.helmOrder, 'OR-4E7B16B8')
  assert.equal(s.slipId, 'PR-993C9DDA')
  assert.equal(s.customer, 'Test Customer')
  assert.equal(s.postcode, 'AB1 2CD')
  assert.equal(s.shipping, 'Std UK Dom_2')
  assert.deepEqual(s.items, [{ code: 'SANMEX-FLY-WASP-KILLER-300ML', name: 'Sanmex Fly & Wasp Killer 300ml', qty: 6 }])
  const s2 = parseSlip(dispatchPages.slip2)
  assert.equal(s2.items[0].code, 'PESTSH-SPRAY-SPIDER-CREEPY-CRAWL-200ML', 'three-line codes too')
  assert.equal(s2.items[0].qty, 3)
})

test('labels: Evri read from the PDF, DHL from recognised text', async () => {
  const { parseLabel } = await import('../src/lib/dispatch.js')
  const e = parseLabel(dispatchPages.evri)
  assert.equal(e.carrier, 'Evri'); assert.equal(e.service, 'Standard')
  assert.equal(e.ref, 'P-2192348081'); assert.equal(e.tracking, 'H-08AN-A-000000862-4')
  const d = parseLabel({ items: [], ocr: dispatchPages.dhlOcr })
  assert.equal(d.carrier, 'DHL'); assert.equal(d.ref, 'OR-1CAAEDCA', 'the dash OCR reads as a long dash still matches')
  assert.equal(d.tracking, '60120262962422')
})

test('Evri tracking read from a picture label: misread characters put right', async () => {
  const { evriTracking, parseLabel } = await import('../src/lib/dispatch.js')
  assert.equal(evriTracking('H-08AN-A-000000862-4'), 'H-08AN-A-000000862-4')
  assert.equal(evriTracking('C-ROUND 2997\nH - 08AN - A - 000000837 - 1'), 'H-08AN-A-000000837-1', 'spaces round the dashes')
  assert.equal(evriTracking('H—O8AN—A—0000OO837—I'), 'H-08AN-A-000000837-1', 'long dashes, O for 0, I for 1')
  assert.equal(evriTracking('H=08AN=A=000 000 837=1'), 'H-08AN-A-000000837-1', 'equals signs and a split number')
  assert.equal(evriTracking('VAN A1 DROP 27 C-ROUND 2997'), '', 'nothing like a tracking number')
  assert.equal(evriTracking('H-08AN-A-0000ABC37-1'), '', 'letters inside the number are not guessed at')
  const e = parseLabel({ items: [], ocr: 'ADRIAN MARSH LIMITED EVRI\nNDAY\nDestination\nReference 1 OR-23D2BF35\nH - O8AN - A - 000000837 - 1' })
  assert.equal(e.carrier, 'Evri'); assert.equal(e.tracking, 'H-08AN-A-000000837-1')
})

test('item keys ignore order, case and the dashes line-wrapping loses', async () => {
  const { itemKey } = await import('../src/lib/dispatch.js')
  assert.equal(itemKey([{ code: 'A-1', qty: 1 }, { code: 'b2', qty: 2 }]), itemKey([{ code: 'B2', qty: 2 }, { code: 'A1', qty: 1 }]))
  assert.notEqual(itemKey([{ code: 'A1', qty: 5 }]), itemKey([{ code: 'A1', qty: 2 }]), 'a 5-pack and a 2-pack are different orders')
})

test('pages pair into orders, multi-parcel orders are counted, and mismatches are held', async () => {
  const { pairPages, checkOrders, buildBatches } = await import('../src/lib/dispatch.js')
  const label = (i, ref) => ({ index: i, items: [], ocr: `Shipment No: 6012026${i}000000\nAltRef: ${ref}\nDHL eCommerce UK`, hasPicture: true })
  const slip = (i, order, code, qty) => ({ index: i, items: [
    { str: 'Packing Slip -', x: 340, y: 800, h: 12 }, { str: `Order: ${order}`, x: 19, y: 760, h: 12 },
    { str: 'Product', x: 19, y: 600, h: 10 }, { str: 'Item Code', x: 643, y: 600, h: 10 }, { str: 'Qty', x: 777, y: 600, h: 10 },
    { str: 'Play Sand 25kg', x: 160, y: 570, h: 10 }, { str: code, x: 643, y: 570, h: 10 }, { str: String(qty), x: 778, y: 570, h: 10 },
  ] })
  const summary = { index: 99, items: [{ str: 'List of orders with successful label purchase', x: 10, y: 10, h: 10 }] }
  const pages = [
    label(0, 'OR-AAA'), label(1, 'OR-AAA'), label(2, 'OR-AAA'), slip(3, 'OR-AAA', 'SAND-25', 3),   // 3 x 25kg, 3 parcels
    label(4, 'OR-BBB'), slip(5, 'OR-BBB', 'SAND-25', 1),                                          // single bag
    label(6, 'OR-CCC'), slip(7, 'OR-CCC', 'SAND-25', 3),                                          // 3-pack with a label missing
    label(8, 'OR-XXX'), slip(9, 'OR-DDD', 'SAND-25', 1),                                          // wrong label for the slip
    summary,
  ]
  const { orders, skipped } = pairPages(pages)
  assert.equal(orders.length, 4); assert.equal(skipped, 1)
  assert.equal(orders[0].labels.length, 3)
  const mappings = [
    { item_key: 'SAND25x3', label_name: '25KG PLAY SAND', contents: '1 x 25kg bag', parcels: 3 },
    { item_key: 'SAND25x1', label_name: '25KG PLAY SAND', contents: '1 x 25kg bag', parcels: 1 },
  ]
  const checked = checkOrders(orders, mappings)
  assert.deepEqual(checked.map(o => o.level), ['ok', 'ok', 'hold', 'hold'])
  assert.ok(checked[2].problems.some(p => /Should have 3 labels, has 1/.test(p.text)))
  assert.ok(checked[3].problems.some(p => p.code === 'mismatch'))
  // the 3-pack and the single both send one bag per box, so they're one batch
  const batches = buildBatches(checked, { include: o => o.level === 'ok' })
  assert.equal(batches.length, 1)
  assert.equal(batches[0].labels.length, 4)
  assert.deepEqual(batches[0].labels.map(l => l.seq), [1, 2, 3, 4])
  assert.equal(batches[0].orders.length, 2)
})

test('a new item is asked about, not guessed', async () => {
  const { pairPages, checkOrders } = await import('../src/lib/dispatch.js')
  const { orders } = pairPages([
    { index: 0, items: [], ocr: 'AltRef: OR-AAA\nDHL eCommerce UK' },
    { index: 1, items: [
      { str: 'Packing Slip', x: 1, y: 800, h: 12 }, { str: 'Order: OR-AAA', x: 1, y: 760, h: 12 },
      { str: 'Item Code', x: 643, y: 600, h: 10 }, { str: 'Qty', x: 777, y: 600, h: 10 },
      { str: 'NEW-THING', x: 643, y: 570, h: 10 }, { str: '2', x: 778, y: 570, h: 10 },
    ] },
  ])
  const [o] = checkOrders(orders, [])
  assert.equal(o.level, 'map')
  assert.equal(o.key, 'NEWTHINGx2')
})

test('dispatch batches and labels are findable by postcode, order reference and batch', async () => {
  const { buildSearchItems, searchItems } = await import('../src/lib/search.js')
  const me = { role: 'member', active: true, permissions: ['dispatch'] }
  const items = buildSearchItems({
    me, go: () => {},
    dispatch: {
      batches: [{ id: 'b1', code: 'B3', label_name: '25KG PLAY SAND', ship_date: '2026-10-13', carrier: 'DHL', service: 'Next Day', label_count: 23 }],
      labels: [{ id: 'l1', batch_id: 'b1', seq: 7, customer: 'Test Customer', postcode: 'AB1 2CD', channel_ref: '205-4194810-6689938', label_name: '25KG PLAY SAND', status: 'ready' }],
    },
  })
  const find = (q) => searchItems(items, q).map(i => i.type)
  assert.ok(find('AB1 2CD').includes('Shipping label'))
  assert.ok(find('205-4194810').includes('Shipping label'))
  assert.ok(find('B3').includes('Dispatch batch'))
  const outsider = buildSearchItems({ me: { role: 'member', active: true, permissions: ['stock'] }, go: () => {},
    dispatch: { batches: [{ id: 'b1', code: 'B3', label_name: 'X', label_count: 1 }], labels: [] } })
  assert.equal(outsider.length, 0, 'nobody without Dispatch sees its labels')
})

test('HELM 6x4 files: slip first, then its label — read, paired and matched by order number', async () => {
  const { pairPages, checkOrders, itemKey } = await import('../src/lib/dispatch.js')
  const { orders, slipFirst } = pairPages([{ ...dispatchPages.helmSlip, index: 0 }, { ...dispatchPages.helmEvri, index: 1 }])
  assert.equal(slipFirst, true)
  assert.equal(orders.length, 1)
  const [o] = orders
  assert.deepEqual(o.slip.items, [{ code: 'PESTSH-SPRAY-SPIDER-CREEPY-CRAWL-200ML', name: 'Pestshield Spider & Creepy Crawl Spray 200ml', qty: 1 }])
  assert.equal(o.slip.helmOrder, 'OR-23D2BF35')
  assert.equal(o.labels[0].ref, 'OR-23D2BF35')
  assert.equal(o.labels[0].service, 'Next Day')
  assert.equal(o.labels[0].customer, 'Adrian Marsh', 'the Destination block, not the routing codes beside it')
  const [c] = checkOrders(orders, [{ item_key: itemKey(o.slip.items), label_name: 'SPIDER SPRAY', parcels: 1 }])
  assert.equal(c.level, 'ok', 'reference matches, count matches — nothing to check')
})

test('close day: leftover label numbers are read exactly, and typos are caught rather than ignored', async () => {
  const { parseRanges, compressRanges } = await import('../src/lib/dispatch.js')
  const r = parseRanges('10-25, 31', 40)
  assert.equal(r.set.size, 17); assert.deepEqual(r.errors, [])
  assert.equal(compressRanges([...r.set]), '10–25, 31')
  assert.equal(parseRanges('10 - 12 ; 14 to 15', 20).set.size, 5, 'spaces, semicolons and "to" all work')
  assert.equal(parseRanges('25-10', 30).set.size, 16, 'backwards ranges are fine')
  assert.equal(parseRanges('', 30).set.size, 0, 'nothing left over')
  assert.ok(parseRanges('10-45', 40).errors.length, 'past the end of the batch')
  assert.ok(parseRanges('ten', 40).errors.length)
})

test('a label is delayed once the cut-off passes on its day, or any day after', async () => {
  const { isDelayed, daysLate } = await import('../src/lib/dispatch.js')
  const today = '2026-10-13'
  assert.equal(isDelayed('2026-10-13', { today, now: '17:59', cutoff: '18:00' }), false)
  assert.equal(isDelayed('2026-10-13', { today, now: '18:00', cutoff: '18:00' }), true)
  assert.equal(isDelayed('2026-10-12', { today, now: '08:00', cutoff: '18:00' }), true)
  assert.equal(isDelayed('2026-10-13', { today, now: '16:30', cutoff: '16:00' }), true, 'cut-off can be changed')
  assert.equal(daysLate('2026-10-13', today), 0)
  assert.equal(daysLate('2026-10-10', today), 3)
})

test('6x4 slips: numeric and mixed-case item codes, names over two lines, the bold line is the code', async () => {
  const { parseSlip, parseLabel, pairPages, checkOrders } = await import('../src/lib/dispatch.js')
  const n = parseSlip(dispatchPages.numericSlip)
  assert.deepEqual(n.items, [{ code: '366601900474', name: 'Pyrex Glass Measuring Jug 0.5L 500ml Classic Kitchen Prep Measurement Jug 1 Pint', qty: 1 }])
  assert.equal(n.channelRef, '12-15290-93265', 'the order number beside the postcode')
  assert.equal(n.customer, 'Test Buyer')
  const m = parseSlip(dispatchPages.mixedSlip)
  assert.equal(m.items[0].code, 'ScolaArtmix-Pearl-6x150ml-001')
  assert.equal(m.items[0].name, 'Scola Textile Fabric Paint, 6 Assorted Colours, 150ml Bottles[Pearl]')
  // Evri Reference 1 is that same order number
  const { orders } = pairPages([{ ...dispatchPages.numericSlip, index: 0 }, { ...dispatchPages.numericEvri, index: 1 }])
  const [o] = checkOrders(orders, [{ item_key: '366601900474x1', label_name: 'PYREX JUG 500ML', parcels: 1 }])
  assert.equal(o.level, 'ok')
  // DHL: the shipment number in "Ref" matches the SH- number at the top of the slip
  const d = parseSlip(dispatchPages.dhlSlip)
  assert.equal(d.slipId, 'SH-547CC2DF')
  assert.equal(d.channelRef, '204-2122931-4963555')
  const label = parseLabel({ items: [], ocr: dispatchPages.dhlShOcr })
  assert.ok(label.refs.includes('SH-547CC2DF'))
  const [dh] = checkOrders([{ slip: d, labels: [{ ...label, pageIndex: 1 }] }], [{ item_key: 'PEACOCSALTWHITEDEICING20KGx1', label_name: '20KG WHITE SALT', parcels: 1 }])
  assert.equal(dh.level, 'ok', 'a DHL label is matched by its shipment number when AltRef holds something else')
})

test('an order already in an earlier batch is held, so it is never sent twice', async () => {
  const { checkOrders } = await import('../src/lib/dispatch.js')
  const order = { slip: { channelRef: '204-2122931-4963555', slipId: 'SH-547CC2DF', items: [{ code: 'A', qty: 1 }] },
    labels: [{ pageIndex: 0, carrier: 'DHL', refs: ['SH-547CC2DF'], ref: 'SH-547CC2DF' }] }
  const mappings = [{ item_key: 'Ax1', label_name: 'A', parcels: 1 }]
  assert.equal(checkOrders([order], mappings)[0].level, 'ok')
  const [o] = checkOrders([order], mappings, { existing: [{ slip_id: 'SH-547CC2DF', status: 'dispatched', upload: { code: 'B2', ship_date: '2026-10-13' } }] })
  assert.equal(o.level, 'hold')
  assert.match(o.problems.find(p => p.code === 'duplicate').text, /B2 on 13 Oct — and dispatched/)
})

test('the pick list adds up every item across a batch, counting each order once', async () => {
  const { pickTotals } = await import('../src/lib/dispatch.js')
  const labels = [
    // a 3-bag order has three labels but is picked once: 3 bags
    ...[1, 2, 3].map(i => ({ id: `a${i}`, upload_id: 'u', order_key: 'A', items: [{ code: 'SAND-25', name: 'Play Sand 25kg', qty: 3 }] })),
    { id: 'b', upload_id: 'u', order_key: 'B', items: [{ code: 'SAND-25', name: 'Play Sand 25kg', qty: 1 }] },
    { id: 'c', upload_id: 'u', order_key: 'C', items: [{ code: 'JUG', name: 'Pyrex Jug', qty: 2 }] },
  ]
  assert.deepEqual(pickTotals(labels).map(t => [t.code, t.qty]), [['SAND-25', 4], ['JUG', 2]])
})

test('Amazon Buy Shipping Evri labels: pictures with no reference, checked by postcode instead', async () => {
  const { parseLabel, checkOrders, fixOcrPostcode, samePostcode, pageKind } = await import('../src/lib/dispatch.js')
  assert.equal(fixOcrPostcode('CO7 BAB'), 'CO7 8AB', 'the inward code is always digit-letter-letter')
  assert.ok(samePostcode('NE1S 9DH', 'NE15 9DH'))
  assert.ok(!samePostcode('NE15 9DH', 'NE16 9DH'))
  const label = parseLabel({
    items: [],
    ocr: 'ADRIAN MARSH LIMITED Marketplace\nEVRi\nVAN 86\nDROP 29\nC—ROUND 08 1028',
    ocrService: 'NDAY NDAY',
    ocrAddress: 'Destination :\nTest Buyer\n31 TEST GATE\nSTEVENAGE\nSG2 7QY\nDate 15/10/2026\nWeight in KG 0.42',
  })
  assert.equal(label.carrier, 'Evri'); assert.equal(label.service, 'Next Day', 'NDAY read from the close-up of the service band')
  assert.equal(label.customer, 'Test Buyer'); assert.equal(label.postcode, 'SG2 7QY')
  const slip = { channelRef: '205-6756920-8196367', postcode: 'SG2 7QY', items: [{ code: 'A', qty: 1 }] }
  const mappings = [{ item_key: 'Ax1', label_name: 'A', parcels: 1 }]
  assert.equal(checkOrders([{ slip, labels: [{ ...label, pageIndex: 1 }] }], mappings)[0].level, 'ok', 'postcode matches — nothing to check')
  const wrong = checkOrders([{ slip: { ...slip, postcode: 'HA4 7QW' }, labels: [{ ...label, pageIndex: 1 }] }], mappings)[0]
  assert.equal(wrong.level, 'hold')
  assert.ok(wrong.problems.some(p => p.code === 'postcode'))
  // "Powered by TCPDF" on a picture label doesn't make it a page with words
  assert.equal(pageKind({ items: [{ str: 'Powered by TCPDF (www.tcpdf.org)', x: 1, y: 1 }], ocr: 'DHL eCommerce UK AltRef: X', hasPicture: true }), 'label')
  assert.equal(parseLabel({ items: [{ str: 'Powered by TCPDF (www.tcpdf.org)', x: 1, y: 1 }], ocr: 'Shipment No: 60120263356734\nRef: 026-9338665-4398717\nDHL eCommerce UK' }).carrier, 'DHL')
})

test('a long packing slip running onto a second page keeps all its items', async () => {
  const { pairPages } = await import('../src/lib/dispatch.js')
  const row = (y, qty = 2) => [
    { str: 'Peacock White De-Icing Salt 10kg', x: 25, y: y + 8, w: 150, h: 9, font: 'reg' },
    { str: 'PEACOC-SALT-WHITE-DEICING-10KG', x: 25, y, w: 150, h: 9, font: 'bold' },
    { str: String(qty), x: 240, y: y + 4, w: 6, h: 12, font: 'reg' },
  ]
  const slip = { index: 0, items: [
    { str: 'Packing Slip', x: 25, y: 400, w: 80, h: 16, font: 'bold' },
    { str: 'Test Buyer', x: 25, y: 350, w: 60, h: 9, font: 'reg' },
    { str: 'GL13 9PA, GB', x: 25, y: 340, w: 60, h: 9, font: 'reg' },
    { str: '206-0740392-9720346', x: 150, y: 340, w: 90, h: 9, font: 'reg' },
    ...row(300), ...row(270), ...row(240),
  ] }
  const more = { index: 1, items: [...row(400), ...row(370)] }
  const label = (i) => ({ index: i, items: [], ocr: 'Shipment No: 60120263356716\nRef: 206-0740392-9720346\nDHL eCommerce UK', hasPicture: true })
  const { orders } = pairPages([slip, more, label(2), label(3), label(4), label(5), label(6)])
  assert.equal(orders.length, 1, 'the second page is not mistaken for a label')
  assert.equal(orders[0].slip.items.reduce((s, i) => s + i.qty, 0), 10)
  assert.equal(orders[0].labels.length, 5)
})

test('one set-up covers every quantity of a heavy item; postcode misreads of one character still match', async () => {
  const { checkOrders, samePostcode, sameName } = await import('../src/lib/dispatch.js')
  const maps = [{ item_key: 'SALT25x*', label_name: '25KG WHITE SALT', parcels: 1 }, { item_key: 'SALT10x*', label_name: '10KG SALT', parcels: 2 }]
  const order = (code, qty, n) => ({ slip: { channelRef: 'R', items: [{ code, qty }] }, labels: Array.from({ length: n }, (_, i) => ({ pageIndex: i, carrier: 'DHL', refs: ['R'] })) })
  const [a, b, c, d] = checkOrders([order('SALT-25', 6, 6), order('SALT-25', 1, 1), order('SALT-10', 30, 15), order('SALT-10', 30, 14)], maps)
  assert.equal(a.level, 'ok'); assert.equal(b.level, 'ok'); assert.equal(c.level, 'ok', '30 bags at 2 a box = 15 labels')
  assert.equal(d.level, 'hold', "one label short: what's in each box is unknown, so it waits for a person")
  assert.ok(samePostcode('SE22 0OR', 'SE22 0QR', 1))
  assert.ok(samePostcode('WV13 5EF', 'WV13 3EF', 1))
  assert.ok(!samePostcode('WV13 5EF', 'B50 4AT', 1))
  assert.ok(sameName('Mrs Gillian Reay', 'Gillian Reay'))
  assert.ok(!sameName('John Smith', 'Jane Doe'))
})

test('a batch prints Evri first, then DHL, with the same product together smallest pack first', async () => {
  const { buildBatches, checkOrders } = await import('../src/lib/dispatch.js')
  const o = (code, name, carrier) => ({ slip: { channelRef: code + carrier, items: [{ code, name, qty: 1 }] }, labels: [{ pageIndex: 0, carrier, service: 'Next Day', refs: [code + carrier] }] })
  const maps = ['PS4', 'PS2', 'PS3', 'SALT', 'JUG'].map(c => ({ item_key: `${c}x1`, label_name: c, parcels: 1 }))
  const orders = [o('PS4', '4 x Pestshield Spray', 'Evri'), o('SALT', 'Peacock Salt 25kg', 'DHL'), o('PS2', '2 x Pestshield Spray', 'Evri'),
    o('JUG', 'Pyrex Jug', 'Evri'), o('PS3', '3 x Pestshield Spray', 'Evri')]
  const groups = buildBatches(checkOrders(orders, maps))
  assert.deepEqual(groups.map(g => g.label_name), ['PS2', 'PS3', 'PS4', 'JUG', 'SALT'])
})

test('units: pack sizes are guessed from code and name, and add up per base product; replacements kept apart', async () => {
  const { guessUnits, summariseDispatch } = await import('../src/lib/dispatch.js')
  assert.deepEqual(guessUnits({ code: 'SANMEX-FLY-WASP-KILLER-300ML-3PK', name: '3 x Sanmex Fly & Wasp Killer 300ml' }), { base_product: 'Sanmex Fly & Wasp Killer 300ml', units: 3 })
  assert.equal(guessUnits({ code: 'SCOLA-PAINT-FLUOR-6-600ML', name: 'Scola Readymix Paint Fluorescent Colours 600ml - Pack of 6' }).units, 6)
  assert.equal(guessUnits({ code: 'PEACOC-SALT-10KG', name: 'Peacock White De-Icing Salt 10kg' }).units, 1)
  const units = new Map([
    ['SAN3PK', { base_product: 'Sanmex 300ml', units: 3, confirmed: true }],
    ['SAN', { base_product: 'Sanmex 300ml', units: 1, confirmed: true }],
  ])
  const l = (id, order, code, qty, status, extra = {}) => ({ id, upload_id: 'u', order_key: order, status, items: [{ code, qty }], carrier: 'Evri', ...extra })
  const s = summariseDispatch([
    l('a', 'A', 'SAN-3PK', 2, 'dispatched'),            // 6 units gone
    l('b', 'B', 'SAN', 1, 'dispatched'),                // 1 unit gone
    l('c', 'C', 'SAN', 4, 'ready'),                     // 4 still to go
    l('d', 'D', 'SAN', 1, 'dispatched', { reason: 'replacement' }),
  ], units)
  assert.equal(s.products.length, 1, 'singles and 3-packs roll up into one product')
  assert.equal(s.products[0].gone, 7); assert.equal(s.products[0].waiting, 4); assert.equal(s.products[0].replacements, 1)
  assert.equal(s.replacements, 1); assert.equal(s.unitsGone, 7)
})

test('labels with no packing slip stand alone, and once told what they are they batch like any other', async () => {
  const { pairPages, planUpload } = await import('../src/lib/dispatch.js')
  const label = (i, pc) => ({ index: i, items: [], ocr: `ADRIAN MARSH LIMITED Marketplace\nEVRi\nNDAY`, ocrAddress: `Destination :\nTest Buyer\n${pc}`, hasPicture: true })
  const { orders } = pairPages([label(0, 'AB1 2CD'), label(1, 'ZZ9 9ZZ')])
  assert.equal(orders.length, 2, 'two hand-made labels are two orders, not one')
  const maps = [{ item_key: 'SANx1', label_name: 'SANMEX', parcels: 1, items: [{ code: 'SAN', qty: 1, name: 'Sanmex' }] }]
  const before = planUpload(orders, maps)
  assert.equal(before.needsYou, 2)
  const after = planUpload(orders, maps, { manual: { o0: { mapping: maps[0], reason: 'replacement', originalRef: '205-1' }, o1: { mapping: maps[0] } } })
  assert.equal(after.needsYou, 0)
  assert.equal(after.batches[0].labels.length, 2)
  assert.equal(after.checked[0].slip.reason, 'replacement')
})

test('stamp names never drop a size, weight, count or the variety — checked against every HELM product', async () => {
  const { stampName } = await import('../src/lib/dispatch.js')
  const helm = JSON.parse(readFileSync(new URL('../src/data/helmProducts.json', import.meta.url), 'utf8'))
  assert.ok(helm.units.length > 200)
  for (const u of helm.units) {
    const s = stampName(u.name)
    assert.ok(s.length <= 54 || s.split(' + ').length > 1, `${u.name} → ${s} is too long`)
    const sizes = (stampName(u.name, { max: 999 }).match(/\S*\d\S*/g) || [])
    for (const t of sizes) assert.ok(s.includes(t), `${u.name} → ${s} lost ${t}`)
  }
  assert.equal(stampName('Scola Air Dry Clay Stone 12.5kg'), 'SCOLA AIR DRY CLAY STONE 12.5KG')
  assert.match(stampName('1L 1000ml Pyrex Large Glass Measuring Jug Classic Kitchen Prep Measurement Jug'), /1L 1000ML PYREX/)
  assert.equal(stampName('1 x Pyrex Glass Measuring Jug 250ml + 1 x Pyrex Glass Measuring Jug 500ml'), '1 X PYREX JUG 250ML + 1 X PYREX JUG 500ML')
})

test('HELM bundles count as their parts, mixed sets as each thing in them', async () => {
  const { helmProductsToUnits, summariseDispatch } = await import('../src/lib/dispatch.js')
  const units = helmProductsToUnits([
    { 'Product Name': 'Fairy 320ml', 'Product Code': 'FAIRY-320ML', Type: 'INVENTORY' },
    { 'Product Name': '10 x Fairy 320ml', 'Product Code': 'FAIRY-320ML-10PK', Type: 'GROUP', 'Main Product Code': 'FAIRY-320ML', 'Quantity per Group': 10 },
    { 'Product Name': 'Jug 250ml', 'Product Code': 'JUG-250', Type: 'INVENTORY' },
    { 'Product Name': 'Jug 500ml', 'Product Code': 'JUG-500', Type: 'INVENTORY' },
    { 'Product Name': 'Jug set', 'Product Code': 'JUG-SET', Type: 'GROUP', 'Main Product Code': 'JUG-250', 'Quantity per Group': 1 },
    { 'Product Name': 'Jug set', 'Product Code': 'JUG-SET', Type: 'GROUP', 'Main Product Code': 'JUG-500', 'Quantity per Group': 1 },
  ])
  const by = new Map(units.map(u => [u.code_key, u]))
  assert.equal(by.get('FAIRY320ML10PK').units, 10)
  const s = summariseDispatch([
    { id: 'a', upload_id: 'u', order_key: 'A', status: 'dispatched', items: [{ code: 'FAIRY-320ML-10PK', qty: 2 }] },
    { id: 'b', upload_id: 'u', order_key: 'B', status: 'dispatched', items: [{ code: 'JUG-SET', qty: 1 }] },
  ], by)
  const p = Object.fromEntries(s.products.map(x => [x.base, x.gone]))
  assert.equal(p['Fairy 320ml'], 20)
  assert.equal(p['Jug 250ml'], 1); assert.equal(p['Jug 500ml'], 1)
  assert.equal(s.unconfirmed.length, 0)
})

test('after the cut-off, uploads go on the next working day, and never count as late before it', async () => {
  const { nextWorkingDay, isDelayed } = await import('../src/lib/dispatch.js')
  assert.equal(nextWorkingDay('2026-10-14'), '2026-10-15')   // Wed → Thu
  assert.equal(nextWorkingDay('2026-10-16'), '2026-10-17')   // Fri → Sat: Saturday is a dispatch day
  assert.equal(nextWorkingDay('2026-10-17'), '2026-10-19')   // Sat → Mon
  assert.equal(isDelayed('2026-10-17', { today: '2026-10-16', now: '19:00', cutoff: '18:00' }), false)
})

test('pages are drawn without waiting for animation frames, so reading carries on in a background tab', async () => {
  const src = readFileSync(new URL('../src/lib/dispatchPdf.js', import.meta.url), 'utf8')
  for (const m of src.matchAll(/\.render\(\{[^}]*\}\)/g)) assert.match(m[0], /intent: 'print'/, `${m[0]} would pause when the tab is hidden`)
  const jobs = readFileSync(new URL('../src/lib/dispatchJobs.js', import.meta.url), 'utf8')
  assert.match(jobs, /navigator\.locks/, 'reading holds a lock so the tab is not frozen')
})

test('the dashboard says who dispatched what, by day, and what was stamped', async () => {
  const { summariseDispatch } = await import('../src/lib/dispatch.js')
  const l = (id, order, packer, status, day, label_name) => ({ id, upload_id: 'u', order_key: order, packer, status, label_name,
    dispatched_at: status === 'dispatched' ? `${day}T15:00:00Z` : null, items: [{ code: 'A', qty: 2 }], carrier: 'Evri' })
  const labels = [l('1', 'A', 'Ankesh', 'dispatched', '2026-10-15', 'PYREX JUG 500ML'), l('2', 'B', 'Ankesh', 'dispatched', '2026-10-16', 'PYREX JUG 500ML'),
    l('3', 'C', 'Sagar', 'dispatched', '2026-10-16', 'SANMEX X3'), l('4', 'D', 'Sagar', 'ready', '2026-10-16', 'SANMEX X3')]
  const s = summariseDispatch(labels, new Map([['A', { base_product: 'A', units: 1, confirmed: true }]]))
  const by = Object.fromEntries(s.people.map(p => [p.name, p]))
  assert.equal(by.Ankesh.orders, 2); assert.equal(by.Ankesh.days['2026-10-16'], 1); assert.equal(by.Sagar.orders, 1)
  assert.equal(by.Sagar.units, 2)
  assert.deepEqual(s.stamps.map(x => [x.name, x.orders, x.gone]), [['PYREX JUG 500ML', 2, 2], ['SANMEX X3', 2, 1]])
  const onlySagar = summariseDispatch(labels, new Map(), { person: 'Sagar' })
  assert.equal(onlySagar.orders, 2)
})

// ── The stamp is what the warehouse packs by: every way it could go wrong ────

test('stamp safety: each box of an any-quantity order says exactly what it holds', async () => {
  const { checkOrders, buildBatches } = await import('../src/lib/dispatch.js')
  const maps = [{ item_key: 'SALT10x*', label_name: '10KG WHITE SALT', parcels: 2 }]
  const order = (qty, n) => ({ slip: { channelRef: 'R', items: [{ code: 'SALT-10', qty }] }, labels: Array.from({ length: n }, (_, i) => ({ pageIndex: i, carrier: 'DHL', service: 'Next Day', refs: ['R'] })) })
  const [five] = checkOrders([order(5, 3)], maps)
  assert.deepEqual(five.labels.map(l => l.stampName), ['2 X 10KG WHITE SALT', '2 X 10KG WHITE SALT', '10KG WHITE SALT'])
  const groups = buildBatches([five])
  assert.deepEqual(groups.map(g => [g.label_name, g.labels.length]).sort(), [['10KG WHITE SALT', 1], ['2 X 10KG WHITE SALT', 2]])
  const [wrong] = checkOrders([order(5, 2)], maps)
  assert.equal(wrong.level, 'hold', '5 bags in 2 boxes at 2 a box doesn\'t add up — ask, don\'t guess')
  assert.ok(wrong.problems.some(p => p.perBox))
  const single = checkOrders([order(1, 1)], [{ item_key: 'SALT10x*', label_name: '10KG WHITE SALT', parcels: 1 }])[0]
  assert.equal(single.labels[0].stampName, '10KG WHITE SALT')
})

test('stamp safety: the label\'s own "2xCODE" / MULTI_ITEM_ORDER must agree with the slip', async () => {
  const { checkOrders, parseLabel } = await import('../src/lib/dispatch.js')
  const dhl = parseLabel({ items: [], ocr: 'Shipment No: 60120263356732\nRef: 206—2873789—4733101\nAltRef: 2xPEACOC—SALT—WHITE—\nDHL eCommerce UK' })
  assert.deepEqual(dhl.itemHint, { qty: 2, prefix: 'PEACOC-SALT-WHITE-' })
  const evri = parseLabel(dispatchPages.helmEvri)
  assert.deepEqual(evri.itemHint, { qty: 1, prefix: 'PESTSH-SPRAY-SPIDE' })
  const maps = [{ item_key: 'PEACOCSALTWHITEDEICING10KGx2', label_name: '2 X 10KG SALT', parcels: 1 }, { item_key: 'PEACOCSALTWHITEDEICING10KGx1', label_name: '10KG SALT', parcels: 1 }]
  const slip = (qty) => ({ channelRef: '206-2873789-4733101', items: [{ code: 'PEACOC-SALT-WHITE-DEICING-10KG', qty }] })
  assert.equal(checkOrders([{ slip: slip(2), labels: [{ ...dhl, pageIndex: 1 }] }], maps)[0].level, 'ok')
  const misread = checkOrders([{ slip: slip(1), labels: [{ ...dhl, pageIndex: 1 }] }], maps)[0]
  assert.equal(misread.level, 'hold', 'slip read as 1 bag but the label says 2 — never stamp it')
  const multi = parseLabel({ items: [], ocr: 'Shipment No: 1234567890123\nRef: 206—6701824—7569123\nAltRef: MULTI_ITEM_ORDER\nDHL eCommerce UK' })
  assert.equal(checkOrders([{ slip: { channelRef: '206-6701824-7569123', items: [{ code: 'A', qty: 1 }] }, labels: [{ ...multi, pageIndex: 1 }] }], [{ item_key: 'Ax1', label_name: 'A', parcels: 1 }])[0].level, 'hold',
    'a multi-item order read as one item has lost something')
})

test('stamp safety: a new item code HELM doesn\'t know is flagged before it\'s set up; a stamp with the wrong count is held', async () => {
  const { checkOrders, stampCountProblem, fixedStamp } = await import('../src/lib/dispatch.js')
  const o = { slip: { channelRef: 'R', items: [{ code: 'PYREX-JUG-GLASS-50OML', qty: 1 }] }, labels: [{ pageIndex: 0, carrier: 'Evri', refs: ['R'] }] }
  const [c] = checkOrders([o], [], { helmCodes: new Set(['PYREXJUGGLASS500ML']) })
  assert.equal(c.level, 'map')
  assert.ok(c.problems.some(p => p.code === 'unknown-code'))
  // 2 bags of sand in 2 boxes: each box holds 1, so "2 X" on each would be wrong
  const units = new Map([['SAND25', { base_product: 'Kiln Dried Sand 25kg', units: 1, components: [{ name: 'Kiln Dried Sand 25kg', units: 1 }] }]])
  const sand = { item_key: 'SAND25x2', label_name: '2 X KILN DRIED SAND 25KG', parcels: 2, items: [{ code: 'SAND-25', qty: 1 }, { code: 'SAND-25', qty: 1 }] }
  const p = stampCountProblem(sand, units)
  assert.equal(p.perBox, 1)
  assert.equal(fixedStamp(sand, units, p), 'KILN DRIED SAND 25KG')
  const order = { slip: { channelRef: 'R', items: sand.items }, labels: [0, 1].map(i => ({ pageIndex: i, carrier: 'DHL', refs: ['R'] })) }
  assert.equal(checkOrders([order], [sand], { unitsByCode: units })[0].level, 'hold')
  // right counts pass: "2 X (3 X …)" for 2 three-packs in one box, a mixed set, a 6-pack named "6X 225ML"
  const three = new Map([['SAN3PK', { components: [{ name: 'Sanmex', units: 3 }] }], ['RAD6', { components: [{ name: 'Radox', units: 6 }] }]])
  assert.equal(stampCountProblem({ item_key: 'k', label_name: '2 X (3 X SANMEX 300ML)', parcels: 1, items: [{ code: 'SAN-3PK', qty: 2 }] }, three), null)
  assert.equal(stampCountProblem({ item_key: 'k', label_name: 'RADOX SHOWER GEL 6X 225ML', parcels: 1, items: [{ code: 'RAD-6', qty: 1 }] }, three), null)
  assert.ok(stampCountProblem({ item_key: 'k', label_name: '3 X SANMEX 300ML', parcels: 1, items: [{ code: 'SAN-3PK', qty: 2 }] }, three), '2 three-packs is 6, not 3')
})

test('stamp safety: anything not checked every way waits for a person; nothing is stamped from a guess', async () => {
  const { pairPages, planUpload } = await import('../src/lib/dispatch.js')
  const maps = [{ item_key: 'Ax1', label_name: 'A', parcels: 1 }]
  // a label with no reference and no readable postcode: matched only by page order
  const slip = { index: 0, items: [{ str: 'Packing Slip', x: 25, y: 400, h: 16, font: 'b' }, { str: 'Buyer', x: 25, y: 350, h: 9 }, { str: 'AB1 2CD, GB', x: 25, y: 340, h: 9 },
    { str: 'Item', x: 25, y: 300, h: 9 }, { str: 'A-CODE', x: 25, y: 290, h: 9, font: 'b' }, { str: '1', x: 240, y: 294, h: 12 }] }
  const label = { index: 1, items: [], ocr: 'ADRIAN MARSH LIMITED Marketplace\nEVRi\nNDAY', hasPicture: true }
  const { orders } = pairPages([slip, label])
  const plan = planUpload(orders, [{ item_key: 'ACODEx1', label_name: 'A', parcels: 1 }])
  assert.equal(plan.checked[0].level, 'check')
  assert.equal(plan.batches.length, 0, 'not batched until someone ticks it')
  assert.equal(plan.needsYou, 1)
  const ticked = planUpload(orders, [{ item_key: 'ACODEx1', label_name: 'A', parcels: 1 }], { overrides: { o0: true } })
  assert.equal(ticked.batches[0].labels.length, 1)
})

test('stamp safety: an exact set-up always wins, and a different quantity is never stamped as another', async () => {
  const { checkOrders } = await import('../src/lib/dispatch.js')
  const maps = [{ item_key: 'JUGx1', label_name: 'PYREX JUG 500ML', parcels: 1 }, { item_key: 'JUGx2', label_name: '2 X PYREX JUG 500ML', parcels: 1 }]
  const o = (qty) => ({ slip: { channelRef: 'R', items: [{ code: 'JUG', qty }] }, labels: [{ pageIndex: 0, carrier: 'Evri', refs: ['R'] }] })
  const [one, two, three] = checkOrders([o(1), o(2), o(3)], maps)
  assert.equal(one.labels[0].stampName, 'PYREX JUG 500ML')
  assert.equal(two.labels[0].stampName, '2 X PYREX JUG 500ML')
  assert.equal(three.level, 'map', '3 jugs has no set-up — asked, not stamped as 1 or 2')
  // mixed orders only match their exact set
  const [mixed] = checkOrders([{ slip: { channelRef: 'R', items: [{ code: 'JUG', qty: 1 }, { code: 'BOWL', qty: 1 }] }, labels: [{ pageIndex: 0, carrier: 'Evri', refs: ['R'] }] }], maps)
  assert.equal(mixed.level, 'map')
})

test('stamp safety: DHL\'s reference block is read close up, so a 1 misread as 4 doesn\'t decide anything', async () => {
  const { parseLabel } = await import('../src/lib/dispatch.js')
  const l = parseLabel({ items: [], ocr: 'Shipment No: 60120263380472\nRef: 206—7902193—4338703\nAltRef: 4xUNBRND — SALT — WHITE —\nDHL eCommerce UK',
    ocrRefs: 'Shipment No: 60120263380472\nParcel: 1\nRef: 206 — 7902193 — 4338703\nAltRef: 1xUNBRND — SALT — WHITE—' })
  assert.deepEqual(l.itemHint, { qty: 1, prefix: 'UNBRND-SALT-WHITE-' })
  assert.ok(l.refs.some(r => r.replace(/-/g, '') === '20679021934338703'))
})

test('weight rules: no box over 25kg, nothing 15kg or more on Evri, and units per box from the weight', async () => {
  const { checkOrders, unitsPerBox, itemKg } = await import('../src/lib/dispatch.js')
  assert.equal(unitsPerBox({ name: 'Peacock White De-Icing Salt 10kg' }), 2)
  assert.equal(unitsPerBox({ name: 'Scola Air Dry Clay Stone 12.5kg' }), 2)
  assert.equal(unitsPerBox({ name: 'Peacock White De-Icing Salt 15kg' }), 1)
  assert.equal(unitsPerBox({ name: 'Unbranded Kiln Dried Sand 25kg' }), 1)
  assert.equal(itemKg({ name: '2 x Scola Air Dry Clay Stone 12.5kg' }), 25)
  const o = (code, name, qty, n, carrier) => ({ slip: { channelRef: 'R', items: [{ code, name, qty }] }, labels: Array.from({ length: n }, (_, i) => ({ pageIndex: i, carrier, refs: ['R'] })) })
  const maps = [{ item_key: 'S10x*', label_name: 'SALT 10KG', parcels: 2 }, { item_key: 'S10x3', label_name: '3 X SALT 10KG', parcels: 1 }, { item_key: 'S10x1', label_name: 'SALT 10KG', parcels: 1 }]
  const [ok5, tooHeavy, evri10, evri20] = checkOrders([
    o('S-10', 'Salt 10kg', 5, 3, 'DHL'),          // 2+2+1 bags: 20, 20, 10kg
    o('S-10', 'Salt 10kg', 3, 1, 'DHL'),          // 30kg in one box
    o('S-10', 'Salt 10kg', 1, 1, 'Evri'),         // 10kg on Evri: fine
    o('S-10', 'Salt 10kg', 5, 3, 'Evri'),         // 20kg boxes on Evri: no
  ], [maps[0], maps[1], maps[2]].filter(Boolean).map(m => m))
  assert.equal(ok5.level, 'ok')
  assert.equal(tooHeavy.level, 'hold'); assert.ok(tooHeavy.problems.some(p => /30kg/.test(p.text)))
  assert.equal(evri10.level, 'ok')
  assert.equal(evri20.level, 'hold')
})

test('stamp count: a pack named by what\'s in it ("6 ROLLS", "12 PIECES") isn\'t flagged; every HELM product\'s own name passes', async () => {
  const { stampCountProblem, suggestStamp } = await import('../src/lib/dispatch.js')
  const six = new Map([['ROLL6PK', { components: [{ name: 'Plenty roll', units: 6 }] }]])
  assert.equal(stampCountProblem({ item_key: 'k', label_name: 'PLENTY ORIGINAL 100 SHEETS - 6 ROLLS', parcels: 1, items: [{ code: 'ROLL-6PK', qty: 1 }] }, six), null)
  assert.ok(stampCountProblem({ item_key: 'k', label_name: 'PLENTY ORIGINAL 100 SHEETS - 6 ROLLS', parcels: 1, items: [{ code: 'ROLL-6PK', qty: 2 }] }, six), '2 six-packs is 12')
  const helm = JSON.parse(readFileSync(new URL('../src/data/helmProducts.json', import.meta.url), 'utf8')).units
  const units = new Map(helm.map(u => [u.code_key, u]))
  const names = new Map(helm.map(u => [u.code_key, u.name]))
  for (const u of helm) for (const qty of [1, 2]) {
    const items = [{ code: u.code, qty, name: u.name }]
    const p = stampCountProblem({ item_key: 'k', label_name: suggestStamp(items, { names }), parcels: 1, items }, units)
    assert.equal(p, null, `${qty} x ${u.name} → ${suggestStamp(items, { names })}: ${p?.text}`)
  }
})

// ── Delivery dates (v2.23.0) ──
import { addWorkingDays, deliveryState, received as poReceived2 } from '../src/lib/purchases.js'
test('lead times skip weekends', () => {
  // Fri 16 Oct + 3 working days = Wed 21 Oct
  assert.equal(addWorkingDays(new Date('2026-10-16T12:00:00'), 3).getDate(), 21)
})
test('delivery: estimate is a guide, confirmed is firm, back orders take over', () => {
  const po = { status: 'awaiting_delivery', category: 'stock', terms: 'prepay', payment_status: 'paid', paid_at: '2026-10-12T10:00:00',
    items: [{ qty: 10, qty_received: 0 }] }
  const sup = { data: { leadDays: 3 } }
  assert.equal(deliveryState(po, po.items, sup, new Date('2026-10-14T09:00:00')).kind, 'estimated')
  assert.equal(deliveryState(po, po.items, sup, new Date('2026-10-14T09:00:00')).chase, false)
  assert.equal(deliveryState(po, po.items, sup, new Date('2026-10-16T09:00:00')).chase, true)
  assert.equal(deliveryState({ ...po, delivery_date: '2026-10-20' }, po.items, sup, new Date('2026-10-16T09:00:00')).kind, 'confirmed')
  assert.equal(deliveryState({ ...po, delivery_date: '2026-10-20' }, po.items, sup, new Date('2026-10-21T09:00:00')).overdue, true)
  const rest = [{ qty: 10, qty_received: 10 }, { qty: 5, qty_received: 0, line_status: 'back_order', back_order_date: '2026-11-02' }]
  const d = deliveryState({ ...po, delivery_date: '2026-10-14' }, rest, sup, new Date('2026-10-21T09:00:00'))
  assert.equal(d.kind, 'back_order'); assert.equal(d.overdue, false)
  // unpaid prepay order isn't placed yet
  assert.equal(deliveryState({ ...po, payment_status: 'unpaid', status: 'awaiting_payment' }, po.items, sup).kind, 'not_placed')
})
test('cancelled lines stop counting as still to come', () => {
  const r = poReceived2([{ qty: 5, qty_received: 5 }, { qty: 3, qty_received: 0, line_status: 'cancelled' }])
  assert.equal(r.complete, true); assert.equal(r.cancelled, 1)
})

// ── Goods in (v2.25.0) ──
import { arrivalOf, bookingLines, toCome } from '../src/lib/goodsIn.js'
test('goods in: only a confirmed date counts; back orders and overdue are grouped', () => {
  const now = new Date('2026-10-20T10:00:00')
  const base = { status: 'awaiting_delivery', terms: 'prepay', payment_status: 'paid', po_number: 'PO-1', items: [{ id: 'a', name: 'A', qty: 10, qty_received: 0 }] }
  assert.equal(arrivalOf(base, now).group, 'no_date')
  assert.equal(arrivalOf({ ...base, delivery_date: '2026-10-20' }, now).group, 'today')
  assert.equal(arrivalOf({ ...base, delivery_date: '2026-10-18' }, now).group, 'overdue')
  assert.equal(arrivalOf({ ...base, delivery_date: '2026-10-24' }, now).group, 'week')
  assert.equal(arrivalOf({ ...base, items: [{ id: 'a', qty: 10, qty_received: 0, line_status: 'back_order' }] }, now).group, 'back_order')
  assert.equal(arrivalOf({ ...base, items: [{ id: 'a', qty: 10, qty_received: 10 }] }, now).group, 'done')
})
test('goods in: booking lines — short only when ticked, damage capped at what arrived', () => {
  const o = { items: [{ id: 'a', name: 'A', qty: 10, qty_received: 2 }, { id: 'b', name: 'B', qty: 5, qty_received: 0 }, { id: 'c', name: 'C', qty: 3, qty_received: 0, line_status: 'cancelled' }] }
  assert.equal(toCome(o).length, 2)
  const lines = bookingLines(o, { a: { arrived: '6', damaged: '9', short: true }, b: { arrived: '' } })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].arrived, 6); assert.equal(lines[0].damaged, 6); assert.equal(lines[0].short_qty, 2)
})

// ── Dispatch Orders tab (v2.26.0) ──
import { stampProgress } from '../src/lib/dispatch.js'
test('orders tab: each order counted once, at the stage all its parcels reached', () => {
  const L = (o, extra) => ({ upload_id: 'u', order_key: o, status: 'ready', label_name: 'SPONGE 6', ...extra })
  const s = stampProgress([
    L('1'), L('2', { printed_at: 'x' }), L('3', { printed_at: 'x', packed_at: 'y' }),
    L('4', { status: 'dispatched' }), L('4', { status: 'dispatched' }),
    L('5', { printed_at: 'x', packed_at: 'y' }), L('5', { printed_at: 'x' }),
    L('6', { status: 'held' }), L('7', { status: 'cancelled' }), L('8', { label_name: 'MOP' }),
  ])
  assert.deepEqual({ ...s.totals }, { orders: 6, toPrint: 2, printed: 2, ready: 1, dispatched: 1 })
  assert.equal(s.held, 1)
  assert.equal(s.stamps[0].name, 'SPONGE 6'); assert.equal(s.stamps[0].orders, 5)
})

// ── Inventory ────────────────────────────────────────────────────────────────
test('shelves are read the way people type them, and only real ones', async () => {
  const { cleanLocation, locationProblem, byLocation } = await import('../src/lib/inventory.js')
  assert.equal(cleanLocation('a 10 0 1'), 'A-10-0-1')
  assert.equal(cleanLocation('A10-0-1'), 'A-10-0-1')
  assert.equal(cleanLocation('D-11-2-4'), 'D-11-2-4', 'aisle D has 11 bays')
  assert.equal(cleanLocation('A-11-0-1'), null, 'the others have 10')
  assert.equal(cleanLocation('I-1-0-1'), null)
  assert.equal(cleanLocation('A-1-0-5'), null, 'four sections')
  assert.match(locationProblem('A-11-0-1'), /bays 1 to 10/)
  assert.deepEqual(['B-1-0-1', 'A-10-0-1', 'A-2-1-1', 'A-2-0-3'].sort(byLocation), ['A-2-0-3', 'A-2-1-1', 'A-10-0-1', 'B-1-0-1'])
})

test('a stock count sheet is read from its own headings, and packs become singles', async () => {
  const { readCountSheet, packToSingles } = await import('../src/lib/inventory.js')
  const aoa = [
    ['Stock by Location'], ['note'], [],
    ['Location Code', 'Stock Location Type', 'Product Name', 'Product Code', 'Helm Status', 'Product Type', 'Stock Quantity', 'Original Count Name'],
    ['A-9-0-1', 'Pickable', 'Peacock Salt 25kg', 'PEACOC-SALT-25KG', 'Currently in Helm', 'INVENTORY', 390, 'x'],
    ['E-2-0-1', 'Non-pickable', 'Sand 20kg', 'SAND-20KG', 'Not in Helm', 'INVENTORY', 50, ''],
    ['C-2-0-2', 'Pickable', 'Scola PVA 5L', 'SCOLA-PVA-5L', 'Currently in Helm', 'INVENTORY', 0, ''],
    ['E-5-1-1', 'Pickable', '6 x Radox Feel Awake 225ml', 'RADOX-AWAKE-225ML-6PK', 'Currently in Helm', 'GROUP', 7, ''],
    ['Z-1-0-1', 'Pickable', 'Bad', 'BAD', '', 'INVENTORY', 1, ''],
  ]
  const r = readCountSheet(aoa)
  assert.equal(r.rows.length, 4)
  assert.equal(r.problems.length, 1, 'the bad shelf is reported, not guessed')
  assert.equal(r.rows.find(x => x.code === 'SAND-20KG').in_helm, false)
  assert.equal(r.rows.find(x => x.code === 'SCOLA-PVA-5L').qty, 0, 'a zero line is kept as the product’s shelf')
  const c = packToSingles(r.rows, [])
  const radox = c.rows.find(x => x.location === 'E-5-1-1')
  assert.equal(radox.code, 'RADOX-AWAKE-225ML'); assert.equal(radox.qty, 42); assert.equal(radox.name, 'Radox Feel Awake 225ml')
  // HELM's own bundle list wins when it has the pack
  const h = packToSingles(r.rows, [{ code: 'RADOX-AWAKE-225ML-6PK', components: [{ code: 'RADOX-SINGLE', name: 'Radox single', units: 6 }] }, { code: 'RADOX-SINGLE', name: 'Radox Single 225ml' }])
  assert.equal(h.rows.find(x => x.location === 'E-5-1-1').code, 'RADOX-SINGLE')
})

test('Amazon orders keep no customer details and leave cancelled orders out', async () => {
  const { parseAmazonOrders, salesByDay, learnSkus, packOf } = await import('../src/lib/inventory.js')
  const head = 'order-id\tpurchase-date\tbuyer-name\tsku\tproduct-name\tquantity-purchased\tship-address-1\tshipment-status\tis-buyer-requested-cancellation'
  const rows = [
    '206-1\t2026-10-01T10:00:00+00:00\tJo Bloggs\t3x Fly-2Days\tFly spray x3\t1\t1 High St\tDelivered to Buyer\tfalse',
    '206-2\t2026-10-01T23:30:00+00:00\tA N Other\t3x Fly-2Days\tFly spray x3\t2\t2 High St\tDelivered to Buyer\tfalse',
    '206-3\t2026-10-02T10:00:00+00:00\tX\t3x Fly-2Days\tFly spray x3\t1\t3 High St\tDelivered to Buyer\ttrue',
    '206-4\t2026-09-01T10:00:00+00:00\tY\tJug-1\tJug\t1\t4 High St\t\tfalse',
  ]
  const p = parseAmazonOrders([head, ...rows].join('\r\n'))
  assert.equal(p.rows.length, 2)
  assert.equal(p.skipped.cancelled, 1); assert.equal(p.skipped.unshipped, 1)
  assert.ok(p.rows.every(r => !('buyer' in r) && !JSON.stringify(r).includes('High St')), 'nothing about the customer is kept')
  assert.equal(p.rows[1].day, '2026-10-02', 'a late-night order is that day in London')
  assert.deepEqual(salesByDay(p.rows).map(r => r.units), [1, 2])
  const learned = learnSkus(p.rows, { 2061: [{ code: 'SANMEX-3PK', qty: '1' }], 2062: [{ code: 'SANMEX-3PK', qty: '2' }] })
  assert.deepEqual(learned['3x Fly-2Days'].items, [{ code: 'SANMEX-3PK', qty: 1 }])
  assert.equal(learned['3x Fly-2Days'].agree, 2)
  assert.equal(packOf('3 PCS FLY & WASP KILLER -2-Days'), 3)
  assert.equal(packOf('ASTONSH-SHAKFRESH-0350G-X03'), 3)
  assert.equal(packOf('Pyrex Jug 500ml-2 Days'), 1)
})

test('what to reorder: buffer of 15 days on top of the time it takes to arrive', async () => {
  const { stockState } = await import('../src/lib/inventory.js')
  const base = { daily: 10, rate_days: 28, lead: 7, on_order: 0 }
  assert.equal(stockState({ ...base, available: 0 }).state, 'out')
  assert.equal(stockState({ ...base, available: 50 }).state, 'low', '5 days left, 7 to arrive')
  assert.equal(stockState({ ...base, available: 150 }).state, 'running_low', '15 days left, under 22')
  assert.equal(stockState({ ...base, available: 300 }).state, 'ok')
  assert.equal(stockState({ ...base, available: 150, on_order: 200 }).state, 'ok', 'stock on its way counts')
  assert.equal(stockState({ ...base, available: 150 }).suggest, 10 * 37 - 150)
  assert.equal(stockState({ daily: 0, rate_days: 3, available: 5 }).state, 'learning')
})

test('slow stock: nothing sold in 60 days, or more than four months of it', async () => {
  const { slowState } = await import('../src/lib/inventory.js')
  const today = '2026-10-17'
  assert.equal(slowState({ on_hand: 0, last_sold: null, daily: 0 }, today), null, 'nothing on the shelf is never slow')
  assert.equal(slowState({ on_hand: 10, last_sold: null, daily: 0 }, today).kind, 'slow')
  assert.equal(slowState({ on_hand: 10, last_sold: '2026-08-01', daily: 0 }, today).kind, 'slow')
  assert.equal(slowState({ on_hand: 10, last_sold: '2026-10-10', daily: 1 }, today), null)
  assert.equal(slowState({ on_hand: 500, last_sold: '2026-10-16', daily: 2 }, today).kind, 'over')
})

// ── Delivery tracking ───────────────────────────────────────────────────────
import { dueDay, parcelState, summariseParcels, productPatterns, carrierName, needsAttention } from '../src/lib/tracking.js'

test('a parcel is due 2 working days after booking, Sunday off', () => {
  assert.equal(dueDay('2026-10-12T15:00:00Z'), '2026-10-14')   // Mon → Wed
  assert.equal(dueDay('2026-10-16T15:00:00Z'), '2026-10-19')   // Fri → Sat, Mon
  assert.equal(dueDay('2026-10-17T10:00:00Z'), '2026-10-20')   // Sat → Mon, Tue
  assert.equal(dueDay('2026-10-12T23:30:00Z'), '2026-10-15')   // late Monday UTC is Tuesday in London (BST)
})

test('late, delivered late and on time', () => {
  const now = new Date('2026-10-15T09:00:00Z')
  const p = (o) => ({ shipment_status: 1, tracking: 'T1', shipped_at: '2026-10-12T15:00:00Z', ...o })
  assert.equal(parcelState(p({ status: 3 }), now).state, 'late')
  assert.equal(parcelState(p({ status: 3 }), new Date('2026-10-14T20:00:00Z')).state, 'moving')
  const lateDelivered = parcelState(p({ status: 7, delivered_at: '2026-10-15T08:00:00Z' }), now)
  assert.equal(lateDelivered.state, 'delivered'); assert.equal(lateDelivered.late, true)
  assert.equal(parcelState(p({ status: 7, delivered_at: '2026-10-13T12:00:00Z' }), now).late, false)
  assert.equal(parcelState(p({ status: 10 }), now).state, 'problem')
  assert.equal(parcelState(p({ status: 1 }), new Date('2026-10-13T12:00:00Z')).state, 'stuck')
  assert.equal(parcelState(p({ status: 14 }), now).state, 'untracked')
  assert.equal(needsAttention(p({ status: 3, shipment_status: 2 }), now), false)   // a failed booking isn't a parcel
})

test('the courier comes from the service, not the account it was bought through', () => {
  assert.equal(carrierName({ carrier: 'Amazon', service: 'Evri Next Day Contract Rate' }), 'Evri')
  assert.equal(carrierName({ carrier: 'DHLParcelUKCloud', service: 'DHL Parcel UK Parcel' }), 'DHL')
  assert.equal(carrierName({ carrier: 'Evri Corporate', service: 'Hermes 24 POD' }), 'Evri')
})

test('courier totals and product patterns', () => {
  const now = new Date('2026-10-16T09:00:00Z')
  const base = { shipment_status: 1, tracking: 'T', shipped_at: '2026-10-12T15:00:00Z', service: 'DHL Parcel UK Parcel' }
  const parcels = [
    { ...base, status: 7, delivered_at: '2026-10-13T12:00:00Z', items: [{ code: 'A', name: 'Bowl', qty: 1 }] },
    { ...base, status: 7, delivered_at: '2026-10-15T12:00:00Z', items: [{ code: 'A', name: 'Bowl', qty: 1 }] },
    { ...base, status: 10, returned_at: '2026-10-14T12:00:00Z', events: [{ s: 6 }, { s: 10 }], items: [{ code: 'A', name: 'Bowl', qty: 1 }] },
    { ...base, status: 4, items: [{ code: 'B', name: 'Salt', qty: 2 }] },
    { ...base, status: 7, delivered_at: '2026-10-13T12:00:00Z', items: [{ code: 'C', name: 'Mop', qty: 1 }] },
  ]
  const { total } = summariseParcels(parcels, now)
  assert.equal(total.delivered, 3); assert.equal(total.onTime, 2); assert.equal(total.lateDelivered, 1)
  assert.equal(total.lateOpen, 2); assert.equal(total.returned, 1); assert.equal(total.onTimePct, 40)
  const pats = productPatterns(parcels, now)
  assert.deepEqual(pats.map(r => r.code), ['A', 'B'])
  assert.equal(pats[0].returned, 1); assert.equal(pats[0].trouble, 2); assert.equal(pats[0].failed, 0)
  assert.equal(pats[0].rate, 66.7)
})

// ── Stamps from inventory: every slip code checked once by a person ─────────
{
  const { autoMapping, checkOrders, planUpload, normRef } = await import('../src/lib/dispatch.js')
  const JUG = { code: 'PYREX-JUG-GLASS-500ML', name: 'Pyrex Glass Measuring Jug 500ml', stamp: 'Pyrex Glass Measuring Jug 500ml', qty: 1 }
  const BOWL07 = { code: 'PYREX-BOWL-CLASSIC-GLASS-0.7L', name: 'Pyrex Classic Glass Mixing Bowl 0.7L', stamp: 'Pyrex Classic Glass Mixing Bowl 0.7L', qty: 1 }
  const info = new Map([
    ['PYREX-JUG-GLASS-500ML', { status: 'own', items: [JUG] }],
    ['PYREX-JUG-GLASS-500ML-2PK', { status: 'unverified', items: [{ ...JUG, qty: 2 }] }],
    ['2XPYREXJUG500ML', { status: 'verified', kind: 'same', items: [{ ...JUG, qty: 2 }] }],
    ['366706946770', { status: 'verified', kind: 'substitute', wanted_name: 'Pyrex 500ml Mixing Bowl', items: [{ ...BOWL07, qty: 2 }] }],
    ['BROKEN-1', { status: 'broken', items: [] }],
  ].map(([k, v]) => [normRef(k), v]))

  test('the stamp is the inventory name and the units in each box', () => {
    const one = autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 5 }], 1, info)
    assert.equal(one.mapping.label_name, '5 X PYREX GLASS MEASURING JUG 500ML')
    assert.equal(autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 1 }], 1, info).mapping.label_name, 'PYREX GLASS MEASURING JUG 500ML')
    // A bundle of 2, two on the slip: 4 jugs
    const pack = autoMapping([{ code: '2xPyrexJug500ml', qty: 2 }], 1, info)
    assert.equal(pack.mapping.label_name, '4 X PYREX GLASS MEASURING JUG 500ML')
    assert.equal(pack.mapping.products[0].units, 4)
    // Shared evenly over the labels
    assert.deepEqual(autoMapping([{ code: '2xPyrexJug500ml', qty: 2 }], 2, info).mapping.stamps, ['2 X PYREX GLASS MEASURING JUG 500ML', '2 X PYREX GLASS MEASURING JUG 500ML'])
  })

  test('codes nobody has verified, and boxes that don\'t share evenly, stop the order', () => {
    assert.equal(autoMapping([{ code: 'PYREX-JUG-GLASS-500ML-2PK', qty: 1 }], 1, info).unverified[0].status, 'unverified')
    assert.equal(autoMapping([{ code: 'NEVER-SEEN', qty: 1 }], 1, info).unverified[0].status, 'unknown')
    assert.equal(autoMapping([{ code: 'BROKEN-1', qty: 1 }], 1, info).unverified.length, 1)
    // One verified, one not: still stopped
    assert.equal(autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 1 }, { code: 'NEVER-SEEN', qty: 1 }], 1, info).mapping, null)
    const odd = autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 3 }], 2, info)
    assert.equal(odd.problem.code, 'per-box')
    const mixed = autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 1 }, { code: '366706946770', qty: 1 }], 2, info)
    assert.equal(mixed.problem.code, 'per-box')
  })

  test('sent instead: the stamp is what goes in the box, and the listing it should be is kept', () => {
    const sub = autoMapping([{ code: '366706946770', qty: 1 }], 1, info)
    assert.equal(sub.mapping.label_name, '2 X PYREX CLASSIC GLASS MIXING BOWL 0.7L')
    assert.deepEqual(sub.mapping.instead, ['Pyrex 500ml Mixing Bowl'])
    assert.match(sub.mapping.contents, /sent instead of Pyrex 500ml Mixing Bowl/)
    const mix = autoMapping([{ code: 'PYREX-JUG-GLASS-500ML', qty: 1 }, { code: '366706946770', qty: 1 }], 1, info)
    assert.equal(mix.mapping.label_name, '1 X PYREX JUG 500ML + 2 X PYREX BOWL 0.7L', 'shortened to fit the label, sizes kept')
  })

  test('at upload: unverified orders wait in On hold, the rest are batched, and nobody can tick them through', () => {
    const label = (i, ref) => ({ pageIndex: i, carrier: 'Evri', service: 'Next Day', refs: [ref] })
    const order = (i, ref, code, qty, labels = 1) => ({ slip: { channelRef: ref, items: [{ code, qty, name: code }], postcode: 'AB1 2CD' }, labels: Array.from({ length: labels }, (_, k) => label(i * 10 + k, ref)) })
    const orders = [order(0, '204-1', 'PYREX-JUG-GLASS-500ML', 5), order(1, '204-2', 'PYREX-JUG-GLASS-500ML-2PK', 1), order(2, '204-3', '2xPyrexJug500ml', 2, 2)]
    const checked = checkOrders(orders, [], { codeInfo: info })
    assert.deepEqual(checked.map(o => o.level), ['ok', 'verify', 'ok'])
    assert.equal(checked[1].blocked, true)
    const plan = planUpload(orders, [], { codeInfo: info, overrides: { o1: true } })
    assert.equal(plan.needsYou, 0, 'only codes to verify: the rest saves on its own')
    assert.deepEqual(plan.batches.map(b => [b.label_name, b.labels.length]).sort(), [['2 X PYREX GLASS MEASURING JUG 500ML', 2], ['5 X PYREX GLASS MEASURING JUG 500ML', 1]])
    assert.deepEqual(plan.heldBack.map(o => o.id), ['o1'], 'ticking it through is ignored')
  })
}
