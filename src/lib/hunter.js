/**
 * Product hunter: reads a Helium 10 export, matches each Amazon listing to
 * products your suppliers sell, and works out what each would earn.
 *
 * Matching runs in tiers, strongest first:
 *   confirmed — a match you've approved before; always wins
 *   barcode   — the listing's EAN/GTIN appears on a supplier's list
 *   likely /  — same brand, same size, similar name; needs your confirmation
 *   possible
 *   none      — nothing suitable found
 */
import { parseCsv } from './csv.js'
import { normBarcode } from './priceLists.js'
import { calcProduct, carrierOptions } from './calc.js'

const LB = 0.45359237
const IN = 2.54

// ── Reading the export ───────────────────────────────────────────────────────

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[£,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const na = (v) => v === undefined || v === null || ['', 'n/a', 'na', '-'].includes(String(v).trim().toLowerCase())

/** Turns a Helium Black Box CSV into market listings. Units converted to kg and cm. */
export function parseHeliumExport(text, fileName = '') {
  const rows = parseCsv(text)
  if (rows.length < 2) return { listings: [], error: 'The file is empty.' }
  const head = rows[0].map(h => h.trim())
  const idx = (name) => head.findIndex(h => h.toLowerCase() === name.toLowerCase())
  const need = ['ASIN', 'Title', 'Price']
  if (need.some(n => idx(n) === -1)) {
    return { listings: [], error: "This doesn't look like a Helium 10 Black Box export — it needs ASIN, Title and Price columns." }
  }
  const get = (r, name) => { const i = idx(name); return i === -1 ? '' : (r[i] ?? '').trim() }

  const listings = []
  for (const r of rows.slice(1)) {
    const asin = get(r, 'ASIN')
    if (!/^[A-Z0-9]{10}$/i.test(asin)) continue
    const barcodes = [...new Set(['EAN', 'GTIN', 'UPC']
      .flatMap(k => na(get(r, k)) ? [] : get(r, k).split(/[;,\s]+/))
      .map(normBarcode).filter(Boolean))]
    const lengthIn = num(get(r, 'Length')), widthIn = num(get(r, 'Width')), heightIn = num(get(r, 'Height'))
    const weightLb = num(get(r, 'Weight'))
    const seller = get(r, 'Seller')
    listings.push({
      asin: asin.toUpperCase(),
      brand: get(r, 'Brand') || null,
      title: get(r, 'Title'),
      source_file: fileName,
      data: {
        price: num(get(r, 'Price')),
        sales: num(get(r, 'ASIN Sales')),
        parentSales: num(get(r, 'Parent Level Sales')),
        sellers: num(get(r, 'Number of Active Sellers')),
        seller: seller || null,
        amazonSelling: /^amazon(\.co\.uk)?$/i.test(seller),
        category: get(r, 'Category') || null,
        subcategory: get(r, 'Subcategory') || null,
        bsr: num(get(r, 'BSR')),
        reviews: num(get(r, 'Review Count')),
        rating: num(get(r, 'Reviews Rating')),
        barcodes,
        // Helium exports pounds and inches, even for the UK store
        weightKg: weightLb !== null ? +(weightLb * LB).toFixed(3) : null,
        dimsCm: [lengthIn, widthIn, heightIn].every(v => v !== null)
          ? [lengthIn, widthIn, heightIn].map(v => +(v * IN).toFixed(1)) : null,
      },
    })
  }
  return { listings, error: null }
}

// ── Pack sizes and product sizes ─────────────────────────────────────────────

// "Up to 2X longer lasting" is marketing, not a pack size
const MARKETING_X = /\b\d{1,2}\s*[x×]\s*(longer|more|faster|stronger|better|the|as|power|cleaning|grease|effective|fresh)/gi

const PACK_PATTERNS = [
  /^\s*\(?(\d{1,3})\s*[x×]\s/i,                                // "3X 151 Elbow Grease…" at the start
  /\b(\d{1,3})\s*[x×]\s*\d+\s*(?:pc|pcs|pk|pack)\b/i,             // "3 X 7pc"
  /\bpack of (\d{1,3})\b/i,
  /(?:ml|l|g|kg)\s*[x×]\s*(\d{1,3})\b/i,                  // "320 ml ×10"
  /\b(\d{1,3})\s*[x×]\s*(?=[a-z])/i,        // "6 x Fairy …"
  /\b(\d{1,3})\s*[x×]\s*\d+(?:\.\d+)?\s*(?:ml|l|g|kg)\b/i,   // "12x500ml"
  /\b[x×]\s*(\d{1,3})\b(?!\s*(?:ml|l|g|kg|cm|mm))/i,
  /\((\d{1,3})\s*-?\s*pack\)/i,
  /\b(\d{1,3})\s*-?\s*pack\b/i,
  /\b(\d{1,3})\s*pk\b/i,
  /\bbundle of (\d{1,3})\b/i,
  /\bset of (\d{1,3})\b/i,
]

/** How many units a listing title claims. 1 if it says nothing. */
export function packFromTitle(title) {
  const t = String(title || '').replace(MARKETING_X, ' ')
  for (const re of PACK_PATTERNS) {
    const m = t.match(re)
    if (m) {
      const n = parseInt(m[1])
      if (n >= 2 && n <= 200) return n
    }
  }
  return 1
}

/** A product's size in ml or g, e.g. "Fairy 320ml" -> { value: 320, unit: 'ml' }. */
export function sizeOf(text) {
  const m = String(text || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(ml|l|litre|litres|g|kg)\b/)
  if (!m) return null
  const v = parseFloat(m[1]); const u = m[2]
  if (u === 'l' || u.startsWith('litre')) return { value: v * 1000, unit: 'ml' }
  if (u === 'kg') return { value: v * 1000, unit: 'g' }
  return { value: v, unit: u }
}

const COUNT_RE = /\b(\d+)\s*(tablets?|tabs|pods?|capsules?|caps|blades?|refills?|cartridges?|count|ct|sheets?|wipes?|bags?|rolls?|pcs|pc|pieces?|cloths?|washes|wash|scoops?|sachets?)\b/i
/** The count inside a product, e.g. "Fairy Platinum 90 tablets" -> 90. Not the pack size. */
export function countOf(text) {
  // Join model numbers onto their name first: "Mach 3 Blades" is Mach3, not 3 blades
  const t = String(text || '').replace(/\b([a-z]{3,})\s+(\d)\b(?=\s+(?:turbo\s+)?(?:razor|blade|refill|disposable|cartridge|power))/gi, '$1$2')
  const m = t.match(COUNT_RE)
  if (m) return parseInt(m[1])
  // Trade shorthand: "BLADES 10'S", "TABLETS 62S"
  const s = t.match(/\b(\d{1,3})\s*'?\s*S\b/i)
  return s ? parseInt(s[1]) : null
}

const TYPES = ['blade','razor','gel','foam','cream','balm','liquid','spray','tablet','pod','capsule','wipe','powder',
  'shampoo','conditioner','deodorant','soap','bleach','cleaner','polish','refill','cartridge','bag','roll','glove',
  'sponge','cloth','brush','bar','granule','pellet','trap','bait','paint','glue','clay','marker','crayon','jug','bowl']
/** Which product types a name mentions — used so razor blades never match shaving gel. */
function typesOf(text) {
  const t = String(text || '').toLowerCase()
  return new Set(TYPES.filter(w => new RegExp(`\\b${w}s?\\b`).test(t)))
}

const STOP = new Set('the and with for of in a an pack x set bundle by new fresh uk all one easy effortless cleaning powerful'.split(' '))
function tokens(text, brand) {
  const b = new Set(String(brand || '').toLowerCase().split(/\s+/))
  return new Set(String(text || '').toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(ml|l|litre|litres|g|kg)\b/g, ' ')
    .replace(/\bpack of \d+|\d+\s*[x×]|\b[x×]\s*\d+/g, ' ')
    .match(/[a-z]{3,}/g)?.filter(w => !STOP.has(w) && !b.has(w)) || [])
}

// ── Matching ────────────────────────────────────────────────────────────────

/** Indexes supplier products for fast lookup. Excluded and unpriced lines never match. */
export function indexSupplierProducts(supplierProducts, suppliers) {
  const nameOf = (id) => suppliers.find(s => s.id === id)?.name || 'Supplier'
  const usable = supplierProducts.filter(sp =>
    sp.unit_cost !== null && sp.unit_cost > 0 && !sp.data?.excluded &&
    !/DISCONTINUED - NO STOCK/.test(sp.data?.status || ''))
  const byBarcode = new Map()
  for (const sp of usable) {
    if (!sp.barcode) continue
    if (!byBarcode.has(sp.barcode)) byBarcode.set(sp.barcode, [])
    byBarcode.get(sp.barcode).push(sp)
  }
  for (const list of byBarcode.values()) list.sort((a, b) => a.unit_cost - b.unit_cost)
  return { usable, byBarcode, nameOf }
}

/** Every supplier offering the same barcode, cheapest first. */
export function offersFor(barcode, index) {
  return index.byBarcode.get(barcode) || []
}


/**
 * Model markers: the number or numeral that identifies a product line —
 * Mach3, Fusion5, Blue II, Sensor3, "Gillette 2". Blue II and Blue 3 are
 * different products, so these must agree.
 */
export function modelMarks(text) {
  let t = ` ${String(text || '').toLowerCase()} `
  t = t.replace(/([a-z])(iii|ii|iv)\b/g, '$1 $2')
       .replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\biv\b/g, '4')
  const marks = new Set()
  for (const m of t.matchAll(/\b([a-z]{3,})(\d)\b/g)) marks.add(m[1] + m[2])
  for (const m of t.matchAll(/\b([a-z]{3,}) (\d)\b(?!\s*(?:ml|l|g|kg|x|×|pack|pk|pcs|pieces?|count|ct|tablets?|pods?|capsules?|in 1|in one|'s|s\b))/g)) marks.add(m[1] + m[2])
  return marks
}

/** Standalone numbers that could be a count: "Deep Clean 42", "Lemon, 77". */
function bareNumbers(title) {
  const t = String(title || '')
    .replace(/\d+(?:\.\d+)?\s*(?:ml|l|litre|g|kg|cm|mm)\b/gi, ' ')
    .replace(/\bpack of \d+|\d+\s*[x×]|[x×]\s*\d+|\d+\s*-?\s*(?:pack|pk)\b/gi, ' ')
    .replace(/\b(?:all|2)[- ]in[- ](?:1|one)\b/gi, ' ')
  return [...t.matchAll(/(?<![\w.])(\d{2,3})(?![\w.])/g)].map(m => parseInt(m[1]))
}

/** Several products in one listing: "2 x Original, 2 x Lemon, 2 x Pomegranate". */
export function isMixedBundle(title) {
  return (String(title || '').match(/\b\d+\s*[x×]\s*[a-z]/gi) || []).length >= 2
}


/** What one of the supplier's units contains: "POWER CLOTHS 7 PACK" -> 7. */
function supplierCount(name) {
  const c = countOf(name)
  if (c) return c
  const m = String(name || '').match(/\b(\d{1,3})\s*(?:pack|pk|pcs|pc)\b/i)
  return m ? parseInt(m[1]) : null
}
const REFILL_WORDS = /\b(refills?|cartridges?|replacement blades?|blades? refills?)\b/i

// Products bought and sold by the piece: "pack of 8" usually means 8 of them
const COUNT_TYPES = new Set(['blade', 'tablet', 'pod', 'capsule', 'refill', 'cartridge', 'wipe', 'bag', 'sachet', 'razor', 'cloth'])
// Words a supplier name can include that a listing may reasonably leave out
const OPTIONAL_WORDS = new Set(['case', 'outer', 'men', 'mens', 'women', 'womens', 'refill', 'refills', 'bottle', 'bottles', 'can', 'tub', 'pcs', 'pieces', 'piece', 'count', 'wash', 'washes', 'large', 'small', 'medium'])
const stem = (w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)
const stems = (set) => new Set([...set].map(stem))

function nameMatch(listing, index) {
  const brand = String(listing.brand || '').toUpperCase().trim()
  if (!brand) return null
  // Exports often mix in sister brands (Bold and Ariel turn up in a Fairy export),
  // so the title itself has to name the brand
  if (!String(listing.title || '').toUpperCase().includes(brand)) return null

  index.byBrand = index.byBrand || new Map()
  if (!index.byBrand.has(brand)) {
    const lines = index.usable
      .filter(sp => String(sp.name || '').toUpperCase().includes(brand))
      .map(sp => ({ sp, words: stems(tokens(sp.name, listing.brand)) }))
    index.byBrand.set(brand, lines)
  }
  const lines = index.byBrand.get(brand)
  const vocab = new Set(lines.flatMap(x => [...x.words]))

  const lt = stems(tokens(listing.title, listing.brand))
  const ls = sizeOf(listing.title)
  const lc = countOf(listing.title)
  const lty = typesOf(listing.title)
  const pack = packFromTitle(listing.title)
  const byCount = [...lty].some(t => COUNT_TYPES.has(t))
  const lm = modelMarks(listing.title)
  const bare = byCount && !lc ? bareNumbers(listing.title) : []
  const mixed = isMixedBundle(listing.title)

  let best = null
  for (const { sp, words: st } of lines) {
    if (!st.size || !lt.size) continue

    // Every meaningful word in the supplier's name must be in the title.
    // Supplier names are short and titles long, so this is fair — and it
    // stops "Fusion ProGlide" matching "SkinGuard", or Platinum matching Original.
    if ([...st].some(w => !lt.has(w) && !OPTIONAL_WORDS.has(w))) continue

    // Model numbers must agree: Blue II is not Blue 3, Mach3 is not Fusion5
    const sm = modelMarks(sp.name)
    if ([...sm].some(x => !lm.has(x))) continue

    // If a more specific line of the same product exists (Platinum Plus vs
    // Platinum), this less specific one isn't the match
    const extra = [...lt].filter(w => vocab.has(w) && !st.has(w))
    if (extra.some(w => lines.some(o => o.sp !== sp && o.words.has(w) &&
        [...st].filter(x => !o.words.has(x)).length <= 1))) continue

    // Sizes must agree when both are stated
    const ss = sizeOf(sp.name)
    if (ls && ss && (ls.unit !== ss.unit || Math.abs(ls.value - ss.value) > ls.value * 0.02)) continue

    // Product types must overlap: razor blades are not shaving gel
    const sty = typesOf(sp.name)
    if (sty.size && lty.size && ![...sty].some(t => lty.has(t))) continue

    // Refills and cartridges are not the razor they fit
    if (REFILL_WORDS.test(listing.title) && !REFILL_WORDS.test(sp.name) && !/\bblades?\b/i.test(sp.name)) continue

    // Work out how many of the supplier's product make up the listing
    const sc = supplierCount(sp.name)
    let units = null, fromCount = false
    if (sc && byCount) {
      // "10 blades x 3" -> 3; "8 pieces" of a 4-pack -> 2; "pack of 8" blades of a 4-pack -> 2
      let total = lc ? lc * (pack > 1 && pack !== lc ? pack : 1) : (pack > 1 ? pack : null)
      // A bare number can be the count ("Deep Clean 42") — if one fits, use it;
      // if numbers are there but none fit, it's a different pack size
      if (!total && bare.length) {
        const fit = bare.find(n => n % sc === 0)
        if (fit === undefined) continue
        total = fit
      }
      if (total) {
        if (total % sc !== 0) continue          // 42 tablets can't be made from boxes of 77
        units = total / sc
        fromCount = units > 1
      } else units = 1
    } else if (lc && sc) {
      if (lc % sc !== 0) continue
      units = lc / sc
      fromCount = units > 1
    }

    const inter = [...lt].filter(w => st.has(w)).length
    let score = Math.max(inter / new Set([...lt, ...st]).size, inter / st.size * 0.8)
    if (ls && ss) score += 0.2
    if ((ls && !ss) || (!ls && ss)) score -= 0.15

    const countUnknown = byCount && sc && !lc && pack <= 1 && !bare.length
    const uncertain = extra.length > 1 || (extra.length === 1 && score < 0.75) ||
      (ls && !ss) || (!ls && ss) || (sty.size && !lty.size) || (lc && !sc && byCount) || fromCount || countUnknown || mixed
    if (!best || score > best.score) best = { sp, score, uncertain, multiple: units, fromCount, mixed }
  }
  if (!best || best.score < 0.4) return null
  return { ...best, tier: best.score >= 0.6 && !best.uncertain ? 'likely' : 'possible' }
}


/**
 * "Pack of 8" in a title is ambiguous: 8 separate items, or one retail pack
 * that contains 8. If the supplier's product is itself the 8-pack, the
 * listing is one of it.
 */
function supplierAlreadyPack(spName, qty) {
  if (qty <= 1) return false
  const n = String(spName || '').toUpperCase()
  const re = new RegExp(`(^|[^0-9])${qty}\\s*(PK|PACK|PCS|PIECES|CT|COUNT|BLADES?|REFILLS?|CARTRIDGES?|TABLETS?|PODS?|WIPES?|BAGS?|ROLLS?|S\\b)|\\b[X×]\\s*${qty}\\b|PACK OF ${qty}\\b`)
  return re.test(n)
}

/**
 * Finds what a listing is made of. Confirmed decisions win, then barcodes,
 * then names. Returns components as supplier products with quantities.
 */
export function matchListing(listing, index, confirmed) {
  const conf = confirmed.get(listing.asin)
  if (conf?.status === 'rejected') return { tier: 'rejected', components: [] }
  if (conf?.status === 'confirmed' && conf.components?.length) {
    const comps = conf.components.map(c => {
      const offers = offersFor(c.barcode, index)
      return offers.length ? { sp: offers[0], qty: c.qty, offers } : null
    }).filter(Boolean)
    if (comps.length) return { tier: 'confirmed', components: comps, feeCategory: conf.fee_category }
  }

  const qty = packFromTitle(listing.title)
  for (const bc of listing.data?.barcodes || []) {
    const offers = offersFor(bc, index)
    if (offers.length) {
      const q = supplierAlreadyPack(offers[0].name, qty) ? 1 : qty
      // A barcode match whose names share nothing is a data error, not a match
      const shared = [...tokens(listing.title, '')].filter(w => tokens(offers[0].name, '').has(w))
      if (!shared.length) {
        return { tier: 'possible', components: [{ sp: offers[0], qty: q, offers }], qtyFromTitle: q > 1, barcodeConflict: true }
      }
      return { tier: 'barcode', components: [{ sp: offers[0], qty: q, offers }], qtyFromTitle: q > 1 }
    }
  }

  const nm = nameMatch(listing, index)
  if (nm) {
    const offers = nm.sp.barcode ? offersFor(nm.sp.barcode, index) : [nm.sp]
    const sp = offers[0] || nm.sp
    const q = nm.multiple != null ? nm.multiple : (supplierAlreadyPack(sp.name, qty) ? 1 : qty)
    return { tier: nm.tier, score: +nm.score.toFixed(2), components: [{ sp, qty: q, offers: offers.length ? offers : [nm.sp] }], qtyFromTitle: q > 1 && nm.multiple == null, qtyFromCount: nm.fromCount ? nm.multiple : null, mixed: !!nm.mixed }
  }
  return { tier: 'none', components: [] }
}

// ── Fee category (estimate) ──────────────────────────────────────────────────

const CATEGORY_MAP = [
  [/grocery|food|drink/i, 'Grocery and Gourmet'],
  [/health|personal care|beauty|cosmetic/i, 'Beauty, Health and Personal Care'],
  [/baby/i, 'Baby Products'],
  [/pet/i, 'Pet Supplies'],
  [/toy|game/i, 'Toys and Games'],
  [/stationery|office/i, 'Office Products'],
  [/garden|outdoor living|lawn/i, 'Lawn and Garden'],
  [/diy|tools|home improvement/i, 'Tools and Home Improvement'],
  [/automotive|car/i, 'Automotive and Powersports'],
  [/sport/i, 'Sports and Outdoors'],
  [/business|industr|scientific/i, 'Business, Industrial & Scientific Supplies'],
  [/musical/i, 'Musical Instruments and AV Production'],
  [/kitchen/i, 'Kitchen'],
  [/home/i, 'Home Products'],
]

/** Best guess from Helium's category. Always an estimate until verified on Amazon. */
export function estimateFeeCategory(category) {
  for (const [re, name] of CATEGORY_MAP) if (re.test(category || '')) return name
  return 'Everything else'
}

// ── Packaging ────────────────────────────────────────────────────────────────

function dimsFromName(name) {
  const m = String(name || '').match(/(\d{2,4})\s*x\s*(\d{2,4})(?:\s*x\s*(\d{2,4}))?/i)
  if (!m) return null
  return m[3] ? { kind: 'box', mm: [+m[1], +m[2], +m[3]].sort((a, b) => a - b) }
              : { kind: 'mailer', mm: [+m[1], +m[2]].sort((a, b) => a - b) }
}

const FRAGILE = /\b(glass|pyrex|ceramic|porcelain|mirror|crystal)\b/i

/**
 * Suggests packaging: what you've used before for this product, then glass
 * packaging for fragile items, then the cheapest option it physically fits in.
 */
export function suggestPackaging({ title, weightKg, dimsCm, stockItemId, qty }, packaging, savedProducts) {
  // 1. Your own history for this product at this pack size
  if (stockItemId) {
    const prior = savedProducts.find(r => {
      const c = r.data?.components
      return c?.length === 1 && c[0].stockItemId === stockItemId && (parseInt(c[0].qty) || 1) === qty &&
        (r.data?.packagingId || r.data?.ownPackaging)
    })
    if (prior) return {
      packagingId: prior.data.ownPackaging ? '' : prior.data.packagingId,
      ownPackaging: !!prior.data.ownPackaging,
      reason: `as used on "${prior.name}"`, confidence: 'history',
    }
  }

  // 2. Fragile
  if (FRAGILE.test(title || '')) {
    const size = (weightKg || 0) <= 0.55 ? 'Small' : (weightKg || 0) <= 1.6 ? 'Medium' : 'Large'
    const p = packaging.find(x => new RegExp(`^${size} Glass`, 'i').test(x.name))
    if (p) return { packagingId: p.id, reason: 'fragile item', confidence: 'rule' }
  }

  // 3. Smallest cheapest thing it fits in
  if (dimsCm) {
    const [a, b, c] = dimsCm.map(v => v * 10).sort((x, y) => x - y)   // mm, thinnest first
    const fits = packaging.map(p => ({ p, d: dimsFromName(p.name) })).filter(({ d }) => {
      if (!d) return false
      if (d.kind === 'mailer') {
        const [w, l] = d.mm
        // An envelope wraps round the item, so its thickness eats into both sides
        return a <= 60 && (weightKg || 0) <= 2.6 && a + b <= w && a + c <= l
      }
      const [x, y, z] = d.mm
      return a <= x && b <= y && c <= z
    }).sort((m, n) => m.p.cost - n.p.cost)
    if (fits.length) return { packagingId: fits[0].p.id, reason: 'smallest that fits', confidence: 'fit' }
  }

  // 4. Fall back on weight
  const byName = (re) => packaging.find(p => re.test(p.name))
  const w = weightKg || 0
  const p = w <= 0.45 ? byName(/Size 6/i) : w <= 2.5 ? byName(/Size 8/i) : byName(/^Large Box/i)
  return p ? { packagingId: p.id, reason: 'estimated from weight', confidence: 'estimate' }
           : { packagingId: '', reason: 'no packaging found', confidence: 'none' }
}

// ── Economics ────────────────────────────────────────────────────────────────

/**
 * What a matched listing would earn, using your real carrier rates and
 * packaging, and the supplier's cheapest unit price.
 */
export function evaluateListing(listing, match, { settings, savedProducts, stockItems }) {
  const d = listing.data || {}
  if (!match.components.length || !(d.price > 0)) return null

  const cost = match.components.reduce((s, c) => s + c.sp.unit_cost * c.qty, 0)
  const units = match.components.reduce((s, c) => s + c.qty, 0)
  const main = match.components[0]
  const stockItem = stockItems.find(si => si.data?.barcode && si.data.barcode === main.sp.barcode)

  // Helium's weight is for the listing as sold; fall back to a product's unit weight
  const weightKg = d.weightKg || (parseFloat(stockItem?.data?.weightKg) || 0) * units || 0
  const service = 'nextday'
  const carrier = carrierOptions(weightKg, service, settings.carriers)[0]
  const pack = suggestPackaging({ title: listing.title, weightKg, dimsCm: d.dimsCm, stockItemId: stockItem?.id, qty: main.qty },
    settings.packaging, savedProducts)
  // Fees: only trust a category that's been confirmed, or one of your own
  // listings for the same product. Otherwise assume 15.3% so an estimate can
  // never make a product look better than it is.
  const ownListing = stockItem && savedProducts.find(r =>
    (r.data?.components || []).some(c => c.stockItemId === stockItem.id) && (r.data?.feeCategory || r.data?.refFee))
  const knownCategory = match.feeCategory || ownListing?.data?.feeCategory || null
  const knownRate = !knownCategory && ownListing?.data?.refFee ? ownListing.data.refFee : null
  const guessedCategory = estimateFeeCategory(d.category)
  const feeCategory = knownCategory || (knownRate ? '' : 'Everything else')
  const feeSource = knownCategory ? 'confirmed' : knownRate ? 'your listing' : 'assumed 15.3%'

  const p = {
    sellPrice: String(d.price), costPrice: String(cost), bundleQty: '1',
    weightKg: String(weightKg), serviceLevel: service,
    carrierId: carrier?.carrierId || '', carrierCatId: carrier?.catId || '',
    packagingId: pack.packagingId || '', ownPackaging: !!pack.ownPackaging,
    feeCategory, refFee: knownRate || '15.3', vatZero: false,
  }
  const r = calcProduct(p, settings.carriers, settings.packaging, [])
  // What it would earn if Helium's category turned out to be right
  const upside = !knownCategory && !knownRate && guessedCategory !== 'Everything else'
    ? calcProduct({ ...p, feeCategory: guessedCategory }, settings.carriers, settings.packaging, []) : null
  const sales = d.sales || 0
  return {
    ...r, cost, units, weightKg, carrier, pack, feeCategory, feeSource, guessedCategory, stockItem,
    upsideProfit: upside && upside.netProfit > r.netProfit + 0.005 ? upside.netProfit : null,
    monthlyMarketProfit: r.netProfit * sales,
    product: p,
  }
}

/** Why a listing might not be worth it, even if the numbers look good. */
export function flagsFor(listing, match, ev) {
  const d = listing.data || {}
  const f = []
  if (d.amazonSelling) f.push({ tone: 'alert', text: 'Amazon sells this' })
  if ((d.sellers || 0) >= 15) f.push({ tone: 'paused', text: `${d.sellers} sellers` })
  if (!d.weightKg) f.push({ tone: 'paused', text: 'no weight — shipping estimated' })
  if (match.mixed) f.push({ tone: 'alert', text: 'mixed bundle — only one product matched' })
  if (match.barcodeConflict) f.push({ tone: 'alert', text: "barcode matches but the names don't" })
  if (match.qtyFromCount) f.push({ tone: 'quiet', text: `×${match.qtyFromCount} worked out from piece count` })
  if (match.qtyFromTitle) f.push({ tone: 'quiet', text: `×${match.components[0]?.qty} read from title` })
  if (ev && ev.netProfit < 0) f.push({ tone: 'alert', text: 'loses money' })
  if (ev && ['likely', 'possible'].includes(match.tier) && ev.margin > 40)
    f.push({ tone: 'alert', text: 'margin unusually high — check the match' })
  const flags = match.components.flatMap(c => c.sp.data?.flags || [])
  if (flags.some(x => /discontinued/.test(x))) f.push({ tone: 'alert', text: 'being discontinued' })
  if (flags.some(x => /medicine/.test(x))) f.push({ tone: 'paused', text: 'medicine' })
  if (flags.some(x => /English/.test(x))) f.push({ tone: 'paused', text: 'no English on pack' })
  return f
}
