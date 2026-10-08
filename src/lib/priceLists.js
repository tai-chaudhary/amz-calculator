/**
 * Price list parsing. Each supplier formats their sheet differently, and each
 * has a trap an importer has to get right:
 *
 *   Pricecheck    — category rows mixed in with products; 11-digit barcodes
 *                   (UPCs that lost a leading zero in Excel)
 *   Sian          — two unlabelled columns headed "1.17" and "1.35" that are
 *                   the price in EUR and USD, not GBP; pharmacy-only lines
 *   Daler-Rowney  — a product barcode AND an outer-case barcode; only the
 *                   product one matches Amazon. Status and replacement codes.
 */

export function normBarcode(v) {
  let b = String(v ?? '').replace(/\D/g, '')
  if (!b) return ''
  if (b.length === 14 && b.startsWith('0')) b = b.slice(1)
  if (b.length === 11 || b.length === 12) b = b.padStart(13, '0')
  return [8, 13, 14].includes(b.length) ? b : ''
}

const clean = (v) => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
const num = (v) => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v ?? '').replace(/[£,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const up = (v) => clean(v).toUpperCase()

function findHeader(rows, test) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(up)
    if (test(cells)) return { index: i, cells }
  }
  return null
}
const col = (cells, ...names) => {
  for (const n of names) {
    const i = cells.findIndex(c => c === n || c.replace(/\s+/g, ' ') === n)
    if (i !== -1) return i
  }
  for (const n of names) {
    const i = cells.findIndex(c => c.includes(n))
    if (i !== -1) return i
  }
  return -1
}

// ── Pricecheck ────────────────────────────────────────────────────────────────
function parsePricecheck(rows, h) {
  const c = h.cells
  const I = {
    stock: col(c, 'AVAILABLE UNITS'), inner: col(c, 'INNER CASE'), outer: col(c, 'OUTER CASE'),
    name: col(c, 'DESCRIPTION'), sku: col(c, 'PRODUCT CODE'), expiry: col(c, 'EXPIRY DATE'),
    rsp: col(c, 'RSP'), price: col(c, 'PIECE PRICE £', 'PIECE PRICE'), barcode: col(c, 'BARCODE'),
    lang: col(c, 'LANGUAGES'),
  }
  const out = []; let category = ''; let skipped = 0
  for (const r of rows.slice(h.index + 1)) {
    if (!r || !r.some(v => clean(v))) continue
    const vals = r.map(clean).filter(Boolean)
    if (vals.length && new Set(vals).size === 1 && !num(r[I.price])) { category = vals[0]; continue }
    const sku = clean(r[I.sku]); const unitCost = num(r[I.price]); const name = clean(r[I.name])
    if (!sku || !name || unitCost === null) { skipped++; continue }
    const languages = clean(r[I.lang])
    const flags = []
    if (unitCost <= 0.05) flags.push('price looks wrong')
    if (unitCost >= 250) flags.push('possibly not a product')
    if (languages && !languages.split(/[;,]/).map(s => s.trim()).includes('EN')) flags.push('no English on pack')
    out.push({
      sku, name, unitCost, barcode: normBarcode(r[I.barcode]),
      data: {
        category, rsp: num(r[I.rsp]), stock: num(r[I.stock]),
        innerCase: num(r[I.inner]), caseSize: num(r[I.outer]),
        expiry: clean(r[I.expiry]) || null, languages: languages || null,
        rawBarcode: clean(r[I.barcode]), flags,
      },
    })
  }
  return { rows: out, skipped }
}

// ── Sian ──────────────────────────────────────────────────────────────────────
function parseSian(rows, h) {
  const c = h.cells
  const I = {
    sku: col(c, 'NO'), category: col(c, 'ITEM CATEGORY CODE'), barcode: col(c, 'EAN'),
    name: col(c, 'DESCRIPTION'), med: col(c, 'MED'), caseSize: col(c, 'CASE SIZE'),
    casePrice: col(c, 'CASE GBP'), stock: col(c, 'FLOOR STOCK'), dueIn: col(c, 'DUE IN'),
  }
  // "GBP" exactly — the columns headed 1.17 and 1.35 are EUR and USD
  I.price = c.findIndex(x => x === 'GBP')
  const out = []; let skipped = 0
  for (const r of rows.slice(h.index + 1)) {
    const sku = clean(r?.[I.sku]); const name = clean(r?.[I.name]); const unitCost = num(r?.[I.price])
    if (!sku || !name || unitCost === null || sku === 'NO') { skipped++; continue }
    const med = up(r[I.med])
    const pharmacyOnly = med.split('/').some(p => p === 'P')
    const flags = []
    if (pharmacyOnly) flags.push('pharmacy-only medicine')
    else if (med) flags.push(`medicine (${med})`)
    out.push({
      sku, name, unitCost, barcode: normBarcode(r[I.barcode]),
      data: {
        category: clean(r[I.category]), medClass: med || null, excluded: pharmacyOnly,
        caseSize: num(r[I.caseSize]), casePrice: num(r[I.casePrice]),
        stock: num(r[I.stock]), dueIn: num(r[I.dueIn]), flags,
      },
    })
  }
  return { rows: out, skipped }
}

// ── Daler-Rowney ──────────────────────────────────────────────────────────────
function parseDalerRowney(rows, h, discontinuedRows) {
  const c = h.cells
  const I = {
    status: col(c, 'STATUS'), sku: col(c, 'PRODUCT CODE'),
    replacement: col(c, 'NEW REPLACEMENT PRODUCT CODE', 'REPLACEMENT PRODUCT CODE'),
    technique: col(c, 'TECHNIQUE'), brand: col(c, 'BRAND'),
    barcode: col(c, 'EAN PRODUCT BARCODE'), minPack: col(c, 'MIN PACK QTY'),
    name: col(c, 'PRODUCT DESCRIPTION'), hazardous: col(c, 'HAZARDOUS'),
  }
  I.price = c.findIndex(x => x.includes('NET PRICE'))
  const out = []; let skipped = 0
  const seen = new Set()
  for (const r of rows.slice(h.index + 1)) {
    const sku = clean(r?.[I.sku]); const name = clean(r?.[I.name]); const unitCost = num(r?.[I.price])
    if (!sku || sku === '-' || !name || unitCost === null || up(sku) === 'PRODUCT CODE') { skipped++; continue }
    seen.add(sku)
    const status = up(r[I.status])
    const replacement = clean(r[I.replacement]); const hazardous = clean(r[I.hazardous])
    const flags = []
    if (/WHILE STOCKS LAST|DISCONTINUED/.test(status)) flags.push('being discontinued')
    if (/UNAVAILABLE/.test(status)) flags.push('temporarily unavailable')
    if (hazardous && hazardous !== '-') flags.push('hazardous')
    out.push({
      sku, name, unitCost, barcode: normBarcode(r[I.barcode]),
      data: {
        brand: clean(r[I.brand]), category: clean(r[I.technique]), status,
        replacement: replacement && replacement !== '-' ? replacement : null,
        caseSize: num(r[I.minPack]), hazardous: hazardous && hazardous !== '-' ? hazardous : null,
        flags,
      },
    })
  }
  // Their second tab: products gone for good
  if (discontinuedRows) {
    const hd = findHeader(discontinuedRows, cs => cs.includes('PRODUCT CODE') && cs.includes('PRODUCT DESCRIPTION'))
    if (hd) {
      const d = hd.cells
      const J = { sku: col(d, 'PRODUCT CODE'), name: col(d, 'PRODUCT DESCRIPTION'), barcode: col(d, 'EAN PRODUCT BARCODE'),
                  replacement: col(d, 'REPLACEMENT PRODUCT CODE'), brand: col(d, 'BRAND') }
      for (const r of discontinuedRows.slice(hd.index + 1)) {
        const sku = clean(r?.[J.sku]); const name = clean(r?.[J.name])
        if (!sku || sku === '-' || !name || seen.has(sku)) continue
        const repl = clean(r[J.replacement])
        out.push({
          sku, name, unitCost: null, barcode: normBarcode(r[J.barcode]),
          data: { brand: clean(r[J.brand]), status: 'DISCONTINUED - NO STOCK',
                  replacement: repl && repl !== '-' ? repl : null, flags: ['discontinued'] },
        })
      }
    }
  }
  return { rows: out, skipped }
}


/**
 * Some suppliers list the same product code twice at different quantities —
 * Daler-Rowney's clay is £8.32 each, or £7.71 each by the pallet of 80.
 * Keep the standard (smallest pack) price as the cost and hold the others
 * as price breaks, rather than silently dropping one.
 */
function mergeDuplicates(rows) {
  const bySku = new Map()
  for (const r of rows) {
    const k = r.sku.toLowerCase()
    if (!bySku.has(k)) { bySku.set(k, [r]); continue }
    bySku.get(k).push(r)
  }
  const out = []
  for (const group of bySku.values()) {
    if (group.length === 1) { out.push(group[0]); continue }
    const priced = group.filter(g => g.unitCost !== null)
    const sorted = [...(priced.length ? priced : group)]
      .sort((a, b) => (a.data.caseSize || 1) - (b.data.caseSize || 1))
    const main = sorted[0]
    const breaks = sorted.slice(1)
      .filter(g => g.unitCost !== null)
      .map(g => ({ minQty: g.data.caseSize || null, unitCost: g.unitCost, note: g.name }))
    out.push({ ...main, data: { ...main.data, priceBreaks: breaks,
      flags: [...(main.data.flags || []), ...(breaks.length ? ['volume price available'] : [])] } })
  }
  return out
}

// ── Entry point ───────────────────────────────────────────────────────────────
export const FORMATS = {
  pricecheck: { label: 'Pricecheck', supplier: 'Pricecheck Brand Partners' },
  sian: { label: 'Sian Wholesale', supplier: 'Sian Wholesale' },
  dalerrowney: { label: 'Daler-Rowney', supplier: 'Daler-Rowney' },
}

/** Parses a workbook read by SheetJS. Recognises the supplier from its headers. */
export function parsePriceList(XLSX, workbook) {
  const sheets = workbook.SheetNames.map(n => ({
    name: n, rows: XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, raw: true, defval: null }),
  }))
  for (const s of sheets) {
    const pc = findHeader(s.rows, c => c.includes('PIECE PRICE £') || (c.includes('BARCODE') && c.some(x => x.startsWith('PIECE PRICE'))))
    if (pc) { const r = parsePricecheck(s.rows, pc); return { format: 'pricecheck', ...r, rows: mergeDuplicates(r.rows) } }

    const sian = findHeader(s.rows, c => c.includes('EAN') && c.includes('CASE GBP') && c.includes('GBP'))
    if (sian) { const r = parseSian(s.rows, sian); return { format: 'sian', ...r, rows: mergeDuplicates(r.rows) } }

    const dr = findHeader(s.rows, c => c.includes('PRODUCT CODE') && c.some(x => x.includes('NET PRICE')))
    if (dr) {
      const disc = sheets.find(x => /DISCONTINUED/i.test(x.name))
      const r = parseDalerRowney(s.rows, dr, disc?.rows)
      return { format: 'dalerrowney', ...r, rows: mergeDuplicates(r.rows) }
    }
  }
  return { format: null, rows: [], skipped: 0 }
}

/** Best guess at a list's date from its file name, e.g. "…_15_09_2026" or "…_21_09". */
export function dateFromFileName(name) {
  const m = String(name).match(/(\d{1,2})[._-](\d{1,2})(?:[._-](\d{2,4}))?/)
  if (!m) return null
  const d = +m[1], mo = +m[2]
  let y = m[3] ? +m[3] : new Date().getFullYear()
  if (y < 100) y += 2000
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
