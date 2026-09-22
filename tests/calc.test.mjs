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
