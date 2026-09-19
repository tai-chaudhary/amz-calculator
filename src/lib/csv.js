// Column definitions for bulk upload
export const CSV_COLUMNS = [
  { key: 'name',         label: 'Product Name',      required: true,  example: 'Fairy Washing Up Liquid 320ml',    note: 'Required' },
  { key: 'brand',        label: 'Brand',             required: false, example: 'Fairy',                            note: '' },
  { key: 'asin',         label: 'ASIN',              required: false, example: 'B08XYZ1234',                       note: 'Used to fetch product image + Amazon link' },
  { key: 'supplierName', label: 'Supplier Name',     required: false, example: 'Wholesale Direct Ltd',             note: '' },
  { key: 'supplierSku',  label: 'Supplier SKU',      required: false, example: 'SKU-12345',                        note: '' },
  { key: 'sellPrice',    label: 'Sell Price',        required: true,  example: '11.75',                            note: 'Inc. VAT, numbers only' },
  { key: 'costPrice',    label: 'Cost Price',        required: false, example: '5.70',                             note: 'Use for single items' },
  { key: 'costPerItem',  label: 'Cost Per Item',     required: false, example: '',                                 note: 'Use for bundles instead of Cost Price' },
  { key: 'bundleQty',    label: 'Bundle Qty',        required: false, example: '1',                                note: 'Leave as 1 for single items' },
  { key: 'adCost',       label: 'Ad Cost',           required: false, example: '0.50',                             note: 'Per unit' },
  { key: 'refFee',       label: 'Referral Fee %',    required: false, example: '15.3',                             note: 'Defaults to 15.3 if blank' },
  { key: 'vatZero',      label: 'Zero VAT',          required: false, example: 'no',                               note: 'yes / no' },
  { key: 'weightKg',     label: 'Weight KG',         required: false, example: '0.45',                             note: 'Single items: total weight' },
  { key: 'weightPerItem',label: 'Weight Per Item KG',required: false, example: '',                                 note: 'Bundles: weight of ONE item — total is calculated' },
  { key: 'serviceLevel', label: 'Service Level',     required: false, example: 'standard',                         note: 'standard / express / nextday' },
  { key: 'carrierName',  label: 'Carrier',           required: false, example: 'Royal Mail',                       note: 'Must match a carrier in Settings' },
  { key: 'carrierCat',   label: 'Carrier Category',  required: false, example: 'Small Parcel',                     note: 'Must match a category for that carrier' },
  { key: 'packagingName',label: 'Packaging',         required: false, example: 'Small Box',                        note: 'Must match packaging in Settings' },
  { key: 'notes',        label: 'Notes',             required: false, example: '',                                 note: '' },
  { key: 'pushLive',     label: 'Push Live',         required: false, example: 'no',                               note: 'yes = goes straight to Live Products' },
  { key: 'sendReview',   label: 'Send To Review',    required: false, example: 'no',                               note: 'yes = goes to Review queue' },
]

export function generateTemplateCsv() {
  const header = CSV_COLUMNS.map(c => c.label).join(',')
  const example = CSV_COLUMNS.map(c => {
    const v = c.example
    return v.includes(',') ? `"${v}"` : v
  }).join(',')
  const blank = CSV_COLUMNS.map(() => '').join(',')
  return `${header}\n${example}\n${blank}\n${blank}`
}

export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Simple CSV parser that handles quoted fields and embedded commas/newlines
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; continue }
      if (ch === '"') { inQuotes = false; i++; continue }
      field += ch; i++; continue
    }

    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  return rows.filter(r => r.some(c => c.trim() !== ''))
}

const yes = (v) => ['yes', 'y', 'true', '1', 'x'].includes(String(v || '').trim().toLowerCase())

/**
 * Turn parsed CSV rows into product objects, matching carrier/packaging names
 * against the user's actual settings.
 */
export function rowsToProducts(rows, settings) {
  if (rows.length < 2) return { products: [], errors: ['File appears to be empty or has no data rows.'] }

  const headerRow = rows[0].map(h => h.trim().toLowerCase())
  const errors = []
  const products = []

  // Map each expected column to its index in the uploaded file
  const colIndex = {}
  CSV_COLUMNS.forEach(col => {
    const idx = headerRow.indexOf(col.label.toLowerCase())
    if (idx !== -1) colIndex[col.key] = idx
  })

  if (colIndex.name === undefined) {
    return { products: [], errors: ['Could not find a "Product Name" column. Please use the template.'] }
  }
  if (colIndex.sellPrice === undefined) {
    return { products: [], errors: ['Could not find a "Sell Price" column. Please use the template.'] }
  }

  const get = (row, key) => {
    const idx = colIndex[key]
    return idx === undefined ? '' : (row[idx] || '').trim()
  }

  const { carriers = {}, packaging = [] } = settings || {}

  rows.slice(1).forEach((row, n) => {
    const lineNo = n + 2
    const name = get(row, 'name')
    if (!name) return // skip blank rows silently

    const sellPrice = get(row, 'sellPrice')
    if (!sellPrice || isNaN(parseFloat(sellPrice))) {
      errors.push(`Line ${lineNo} "${name}": missing or invalid Sell Price`)
      return
    }

    const bundleQty = parseInt(get(row, 'bundleQty')) || 1
    const costPerItem = get(row, 'costPerItem')
    const costPrice = get(row, 'costPrice')

    if (bundleQty > 1 && !costPerItem) {
      errors.push(`Line ${lineNo} "${name}": Bundle Qty is ${bundleQty} but Cost Per Item is empty`)
      return
    }
    if (bundleQty <= 1 && !costPrice) {
      errors.push(`Line ${lineNo} "${name}": missing Cost Price`)
      return
    }

    // Match carrier by name
    let carrierId = ''
    let carrierCatId = ''
    const carrierName = get(row, 'carrierName')
    if (carrierName) {
      const entry = Object.entries(carriers).find(([, c]) =>
        c.name.toLowerCase() === carrierName.toLowerCase())
      if (entry) {
        carrierId = entry[0]
        const catName = get(row, 'carrierCat')
        if (catName) {
          const cat = entry[1].categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
          if (cat) carrierCatId = cat.id
          else errors.push(`Line ${lineNo} "${name}": carrier category "${catName}" not found for ${entry[1].name} — shipping left unset`)
        }
      } else {
        errors.push(`Line ${lineNo} "${name}": carrier "${carrierName}" not found in Settings — shipping left unset`)
      }
    }

    // Match packaging by name
    let packagingId = ''
    const packName = get(row, 'packagingName')
    if (packName) {
      const pk = packaging.find(x => x.name.toLowerCase() === packName.toLowerCase())
      if (pk) packagingId = pk.id
      else errors.push(`Line ${lineNo} "${name}": packaging "${packName}" not found in Settings — left unset`)
    }

    const serviceLevel = (get(row, 'serviceLevel') || 'standard').toLowerCase()

    products.push({
      _line: lineNo,
      _pushLive: yes(get(row, 'pushLive')),
      _sendReview: yes(get(row, 'sendReview')),
      name,
      brand: get(row, 'brand'),
      asin: get(row, 'asin'),
      supplierName: get(row, 'supplierName'),
      supplierSku: get(row, 'supplierSku'),
      supplierUrl: '',
      productUrl: '',
      sellPrice,
      costPrice: bundleQty > 1 ? '' : costPrice,
      costPerItem: bundleQty > 1 ? costPerItem : '',
      bundleQty: String(bundleQty),
      adCost: get(row, 'adCost'),
      refFee: get(row, 'refFee') || '15.3',
      vatZero: yes(get(row, 'vatZero')),
      weightKg: bundleQty > 1 ? '' : get(row, 'weightKg'),
      weightPerItem: bundleQty > 1 ? get(row, 'weightPerItem') : '',
      weightOverride: false,
      serviceLevel,
      carrierId,
      carrierCatId,
      packagingId,
      parcelSplit: false,
      numParcels: '1',
      parcelWeights: [],
      parcelWeightsOverride: false,
      monthlyVolume: '',
      notes: get(row, 'notes'),
      reviewStatus: yes(get(row, 'sendReview')) ? 'review' : 'none',
    })
  })

  return { products, errors }
}


/** Plain-text download helper */
export function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Builds a complete brief the user can paste into ChatGPT (or hand to a VA),
 * including their ACTUAL carrier, category and packaging names from Settings
 * so nothing gets invented.
 */
export function generateAiBrief(settings) {
  const { carriers = {}, packaging = [] } = settings || {}

  const carrierLines = Object.values(carriers).map(c => {
    const cats = (c.categories || []).map(cat => `"${cat.name}"`).join(', ')
    return `  - "${c.name}"  (max ${c.maxWeight}kg)\n      valid categories: ${cats || 'none set'}`
  }).join('\n')

  const packagingLines = packaging.length
    ? packaging.map(p => `  - "${p.name}"`).join('\n')
    : '  (none configured)'

  const headerRow = CSV_COLUMNS.map(c => c.label).join(',')

  return `INSTRUCTIONS FOR FILLING THE PRODUCT UPLOAD CSV
================================================

I'm filling in a CSV template for an Amazon UK product profit calculator.
Fill ONLY the columns described below. Leave every other column completely
empty. Do not guess, and do not write "N/A", "0", "TBC" or placeholder text
in a cell you don't have real data for — an empty cell is always safe, a
wrong one corrupts the profit calculation.

The header row must stay EXACTLY as below. Do not rename, reorder, add or
remove columns:

${headerRow}


REQUIRED IN EVERY ROW
---------------------
Product Name   The listing title.
Sell Price     Amazon price INCLUDING VAT. Numbers only — no currency symbol,
               no thousands separators. Example: 11.75


COST — FILL ONE OF THESE, NEVER BOTH
------------------------------------
Single-item listing:
  Cost Price       Total cost of the one unit. Example: 5.70
  Bundle Qty       1 (or leave empty)
  Cost Per Item    LEAVE EMPTY

Bundle / multipack listing:
  Cost Per Item    Cost of ONE unit inside the bundle. Example: 1.90
  Bundle Qty       Number of units in the bundle. Example: 3
  Cost Price       LEAVE EMPTY — calculated as Cost Per Item x Bundle Qty


WEIGHT — SAME RULE, FILL ONE
----------------------------
Single-item listing:
  Weight KG            Shipped weight in kg. Example: 0.45
  Weight Per Item KG   LEAVE EMPTY

Bundle / multipack listing:
  Weight Per Item KG   Weight of ONE unit in kg. Example: 0.45
  Weight KG            LEAVE EMPTY — total is calculated automatically

Getting this wrong understates shipping cost and overstates profit, so if
the weight isn't known, leave BOTH empty rather than guessing.


OPTIONAL — ONLY IF THE DATA IS ACTUALLY KNOWN
---------------------------------------------
Brand              Brand name. Example: Fairy
ASIN               10-character Amazon ID. Example: B08XYZ1234
                   Never invent one. Blank means no product image and no
                   Amazon link in the system.
Supplier Name      Supplier or wholesaler name.
Supplier SKU       Supplier's own product code.
Ad Cost            Per-unit advertising cost. Empty if none.
Referral Fee %     Numbers only, e.g. 15.3. Empty defaults to 15.3.
Zero VAT           "yes" ONLY for zero-rated goods (most food, books,
                   children's clothing). Otherwise "no" or empty.
Notes              Free text.
Service Level      Must be EXACTLY one of: standard, nextday, prime
Push Live          "yes" or "no". Empty if unsure.
Send To Review     "yes" or "no". Empty if unsure.


CARRIER, CATEGORY AND PACKAGING — EXACT NAMES ONLY
--------------------------------------------------
These must match my configured settings character-for-character, including
spacing and dash type. Anything else is rejected on import. If you are not
certain, LEAVE THEM EMPTY — they can be set afterwards in the app.

Valid values for "Carrier" and "Carrier Category":

${carrierLines || '  (none configured)'}

Valid values for "Packaging":

${packagingLines}


FORMATTING RULES
----------------
- Output as CSV.
- Any cell containing a comma must be wrapped in double quotes.
- No currency symbols anywhere. Numbers only in numeric fields.
- One product per row.
- Do not add a totals row or any commentary rows.

Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
`
}

/**
 * Generic table export. `columns` is [{ header, value(row) }].
 */
export function exportRowsToCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(c.header)).join(',')
  const body = rows.map(r => columns.map(c => esc(c.value(r))).join(',')).join('\n')
  downloadCsv(filename, `${header}\n${body}`)
}

/** Timestamped filename, e.g. live-products-2026-09-18.csv */
export function stampedName(base) {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`
}
