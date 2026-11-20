// Linking Inventory and Products: they're the same product, one to one. These only suggest — the office
// confirms every link. Sizes and pack counts are compared separately, because "Plenty FlexiSheets 2 Rolls"
// and "Plenty FlexiSheets 12 Rolls" share every word but aren't the same product.

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'in', 'a', 'pack', 'pk', 'x', 'pcs', 'pc', 'piece', 'pieces', 'per', 'set',
  'unbranded', 'size', 'count', 'ct', 'rolls', 'roll', 'sheets', 'sht', 'sh'])

const UNIT = { ml: 'ml', l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', g: 'g', gr: 'g', kg: 'kg', kgs: 'kg', cm: 'cm', mm: 'mm' }

/** Words that say what it is (lowercase, singular-ish, no sizes or filler). */
export function nameWords(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '')
    .split(/[^a-z0-9.]+/).filter(Boolean)
    .filter(w => !/^\d/.test(w) && !STOP.has(w))
    .map(w => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'))
}

/**
 * Every size and pack count in a name, as comparable strings: "500ml", "2.5l" → "2500ml", "20kg" → "20000g",
 * "4 rolls" / "4pk" / "pack of 4" / "4's" / "(4x)" → "×4". "2x80sht" → "×2".
 */
export function sizesOf(name) {
  const s = String(name || '').toLowerCase().replace(/,/g, '.')
  const out = new Set()
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(ml|ltr|litres?|liter|l|kgs?|kg|gr|g|cm|mm)\b/g)) {
    const n = parseFloat(m[1]); const u = UNIT[m[2]] || m[2]
    if (u === 'l') out.add(`${+(n * 1000).toFixed(3)}ml`)
    else if (u === 'kg') out.add(`${+(n * 1000).toFixed(3)}g`)
    else out.add(`${n}${u}`)
  }
  const packs = [
    ...s.matchAll(/(\d+)\s*(?:x\s*)?(?:pk|pack|rolls?|pcs|pieces?|count|ct|'s|s\b)/g),
    ...s.matchAll(/pack of (\d+)/g),
    ...s.matchAll(/\b(\d+)\s*x\s*\d/g),
  ]
  for (const m of packs) if (+m[1] > 1 && +m[1] < 1000) out.add(`×${+m[1]}`)
  return [...out]
}

/** 0–1: how alike two product names are, and whether their sizes agree. */
export function compareNames(a, b) {
  const wa = new Set(nameWords(a)); const wb = new Set(nameWords(b))
  if (!wa.size || !wb.size) return { score: 0, sizes: 'unknown' }
  let both = 0
  for (const w of wa) if (wb.has(w) || [...wb].some(x => x.length > 4 && w.length > 4 && (x.startsWith(w) || w.startsWith(x)))) both++
  const words = both / Math.max(wa.size, wb.size)
  const sa = sizesOf(a); const sb = sizesOf(b)
  // Different sizes are a different product; a size on one side only can't be checked
  const sizes = !sa.length || !sb.length ? 'unknown'
    : sa.some(x => !sb.includes(x)) || sb.some(x => !sa.includes(x)) ? 'differ' : 'same'
  const score = Math.max(0, Math.min(1, words + (sizes === 'same' ? 0.2 : sizes === 'differ' ? -0.35 : 0)))
  return { score: +score.toFixed(3), sizes }
}

/**
 * For each inventory product with no Products entry, the best unlinked Products entry, best first.
 * confident = alike, sizes the same, and each is the other's best match (so two can't claim one).
 * products: [{ id, name }], items: [{ id, name, data }]
 */
export function suggestLinks(products, items) {
  const best = new Map()
  const bestFor = new Map()   // item → best product score
  for (const p of products) {
    const ranked = items.map(si => ({ si, ...compareNames(p.name, si.name) }))
      .concat(items.filter(si => si.data?.supplierProductName).map(si => ({ si, ...compareNames(p.name, si.data.supplierProductName) })))
      .filter(x => x.score >= 0.34).sort((x, y) => y.score - x.score)
    const seen = new Set(); const top = []
    for (const r of ranked) if (!seen.has(r.si.id)) { seen.add(r.si.id); top.push(r) }
    best.set(p.id, top.slice(0, 4))
    if (top[0]) {
      const cur = bestFor.get(top[0].si.id)
      if (!cur || top[0].score > cur.score) bestFor.set(top[0].si.id, { pid: p.id, score: top[0].score })
    }
  }
  return new Map(products.map(p => {
    const top = best.get(p.id) || []
    const first = top[0]
    const confident = !!first && first.score >= 0.75 && first.sizes === 'same' && bestFor.get(first.si.id)?.pid === p.id
    return [p.id, { options: top, confident }]
  }))
}

/** Boxes, mailers and the like: packaging, not something we sell. */
export function looksLikePackaging(name, supplier = '') {
  return /kite packaging/i.test(supplier) || /\b(mailer|cardboard box|single wall|double wall|cushion film|air wrapper|bubble wrap|void fill|packing tape)\b/i.test(String(name || ''))
}
