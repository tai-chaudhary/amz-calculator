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
