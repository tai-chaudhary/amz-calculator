/**
 * Reading a supplier's invoice or proforma so an order doesn't have to be
 * typed out. Each supplier lays its documents out the same way every time, so
 * these are plain readers rather than guesswork — and anything not found is
 * left blank for a person to fill in, never invented.
 *
 * Nothing here is applied automatically: the portal shows what it read and
 * waits to be told to use it.
 */

const num = (s) => {
  if (s === null || s === undefined) return null
  const v = parseFloat(String(s).replace(/[£,\s]/g, ''))
  return Number.isFinite(v) ? v : null
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

/** Dates come in every shape; this returns YYYY-MM-DD or null. */
export function parseDate(s) {
  if (!s) return null
  const t = String(s).trim()
  let m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)      // 18/09/2026
  if (m) {
    const [, d, mo, y] = m
    const year = y.length === 2 ? 2000 + +y : +y
    if (+mo >= 1 && +mo <= 12 && +d <= 31) return iso(year, +mo, +d)
  }
  m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})/)    // 18 Sep 2026
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] || (m && MONTHS[m[2].slice(0, 3).toLowerCase()])) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return iso(year, mo, +m[1])
  }
  m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/)       // Sep 18, 2026
  if (m && (MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()])) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()]
    return iso(+m[3], mo, +m[2])
  }
  return null
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const after = (text, label, pattern = '([^\\n]*)') => {
  const m = text.match(new RegExp(label + '\\s*[:#]?\\s*' + pattern, 'i'))
  return m ? m[1].trim() : null
}
const money = (text, label) => {
  // The label is wrapped, so a list of alternatives all take the amount that
  // follows — and must not match inside a longer word ("Total" in "Subtotal")
  const m = text.match(new RegExp('(?<![A-Za-z])(?:' + label + ')[^0-9£-]{0,40}(-?£?\\s?[\\d,]+\\.\\d{2})', 'i'))
  return m ? num(m[1]) : null
}

/** Which supplier's document is this? */
export function detectSupplier(text) {
  const t = text.toLowerCase()
  if (t.includes('poundwholesale') || t.includes('pound plus distribution')) return 'pound'
  if (t.includes('kitepackaging') || t.includes('kite packaging')) return 'kite'
  if (t.includes('jdcateringequip')) return 'jd'
  if (t.includes('daler-rowney') || t.includes('daler rowney')) return 'daler'
  if (t.includes('pricecheck')) return 'pricecheck'
  if (t.includes('regal wholesale') || t.includes('regalsales')) return 'regal'
  if (t.includes('efghousewares') || t.includes('efg')) return 'efg'
  if (t.includes('kd wholesale')) return 'kd'
  if (t.includes('intellectual property office')) return 'ipo'
  if (t.includes('currys')) return 'currys'
  if (t.includes('alibaba')) return 'alibaba'
  if (t.includes('audiotech') || t.includes('121 wholesale')) return '121'
  return null
}

export const SUPPLIER_NAMES = {
  pound: 'Pound Wholesale', kite: 'Kite Packaging', jd: 'JD Catering', daler: 'Daler-Rowney',
  pricecheck: 'Pricecheck Brand Partners', regal: 'Regal Wholesale', efg: 'EFG Housewares',
  kd: 'KD Wholesale', ipo: 'Intellectual Property Office', currys: 'Currys Business',
  alibaba: 'Shenzhen Aigocity (Alibaba)', '121': '121 Wholesale',
}

/** What kind of document it is — a proforma is not an invoice. */
export function detectKind(text) {
  const t = text.toLowerCase()
  if (t.includes('credit note')) return 'credit_note'
  if (t.includes('pro forma') || t.includes('proforma')) return 'proforma'
  if (t.includes('not a vat invoice') || t.includes('sales order')) return 'order'
  if (t.includes('draft tax invoice')) return 'draft_invoice'
  if (t.includes('receipt')) return 'receipt'
  return 'invoice'
}

// ── Readers, one per supplier ────────────────────────────────────────────────

const readers = {
  pound(text) {
    const lines = []
    for (const l of text.split('\n')) {
      // SKU, description, pack qty, [refunded], unit price, net price
      const m = l.match(/^\s*([A-Z0-9][A-Z0-9/.-]{2,15})\s{2,}(.+?)\s{2,}(\d{1,5})\s+(?:(\d{1,5})\s+)?£?([\d.]+)\s+£?([\d,.]+)\s*$/)
      if (m && !/^(SKU|TOTAL)/i.test(m[1])) {
        lines.push({ sku: m[1], name: m[2].trim(), qty: +m[3], refunded: m[4] ? +m[4] : 0, unitCost: num(m[5]), lineTotal: num(m[6]) })
      }
    }
    return {
      invoiceNumber: after(text, 'Invoice\\s*#', '([\\d]+)'),
      invoiceDate: parseDate(after(text, 'Order Date', '([^\\n]{6,20})')),
      orderRef: after(text, 'Order\\s*#', '([\\d]+)'),
      net: (() => {
        const sub = money(text, 'SUBTOTAL')
        if (sub == null) return null
        // Delivery and tail lift are charged as extra lines
        const extras = [...text.matchAll(/ADDITIONAL COST[^£\n]*£([\d,.]+)/gi)].reduce((t, m) => t + (num(m[1]) || 0), 0)
        return +(sub + extras).toFixed(2)
      })(),
      vat: money(text, 'TAX'), total: money(text, 'GRAND TOTAL'),
      delivery: (() => {
        const ship = money(text, 'Total Shipping Charges')
        const extras = [...text.matchAll(/ADDITIONAL COST[^£\n]*£([\d,.]+)/gi)].reduce((t, m) => t + (num(m[1]) || 0), 0)
        return extras > 0 ? +extras.toFixed(2) : ship
      })(),
      method: /credit\s*\/?\s*debit card/i.test(text) ? 'card' : null,
      lines,
    }
  },

  kite(text) {
    const lines = []
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*([A-Z0-9][A-Z0-9.X\/-]{1,24})\s{2,}(.+?)\s{2,}[\d.]+\s*kg\s+(\d{1,6})\s+(\d{1,5})\s*£([\d,.]+)\s+£([\d,.]+)/)
      if (m) lines.push({ sku: m[1], name: m[2].trim(), qty: +m[4], unitCost: num(m[5]), lineTotal: num(m[6]), units: +m[3] })
    }
    return {
      invoiceNumber: after(text, 'Order number', '([A-Z0-9]+)'),
      invoiceDate: parseDate(after(text, 'Order date', '([\\d/]{8,10})')),
      // Their totals line carries the weight before the money, so read it directly
      net: (() => {
        const sub = num((text.match(/Sub total:[^\n]*?£([\d,.]+)\s+£[\d,.]+/i) || [])[1])
        const del = num((text.match(/Delivery:[^\n]*?£([\d,.]+)/i) || [])[1]) || 0
        return sub == null ? null : +(sub + del).toFixed(2)
      })(),
      vat: (() => {
        const v = num((text.match(/Sub total:[^\n]*?£[\d,.]+\s+£([\d,.]+)/i) || [])[1])
        const dv = num((text.match(/Delivery:[^\n]*?£[\d,.]+\s*[\d.]*%?\s*£([\d,.]+)/i) || [])[1]) || 0
        return v == null ? null : +(v + dv).toFixed(2)
      })(),
      total: money(text, 'Grand total'),
      delivery: num((text.match(/Delivery:[^\n]*?£([\d,.]+)/i) || [])[1]),
      method: /payment method:\s*card/i.test(text) ? 'card' : null,
      lines,
    }
  },

  jd(text) {
    const lines = []
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*(.+?)\s{2,}(\d{1,5})\s+([\d.]+)\s+(\d{1,2})%\s+([\d,.]+)\s*$/)
      if (m && !/description/i.test(m[1])) lines.push({ name: m[1].trim(), qty: +m[2], unitCost: num(m[3]), lineTotal: num(m[5]) })
    }
    return {
      invoiceNumber: (text.match(/Invoice number[^\n]*\n[^\n]*?([A-Z]{2,4}-\d{3,8})/i) || [])[1]
        || after(text, 'Invoice number', '([A-Z0-9-]{3,})')
        || (text.match(/ONLINE STORE INVOICE\s*#?(\d+)/i) || [])[1],
      invoiceDate: parseDate((text.match(/Issue date[^\n]*\n[^\n]*?(\d{1,2} [A-Za-z]{3,9} \d{4})\s+[A-Z]{2,4}-/i) || [])[1])
        || parseDate((text.match(/Due date[^\n]*\n\s*£[\d,.]+\s+\d{1,2} [A-Za-z]{3,9} \d{4}\s+(\d{1,2} [A-Za-z]{3,9} \d{4})/i) || [])[1])
        || parseDate(after(text, 'Issue date', '([^\\n]{6,20})')) ||
                   parseDate((text.match(/#\d+\s*\n\s*(\d{1,2} [A-Za-z]+ \d{4})/) || [])[1]),
      dueDate: parseDate((text.match(/Due date[^\n]*\n\s*£[\d,.]+\s+(\d{1,2} [A-Za-z]{3,9} \d{4})/i) || [])[1])
        || parseDate(after(text, 'Due date', '([^\\n]{6,20})')),
      net: money(text, 'Subtotal'), vat: money(text, 'Total VAT\\s*\\d*%?|GB VAT[^£\\n]*'), total: money(text, 'Order Total|Total'),
      method: /payment\s*visa|visa \(/i.test(text) ? 'card' : 'bacs',
      lines,
    }
  },

  daler(text) {
    const lines = []
    const rows = text.split('\n')
    for (let i = 0; i < rows.length; i++) {
      const head = rows[i].match(/^\s*(\d{2,4})\s+([A-Z0-9][A-Z0-9/.-]{3,18})\s{2,}(.+?)\s{2,}(\d{8,14})\s*$/)
      if (!head) continue
      const next = rows[i + 1] || ''
      const q = next.match(/\s*(\d{1,5})\s+EA\s+([\d.,]+)\s+GBP\s+([\d.,]+)/)
      lines.push({ sku: head[2], name: head[3].trim(), barcode: head[4],
        qty: q ? +q[1] : null, unitCost: q ? num(q[2]) : null, lineTotal: q ? num(q[3]) : null })
    }
    return {
      invoiceNumber: after(text, 'N°', '([\\d]+)'),
      invoiceDate: parseDate(after(text, 'Date', '([\\d/]{8,10})')),
      dueDate: parseDate(after(text, 'Due date', '([\\d/]{8,10})')),
      net: money(text, 'VAT Base'),
      vat: num((text.match(/VAT Rate\s*[\d.]+\s*%[^\n]*?([\d,]+\.\d{2})\s*G?B?P?\s*$/im) || [])[1]),
      total: money(text, 'Amount Payable') || num((text.match(/Total:\s*([\d,.]+)\s*GBP/i) || [])[1]),
      surcharge: money(text, 'Surcharge'),
      method: 'bacs', lines,
    }
  },

  pricecheck(text) {
    const lines = []
    for (const l of text.split('\n')) {
      // Their columns don't line up the same way on every row, so work from
      // the figures: code, barcode, then qty … net value, VAT at the end
      const m = l.match(/^\s*([A-Z]{3,}[A-Z0-9]*)\s+(.*?)\s*(\d{8,14})\s+([\d.,\s]+)$/)
      if (!m) continue
      const nums = m[4].trim().split(/\s+/).map(n => num(n)).filter(n => n !== null)
      if (nums.length < 3) continue
      const qty = nums[0]
      const vat = nums[nums.length - 1]
      const lineTotal = nums[nums.length - 2]
      if (!(qty > 0) || !(lineTotal >= 0)) continue
      lines.push({
        sku: m[1], name: m[2].trim(), barcode: m[3], qty,
        // Taken from the money rather than a column that may not be there
        unitCost: +(lineTotal / qty).toFixed(4), lineTotal, vat,
      })
    }
    return {
      invoiceNumber: (text.match(/INVOICE NUMBER:[^\S\n]*([A-Z0-9][A-Z0-9-]{2,})[^\S\n]*$/im) || [])[1] || null,
      orderRef: after(text, 'OUR ORDER NUMBER', '(\\d+)'),
      invoiceDate: parseDate(after(text, 'DATE ORDER RECEIVED', '([\\d/]{8,10})')),
      net: money(text, 'TOTAL VALUE'), vat: money(text, 'VAT AMOUNT|VAT'), total: money(text, 'TOTAL DUE'),
      method: 'bacs', lines,
    }
  },

  regal(text) {
    const lines = []
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*(\d{4,6})\s{2,}(.+?)\s{2,}[\w]*\s*\d{0,3}\s*\d{8,12}\s+.*?([\d.]+)\s+(\d{1,4})\s+([\d,.]+)\s+\d{1,2}\s+/)
      if (m) lines.push({ sku: m[1], name: m[2].trim(), qty: +m[4], unitCost: num(m[3]), lineTotal: num(m[5]) })
    }
    return {
      invoiceNumber: (text.match(/Pro Forma Invoice\s*:\s*([A-Z0-9]+)/i) || [])[1],
      invoiceDate: parseDate(after(text, 'Document Date', '([^\\n]{6,25})')),
      net: money(text, 'Total GBP'), vat: money(text, 'VAT Amount'), total: money(text, 'Total GBP Incl\\. VAT'),
      method: 'bacs', lines,
    }
  },

  efg(text) {
    const lines = []
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*(\d{1,5})\s+([A-Z0-9]{4,10})\s{2,}(.+?)\s{2,}(?:\d{8,12}\s+)?([\d.]+)\s+([\d,.]+)\s+[A-Z]\s*$/)
      if (m) lines.push({ sku: m[2], name: m[3].trim(), qty: +m[1], unitCost: num(m[4]), lineTotal: num(m[5]) })
    }
    return {
      invoiceNumber: after(text, 'No\\.', '(INV[A-Z0-9]+)'),
      invoiceDate: parseDate(after(text, 'Date', '([^\\n]{6,20})')),
      net: money(text, 'Nett total'), vat: money(text, 'VAT'), total: money(text, 'Total due'),
      method: 'bacs', lines,
    }
  },

  kd(text) {
    const lines = []
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*([A-Z0-9]{4,12})\s{2,}(.+?)\s{2,}(\d{1,5})\s+(?:\d*\s+)?(\d{1,5})\s+([\d.]+)\s+([\d,.]+)\s+[\d.]+\s+([\d,.]+)\s+([\d,.]+)/)
      if (m) lines.push({ sku: m[1], name: m[2].trim(), qty: +m[3], unitCost: num(m[5]), lineTotal: num(m[6]) })
    }
    return {
      invoiceNumber: null,
      orderRef: (text.match(/\n\s*(\d{5,6})\s+\d{2}\/\d{2}\/\d{2}/) || [])[1],
      invoiceDate: parseDate((text.match(/\n\s*\d{5,6}\s+(\d{2}\/\d{2}\/\d{2})/) || [])[1]),
      net: money(text, 'NET'), vat: money(text, 'VAT'), total: money(text, 'GROSS'),
      method: 'bacs', lines,
    }
  },

  ipo(text) {
    return {
      invoiceNumber: after(text, 'Invoice Number', '(\\d+)'),
      invoiceDate: parseDate(after(text, 'Invoice Date', '([^\\n]{6,25})')),
      net: money(text, 'Total Excluding VAT'), vat: money(text, 'VAT Amount \\(Out of Scope\\)'),
      total: money(text, 'Total Including VAT'),
      reference: after(text, 'Payment Reference', '([A-Z0-9]+)'),
      method: /payment method\s*card/i.test(text) ? 'card' : null,
      lines: [],
    }
  },

  currys(text) {
    return {
      invoiceNumber: after(text, 'Invoice number', '(\\d+)') || after(text, 'Sales receipt no\\.', '(\\d+)'),
      invoiceDate: parseDate(after(text, 'Date of receipt', '([^\\n]{6,25})')) || parseDate(after(text, 'Date', '([\\d/]{8,10})')),
      net: money(text, 'Total excluding VAT|Subtotal'),
      vat: money(text, 'Total VAT|VAT'), total: money(text, 'Total including VAT|Total'),
      method: /visa|card/i.test(text) ? 'card' : null,
      lines: [],
    }
  },
}

/** Anything we don't have a reader for: labels only, no lines invented. */
function generic(text) {
  return {
    invoiceNumber: after(text, 'Invoice\\s*(?:number|no\\.?|#)', '([A-Z0-9][A-Z0-9/-]{2,20})'),
    invoiceDate: parseDate(after(text, 'Invoice date', '([^\\n]{6,25})')) || parseDate(after(text, 'Date', '([^\\n]{6,25})')),
    dueDate: parseDate(after(text, 'Due date', '([^\\n]{6,25})')),
    net: money(text, 'Sub\\s?total|Net total|Nett total|Total excluding VAT|Goods'),
    vat: money(text, 'VAT|Tax'),
    total: money(text, 'Total due|Grand total|Amount payable|Total including VAT|Order total|Total'),
    lines: [],
  }
}

/**
 * Everything readable from a document's text. Returns what it found, what it
 * couldn't, and never guesses a figure that isn't printed.
 */
export function parseInvoice(text) {
  const clean = String(text || '').replace(/\r/g, '')
  const supplier = detectSupplier(clean)
  const read = (readers[supplier] || generic)(clean)
  const out = {
    supplier, supplierName: SUPPLIER_NAMES[supplier] || null,
    documentKind: detectKind(clean),
    invoiceNumber: null, invoiceDate: null, dueDate: null, orderRef: null,
    net: null, vat: null, total: null, delivery: null, method: null, reference: null,
    lines: [], warnings: [],
    ...read,
  }
  out.lines = (out.lines || []).filter(l => l.qty > 0 && l.unitCost >= 0)

  // Work out anything missing from what we do have, rather than leaving a hole
  if (out.total == null && out.net != null && out.vat != null) out.total = +(out.net + out.vat).toFixed(2)
  if (out.vat == null && out.total != null && out.net != null) out.vat = +(out.total - out.net).toFixed(2)
  if (out.net == null && out.total != null && out.vat != null) out.net = +(out.total - out.vat).toFixed(2)

  // Does the arithmetic hold? Say so rather than quietly disagreeing
  if (out.net != null && out.vat != null && out.total != null &&
      Math.abs(out.net + out.vat - out.total) > 0.02) {
    out.warnings.push(`The figures don’t add up: ${out.net.toFixed(2)} + ${out.vat.toFixed(2)} ≠ ${out.total.toFixed(2)}. Check before using them.`)
  }
  const lineSum = out.lines.reduce((s, l) => s + (l.lineTotal ?? l.qty * l.unitCost), 0)
  // Lines are the goods; delivery and the like are charged on top
  const goods = out.net != null ? out.net - (out.delivery || 0) : null
  if (out.lines.length && goods != null && Math.abs(lineSum - goods) > Math.max(0.05, goods * 0.02)) {
    out.warnings.push(`The lines come to ${lineSum.toFixed(2)} but the goods total is ${goods.toFixed(2)} — some lines may not have been read.`)
  }
  if (!out.lines.length) out.warnings.push('No line items could be read from this document — add them by hand if you need them.')
  if (out.documentKind === 'proforma') out.warnings.push('This is a proforma, not an invoice — the final invoice will still be needed.')
  if (out.documentKind === 'order') out.warnings.push('This is an order confirmation, not a VAT invoice.')
  if (!out.total) out.warnings.push('No total could be read — enter the amounts by hand.')
  return out
}
