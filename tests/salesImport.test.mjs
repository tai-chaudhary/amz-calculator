import test from 'node:test'
import assert from 'node:assert/strict'
import { readSalesReport, ebayTransactionsToLines, tiktokIncomeToLines, parseEbayDate, sheetRows } from '../src/lib/salesImport.js'

const EH = ['Transaction creation date', 'Type', 'Order number', 'Buyer name', 'Net amount', 'Item ID', 'Transaction ID', 'Item title', 'Custom label', 'Quantity', 'Item subtotal', 'Postage and packaging',
  'Final value fee – fixed', 'Final value fee – variable', 'Regulatory operating fee', 'Gross transaction amount', 'Reference ID', 'Description']
const E = (o) => EH.map(h => o[h] ?? '--')
const ebay = [
  ['Notes'], ['All fee amounts shown include taxes.'], EH,
  E({ 'Transaction creation date': '14 Nov 2026', Type: 'Order', 'Order number': '17-1', 'Buyer name': 'A Person', 'Net amount': '7.49', 'Item ID': '366806038370', 'Transaction ID': 't1', 'Item title': 'Razor', 'Custom label': 'GIL-1', Quantity: '1', 'Item subtotal': '8.95', 'Postage and packaging': '0', 'Final value fee – fixed': '-0.36', 'Final value fee – variable': '-1.06', 'Regulatory operating fee': '-0.04', 'Gross transaction amount': '8.95' }),
  E({ 'Transaction creation date': '14 Nov 2026', Type: 'Other fee', 'Order number': '17-1', 'Net amount': '-1.32', 'Item ID': '366806038370', 'Gross transaction amount': '-1.32', 'Reference ID': 'FEE-1', Description: 'Promoted Listings - General fee' }),
  E({ 'Transaction creation date': '30 Sept 2026', Type: 'Payout', 'Net amount': '-44.21', 'Gross transaction amount': '-44.21', 'Reference ID': 'Bank ref' }),
  E({ 'Transaction creation date': '5 Nov 2026', Type: 'Refund', 'Order number': '21-1', 'Net amount': '-14.11', 'Custom label': 'Whitesalt', 'Final value fee – fixed': '0.48', 'Final value fee – variable': '2.29', 'Regulatory operating fee': '0.07', 'Gross transaction amount': '-16.95', 'Reference ID': 'Refund 1' }),
  // an order with two items: a summary row (no item) then one row per item
  E({ 'Transaction creation date': '1 Sep 2026', Type: 'Order', 'Order number': '21-2', 'Net amount': '30.48', 'Gross transaction amount': '36.8' }),
  E({ 'Transaction creation date': '1 Sep 2026', Type: 'Order', 'Order number': '21-2', 'Item ID': '111', 'Transaction ID': 't2', Quantity: '1', 'Item subtotal': '17.85', 'Postage and packaging': '0', 'Final value fee – fixed': '-0.48', 'Final value fee – variable': '-2.76', 'Regulatory operating fee': '-0.07' }),
  E({ 'Transaction creation date': '1 Sep 2026', Type: 'Order', 'Order number': '21-2', 'Item ID': '222', 'Transaction ID': 't3', Quantity: '1', 'Item subtotal': '18.95', 'Postage and packaging': '0', 'Final value fee – variable': '-2.93', 'Regulatory operating fee': '-0.08' }),
]

test('eBay dates', () => {
  assert.equal(parseEbayDate('14 Nov 2026'), '2026-11-14')
  assert.equal(parseEbayDate('30 Sept 2026'), '2026-09-30')
  assert.equal(parseEbayDate('--'), null)
})

test('eBay report: sales, fees, charges, payouts and refunds', () => {
  const { lines } = ebayTransactionsToLines(ebay)
  const sale = lines.find(l => l.order_ref === '17-1' && l.kind === 'sale')
  assert.deepEqual([sale.product_sales, sale.selling_fees, sale.total, sale.listing_sku, sale.item_code], [8.95, -1.46, 7.49, 'GIL-1', '366806038370'])
  const promo = lines.find(l => l.kind === 'charge')
  assert.deepEqual([promo.order_ref, promo.other_fees, promo.total], ['17-1', -1.32, -1.32])
  assert.match(promo.description, /Promoted Listings/)
  assert.equal(lines.find(l => l.kind === 'transfer').total, -44.21)
  const refund = lines.find(l => l.kind === 'refund')
  assert.deepEqual([refund.product_sales, refund.selling_fees, refund.total], [-16.95, 2.84, -14.11])
  // the summary row of a two-item order is left out, so nothing is counted twice
  const two = lines.filter(l => l.order_ref === '21-2')
  assert.equal(two.length, 2)
  assert.equal(+two.reduce((s, l) => s + l.total, 0).toFixed(2), 30.48)
  assert.equal(two[0].listing_sku, '111')        // no custom label → the item number
  // no buyer details anywhere
  assert.ok(!JSON.stringify(lines).includes('A Person'))
  // the same file twice gives the same keys
  assert.deepEqual(ebayTransactionsToLines(ebay).lines.map(l => l.source_key), lines.map(l => l.source_key))
  assert.equal(new Set(lines.map(l => l.source_key)).size, lines.length)
})

const TH = ['Statement date', 'Type', 'Order/adjustment ID', 'SKU ID', 'Quantity', 'Product name', 'SKU name', 'Order created date', 'Total settlement amount', 'Net sales', 'Shipping', 'Fees', 'Adjustment amount', 'Adjustment reason', 'Related order ID  ']
const tiktok = [TH,
  ['2026/11/13', 'Order', '5769', '1729', '1', 'Clay', 'Stone', '2026/10/11', '10.25', '7.95', '4.95', '-2.65', '0', '/', '5769'],
  ['2026/11/04', 'Bill deduction for negative balance', '3469', '', '', '', '', '', '-2.6', '0', '0', '0', '-2.6', 'x', ''],
]
test('TikTok income report', () => {
  const { lines } = tiktokIncomeToLines(tiktok)
  assert.equal(lines.length, 2)
  assert.deepEqual([lines[0].kind, lines[0].sale_date, lines[0].product_sales, lines[0].shipping, lines[0].selling_fees, lines[0].total, lines[0].order_ref], ['sale', '2026-10-11', 7.95, 4.95, -2.65, 10.25, '5769'])
  assert.equal(lines[1].kind, 'transfer')
})

test('the right reader is picked from what is in the file', () => {
  assert.equal(readSalesReport([{ name: 'a', rows: ebay }]).source, 'ebay_report')
  assert.equal(readSalesReport([{ name: 'Statements', rows: [['x']] }, { name: 'Order details', rows: tiktok }]).source, 'tiktok_report')
  assert.throws(() => readSalesReport([{ name: 'a', rows: [['Order ID', 'SKU Subtotal After Discount']] }]), /order list/)
  assert.throws(() => readSalesReport([{ name: 'a', rows: [['nothing']] }]), /isn’t a report/)
})

test('a sheet that under-states its own size is still read in full', () => {
  const ws = { '!ref': 'A1:B2', A1: { v: 'a' }, B1: { v: 'b' }, A2: { v: 1 }, A5: { v: 5 }, C5: { v: 'end' } }
  const utils = {
    decode_cell: (k) => ({ c: k.charCodeAt(0) - 65, r: +k.slice(1) - 1 }),
    encode_range: (r) => `A1:${String.fromCharCode(65 + r.e.c)}${r.e.r + 1}`,
    sheet_to_json: (_ws, o) => o.range,
  }
  assert.equal(sheetRows(ws, utils), 'A1:C5')
  assert.deepEqual(sheetRows({}, utils), [])
})
