/**
 * Dispatch — turning one HELM file (labels and packing slips together) into
 * batches the warehouse can print.
 *
 * Everything here is plain data in, plain data out, so it is tested without a
 * browser. Reading the PDF itself (text, pictures, text recognition) lives in
 * dispatchPdf.js.
 *
 * A page arrives as { index, width, height, items, ocr } where items are the
 * PDF's own words with positions (x, y from the bottom, as PDFs measure) and
 * ocr is text recognised from the picture when the page has no words.
 */

// ── Small helpers ────────────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
export const decode = (s) => String(s || '').replace(/&(amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m])

/** Codes and references compared without spaces, dashes or case: OCR and line wrapping both mangle those. */
export const normRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/
/**
 * Text recognition mixes up look-alike characters in postcodes. A UK
 * postcode's last part is always digit, letter, letter — so those positions
 * can be put right.
 */
export function fixOcrPostcode(s) {
  return String(s || '').toUpperCase().replace(/\b([A-Z0-9]{2,4})\s+([A-Z0-9]{3})\b/g, (m, out, inw) => {
    const toDigit = { O: '0', D: '0', Q: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' }
    const toLetter = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' }
    const fixed = (toDigit[inw[0]] || inw[0]) + inw.slice(1).split('').map(c => toLetter[c] || c).join('')
    return `${out} ${fixed}`
  })
}

/** Two postcodes the same, allowing for the look-alike characters text recognition confuses. */
export function samePostcode(a, b, slack = 0) {
  const squash = (s) => normRef(s).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/Q/g, '0').replace(/G/g, 'C')
  if (!a || !b) return false
  return editDistance(squash(a), squash(b)) <= slack
}

/** Same customer, read off a picture: the words of the slip's name all on the label. */
export function sameName(a, b) {
  const words = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  const x = words(a), y = words(b)
  if (!x.length || !y.length) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.every(w => long.some(v => editDistance(w, v) <= (w.length > 5 ? 1 : 0)))
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length][b.length]
}

export const fmtPostcode = (s) => {
  const m = String(s || '').toUpperCase().match(UK_POSTCODE)
  return m ? `${m[1]} ${m[2]}` : ''
}

/** Text some PDF makers stamp on pages ("Powered by TCPDF") — not part of any label. */
export const BOILERPLATE = /powered by tcpdf|www\.tcpdf\.org/i
export const realWords = (items = []) => items.filter(i => String(i.str).trim() && !BOILERPLATE.test(String(i.str)))

/** The words of a page as lines, top to bottom. */
export function pageLines(items = []) {
  const sorted = realWords(items).sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, (it.h || 8) * 0.35))
    if (line) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map(l => ({ y: l.y, text: l.items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim() }))
}

export const pageText = (page) => {
  const own = pageLines(page.items).map(l => l.text).join('\n')
  return own.trim() ? own : String(page.ocr || '')
}

// ── What kind of page is this? ───────────────────────────────────────────────

export function pageKind(page) {
  const t = pageText(page)
  if (/packing\s*slip/i.test(t)) return 'slip'
  if (/list of orders with successful label purchase/i.test(t)) return 'skip'
  if (!t.trim() && !page.hasPicture) return 'skip'
  // A long packing slip runs onto a second page with no heading: item lines and
  // quantities, nothing a label has on it
  if (realWords(page.items).length && !LABEL_WORDS.test(t) && parseCompactItems(page.items).length) return 'slip-more'
  return 'label'
}
const LABEL_WORDS = /DHL|EVRI|SHIPMENT|ALT\s*REF|DESTINATION|C\s*-?\s*ROUND|NDAY|ROYAL MAIL|PARCELFORCE|DPD|YODEL|TRACKING/i

// ── Packing slips ────────────────────────────────────────────────────────────

/**
 * Reads a HELM packing slip: the order, the channel's own reference, the
 * customer, and the item table (code and quantity — the product name is
 * there too, for people).
 *
 * The item table is read by position under its headings, because long item
 * codes wrap onto two or three lines and come out of the PDF in pieces.
 */
export function parseSlip(page) {
  const lines = pageLines(page.items)
  const text = lines.map(l => l.text).join('\n')
  const out = { helmOrder: '', channelRef: '', slipId: '', customer: '', postcode: '', items: [], shipping: '' }

  out.helmOrder = (text.match(/Order\s*(?:No\.?|Number)?\s*[:#]?\s*(OR-[A-Z0-9]+)/i) || [])[1] || (text.match(/\bOR-[A-Z0-9]{5,}\b/) || [])[0] || ''
  out.slipId = (text.match(/\b(?:PR|SH)-[A-Z0-9]{5,}\b/) || [])[0] || ''
  const shipLabel = (page.items || []).find(i => /^shipping requested:?$/i.test(String(i.str).trim()))
  if (shipLabel) {
    const next = (page.items || []).filter(i => Math.abs(i.y - shipLabel.y) < 2 && i.x > shipLabel.x && String(i.str).trim())
      .sort((a, b) => a.x - b.x)[0]
    out.shipping = next ? String(next.str).trim() : ''
  }
  const ref = text.match(/(?:Channel\s*(?:Order\s*)?Ref(?:erence)?|Order\s*Ref(?:erence)?|Channel\s*Order(?:\s*(?:No\.?|Number|ID))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i)
  out.channelRef = ref ? ref[1] : ((text.match(/\b\d{3}-\d{7}-\d{7}\b/) || [])[0] || '')
  if (!out.channelRef) {
    // HELM's 6x4 slip prints the channel's order number on the postcode line, to the right
    const pcItem = (page.items || []).find(i => UK_POSTCODE.test(String(i.str).toUpperCase()) && /,\s*[A-Z]{2}$/.test(String(i.str).trim()))
    const beside = pcItem && (page.items || []).filter(i => Math.abs(i.y - pcItem.y) < 2 && i.x > pcItem.x + 20 && String(i.str).trim())
      .sort((a, b) => a.x - b.x)[0]
    if (beside && /^[A-Z0-9][A-Z0-9-]{4,}$/i.test(String(beside.str).trim())) out.channelRef = String(beside.str).trim()
  }

  // Customer: the first lines under "Shipping Address"
  const items = page.items || []
  const shipHead = items.find(i => /^shipping address$/i.test(String(i.str).trim()))
  const invHead = items.find(i => /^invoice address$/i.test(String(i.str).trim()))
  if (shipHead) {
    const right = invHead && invHead.x > shipHead.x ? invHead.x - 3 : Infinity
    const col = items.filter(i => i.x >= shipHead.x - 3 && i.x < right && i.y < shipHead.y - 2 && i.y > shipHead.y - 160)
    const colLines = pageLines(col).map(l => l.text)
    out.customer = colLines[0] || ''
    out.postcode = fmtPostcode(colLines.find(l => UK_POSTCODE.test(l.toUpperCase())) || '')
  }
  if (!shipHead) {
    const i = lines.findIndex(l => UK_POSTCODE.test(l.text.toUpperCase()))
    if (i > 0 && !/packing\s*slip|^OR-/i.test(lines[i - 1].text)) out.customer = lines[i - 1].text.replace(/\bOR-[A-Z0-9]+\b/, '').trim()
  }
  if (!out.postcode) {
    // No headings: the first postcode that isn't in our own footer or return address
    const own = lines.filter(l => /adrian marsh|return|tax number|company number/i.test(l.text)).map(l => l.text).join(' ')
    const ownCodes = new Set((own.toUpperCase().match(new RegExp(UK_POSTCODE.source, 'g')) || []).map(normRef))
    for (const l of lines) {
      const m = l.text.toUpperCase().match(UK_POSTCODE)
      if (m && !ownCodes.has(normRef(m[0]))) { out.postcode = fmtPostcode(m[0]); break }
    }
  }

  out.items = parseSlipItems(items)
  out.boldFont = (items.find(i => /^packing\s*slip$/i.test(String(i.str).trim())) || {}).font || null
  return out
}

export function parseSlipItems(items = []) {
  const find = (re) => items.find(i => re.test(String(i.str).trim()))
  const codeHead = find(/^item\s*code$/i) || find(/^(sku|code)$/i)
  const qtyHead = find(/^(qty|quantity)$/i)
  if (!codeHead || !qtyHead) return parseCompactItems(items)
  const headY = Math.max(codeHead.y, qtyHead.y)
  const below = items.filter(i => i.y < headY - 2)
  const footer = below
    .filter(i => /^helm$|tax number|company number|eori|^adrian marsh limited/i.test(String(i.str).trim()))
    .sort((a, b) => b.y - a.y)[0]
  const floor = footer ? footer.y + 2 : -Infinity
  const rows = below.filter(i => i.y > floor)

  const qtys = rows
    .filter(i => /^\d{1,4}$/.test(String(i.str).trim()) && i.x >= qtyHead.x - 8 && i.x <= qtyHead.x + 45)
    .sort((a, b) => b.y - a.y)
  if (!qtys.length) return []

  const out = qtys.map(q => ({ qty: parseInt(q.str, 10), y: q.y, code: [], name: [] }))
  const nearest = (y) => out.reduce((best, r) => (Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best), out[0])
  for (const it of rows) {
    if (qtys.includes(it)) continue
    const s = String(it.str).trim()
    if (!s) continue
    const row = nearest(it.y)
    if (it.x >= codeHead.x - 4 && it.x < qtyHead.x - 4) row.code.push(it)
    else if (it.x < codeHead.x - 4) row.name.push(it)
  }
  const join = (parts, sep) => parts.sort((a, b) => b.y - a.y || a.x - b.x).map(p => String(p.str).trim()).join(sep)
  return out
    .map(r => ({ code: join(r.code, '').replace(/\s+/g, ''), name: decode(join(r.name, ' ')).replace(/\s+/g, ' ').trim(), qty: r.qty }))
    .filter(r => r.code && r.qty > 0)
}

/**
 * HELM's 6x4 slip has no table headings: each item is its name (one or more
 * lines), its code in bold underneath, and the quantity in a box to the
 * right. Codes come in every shape — capitals, mixed case, plain numbers —
 * so the bold line is what marks the code, not what it looks like.
 */
export function parseCompactItems(items = [], { boldFont = null } = {}) {
  const words = realWords(items)
  if (!words.length) return []
  const right = Math.max(...words.map(i => i.x + (i.w || 0)))
  const head = words.find(i => /^packing\s*slip$/i.test(String(i.str).trim()))
  const bold = head?.font || boldFont || null
  // Items sit below the customer block (the line with the postcode)
  const pcLine = words.find(i => UK_POSTCODE.test(String(i.str).toUpperCase()))
  const top = pcLine ? pcLine.y - 12 : (head ? head.y - 60 : Infinity)
  const body = words.filter(i => i.y < top && !/^powered by/i.test(String(i.str).trim()))
  const qtys = body.filter(i => /^\d{1,4}$/.test(String(i.str).trim()) && i.x > right * 0.6).sort((a, b) => b.y - a.y)
  if (!qtys.length) return []
  const left = body.filter(i => !qtys.includes(i) && i.x < right * 0.6).sort((a, b) => b.y - a.y || a.x - b.x)

  const rows = qtys.map(q => ({ q, lines: [] }))
  const nearest = (y) => rows.reduce((best, r) => (Math.abs(r.q.y - y) < Math.abs(best.q.y - y) ? r : best), rows[0])
  for (const it of left) nearest(it.y).lines.push(it)

  return rows.map(({ q, lines }) => {
    if (!lines.length) return null
    let codeLines = bold ? lines.filter(l => l.font === bold) : []
    if (!codeLines.length) {
      // No font to go on: the code is the last line, or the last that looks like one
      const looks = lines.filter(l => !/\s/.test(String(l.str).trim()) && String(l.str).trim().length >= 4)
      codeLines = [looks[looks.length - 1] || lines[lines.length - 1]]
    }
    const nameLines = lines.filter(l => !codeLines.includes(l))
    return {
      code: codeLines.map(l => String(l.str).trim()).join('').replace(/\s+/g, ''),
      name: decode(nameLines.map(l => String(l.str).trim()).join(' ')).replace(/\s+/g, ' ').trim(),
      qty: parseInt(q.str, 10),
    }
  }).filter(r => r && r.code && r.qty > 0)
}

/** One key for a set of items, however the slip lists them: order doesn't matter, codes are normalised. */
export function itemKey(items = []) {
  const merged = new Map()
  for (const it of items) {
    const k = normRef(it.code)
    if (!k) continue
    merged.set(k, (merged.get(k) || 0) + (parseInt(it.qty, 10) || 0))
  }
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, q]) => `${k}x${q}`).join('+')
}

/** A short name to start a new mapping from: what a packer would say out loud. */
export function suggestLabelName(items = []) {
  const one = (it) => {
    let n = decode(it.name || it.code).toUpperCase()
      .replace(/\b(PACK OF \d+|\(PACK OF \d+\))/g, '')
      .replace(/\s+/g, ' ').trim()
    // Brand and product come first on most listings; keep those and stop before it gets long
    if (n.length > 26) {
      const kept = []
      for (const w of n.split(' ')) { if ((kept.join(' ') + ' ' + w).trim().length > 26) break; kept.push(w) }
      n = kept.join(' ') || n.slice(0, 26)
    }
    return it.qty > 1 ? `${n} x${it.qty}` : n
  }
  return items.map(one).join(' + ').slice(0, 40)
}

// ── Shipping labels ──────────────────────────────────────────────────────────

/**
 * Who the label is for and what it says: carrier, service, the reference
 * HELM put on it (the channel order number), the tracking number and postcode.
 */
/**
 * Evri's tracking number, e.g. H-08AN-A-000000862-4. Since mid-October HELM's
 * Evri labels are pictures, and recognised text gets this slightly wrong:
 * spaces round the dashes, a long dash or "=", O for 0, I or L for 1. The
 * shape is fixed, so it's found by shape and the digits put right.
 */
export function evriTracking(text) {
  const up = String(text || '').toUpperCase().replace(/[—–_]/g, '-')
  const strict = up.match(/\b(T\d{2}[A-Z0-9]{10,}|H-[A-Z0-9]{2,4}-[A-Z0-9]-\d{6,}-\d)\b/)
  if (strict) return strict[1]
  const sep = '\\s*[-~=.]\\s*'
  const loose = up.match(new RegExp(`\\bH${sep}([0-9OQDIL]{2})\\s*([A-Z0-9]{2})${sep}([A-Z0-9])${sep}([0-9OQDILSB ]{6,14})${sep}([0-9OQDILSB])(?![A-Z0-9])`))
  if (!loose) return ''
  const digits = (x) => x.replace(/\s+/g, '').replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
  const run = digits(loose[4])
  if (!/^\d{6,12}$/.test(run)) return ''
  return `H-${digits(loose[1])}${loose[2]}-${loose[3]}-${run}-${digits(loose[5])}`
}

export function parseLabel(page) {
  const t = pageText(page)
  const up = t.toUpperCase().replace(/[—–]/g, '-')
  const out = { carrier: '', service: '', ref: '', refs: [], tracking: '', postcode: '', customer: '' }

  if (/DHL|ALTREF|SHIPMENT NO/.test(up)) out.carrier = 'DHL'
  else if (/EVRI|HERMES|C\s*-?\s*ROUND|DESTINATION\s*:?|\bNDAY\b/.test(up)) out.carrier = 'Evri'

  const service = `${up}\n${String(page.ocrService || '').toUpperCase()}`
  if (out.carrier === 'Evri') out.service = /\bN\s?DAY\b|NEXT\s*DAY/.test(service) ? 'Next Day' : 'Standard'
  else if (out.carrier === 'DHL') out.service = 'Next Day'

  // DHL shows "Ref" and "AltRef"; HELM can put the order number in either, so both are kept
  const refs = []
  // DHL's reference block has its own close-up read; prefer it, keep the full read as well
  const close = String(page.ocrRefs || '').toUpperCase().replace(/[—–]/g, '-')
  if (out.carrier === 'DHL' && close) {
    const a2 = close.match(/ALT\s*REF\s*[:.]?\s*([A-Z0-9][A-Z0-9 -]{4,}?)(?:\s{2,}|\n|$)/)
    const m2 = close.match(/(?:^|\n|\s)REF\s*[:.]?\s*([A-Z0-9][A-Z0-9 -]{4,}?)(?:\s{2,}|\n|$)/)
    if (a2) refs.push(a2[1]); if (m2) refs.push(m2[1])
  }
  if (out.carrier === 'DHL') {
    const alt = up.match(/ALT\s*REF\s*[:.]?\s*([A-Z0-9][A-Z0-9 -]{4,}?)(?:\s{2,}|\n|$)/)
    const main = up.match(/(?:^|\n|\s)REF\s*[:.]?\s*([A-Z0-9][A-Z0-9 -]{4,}?)(?:\s{2,}|\n|$)/)
    if (alt) refs.push(alt[1]); if (main) refs.push(main[1])
  } else {
    const r1 = up.match(/REF(?:ERENCE)?\s*1\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,})/)
    if (r1) refs.push(r1[1])
  }
  out.refs = [...new Set(refs.map(r => r.replace(/\s+/g, '').replace(/^#/, '')))]
  // HELM also writes what's in the parcel on the label — Evri "Reference 2", DHL "AltRef":
  // "2xPEACOC-SALT-WHITE-" or "MULTI_ITEM_ORDER". A second, independent check on the slip.
  const hintText = out.carrier === 'DHL' && close ? close : up
  if (/MULTI[_\s-]*ITEM[_\s-]*ORDER/.test(hintText)) out.itemHint = { multi: true }
  else {
    const hint = (out.carrier === 'DHL'
      ? hintText.match(/ALT\s*REF\s*[:.]?\s*(\d{1,3})\s*X\s*([A-Z0-9][A-Z0-9 -]{3,})/)
      : hintText.match(/REF(?:ERENCE)?\s*2\s*[:#]?\s*(\d{1,3})\s*X\s*([A-Z0-9][A-Z0-9-]{3,})/))
    if (hint) out.itemHint = { qty: parseInt(hint[1], 10), prefix: hint[2].replace(/\s+/g, '') }
  }
  out.ref = out.refs[0] || ''

  const dhlShip = up.match(/SHIPMENT\s*NO\s*[:.]?\s*(\d{10,})/)
  out.tracking = dhlShip ? dhlShip[1] : evriTracking(up)

  // Evri prints the address under "Destination"; that's the customer
  // (read by position, so the routing codes beside it don't get mixed in)
  const items = (page.items || []).filter(i => String(i.str).trim())
  const head = items.find(i => /^destination\s*:?$/i.test(String(i.str).trim()))
  if (head) {
    const stop = items.find(i => /^date$/i.test(String(i.str).trim()) && i.y < head.y)
    const block = items
      .filter(i => Math.abs(i.x - head.x) < 6 && i.y < head.y - 2 && (!stop || i.y > stop.y + 2))
      .sort((a, b) => b.y - a.y).map(i => String(i.str).trim())
    out.customer = block[0] || ''
    out.postcode = fmtPostcode(block.find(l => UK_POSTCODE.test(l.toUpperCase())) || '')
  }
  if (!head && page.ocrAddress) {
    const lines = String(page.ocrAddress).split('\n').map(x => x.trim()).filter(Boolean)
    const d = lines.findIndex(l => /destination/i.test(l))
    const block = []
    for (const l of lines.slice(d + 1)) { if (/^(date|weight|reference)/i.test(l)) break; block.push(l) }
    if (block.length) {
      out.customer = block[0]
      const pcLine = [...block].reverse().find(l => UK_POSTCODE.test(fixOcrPostcode(l)))
      if (pcLine) out.postcode = fmtPostcode(fixOcrPostcode(pcLine))
    }
  }
  if (!out.postcode) {
    const pc = up.match(new RegExp(UK_POSTCODE.source, 'g'))
    if (pc) out.postcode = fmtPostcode(pc.find(p => normRef(p) !== 'TF92DU') || '')
  }
  return out
}

// ── Putting a file together ──────────────────────────────────────────────────

/**
 * Pages → orders. HELM puts each order's label(s) before its packing slip; if
 * a file starts with a slip instead, the slip comes first and the labels
 * follow. Either way an order with five parcels has five labels.
 */
export function pairPages(pages) {
  const kinds = pages.map(p => ({ page: p, kind: pageKind(p) }))
  const firstReal = kinds.find(k => k.kind !== 'skip')
  const slipFirst = firstReal?.kind === 'slip'
  const orders = []
  let buffer = []
  let current = null

  for (const { page, kind } of kinds) {
    if (kind === 'skip') continue
    if (kind === 'label') {
      const label = { pageIndex: page.index, ...parseLabel(page), stamp: page.stamp || {} }
      if (slipFirst) {
        if (current) current.labels.push(label)
        else orders.push({ slip: null, labels: [label] })
      } else buffer.push(label)
      continue
    }
    if (kind === 'slip-more') {
      // The rest of the previous slip's items
      const last = slipFirst ? current?.slip : orders[orders.length - 1]?.slip
      if (last) last.items = [...last.items, ...parseCompactItems(page.items, { boldFont: last.boldFont })]
      continue
    }
    const slip = { pageIndex: page.index, ...parseSlip(page) }
    if (slipFirst) {
      current = { slip, labels: [] }
      orders.push(current)
    } else {
      orders.push({ slip, labels: buffer })
      buffer = []
    }
  }
  // Labels with no slip (made by hand — replacements and the like) are one order each
  for (const l of buffer) orders.push({ slip: null, labels: [l] })
  const loose = []
  for (const o of orders) {
    if (!o.slip && o.labels.length > 1) o.labels.forEach(l => loose.push({ slip: null, labels: [l] }))
    else loose.push(o)
  }
  return { orders: loose, slipFirst, skipped: kinds.filter(k => k.kind === 'skip').length }
}

/**
 * Every order checked before anything is printed. Problems that would send
 * the wrong parcel stop the order ('hold'); things we simply couldn't confirm
 * are shown but don't stop it ('check').
 */
export function checkOrders(orders, mappings = [], { existing = [], helmCodes = null, unitsByCode = null } = {}) {
  const byKey = new Map(mappings.map(m => [m.item_key, m]))
  const seen = new Map()
  for (const e of existing) {
    for (const r of [e.channel_ref, e.helm_order, e.slip_id]) if (r && !seen.has(normRef(r))) seen.set(normRef(r), e)
  }
  return orders.map((input, i) => {
    let o = input
    const problems = []
    const items = o.slip?.items || []
    const key = itemKey(items)
    const codes = [...new Set(items.map(i => normRef(i.code)))]
    const units = items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0)
    const { mapping, anyQty } = resolveMapping(items, o.labels.length, byKey)

    if (!o.slip) problems.push({ level: 'manual', code: 'no-slip', text: 'No packing slip — say what this parcel is' })
    else if (!items.length) problems.push({ level: 'hold', code: 'no-items', text: 'Couldn\'t read the items on the packing slip' })
    else if (!mapping) problems.push({ level: 'map', code: 'unmapped', text: 'New item — set what goes in each parcel' })

    if (o.slip && !o.labels.length) problems.push({ level: 'hold', code: 'no-label', text: 'Packing slip with no label' })
    if (mapping && anyQty && o.labels.length && !o.slip?.manual) {
      // Set up for any quantity: "parcels" is how many units go in each box.
      // If the labels don't add up, we can't say what's in each box — so ask.
      const expect = Math.ceil(units / Math.max(1, mapping.parcels || 1))
      if (o.labels.length !== expect) problems.push({ level: 'hold', code: 'count', perBox: true, text: `${units} units at ${mapping.parcels || 1} a box should be ${expect} label${expect !== 1 ? 's' : ''}, has ${o.labels.length} — can't tell what's in each box` })
    }
    // A new item whose code HELM doesn't know: say so, so the slip gets a second look before it's set up
    if (helmCodes && helmCodes.size && o.slip && !o.slip.manual && !mapping) {
      const unknown = items.filter(i => !helmCodes.has(normRef(i.code)))
      if (unknown.length) problems.push({ level: 'map', code: 'unknown-code', text: `${unknown.map(i => i.code).join(', ')} isn't in HELM's product list — check the code before setting it up` })
    }
    // Weight: no box over DHL's 25kg, and nothing 15kg or more on Evri
    if (mapping && o.labels.length) {
      const kgs = items.map(itemKg)
      if (kgs.every(k => k != null)) {
        const unitKg = items.length === 1 ? kgs[0] : null
        const boxes = anyQty && unitKg != null
          ? boxStamps(mapping, items, o.labels.length, { anyQty, manual: !!o.slip?.manual }).map(t => (parseInt(t, 10) || 1) * unitKg)
          : Array.from({ length: o.labels.length }, () => items.reduce((t, it, k) => t + kgs[k] * (parseInt(it.qty, 10) || 0), 0) / o.labels.length)
        const heaviest = Math.max(...boxes)
        if (heaviest > MAX_BOX_KG + 0.01) problems.push({ level: 'hold', code: 'weight', text: `A box would weigh ${+heaviest.toFixed(1)}kg — over the ${MAX_BOX_KG}kg limit` })
        o.labels.forEach((l, k) => {
          if (l.carrier === 'Evri' && boxes[k] >= EVRI_UNDER_KG) problems.push({ level: 'hold', code: 'weight', text: `${+boxes[k].toFixed(1)}kg box on an Evri label — Evri is for under ${EVRI_UNDER_KG}kg` })
        })
      }
    }
    // The stamp must say what's actually in each box
    if (mapping && unitsByCode) {
      const wrong = stampCountProblem(mapping, unitsByCode)
      if (wrong) problems.push({ level: 'hold', code: 'stamp-count', text: `${wrong.text} ("${mapping.label_name}") — fix it under Parcel mappings` })
    }
    // What the label itself says is in the parcel must agree with the slip
    if (o.slip && !o.slip.manual && items.length) {
      for (const l of o.labels) {
        const h = l.itemHint
        if (!h) continue
        if (h.multi) {
          if (items.length < 2) problems.push({ level: 'hold', code: 'hint', text: `Label says it's a multi-item order, slip has one item` })
          continue
        }
        const pre = normRef(h.prefix)
        const byCode = new Map()
        for (const i of items) byCode.set(normRef(i.code), (byCode.get(normRef(i.code)) || 0) + (parseInt(i.qty, 10) || 0))
        const match = [...byCode.entries()].filter(([c]) => pre && c.startsWith(pre))
        if (byCode.size !== 1 || match.length !== 1 || match[0][1] !== h.qty) {
          problems.push({ level: 'hold', code: 'hint', text: `Label says ${h.qty} x ${h.prefix}…, slip says ${items.map(i => `${i.qty} x ${i.code}`).join(' + ')}` })
          break
        }
      }
    }
    if (mapping && !anyQty && !o.slip?.manual && o.labels.length && o.labels.length !== mapping.parcels) {
      problems.push({ level: 'hold', code: 'count', text: `Should have ${mapping.parcels} label${mapping.parcels !== 1 ? 's' : ''}, has ${o.labels.length}` })
    }

    const slipRefs = o.slip?.manual ? [] : [o.slip?.channelRef, o.slip?.helmOrder, o.slip?.slipId].map(normRef).filter(Boolean)
    const dupe = slipRefs.map(r => seen.get(r)).find(Boolean)
    if (dupe) {
      const where = [dupe.upload?.code, dupe.upload?.ship_date && new Date(`${dupe.upload.ship_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })].filter(Boolean).join(' on ')
      problems.push({ level: 'hold', code: 'duplicate', text: `Already uploaded${where ? ` in ${where}` : ''}${dupe.status === 'dispatched' ? ' — and dispatched' : ''}. Kept back so it isn't sent twice` })
    }
    let unread = 0
    for (const l of o.labels) {
      if (!l.carrier) problems.push({ level: 'hold', code: 'carrier', text: `Label on page ${l.pageIndex + 1}: carrier not recognised` })
      const refs = (l.refs && l.refs.length ? l.refs : [l.ref]).filter(Boolean)
      if (!refs.length) { unread++; continue }
      if (slipRefs.length && !refs.some(r => slipRefs.includes(normRef(r)))) {
        problems.push({ level: 'hold', code: 'mismatch', text: `Label says ${refs.join(' / ')}, slip says ${[o.slip?.channelRef, o.slip?.slipId, o.slip?.helmOrder].filter(Boolean).join(' / ')}` })
      }
    }
    // Labels with no reference on them (Amazon's Evri labels) are checked by postcode instead
    if (o.slip && !o.slip.manual && unread) {
      const noRef = o.labels.filter(l => !(l.refs && l.refs.length) && !l.ref)
      const byPostcode = noRef.filter(l => samePostcode(l.postcode, o.slip.postcode, 1) || sameName(l.customer, o.slip.customer))
      const wrongPostcode = noRef.filter(l => !byPostcode.includes(l) && l.postcode && o.slip.postcode)
      for (const l of wrongPostcode) {
        problems.push({ level: 'hold', code: 'postcode', text: `Label is for ${l.postcode}${l.customer ? ` (${l.customer})` : ''}, slip is for ${o.slip.postcode}` })
      }
      const left = noRef.length - byPostcode.length - wrongPostcode.length
      if (left > 0) problems.push({ level: 'check', code: 'unverified', text: `Couldn't read the ${left === o.labels.length ? 'label' : `${left} label${left !== 1 ? 's' : ''}`} well enough to check it — matched by page order` })
    }
    if (o.slip && !o.slip.manual && !slipRefs.length) problems.push({ level: 'check', code: 'no-ref', text: 'No order reference on the slip — matched by page order' })
    const carriers = new Set(o.labels.map(l => l.carrier).filter(Boolean))
    if (carriers.size > 1) problems.push({ level: 'hold', code: 'mixed', text: 'Labels from different carriers on one order' })

    const level = problems.some(p => p.level === 'hold') ? 'hold'
      : problems.some(p => p.level === 'manual') ? 'manual'
      : problems.some(p => p.level === 'map') ? 'map'
      : problems.some(p => p.level === 'check') ? 'check' : 'ok'
    // What to stamp on each box. Normally the parcel name; for "any quantity" items
    // each box says exactly how many it holds (2 X …, and 1 X … for an odd last one)
    const stamps = mapping ? boxStamps(mapping, items, o.labels.length, { anyQty, manual: !!o.slip?.manual }) : []
    o = { ...o, labels: o.labels.map((l, k) => ({ ...l, stampName: stamps[k] || mapping?.label_name })) }
    return {
      ...o, id: `o${i}`, key, mapping, anyQty, problems, level,
      orderKey: o.slip?.channelRef || o.slip?.helmOrder || `page-${o.labels[0]?.pageIndex ?? i}`,
    }
  })
}

/**
 * Orders → batches, by what goes in each parcel and how it's sent. The packer
 * doesn't care whether a bag came from a 5-pack or a single order — one bag,
 * one box, one label — so those all land in the same batch.
 */
export function buildBatches(checked, { include = () => true } = {}) {
  const groups = new Map()
  for (const o of checked) {
    if (!o.mapping || !include(o)) continue
    const carrier = o.labels[0]?.carrier || 'Unknown'
    const service = o.labels[0]?.service || ''
    // Grouped by what's stamped on each box, so like is packed with like
    for (const l of o.labels) {
      const name = l.stampName || o.mapping.label_name
      const k = `${carrier}|${service}|${name.toUpperCase()}`
      if (!groups.has(k)) groups.set(k, { key: k, carrier, service, label_name: name, contents: o.mapping.contents || name, orders: [], labels: [] })
      const g = groups.get(k)
      if (!g.orders.includes(o)) g.orders.push(o)
      g.labels.push({ ...l, order: o })
    }
  }
  return [...groups.values()]
    .map(g => ({
      ...g,
      labels: g.labels.sort((a, b) => a.pageIndex - b.pageIndex).map((l, i) => ({ ...l, seq: i + 1 })),
      sort_key: sortKey({ carrier: g.carrier, service: g.service, label_name: g.label_name, items: g.orders[0]?.slip?.items || [] }),
    }))
    .sort((a, b) => a.sort_key.localeCompare(b.sort_key))
}

const CARRIER_ORDER = ['EVRI', 'DHL']

/** "2 x Pestshield Fly & Wasp Spray 300ml" → "pestshield fly & wasp spray 300ml": the product, whatever the pack. */
export function productFamily(items = []) {
  return items.map(i => decode(i.name || i.code).toLowerCase()
    .replace(/^\s*\d+\s*[x×]\s*/, '')
    .replace(/\(?\bpack of \d+\)?|\b\d+\s*(?:pk|pack)\b/g, '')
    .replace(/\s+/g, ' ').trim()).sort().join(' + ')
}

/** How many of the product an order holds: 2 of a 3-pack is 6. */
export function packUnits(items = []) {
  return items.reduce((sum, i) => {
    const name = decode(i.name || '')
    const lead = name.match(/^\s*(\d+)\s*[x×]/i)
    const pk = String(i.code || '').match(/(\d+)\s*PK\b/i) || name.match(/pack of (\d+)/i)
    const each = lead ? +lead[1] : pk ? +pk[1] : 1
    return sum + each * (parseInt(i.qty, 10) || 1)
  }, 0)
}

/**
 * The order products print in: Evri first, then DHL; Next Day before
 * Standard; then the same product together, smallest pack first — so the
 * packer works through 2 x, 3 x, 4 x of one thing in a row.
 */
export function sortKey({ carrier, service, label_name, items = [] }) {
  const c = CARRIER_ORDER.indexOf(String(carrier || '').toUpperCase())
  const sv = /next/i.test(service || '') ? 0 : 1
  const fam = productFamily(items) || String(label_name || '').toLowerCase()
  const units = String(packUnits(items) || 0).padStart(5, '0')
  return `${c < 0 ? 9 : c}|${sv}|${fam}|${units}|${String(label_name || '').toLowerCase()}`
}

/** Sort product lines the same way wherever they're listed or printed. */
export const byPrintOrder = (a, b) => {
  const k = (g) => g.sort_key || sortKey({ carrier: g.carrier, service: g.service, label_name: g.label_name })
  return k(a).localeCompare(k(b))
}

/** The words stamped on a label: kept to what a packer needs. */
export function stampText(labelName, seq, count, code) {
  const name = String(labelName || '').toUpperCase()
  return { name, count: `${seq} of ${count}${code ? ` · ${code}` : ''}`, line: `${name}  ${seq}/${count}${code ? ` · ${code}` : ''}` }
}

/** Today in the UK, as a date the database understands. */
export function londonDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// ── Dispatching ──────────────────────────────────────────────────────────────

/**
 * "10-25, 31" → the label numbers left over. Anything outside the batch or
 * unreadable is reported rather than ignored, so a typo can't mark the wrong
 * parcels as gone.
 */
export function parseRanges(text, max) {
  const set = new Set()
  const errors = []
  const tidy = String(text || '').replace(/\s*(?:-|–|—|\bto\b)\s*/gi, '-')
  for (const raw of tidy.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)) {
    const m = raw.match(/^(\d+)-(\d+)$|^(\d+)$/)
    if (!m) { errors.push(`"${raw}" isn't a number or range`); continue }
    const a = parseInt(m[1] ?? m[3], 10), b = parseInt(m[2] ?? m[3], 10)
    const lo = Math.min(a, b), hi = Math.max(a, b)
    if (lo < 1 || hi > max) { errors.push(`${raw} is outside 1–${max}`); continue }
    for (let n = lo; n <= hi; n++) set.add(n)
  }
  return { set, errors }
}

/** [10,11,12,…,25,31] → "10–25, 31" */
export function compressRanges(nums) {
  const s = [...new Set(nums)].map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`)
    i = j
  }
  return out.join(', ')
}

/** Now in the UK, as "HH:MM", for comparing with the cut-off. */
export function londonTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

/**
 * A label is late if it hasn't gone by the cut-off on its dispatch day:
 * any day before today, or today once the cut-off has passed.
 */
export function isDelayed(shipDate, { today = londonDate(), now = londonTime(), cutoff = '18:00' } = {}) {
  if (!shipDate) return false
  const d = String(shipDate).slice(0, 10)
  return d < today || (d === today && now >= cutoff)
}

/** Whole days late: 0 means late today. */
export function daysLate(shipDate, today = londonDate()) {
  const a = new Date(`${String(shipDate).slice(0, 10)}T12:00:00Z`), b = new Date(`${today}T12:00:00Z`)
  return Math.max(0, Math.round((b - a) / 86400000))
}

/**
 * What to pick for a batch: every item across its orders, added up. Each
 * order counts once however many labels it has.
 */
export function pickTotals(labels = [], unitsByCode = null) {
  const orders = new Map()
  for (const l of labels) {
    const k = `${l.upload_id || ''}|${l.order_key || l.id}`
    if (!orders.has(k)) orders.set(k, l.items || [])
  }
  const totals = new Map()
  for (const items of orders.values()) {
    if (unitsByCode) {
      // In real products: singles, packs and sets of one thing added up together
      for (const ln of orderUnits(items, unitsByCode)) {
        if (!totals.has(ln.base)) totals.set(ln.base, { code: '', name: ln.base, qty: 0 })
        totals.get(ln.base).qty += ln.units
      }
      continue
    }
    for (const it of items) {
      const k = normRef(it.code)
      if (!totals.has(k)) totals.set(k, { code: it.code, name: decode(it.name || it.code), qty: 0 })
      totals.get(k).qty += parseInt(it.qty, 10) || 0
    }
  }
  return [...totals.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
}

/**
 * Everything an upload turns into, given what's been decided so far:
 * the checked orders, the product lines to batch, and what's held back.
 * Used both when reading finishes in the background and on the review screen.
 */
export function planUpload(orders, mappings, { existing = [], overrides = {}, carrierFix = {}, manual = {}, helmCodes = null, unitsByCode = null } = {}) {
  const fixed = orders.map((o, i) => {
    const fix = carrierFix[`o${i}`]
    let out = fix?.carrier && fix?.service ? { ...o, labels: o.labels.map(l => (l.carrier ? l : { ...l, carrier: fix.carrier, service: fix.service })) } : o
    // A label with no slip, told what it is
    const m = manual[`o${i}`]
    if (!o.slip && m?.mapping) out = { ...out, slip: manualSlip(out.labels[0], m) }
    return out
  })
  const checked = checkOrders(fixed, mappings, { existing, helmCodes, unitsByCode })
  // Only orders checked every way go in on their own; anything the portal couldn't confirm waits for a person
  const included = (o) => (o.id in overrides ? overrides[o.id] && !!o.mapping : o.level === 'ok')
  const batches = buildBatches(checked, { include: included })
  const heldBack = checked.filter(o => !included(o))
  const needsYou = checked.filter(o => o.level !== 'ok' && !(o.id in overrides)).length
  return { checked, batches, heldBack, included, needsYou }
}

/** The slip a hand-made label would have had, from what the person said it is. */
export function manualSlip(label, { mapping, qty = 1, reason = 'replacement', note = '', originalRef = '' }) {
  const anyQty = String(mapping.item_key || '').endsWith('x*')
  const items = anyQty
    ? [{ ...(mapping.items?.[0] || {}), qty: Math.max(1, parseInt(qty, 10) || 1) }]
    : (mapping.items || []).map(i => ({ ...i }))
  return {
    manual: true, reason, note, originalRef, items,
    customer: label?.customer || '', postcode: label?.postcode || '',
    channelRef: originalRef || '', helmOrder: '', slipId: '',
  }
}

// ── Units: what each item code really is ─────────────────────────────────────

/**
 * A first guess at what an item code is, from its code and name:
 * "3 x Sanmex Fly & Wasp Killer 300ml" / SANMEX-…-300ML-3PK → 3 of
 * "Sanmex Fly & Wasp Killer 300ml". A person confirms it once.
 */
export function guessUnits(item = {}) {
  const name = decode(item.name || '').trim()
  const code = String(item.code || '')
  const lead = name.match(/^\s*(\d+)\s*[x×]\s*/i)
  const packOf = name.match(/\(?\bpack of (\d+)\)?/i)
  const pkCode = code.match(/(?:^|[-_])(\d+)\s*PK$/i) || code.match(/(?:^|[-_])(\d+)PK(?:[-_]|$)/i)
  const units = lead ? +lead[1] : packOf ? +packOf[1] : pkCode ? +pkCode[1] : 1
  const base = name
    .replace(/^\s*\d+\s*[x×]\s*/i, '')
    .replace(/\s*-?\s*\(?\bpack of \d+\)?/i, '')
    .replace(/\s+/g, ' ').trim() || code
  return { base_product: base, units: Math.max(1, units) }
}

/** An order's items as base products and unit counts; guesses where nothing's been set. */
export function orderUnits(items = [], unitsByCode = new Map()) {
  const out = []
  for (const it of items) {
    const qty = parseInt(it.qty, 10) || 0
    if (!qty) continue
    const known = unitsByCode.get(normRef(it.code))
    if (known?.components?.length) {
      // From HELM: a bundle is its parts, each a product of its own
      for (const c of known.components) out.push({ base: c.name, units: qty * (c.units || 1), guessed: false, code: it.code })
      continue
    }
    const g = known || guessUnits(it)
    out.push({ base: g.base_product, units: qty * (g.units || 1), guessed: !known || !known.confirmed, code: it.code })
  }
  return out
}

/**
 * The Dispatch Dashboard's figures, from label rows: each order counted
 * once, its units only "gone" when all its labels are dispatched, and
 * replacements kept apart from sales.
 */
export function summariseDispatch(labels = [], unitsByCode = new Map(), { cutoff = '18:00', person = '' } = {}) {
  const orders = new Map()
  const whoOf = (l) => l.packer || l.upload?.picker || l.batch?.upload?.picker || ''
  for (const l of labels) {
    if (l.status === 'cancelled' || l.status === 'held') continue
    if (person && whoOf(l) !== person) continue
    const k = `${l.upload_id}|${l.order_key || l.id}`
    if (!orders.has(k)) orders.set(k, { labels: [], first: l })
    orders.get(k).labels.push(l)
  }
  const products = new Map()
  const carriers = new Map()
  const pickers = new Map()
  const unconfirmed = new Map()
  const people = new Map()      // who → orders, parcels and units they dispatched, and by day
  const stamps = new Map()      // what was stamped on the labels → orders and parcels
  const days = new Map()        // dispatch day → orders gone
  let ordersN = 0, parcels = 0, unitsGone = 0, unitsWaiting = 0, replacements = 0, replacementUnits = 0
  let onTime = 0, late = 0, reprints = 0
  for (const o of orders.values()) {
    const f = o.first
    const isReplacement = !!f.reason && f.reason !== 'order'
    const gone = o.labels.every(l => l.status === 'dispatched')
    const lines = orderUnits(f.items || [], unitsByCode)
    ordersN++; parcels += o.labels.length
    if (isReplacement) replacements++
    for (const ln of lines) {
      if (ln.guessed) unconfirmed.set(normRef(ln.code), { code: ln.code, base: ln.base })
      if (!products.has(ln.base)) products.set(ln.base, { base: ln.base, orders: 0, gone: 0, waiting: 0, replacements: 0, guessed: false })
      const p = products.get(ln.base)
      if (isReplacement) { p.replacements += ln.units; replacementUnits += ln.units; continue }
      if (gone) { p.gone += ln.units; unitsGone += ln.units } else { p.waiting += ln.units; unitsWaiting += ln.units }
      p.guessed = p.guessed || ln.guessed
    }
    for (const base of new Set(lines.map(l => l.base))) if (!isReplacement) products.get(base).orders++
    // By what was stamped, and by who packed it
    const stamp = f.label_name || o.labels.find(l => l.label_name)?.label_name || 'Not named'
    if (!stamps.has(stamp)) stamps.set(stamp, { name: stamp, orders: 0, parcels: 0, gone: 0, replacements: 0 })
    const st = stamps.get(stamp)
    st.orders++; st.parcels += o.labels.length; if (gone) st.gone++; if (isReplacement) st.replacements++
    if (gone) {
      const lastOut = o.labels.map(l => l.dispatched_at).filter(Boolean).sort().pop()
      const day = lastOut ? londonDate(new Date(lastOut)) : (f.batch?.ship_date || String(f.created_at).slice(0, 10))
      days.set(day, (days.get(day) || 0) + 1)
      const who = whoOf(f) || 'Not recorded'
      if (!people.has(who)) people.set(who, { name: who, orders: 0, parcels: 0, units: 0, days: new Map() })
      const pp = people.get(who)
      pp.orders++; pp.parcels += o.labels.length
      pp.units += isReplacement ? 0 : lines.reduce((t, ln) => t + ln.units, 0)
      pp.days.set(day, (pp.days.get(day) || 0) + 1)
    }
    const carrier = `${f.carrier || 'Unknown'}`
    carriers.set(carrier, (carriers.get(carrier) || 0) + o.labels.length)
    const who = f.upload?.picker || f.batch?.upload?.picker
    if (who) pickers.set(who, (pickers.get(who) || 0) + o.labels.length)
    for (const l of o.labels) {
      reprints += l.reprint_count || 0
      if (l.status !== 'dispatched' || !l.dispatched_at) continue
      const day = l.batch?.ship_date || String(l.created_at).slice(0, 10)
      const sent = londonDate(new Date(l.dispatched_at)), at = londonTime(new Date(l.dispatched_at))
      if (sent < day || (sent === day && at <= cutoff)) onTime++
      else late++
    }
  }
  return {
    orders: ordersN, parcels, unitsGone, unitsWaiting, replacements, replacementUnits, reprints,
    onTimePct: onTime + late ? Math.round((onTime / (onTime + late)) * 100) : null,
    products: [...products.values()].sort((a, b) => (b.gone + b.waiting) - (a.gone + a.waiting) || a.base.localeCompare(b.base)),
    carriers: [...carriers.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    pickers: [...pickers.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    people: [...people.values()].map(p => ({ ...p, days: Object.fromEntries(p.days) })).sort((a, b) => b.orders - a.orders),
    stamps: [...stamps.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)),
    days: [...days.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day)),
    unconfirmed: [...unconfirmed.values()],
  }
}

// ── Label names that keep what matters ───────────────────────────────────────

// Words that describe rather than identify: the first to go when a name is too long
const FILLER = new Set(('with for the and of in a an to by on classic kitchen prep measurement measuring large small ' +
  'all purpose multi multipurpose household home premium quality professional heavy duty extra super ultra ' +
  'decorative scented formula range style use uk genuine bottles bottle per').split(' '))
const isSize = (w) => /\d/.test(w) || /^[X×+&/]$/.test(w)

/**
 * A name for the stamp that never loses the detail that tells products
 * apart. Names are brand, line, what it is, variety, size — so when one is
 * too long, filler goes first, then words from the middle (what it is),
 * never the brand, the variety at the end, or any size, weight or count.
 * Short enough names are kept whole.
 */
export function stampName(name, { max = 54 } = {}) {
  // A set of different things: shorten each part on its own, so each keeps its size
  const parts = decode(name || '').split(/\s+\+\s+/)
  if (parts.length > 1) {
    const whole = parts.map(p => stampName(p, { max: 999 })).join(' + ')
    if (whole.length <= max) return whole
    const each = Math.floor((max - 3 * (parts.length - 1)) / parts.length)
    return parts.map(p => stampName(p, { max: each })).join(' + ')
  }
  let n = decode(name || '').replace(/[()]/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  // "Pack of 6", "6 Pack", "6 Pieces" all say 6PK more shortly
  const leadQty = /^\s*\d+\s*[x×]/i.test(n)
  n = n.replace(/\s*-?\s*\bpack of (\d+)\b/i, (m, k) => (leadQty ? '' : ` ${k}PK`))
  n = n.replace(/\b(\d+)\s*(pack|pieces|pcs)\b/gi, '$1PK')
  n = n.replace(/\b(\d+)\s*count\b/gi, '$1CT')
  n = n.replace(/(\d)\s+(kg|g|ml|l|ltr|litre|litres|cl|cm|mm)\b/gi, '$1$2')
  n = n.replace(/\s+-\s+/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim()
  if (n.length <= max) return n
  const words = n.split(' ')
  const lead = /^\d+$/.test(words[0]) && /^[X×]$/.test(words[1] || '') ? 2 : 0
  const fixed = new Set([lead, lead + 1])                              // brand and line
  // Where the variety starts: the last two plain words before the size
  const plain = words.map((w, i) => i).filter(i => i >= lead && !isSize(words[i]))
  plain.slice(-2).forEach(i => fixed.add(i))
  const protectedWord = (i) => i < lead || fixed.has(i) || isSize(words[i])
  let keep = words.map((w, i) => protectedWord(i) || !FILLER.has(w.toLowerCase().replace(/[^a-z]/g, '')))
  const text = () => words.filter((_, i) => keep[i]).join(' ')
  // Then from the middle, left to right
  for (let i = lead + 2; i < words.length && text().length > max; i++) if (keep[i] && !protectedWord(i)) keep[i] = false
  // Still too long (rare): more from the middle, keeping the brand and the last word before the size
  const lastPlain = plain[plain.length - 1]
  for (let i = lead + 1; i < words.length && text().length > max; i++) if (keep[i] && !isSize(words[i]) && i !== lastPlain) keep[i] = false
  return text()
}

/** What to stamp for a set of items: each item's full name if it fits, the qty in front when more than one. */
export function suggestStamp(items = [], { names = new Map(), max = 54 } = {}) {
  const parts = items.map(it => {
    const full = names.get(normRef(it.code)) || it.name || it.code
    const each = stampName(full, { max: Math.floor(max / Math.max(1, items.length)) })
    return (parseInt(it.qty, 10) || 1) > 1 ? `${it.qty} X ${/^\d+ X /.test(each) ? `(${each})` : each}` : each
  })
  return parts.join(' + ')
}

/**
 * The details a stamp mustn't lose — sizes, weights, counts and the variety
 * words — that are in the suggested name but missing from the one in use.
 */
export function missingDetail(current, suggested) {
  const have = new Set(String(current || '').toUpperCase().replace(/[()]/g, ' ').split(/\s+/).map(w => w.replace(/[^A-Z0-9.]/g, '')))
  const words = String(suggested || '').toUpperCase().split(/\s+/)
  const plain = words.filter(w => !/\d/.test(w) && !/^[X×+&/]$/.test(w))
  const variety = new Set(plain.slice(-2))
  return words
    .map(w => w.replace(/[^A-Z0-9.]/g, ''))
    .filter(w => w && (/\d/.test(w) && !/^\d+$/.test(w) ? true : variety.has(w)))
    .filter(w => !have.has(w) && !have.has(w.replace(/L$/, 'ML')))
}

// ── HELM's own product list ──────────────────────────────────────────────────

/**
 * Rows from HELM's "Inventory Products and Groups" export into item units:
 * a product is 1 of itself; a group (bundle) is its parts — "FAIRY…-10PK" is
 * 10 × FAIRY…-320ML, and a mixed set lists each thing in it.
 */
export function helmProductsToUnits(rows = []) {
  const col = (r, ...names) => {
    for (const n of names) for (const k of Object.keys(r)) if (k.trim().toLowerCase() === n) return r[k]
    return undefined
  }
  const products = new Map()
  const groups = new Map()
  for (const r of rows) {
    const code = String(col(r, 'product code', 'code', 'sku') || '').trim()
    const name = String(col(r, 'product name', 'name') || '').trim()
    if (!code) continue
    const type = String(col(r, 'type') || '').trim().toUpperCase()
    if (type === 'GROUP') {
      const main = String(col(r, 'main product code', 'parent code') || '').trim()
      const qty = parseFloat(col(r, 'quantity per group', 'quantity', 'qty')) || 1
      if (!groups.has(code)) groups.set(code, { code, name, parts: [] })
      if (main) groups.get(code).parts.push({ code: main, qty })
    } else products.set(normRef(code), { code, name })
  }
  const out = []
  for (const p of products.values()) {
    out.push({ code_key: normRef(p.code), code: p.code, name: p.name, base_product: p.name, units: 1,
      components: [{ code: p.code, name: p.name, units: 1 }], confirmed: true, source: 'helm' })
  }
  for (const g of groups.values()) {
    const parts = g.parts.map(pt => ({ code: pt.code, name: products.get(normRef(pt.code))?.name || pt.code, units: Math.max(1, Math.round(pt.qty)) }))
    if (!parts.length) continue
    out.push({ code_key: normRef(g.code), code: g.code, name: g.name,
      base_product: parts.length === 1 ? parts[0].name : g.name, units: parts.length === 1 ? parts[0].units : 1,
      components: parts, confirmed: true, source: 'helm' })
  }
  return out
}

/** The next day the carriers collect: Monday to Saturday, so after Saturday it's Monday. */
export function nextWorkingDay(from = londonDate()) {
  const d = new Date(`${from}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0)
  return d.toISOString().slice(0, 10)
}

/**
 * What's stamped on each of an order's boxes. A parcel mapping names the whole
 * parcel. An "any quantity" item names one unit, and each box gets its own
 * count: 5 bags at 2 a box → "2 X …", "2 X …", "1 X …". Never guessed: if the
 * numbers don't add up the order is held before it gets here.
 */
export function boxStamps(mapping, items, labelCount, { anyQty = false, manual = false } = {}) {
  const name = mapping.label_name
  if (!anyQty) return Array.from({ length: labelCount }, () => name)
  const base = String(name).replace(/^\s*\d+\s*[X×]\s*/i, '').trim()
  const units = items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0)
  // One in the box: just its name; more: "2 X name" — the same wording every time
  const each = (n) => (n === 1 ? base : `${n} X ${base}`)
  if (manual || labelCount === 1) return [each(units)]
  const per = Math.max(1, mapping.parcels || 1)
  let left = units
  return Array.from({ length: labelCount }, () => { const n = Math.min(per, left); left -= n; return each(Math.max(n, 1)) })
}

/**
 * Which parcel mapping covers an order's items: the exact set first; for one
 * item, an "any quantity" set-up; or the single set up as one a box when
 * there's one label per unit.
 */
export function resolveMapping(items, labelCount, byKey) {
  const codes = [...new Set(items.map(i => normRef(i.code)))]
  // One item set up for any quantity: that's used for every quantity, so the same
  // box is always stamped the same way, whatever the order size
  const any = codes.length === 1 ? byKey.get(`${codes[0]}x*`) : null
  if (any) return { mapping: any, anyQty: true }
  const key = itemKey(items)
  const mapping = key ? byKey.get(key) || null : null
  if (mapping) return { mapping, anyQty: false }
  if (codes.length !== 1) return { mapping: null, anyQty: false }
  const units = items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0)
  const single = byKey.get(`${codes[0]}x1`)
  if (single && single.parcels === 1 && labelCount === units) return { mapping: { ...single, parcels: units }, anyQty: false }
  return { mapping: null, anyQty: false }
}

/**
 * Does a parcel mapping's stamp say the right number for what's in each box?
 * From HELM's units: an order's total units, shared over its boxes, is what
 * each box holds — and the stamp's count must match it. Returns null when it
 * agrees (or can't be known), or what's wrong.
 *   "2 X KILN DRIED SAND 25KG" on 2 boxes for 2 bags → each box holds 1, not 2.
 */
export function stampCountProblem(mapping, unitsByCode) {
  if (!mapping || String(mapping.item_key).endsWith('x*')) return null
  const items = mapping.items || []
  const totals = new Map()
  for (const it of items) {
    const known = unitsByCode.get(normRef(it.code))
    if (!known) return null
    const parts = known.components?.length ? known.components : [{ name: known.base_product, units: known.units || 1 }]
    for (const p of parts) totals.set(p.name, (totals.get(p.name) || 0) + (parseInt(it.qty, 10) || 0) * (p.units || 1))
  }
  if (totals.size !== 1) return null                       // a mixed set: the name lists each thing
  const total = [...totals.values()][0]
  const boxes = Math.max(1, mapping.parcels || 1)
  if (total % boxes) return `${total} units don't share evenly over ${boxes} boxes`
  const perBox = total / boxes
  const name = String(mapping.label_name || '').toUpperCase().replace(/×/g, 'X')
  // Counts the stamp states: "2 X (3 X …)" = 6, "2 X …" = 2, "… 6PK" = 6, none = 1
  const nested = name.match(/^\s*(\d+)\s*X\s*\(\s*(\d+)\s*X/)
  const lead = name.match(/^\s*(\d+)\s*X\b/)
  const said = nested ? +nested[1] * +nested[2] : lead ? +lead[1] : 1
  if (said === perBox) return null
  // A count inside the name ("… 6X 225ML", "… 6PK") can be what the box holds when the
  // stamp doesn't lead with one — but a pack word on a single product isn't a count of boxes
  if (!lead && !nested) {
    // "6 ROLLS", "6PK", "6X 225ML", "12 PIECES"… — a count of the things in the pack
    const inside = [...name.matchAll(/\b(\d+)\s*(?:PK|PACK|PACKS|X(?=\s|\d)|ROLLS?|PCS|PIECES?|CT|COUNT|BAGS?|BOTTLES?|CANS?|TINS?|SACHETS?|TABLETS?|CAPSULES?|PODS?|CANDLES?|BOXES|BOWLS?|JUGS?|SPRAYS?|PAIRS?|UP)\b/g)].map(m => +m[1])
    if (perBox === 1 || inside.includes(perBox)) return null
  }
  return { perBox, said, text: `Each box holds ${perBox}, but the stamp says ${said}` }
}

/** The corrected stamp for a mapping whose count is wrong: the right count and the product's full name. */
export function fixedStamp(mapping, unitsByCode, problem) {
  const it = (mapping.items || [])[0]
  const known = it && unitsByCode.get(normRef(it.code))
  const part = known?.components?.length === 1 ? known.components[0].name : known?.base_product
  const base = stampName(part || String(mapping.label_name).replace(/^\s*\d+\s*[X×]\s*(\()?/i, '').replace(/\)$/, ''))
  return problem.perBox === 1 ? base : `${problem.perBox} X ${base}`
}

// Box weight rules: DHL takes up to 25kg a box; under 15kg goes by Evri
export const MAX_BOX_KG = 25
export const EVRI_UNDER_KG = 15

/** The weight of one of an item, from its name: "2 x Scola Clay 12.5kg" = 25kg. Null when the name has no kg. */
export function itemKg(item = {}) {
  const name = decode(item.name || '')
  const kg = name.match(/(\d+(?:\.\d+)?)\s*kg\b/i)
  if (!kg) return null
  const lead = name.match(/^\s*(\d+)\s*[x×]\s*/i)
  return parseFloat(kg[1]) * (lead ? +lead[1] : 1)
}

/** How many of a weighed item fit in one box under the limit: 10kg → 2, 12.5kg → 2, 15kg and over → 1. */
export function unitsPerBox(item) {
  const kg = itemKg(item)
  return kg ? Math.max(1, Math.floor(MAX_BOX_KG / kg)) : null
}


/**
 * Where the day's orders are up to, grouped by what's stamped on the label.
 * An order is at the stage all its parcels have reached: To print → Printed →
 * Ready (packed) → Dispatched. Each order is counted once, at its stage.
 */
export const ORDER_STAGES = [
  { id: 'toPrint', label: 'To print', short: 'To print' },
  { id: 'printed', label: 'Printed', short: 'Printed' },
  { id: 'ready', label: 'Ready', short: 'Ready' },
  { id: 'dispatched', label: 'Dispatched', short: 'Sent' },
]

export function stageOfOrder(labels) {
  if (labels.every(l => l.status === 'dispatched')) return 'dispatched'
  if (labels.every(l => l.status === 'dispatched' || l.packed_at)) return 'ready'
  if (labels.every(l => l.status === 'dispatched' || l.packed_at || l.printed_at)) return 'printed'
  return 'toPrint'
}

export function stampProgress(labels = []) {
  const orders = new Map()
  let held = 0
  const heldSeen = new Set()
  for (const l of labels) {
    const k = `${l.upload_id}|${l.order_key || l.id}`
    if (l.status === 'held') { if (!heldSeen.has(k)) { heldSeen.add(k); held++ } continue }
    if (l.status === 'cancelled') continue
    if (!orders.has(k)) orders.set(k, [])
    orders.get(k).push(l)
  }
  const blank = () => ({ orders: 0, toPrint: 0, printed: 0, ready: 0, dispatched: 0 })
  const totals = blank()
  const stamps = new Map()
  for (const [key, ls] of orders) {
    const first = ls[0]
    const name = ls.find(l => l.label_name)?.label_name || first.batch?.label_name || 'Not named'
    const stage = stageOfOrder(ls)
    if (!stamps.has(name)) stamps.set(name, { name, ...blank(), list: [] })
    const st = stamps.get(name)
    st.orders++; st[stage]++; totals.orders++; totals[stage]++
    st.list.push({
      key, stage, parcels: ls.length,
      customer: ls.find(l => l.customer)?.customer || '', postcode: ls.find(l => l.postcode)?.postcode || '',
      ref: ls.find(l => l.channel_ref)?.channel_ref || first.order_key || '', batch: first.batch?.code || '',
    })
  }
  const order = { toPrint: 0, printed: 1, ready: 2, dispatched: 3 }
  const list = [...stamps.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name))
  list.forEach(st => st.list.sort((a, b) => order[a.stage] - order[b.stage] || String(a.customer).localeCompare(String(b.customer))))
  return { totals, stamps: list, held }
}

// ── HELM orders not labelled yet ─────────────────────────────────────────────

/**
 * What an order from HELM would be stamped as, before it has a label: its
 * parcel mapping's name where there is one (the words the warehouse already
 * knows), otherwise a name made from HELM's product names.
 *   one item set up for any quantity, 3 ordered → "3 X COMPOST 25KG"
 *   one per box, 2 ordered                       → "2 X COMPOST 25KG"
 */
export function orderStamp(items = [], byKey = new Map(), names = new Map()) {
  if (!items.length) return 'Unknown items'
  const units = items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0)
  const { mapping, anyQty } = resolveMapping(items, units, byKey)
  if (mapping) {
    if (anyQty) {
      const base = String(mapping.label_name).replace(/^\s*\d+\s*[X×]\s*/i, '').trim()
      return units === 1 ? base : `${units} X ${base}`
    }
    // Set up as one a box and sent one per unit: say how many
    if (!byKey.get(itemKey(items)) && units > 1) return `${units} X ${mapping.label_name}`
    return mapping.label_name
  }
  return suggestStamp(items, { names })
}

/**
 * Stock against everything waiting in HELM, per product: short (not enough in
 * the warehouse once uploaded orders are taken out), top-up (enough, but not
 * on the pick shelf), or missing (not in inventory at all).
 */
export function helmStockCheck(orders = [], stock = {}) {
  const need = new Map()
  for (const o of orders) for (const u of o.units || []) {
    const k = u.product_id || `code:${u.code}`
    need.set(k, (need.get(k) || 0) + (Number(u.qty) || 0))
  }
  const out = new Map()
  for (const [k, n] of need) {
    if (String(k).startsWith('code:')) { out.set(k, { level: 'missing', need: n, code: k.slice(5) }); continue }
    const s = stock[k] || {}
    const free = (Number(s.on_hand) || 0) - (Number(s.uploaded) || 0)
    const pickFree = (Number(s.pick) || 0) - (Number(s.uploaded) || 0)
    const level = n > free ? 'short' : n > pickFree ? 'topup' : 'ok'
    out.set(k, { level, need: n, free: Math.max(0, free), pickFree: Math.max(0, pickFree), name: s.name, code: s.code })
  }
  return out
}
