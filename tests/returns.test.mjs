import test from 'node:test'
import assert from 'node:assert/strict'
import { readReturnsReport, parseReturnsXml, toIso } from '../src/lib/returnsReport.js'
import { classifyCode, amazonState, buildTodo, summarise, statusFromItems, safetEligible, causeOf, returnsByDay } from '../src/lib/returnsLogic.js'

// Made-up requests in Amazon's own shapes (no real customers; the report has no customer details anyway)
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope><Header><DocumentVersion>1.00</DocumentVersion></Header><MessageType>Returns-Report</MessageType><Message>
<return_details>
    <item_details>
        <item_name>3 PCS FLY &amp; WASP KILLER 300ML</item_name><asin>B07RQDY83Y</asin><return_reason_code>CR-DAMAGED_BY_CARRIER</return_reason_code>
        <merchant_sku>3 PCS FLY &amp; WASP KILLER -2-Days</merchant_sku><in_policy>Y</in_policy><return_quantity>1</return_quantity>
        <resolution>StandardRefund</resolution><category>BISS</category><refund_amount>0.0</refund_amount><order_item_id>069385</order_item_id>
    </item_details>
    <order_id>206-1111111-0000001</order_id><order_date>2026-09-16T01:19:12Z</order_date><amazon_rma_id>D9Zfw3rvRRMA</amazon_rma_id>
    <return_request_date>2026-09-17T19:36:10Z</return_request_date><return_request_status>Approved</return_request_status>
    <a_to_z_claim>false</a_to_z_claim><is_prime>N</is_prime>
    <label_details><label_cost>0.0</label_cost><label_type>AmazonUnPaidLabel</label_type></label_details>
    <label_to_be_paid_by>Seller</label_to_be_paid_by><return_type>C-Returns</return_type><order_amount>6.45</order_amount><order_quantity>1</order_quantity>
</return_details>
<return_details>
    <item_details>
        <item_name>Scola Readymix 6 Colours</item_name><asin>B003LVYN6M</asin><return_reason_code>CR-DAMAGED_BY_CARRIER</return_reason_code>
        <merchant_sku>6x Scola Art Mix-Next-Day</merchant_sku><in_policy>Y</in_policy><return_quantity>1</return_quantity>
        <resolution>RefundAtFirstScan</resolution><category>Home Improvement</category><refund_amount>15.94</refund_amount><order_item_id>606300</order_item_id>
    </item_details>
    <order_id>203-2222222-0000002</order_id><order_date>2026-09-11T08:09:19Z</order_date><amazon_rma_id>DSJ8wbrhRRMA</amazon_rma_id>
    <return_request_date>2026-09-15T18:20:56Z</return_request_date><return_request_status>Approved</return_request_status>
    <a_to_z_claim>false</a_to_z_claim><is_prime>N</is_prime>
    <label_details><tracking_id>T00WLA4732448497</tracking_id><return_carrier>HERMES_UK</return_carrier><currency_code>GBP</currency_code><label_cost>2.73</label_cost><label_type>AmazonPrePaidLabel</label_type></label_details>
    <label_to_be_paid_by>Seller</label_to_be_paid_by><return_delivery_date>2026-09-21T16:20:00Z</return_delivery_date><return_type>C-Returns</return_type>
    <order_amount>15.94</order_amount><order_quantity>1</order_quantity>
    <safet_claim_details><safet_action_reason>SELLER_APPEAL</safet_action_reason><safet_claim_id>38325-06185-9662247</safet_claim_id><safet_claim_state>PENDING_ACTION</safet_claim_state><safet_claim_creation_time>2026-10-15T14:00:49Z</safet_claim_creation_time></safet_claim_details>
</return_details>
</Message></AmazonEnvelope>`

const TSV = ['Order ID\tOrder date\tReturn request date\tReturn request status\tAmazon RMA ID\tMerchant RMA ID\tLabel type\tLabel cost\tCurrency code\tReturn carrier\tTracking ID\tLabel to be paid by\tA-to-Z Claim\tIs prime\tASIN\tMerchant SKU\tItem name\tReturn quantity\tReturn Reason\tIn policy\tReturn type\tResolution\tInvoice number\tReturn delivery date\tOrder amount\tOrder quantity\tSafeT action reason\tSafeT claim ID\tSafeT claim state\tSafeT claim creation time\tSafeT claim reimbursement amount\tRefunded amount\tCategory\tVAT\tOrder Item ID',
  '203-3333333-0000003\t13-Oct-2026\t13-Nov-2026\tApproved\tDGTNsWrZRRMA\t \tAmazonPrePaidLabel\t2.73\tGBP\tHERMES_UK\tT00WLA4739542519\tSeller\tN\tN\tB07BGWZ7MV\t5 Litre PVA Glue-Next Day\tScola PVA Glue 5L\t2\tCR-SWITCHEROO\tY\tC-Returns\tStandardRefund\t \t \t34.70\t2\t \t \t \t \t \t \tBISS\t \t29751058352499',
  '204-4444444-0000004\t07-Sep-2026\t14-Sep-2026\tApproved\tDN5XBsrwRRMA\t \tAmazonPrePaidLabel\t2.73\tGBP\tHERMES_UK\tT00WLA4732323265\tCustomer\tN\tN\tB00J5LDA2K\t5-Litre PVA Glue-2 Days\tScola Washable Glue 5L\t1\tCR-QUALITY_UNACCEPTABLE\tY\tC-Returns\tRefundAtFirstScan\t \t02-Oct-2026\t31.50\t2\tSEND_EMAIL\t25024-42047-4184811\tGRANT\t15-Oct-2026\t21.24\t13.02\tgl_biss\t \t28769080978243',
].join('\n')

test('XML report: every field read, entities unescaped, 0.0 refund means not refunded', () => {
  const r = readReturnsReport(XML, 'report.xml')
  assert.equal(r.format, 'XML')
  assert.equal(r.rows.length, 2)
  assert.equal(r.from, '2026-09-15'); assert.equal(r.to, '2026-09-17')
  const [a, b] = r.rows
  assert.equal(a.rma, 'D9Zfw3rvRRMA'); assert.equal(a.order_ref, '206-1111111-0000001')
  assert.equal(a.sku, '3 PCS FLY & WASP KILLER -2-Days'); assert.equal(a.item_name, '3 PCS FLY & WASP KILLER 300ML')
  assert.equal(a.qty, 1); assert.equal(a.label_type, 'AmazonUnPaidLabel'); assert.equal(a.tracking, undefined)
  assert.equal(a.refund_amount, undefined); assert.equal(a.in_policy, true); assert.equal(a.a_to_z, false); assert.equal(a.prime, false)
  assert.equal(a.request_date, '2026-09-17T19:36:10.000Z')
  assert.equal(b.tracking, 'T00WLA4732448497'); assert.equal(b.carrier, 'HERMES_UK'); assert.equal(b.label_cost, 2.73)
  assert.equal(b.refund_amount, 15.94); assert.equal(b.delivered_at, '2026-09-21T16:20:00.000Z')
  assert.equal(b.safet_claim_id, '38325-06185-9662247'); assert.equal(b.safet_state, 'PENDING_ACTION'); assert.equal(b.safet_reason, 'SELLER_APPEAL')
})

test('TSV report: same fields as the XML; dates at midday so they never slip a day; blanks dropped', () => {
  const r = readReturnsReport(TSV, 'report.tsv')
  assert.equal(r.format, 'Text (TSV)')
  assert.equal(r.rows.length, 2)
  const [a, b] = r.rows
  assert.equal(a.rma, 'DGTNsWrZRRMA'); assert.equal(a.qty, 2); assert.equal(a.order_amount, 34.7); assert.equal(a.reason_code, 'CR-SWITCHEROO')
  assert.equal(a.request_date.slice(0, 10), '2026-11-13'); assert.equal(a.delivered_at, undefined); assert.equal(a.safet_claim_id, undefined)
  assert.equal(b.delivered_at.slice(0, 10), '2026-10-02'); assert.equal(b.safet_amount, 21.24); assert.equal(b.refund_amount, 13.02); assert.equal(b.label_paid_by, 'Customer')
  assert.equal(toIso('02-Oct-2026'), '2026-10-02T12:00:00.000Z')
})

test('report: wrong files are refused in plain English; the same RMA twice keeps the later line', () => {
  assert.throws(() => readReturnsReport('Order ID\tSKU\n1\t2', 'sales.csv'), /isn't Amazon's returns report/)
  assert.throws(() => readReturnsReport('<?xml version="1.0"?><AmazonEnvelope></AmazonEnvelope>', 'x.xml'), /no returns in it/)
  const twice = XML.replace('DSJ8wbrhRRMA', 'D9Zfw3rvRRMA')
  const r = readReturnsReport(twice)
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].order_ref, '203-2222222-0000002')
  assert.equal(parseReturnsXml('<return_details><order_id>1</order_id></return_details>').length, 1)
})

test('scan: what was scanned, and the warnings', () => {
  assert.deepEqual(classifyCode('T00WLA4732448497'), { kind: 'evri', value: 'T00WLA4732448497', label: 'Evri tracking', warn: null })
  assert.match(classifyCode('T00WLA738557141').warn, /16 characters/)                 // the real typo found on 19 Nov
  assert.equal(classifyCode('H01FFA0002722586').kind, 'evri_barcode')
  // Evri shop labels (20 Nov): every shape the warehouse has logged, no warning — it's a real label, matched by contents
  for (const h of ['H-01FF-A-000275092-7', 'H01FFA0002917856', 'H04FUA00038250812']) { const c = classifyCode(h); assert.equal(c.kind, 'evri_barcode'); assert.equal(c.warn, null) }
  assert.equal(classifyCode('H-01FF-A-000275092-7').value, 'H01FFA0002750927')
  assert.equal(classifyCode(' oy495852333gb ').kind, 'royal_mail')
  assert.equal(classifyCode('oy495852333gb').value, 'OY495852333GB')
  assert.equal(classifyCode('DN7F2frvRRMA').kind, 'rma'); assert.equal(classifyCode('DN7F2frvRRMA').value, 'DN7F2frvRRMA')
  assert.equal(classifyCode('206-8116374-4975509').kind, 'amazon_order')
  assert.equal(classifyCode('921054519').kind, 'dhl')
  // a 2D Royal Mail code carries more than the number: the tracking inside is picked out
  assert.equal(classifyCode('JGB 62000 OY495852333GB 01 0001').value, 'OY495852333GB')
  assert.match(classifyCode('ABC12').warn, /too short/)
  assert.equal(classifyCode('').kind, 'empty')
})

test('Amazon request states: overdue after 14 days, self-post not coming after 21, delivered but not logged', () => {
  const today = '2026-11-19'
  assert.equal(amazonState({ request_date: '2026-11-10', self_post: false }, today), 'on_way')
  assert.equal(amazonState({ request_date: '2026-11-01', self_post: false }, today), 'overdue')
  assert.equal(amazonState({ request_date: '2026-11-10', self_post: true }, today), 'may_come')
  assert.equal(amazonState({ request_date: '2026-10-25', self_post: true }, today), 'not_coming')
  assert.equal(amazonState({ request_date: '2026-11-01', delivered_at: '2026-11-05T10:00:00Z' }, today), 'delivered')
  assert.equal(amazonState({ request_date: '2026-10-01', delivered_at: '2026-10-05T10:00:00Z' }, today), 'before')
  assert.equal(amazonState({ request_date: '2026-09-20', self_post: false }, today), 'before')
  assert.equal(amazonState({ request_date: '2026-11-01', return_id: 'x' }, today), 'logged')
})

test('item outcomes → status; SAFE-T only for Amazon returns with something not resaleable (or switcheroo)', () => {
  assert.equal(statusFromItems([{ outcome: 'back_in_stock' }]), 'restocked')
  assert.equal(statusFromItems([{ outcome: 'disposed' }, { outcome: 'wrong_item' }]), 'written_off')
  assert.equal(statusFromItems([{ outcome: 'back_in_stock' }, { outcome: 'empty' }]), 'processed')
  assert.equal(safetEligible({ rma: 'D1', items: [{ outcome: 'back_in_stock' }] }, null), false)
  assert.equal(safetEligible({ rma: 'D1', items: [{ outcome: 'disposed' }] }, null), true)
  assert.equal(safetEligible({ rma: 'D1', items: [{ outcome: 'back_in_stock' }] }, { reason_code: 'CR-SWITCHEROO' }), true)
  assert.equal(safetEligible({ items: [{ outcome: 'disposed' }] }, null), false)       // no Amazon return, no SAFE-T
  assert.equal(causeOf('damaged_packing'), 'packing'); assert.equal(causeOf('bad_description'), 'listing'); assert.equal(causeOf('xyz'), 'unknown')
})

test("the office's list: SAFE-T first with its deadline, then pending action, not logged, overdue, unmatched", () => {
  const today = '2026-11-19'
  const returns = [
    { id: 'r1', ref: 'RT-0050', status: 'written_off', rma: 'DA', order_ref: '206-0000000-0000001', received_at: '2026-11-15T10:00:00Z', items: [{ outcome: 'disposed', qty: 1 }], source: 'customer' },
    { id: 'r2', ref: 'RT-0051', status: 'restocked', needs_match: true, received_at: '2026-11-18T10:00:00Z', items: [{ outcome: 'back_in_stock', qty: 1 }] },
    { id: 'r3', ref: 'RT-0052', status: 'written_off', rma: 'DB', received_at: '2026-11-18T10:00:00Z', items: [{ outcome: 'disposed', qty: 1 }] },
  ]
  const amazon = [
    { rma: 'DA', order_ref: '206-0000000-0000001', reason: 'damaged', request_date: '2026-11-10T00:00:00Z', return_id: 'r1' },
    { rma: 'DC', order_ref: '206-0000000-0000003', request_date: '2026-11-01T00:00:00Z', delivered_at: '2026-11-06T10:00:00Z', item_name: 'Jug' },
    { rma: 'DD', order_ref: '206-0000000-0000004', request_date: '2026-11-01T00:00:00Z', carrier: 'HERMES_UK', tracking: 'T00W1' },
    { rma: 'DE', order_ref: '206-0000000-0000005', request_date: '2026-09-01T00:00:00Z', safet_state: 'PENDING_ACTION', safet_claim_id: '1-2-3' },
  ]
  const claims = [{ kind: 'safet', return_id: 'r3' }]
  const list = buildTodo({ returns, amazon, claims, today })
  assert.deepEqual(list.map(x => x.kind), ['safet', 'safet_action', 'not_logged', 'overdue', 'match'])
  assert.equal(list[0].due, 26); assert.match(list[0].sub, /26 days left/)
  assert.ok(!list.some(x => x.ref === 'r3'))                                            // already has a SAFE-T claim
})

test('dashboard figures: requests, arrivals, outcomes, causes, return rate against units sold', () => {
  const today = '2026-11-19'
  const amazon = [
    { rma: 'A', request_date: '2026-11-10T10:00:00Z', qty: 1, reason: 'damaged_packing', refund_amount: 10, order_amount: 12, label_paid_by: 'Seller', label_cost: 2.73, items: [{ product_id: 'p1', name: 'Jug', qty: 1 }] },
    { rma: 'B', request_date: '2026-11-12T10:00:00Z', qty: 2, reason: 'changed_mind', self_post: true, order_amount: 20, label_paid_by: 'Customer', label_cost: 0, items: [{ product_id: 'p1', name: 'Jug', qty: 2 }] },
    { rma: 'C', request_date: '2026-10-01T10:00:00Z', qty: 1, reason: 'faulty', items: [{ product_id: 'p2', qty: 1 }] },
  ]
  const returns = [
    { id: 'r', status: 'restocked', received_at: '2026-11-14T10:00:00Z', rma: 'A', match_how: 'rma', items: [{ product_id: 'p1', qty: 1, outcome: 'back_in_stock' }] },
    { id: 's', status: 'written_off', received_at: '2026-11-15T10:00:00Z', reason: 'returned_to_sender', channel: 'eBay', delivered_by: 'DHL', needs_match: false, items: [{ product_id: 'p3', name: 'Salt', qty: 1, outcome: 'disposed' }] },
    { id: 'x', status: 'expected', created_at: '2026-11-15T10:00:00Z', items: [] },
  ]
  const t = summarise({ returns, amazon, sold: { p1: 100, p3: 10 }, names: { p1: 'Pyrex Jug' }, today }, '2026-11-01', '2026-11-19')
  assert.equal(t.requests, 2); assert.equal(t.requestUnits, 3); assert.equal(t.arrived, 2); assert.equal(t.arrivedUnits, 2)
  assert.equal(t.refunded, 10); assert.equal(t.labels, 2.73); assert.equal(t.selfPost, 1)
  assert.deepEqual(t.outcomes, { back_in_stock: 1, disposed: 1 })
  assert.deepEqual(t.causes, { packing: 1, customer: 1, carrier: 1 })
  assert.deepEqual(t.channels, { Amazon: 2, eBay: 1 })
  const jug = t.products.find(p => p.product_id === 'p1')
  assert.equal(jug.name, 'Pyrex Jug'); assert.equal(jug.units, 3); assert.equal(jug.sold, 100); assert.equal(jug.rate, 3)
  assert.equal(t.flagged.length, 1)                                                     // 3% of 100 sold
  assert.equal(t.rate, 3 / 110 * 100)
  assert.equal(t.matchedAuto, 1)
  const days = returnsByDay({ returns, amazon }, '2026-11-10', '2026-11-15')
  assert.equal(days.length, 6); assert.equal(days[0].requests, 1); assert.equal(days[5].arrived, 1)
})

test('P&L: back-in-stock credit lowers direct costs on the day it arrived; return postage and SAFE-T move out of other charges without moving the total', async () => {
  const { extrasByDay, summarise, isReturnCharge } = await import('../src/lib/pnlScreen.js')
  assert.equal(isReturnCharge('Return postage'), true); assert.equal(isReturnCharge('SAFE-T reimbursements'), true); assert.equal(isReturnCharge('Subscription'), false)
  const lines = [{ kind: 'sale', sale_date: '2026-11-10', channel: 'Amazon', order_ref: 'A', gross: 12, vat: 2, fees: -1.5, qty: 1, cogs: 4, shipping: 2, packaging: 0.3, cogsFrom: 'fifo', listing: { data: {} } }]
  const base = { charges: [{ d: '2026-11-10', channel: 'Amazon', amount: -3 }] }
  const chargeDays = [{ d: '2026-11-10', channel: 'Amazon', what: 'Return postage', amount: -2.73 }, { d: '2026-11-10', channel: 'Amazon', what: 'Subscription', amount: -0.27 }]
  const without = summarise({ lines, extras: extrasByDay({ days: base, chargeDays }), ohOn: false }, '2026-11-01', '2026-11-30')
  const withCredit = summarise({ lines, extras: extrasByDay({ days: { ...base, returns: [{ d: '2026-11-12', credit: 3.2, units: 1 }] }, chargeDays }), ohOn: false }, '2026-11-01', '2026-11-30')
  assert.equal(Math.round(withCredit.returnCharges * 100) / 100, -2.73)
  assert.equal(withCredit.charges, -3)                                     // still inside the charges: no total moves
  assert.equal(Math.round((withCredit.gross - without.gross) * 100) / 100, 3.2)
  assert.equal(withCredit.returnedUnits, 1)
})
