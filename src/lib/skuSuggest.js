// Our SKUs follow one pattern: BRAND-TYPE-VARIANT-SIZE-PACK, e.g. PEACOC-SALT-WHITE-DEICING-25KG,
// 151-SPPAINT-GUN-METAL-GREY-400ML, TIDYZ-DOGBAG-BLACK-240PK. The suggestion reuses the brand and type
// codes already in use (every Elbow Grease product starts ELBGRS, every spray paint is SPPAINT), so new
// SKUs look like the old ones. New packs are always written …PK. It's only a suggestion: always editable.

const FILLER = new Set(['up', 'the', 'and', 'with', 'for', 'of', 'in', 'a', 'an', 'to', 'by', 'from', 'pack', 'pk', 'x', 'set', 'size',
  'count', 'ct', 'pcs', 'pieces', 'piece', 'per', 'only', 'new', 'brand', 'premium', 'quality', 'uk', 'value'])
// Words that are a scent, flavour or colour: the variant, when a range has several
const VARIANT_WORDS = new Set(['lemon', 'lime', 'orange', 'apple', 'cherry', 'strawberry', 'mint', 'peppermint', 'spearmint', 'vanilla',
  'lavender', 'rose', 'jasmine', 'lily', 'blossom', 'eucalyptus', 'coconut', 'mango', 'berry', 'raspberry', 'pomegranate',
  'citrus', 'ocean', 'fresh', 'original', 'orig', 'sensitive', 'unscented', 'fragrance', 'almond', 'manuka', 'honey', 'aloe',
  'black', 'white', 'grey', 'gray', 'silver', 'gold', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'brown', 'clear', 'rainbow',
  'khaki', 'natural', 'chocolate', 'caramel', 'cinnamon', 'spice', 'pine', 'linen', 'spring', 'summer', 'winter', 'autumn'])

const up = (s) => String(s || '').toUpperCase()
const clean = (s) => up(s).replace(/&/g, ' ').replace(/[^A-Z0-9.]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
// "De-Icing" → deicing, "Dri-Pak" → dripak, "Size 6" → size6 (a mailer size is part of what it is)
const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/([a-z])-(?=[a-z])/g, '$1')
  .replace(/\bsize\s*(\d+)/g, 'size$1').split(/[^a-z0-9.]+/).filter(Boolean)

/** The size as written for a SKU: 400ML, 2.376L, 12.5KG, 4X20G (several in one pack). */
export function skuSize(name) {
  const s = String(name || '').replace(/,/g, '.')
  const multi = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|l|ltr|litres?|g|kg|cm|mm)\b/i)
  if (multi) return `${multi[1]}X${multi[2]}${unit(multi[3])}`
  const one = s.match(/(\d+(?:\.\d+)?)\s*(ml|ltr|litres?|liter|l|kgs?|kg|g|gr|cm|mm)\b/i)
  return one ? `${one[1]}${unit(one[2])}` : ''
}
function unit(u) {
  const x = u.toLowerCase()
  return x.startsWith('l') ? 'L' : x.startsWith('kg') ? 'KG' : x === 'gr' ? 'G' : up(x)
}
/** The pack count (a bundle or multipack): "Pack of 8", "240 Pack", "2PK", "(4 Pieces)", "7 Count" → 8 / 240 / 2 / 4 / 7 */
export function skuPack(name) {
  const s = String(name || '').toLowerCase()
  const m = s.match(/pack of (\d+)/) || s.match(/\b(\d+)\s*(?:x\s*)?(?:pk|pack|pcs|pieces?|count|ct|rolls?|tablets|sachets|wipes|bags)\b/) || s.match(/\b(\d+)\s*'s\b/)
  const n = m ? +m[1] : 0
  return n > 1 && n < 10000 ? n : 0
}

/**
 * What the existing SKUs teach: brand codes (first word of the name → first part of the SKU) and type
 * codes (a product's words → its second part). existing: [{ code, name }]
 */
export function learnSkus(existing = []) {
  const brands = new Map()   // first name word → { code → count }
  const rows = []
  for (const e of existing) {
    const code = up(e.code)
    if (!code || /^\d+$/.test(code) || code.startsWith('NEW-') || !code.includes('-')) continue
    const parts = code.split('-')
    const w = words(e.name)
    if (!w.length) continue
    const m = brands.get(w[0]) || new Map(); m.set(parts[0], (m.get(parts[0]) || 0) + 1); brands.set(w[0], m)
    rows.push({ code, parts, w, first: w[0] })
  }
  const brandOf = new Map([...brands].map(([w, m]) => [w, [...m].sort((a, b) => b[1] - a[1])[0][0]]))
  return { brandOf, rows }
}

/** A brand code we haven't used yet: the brand, 6 letters at most (consonants kept first). */
function newBrandCode(brand) {
  const b = clean(brand).replace(/[^A-Z0-9]/g, '')
  if (b.length <= 6) return b
  const consonants = b[0] + b.slice(1).replace(/[AEIOU]/g, '')
  return (consonants.length >= 5 ? consonants : b).slice(0, 6)
}

/**
 * Suggest a SKU in the house style. Returns { sku, notes } — notes say what may be missing
 * (no size; a range with scents or colours but none found in the name).
 */
export function suggestSku(name, { brand = '', existing = [], learned = null } = {}) {
  const L = learned || learnSkus(existing)
  const w = words(name)
  if (!w.length) return { sku: '', notes: [] }
  const notes = []

  // Brand: the code we already use for it, or a new one
  const brandWords = brand ? words(brand) : []
  const first = brandWords[0] || w[0]
  let brandCode = L.brandOf.get(first) || newBrandCode(brand || w[0])
  const unbranded = /^unbrand/.test(first) || (!brand && L.brandOf.get(first) === 'UNBRND')
  if (unbranded) brandCode = 'UNBRND'
  // Words of the name that are the brand (e.g. "Elbow Grease", "Cotton Tree") come off the rest
  let rest = w.slice(brandWords.length || 1)
  // A two-word brand: its code isn't just the first word (COTTRE for Cotton Tree, ELBGRS for Elbow Grease),
  // and the products we have under it all share the second word
  const siblings = L.rows.filter(r => r.parts[0] === brandCode && r.first === first)
  const twoWord = !brandWords.length && siblings.length >= 1 && !up(first).startsWith(brandCode) && brandCode !== 'UNBRND'
  if (twoWord && rest.length && siblings.every(r => r.w[1] === rest[0])) rest = rest.slice(1)

  const size = skuSize(name)
  const pack = skuPack(name)
  const isMeasure = (x) => /^\d/.test(x) || /^(ml|l|g|kg|cm|mm|ltr|litres?|pk|pack|x)$/.test(x)
  const meaning = rest.filter(x => !FILLER.has(x) && !isMeasure(x))

  // Type: the code our closest existing product uses (same brand first, then any)
  const overlap = (r) => {
    const rw = new Set(r.w.slice(1)); let n = 0
    for (const x of meaning) if (rw.has(x) && !VARIANT_WORDS.has(x)) n++
    return n
  }
  const ranked = L.rows.map(r => ({ r, n: overlap(r), same: r.parts[0] === brandCode })).filter(x => x.n > 0)
    .sort((a, b) => (b.n + (b.same ? 0.5 : 0)) - (a.n + (a.same ? 0.5 : 0)))
  const near = ranked[0]
  let type = ''
  let used = new Set()
  if (near && near.n >= Math.min(2, meaning.filter(x => !VARIANT_WORDS.has(x)).length) && near.r.parts[1] && !/^\d/.test(near.r.parts[1])) {
    type = near.r.parts[1]
    // Words the closest SKU leaves out (or folds into its type code) are left out here too;
    // words it keeps (DEICING in PEACOC-SALT-WHITE-DEICING-25KG) stay
    for (const x of meaning) if (up(x) === type || (near.r.w.includes(x) && !VARIANT_WORDS.has(x) && !near.r.parts.includes(up(x)))) used.add(x)
  }
  const variant = meaning.filter(x => VARIANT_WORDS.has(x)).map(up)
  const other = meaning.filter(x => !VARIANT_WORDS.has(x) && !used.has(x)).map(up)
  const body = type ? [type, ...other.slice(0, 3), ...variant] : [...other.slice(0, 4), ...variant]

  const packPart = pack && !(size && size.includes('X')) ? `${pack}PK` : ''
  const sku = clean([brandCode, ...body, size, packPart].filter(Boolean).join('-')).slice(0, 48).replace(/-+$/, '')

  if (!size && !pack && !/\bsize\s*\d/i.test(name)) notes.push('No size in the name — add the weight, volume or pack size if it has one')
  // A range with scents, flavours or colours, but none in this name
  const range = L.rows.filter(r => r.parts[0] === brandCode && (!type || r.parts[1] === type))
  if (!variant.length && range.length >= 2 && range.some(r => r.w.some(x => VARIANT_WORDS.has(x)))) {
    notes.push('Others in this range have a scent, flavour or colour — add it if this one has one')
  }
  return { sku, notes }
}
