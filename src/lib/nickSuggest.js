/**
 * Nickname suggestions (rewritten Oct 2026 after "the suggestions are useless").
 *
 * A good nickname keeps everything that tells a product apart from its neighbours — the size or weight,
 * the pack count, the colour or scent — and drops the marketing words. So each name is split into:
 *   brand       first word(s) shared by a product range, or the brand on the product ("151", "Pyrex")
 *   specs       sizes and counts exactly as written: 400ml, 12.5kg, 6 x 600ml, 16 Pack, 3 Rolls, A4, Age 3+
 *   variant     colours and scents: Terracotta, Gun Metal Grey, Tea Tree, Red Berry
 *   what it is  the product type and the word before it: Spray Paint, Measuring Jug, Fly Killer
 * …then put back together short, with nothing said twice. Finally the whole catalogue is checked: two
 * products never get the same suggestion — the words that differ are added until they're different.
 */

const UNIT = '(?:ml|l|ltr|litres?|cl|g|kg|kgs|mg|oz|cm|mm|m|cu ?ft|gsm|amp|")'
const SPEC_RES = [
  new RegExp(`\\b\\d+\\s*x\\s*\\d+(?:\\.\\d+)?\\s*${UNIT}?(?:\\s*x\\s*\\d+(?:\\.\\d+)?\\s*${UNIT}?)?(?![a-z])`, 'gi'), // 6 x 600ml, 305x229x178, 35 x 26cm
  new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*${UNIT}(?![a-z])`, 'gi'),                                    // 400ml, 12.5KG, 0.5L, 15 cu ft
  /\b(?:pack|set) of \d+\b/gi,                                                                    // Pack of 6, Set of 3
  /\b\d+\s*(?:pack|pk|count|ct|rolls?|pieces?|pcs|sachets?|washes|blades|up|sheets)\b/gi,         // 16 Pack, 3 Rolls, 2up, 44 Washes
  /\bsize\s*\d+\b/gi, /\bage\s*\d+\+?/gi, /\bA[3-5]\b/g, /\b\d{3,4}\/\d{3,4}\b/g,                  // size 3, Age 3+, A4, 200/200
]
const VARIANTS = [
  'gun metal grey', 'winter grey', 'burnt umber', 'bright yellow', 'bright silver', 'tea tree', 'citrus zing', 'tropical breeze',
  'fresh linen', 'lily blossom', 'pet fresh', 'red berry', 'salted caramel', 'almond milk', 'apple & cinnamon', 'pomegranate & raspberry',
  'assorted colours', 'fluorescent colours', 'unicorn colours', 'black', 'white', 'red', 'green', 'grey', 'pink', 'blue', 'yellow', 'gold',
  'silver', 'brown', 'orange', 'rainbow', 'khaki', 'clear', 'terracotta', 'stone', 'pearl', 'lemon', 'eucalyptus', 'pomegranate',
  'metallic', 'gloss', 'chalky', 'original', 'regular', 'sensitive', 'large', 'medium', 'small', 'extra large', 'fireman', 'police',
  'army', 'builder', 'explorer', 'washable', 'kiln dried', 'coloured', 'degradable', 'concentrated',
]
const HEADS = [
  'spray paint', 'poster paint', 'fabric paint', 'paint markers', 'washing up liquid', 'measuring jug', 'mixing bowl', 'kitchen towel',
  'kitchen roll', 'doggy bags', 'poo bags', 'food bags', 'nappy bags', 'handy bags', 'refuse sacks', 'bin liners', 'dishwasher tablets',
  'dishwasher salt', 'soda crystals', 'baking soda', 'caustic soda', 'bicarbonate of soda', 'citric acid', 'de-icing salt', 'rock salt',
  'carpet freshener', 'stain remover', 'glass cleaner', 'floor cleaner', 'toilet cleaner', 'oven cleaner', 'lens cleaner', 'jewellery cleaner',
  'washing machine cleaner', 'drain unblocker', 'kettle descaler', 'killer spray', 'killer powder', 'killer aerosol', 'killer', 'pva glue',
  'adhesive spray', 'air dry clay', 'cotton wool', 'wool balls', 'wool pads', 'facial pads', 'oval pads', 'facial wipes', 'household wipes',
  'razor blade refills', 'razor blades', 'razor', 'oven glove', 'ice scraper', 'de-icer', 'deicer spray', 'dehumidifier', 'gift set',
  'costume set', 'costume', 'football', 'scissors', 'snapframe', 'mailer', 'envelope', 'bubble bag', 'box', 'label', 'tape', 'loose fill',
  'paper', 'cushion film', 'compost', 'top soil', 'sand', 'concrete', 'cement mix', 'plant food', 'tree feed', 'feeder', 'scented candle',
  'candle', 'scent beads', 'shampoo', 'collar', 'conditioner', 'shower gel', 'body lotion', 'body cream', 'cream', 'cleanser', 'eau de parfum',
  'eau de toilette', 'scent spray', 'petroleum jelly', 'plasters', 'freeze spray', 'freeze gel', 'massaging spray', 'goggles', 'vest',
  'screenwash', 'white spirit', 'lighter fluid', 'travel wash', 'laundry whitener', 'laundry detergent', 'detergent', 'vinegar spray',
  'borax substitute', 'epsom salts', 'sponges', 'sponge eraser', 'scourers', 'scourer', 'power cloths', 'refills', 'refill', 'degreaser',
  'blaster', 'cleanser', 'spray', 'powder', 'granules', 'gel', 'liquid', 'tray', 'trays', 'dish', 'jars', 'jug', 'bowl', 'bucket', 'set',
  'adaptor', 'gadget', 'card', 'rack', 'bar', 'pleat', 'jelly', 'whitening powder', 'bleach', 'insect repellent', 'nail treatment',
  'wool pleat', 'magic sand', 'surface cleanser', 'lacquer', 'pump spray',
]
const FILLER = new Set(('the and & with for of in a an to by on all purpose multipurpose multi heavy duty extra strong super max power ultimate plus ' +
  'one antibacterial brilliant non scratch fast acting rapid action standard classic premium deep clean daily kind skin professional ' +
  'built-in handles family pack lift action handheld based spec complete with bag gloves shake fresh cook freeze factory plastic decorative holder seriously clean natural').split(' '))
// First words that describe rather than name a brand
const NOT_BRAND = /^(single|double|printed|recycled|recyclable|mini|clear|book|charcoal|spiral|packaging|starch|paint|m2|unbranded|kids)$/i

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tidy = (s) => s.replace(/\s+/g, ' ').trim()
const cap = (w) => (/\d/.test(w) || /^[A-Z0-9]{2,}$/.test(w) && w.length <= 4 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
const fmtSpec = (s) => tidy(s).replace(/(\d)\s*x\s*(?=\d)/gi, (m, d) => (/\d\s*x\s*\d+\s*x/i.test(s) || !/\s/.test(s) ? `${d}x` : `${d} x `)).replace(/(\d)\s+(ml|g|kg|cl|mg|cm|mm|gsm)\b/gi, '$1$2')
  .replace(/(\d)(ml|g|kg|cl|mg|cm|mm|gsm)\b/gi, (m, n, u) => n + u.toLowerCase()).replace(/(\d)\s*(l|ltr)\b/gi, '$1L')
  .replace(/\b(pack|count|rolls?|pieces?|sachets?|washes)\b/gi, w => cap(w)).replace(/^size\s*/i, 'Size ').replace(/^age\s*/i, 'Age ')

/** How each word is written in the name itself (PVA, TidyZ, FlexiSheets), so suggestions keep it. */
function spellings(name) {
  const m = new Map()
  for (const w of String(name || '').split(/[\s(),]+/)) {
    const k = w.toLowerCase()
    if (!w || m.has(k)) continue
    const shouty = w.length > 4 && w === w.toUpperCase() && /[A-Z]/.test(w)
    if (!shouty) m.set(k, w)
  }
  return m
}

/** One name → its parts. */
export function nameParts(name, brand = '') {
  let rest = ' ' + String(name || '').replace(/\(([^)]*)\)/g, ' $1 ').replace(/\s[-–—,:]\s|,/g, ' ') + ' '
  rest = rest.replace(/\b\d+\s*sheets? per roll\b/gi, ' ')
  // Brand: the product's own, else what the name starts with
  let b = String(brand || '').trim()
  if (b && !new RegExp(`^\\s*${esc(b)}\\b`, 'i').test(rest)) b = ''
  if (b) rest = rest.replace(new RegExp(`^\\s*${esc(b)}\\b`, 'i'), ' ')
  if (/^\s*unbranded\b/i.test(rest)) { rest = rest.replace(/^\s*unbranded\b/i, ' '); b = '' }
  const specs = []
  for (const re of SPEC_RES) rest = rest.replace(re, m => { specs.push(fmtSpec(m)); return ' ' })
  const low = ` ${rest.toLowerCase()} `
  const variants = []
  let vrest = low
  for (const v of VARIANTS) {
    const re = new RegExp(`\\s${esc(v)}(?=\\s)`, 'i')
    if (re.test(vrest)) { variants.push({ v, at: vrest.search(re) }); vrest = vrest.replace(re, ' '.repeat(v.length + 1)) }
  }
  variants.sort((x, y) => x.at - y.at)
  let head = null, headAt = -1
  let headEnd = -1
  for (const h of HEADS) {
    const at = vrest.search(new RegExp(`\\s${esc(h)}(?=\\s)`, 'i'))
    if (at < 0) continue
    const end = at + h.length
    if (!head || end > headEnd || (end === headEnd && h.length > head.length)) { head = h; headAt = at; headEnd = end }
  }
  const words = tidy(vrest).split(' ').filter(Boolean)
  const vwords = new Set(variants.flatMap(x => x.v.split(' ')))
  const beforeText = head ? tidy(vrest.slice(0, headAt)) : ''
  // "Fly & Wasp Killer", "Slug & Snail Killer", "Spider & Creepy Crawl Spray": the pair belongs together
  let pair = beforeText.match(/([a-z0-9-]+ & [a-z0-9-]+(?: [a-z0-9-]+)?)$/)
  if (pair && FILLER.has(pair[1].split(' ')[0])) pair = null
  const before = pair ? [pair[1]] : beforeText.split(' ').filter(w => w && !FILLER.has(w) && !vwords.has(w))
  const others = words.filter(w => !FILLER.has(w) && !(head || '').split(' ').includes(w))
  let sp = [...new Set(specs)]
  // A numbered size says it: the dimensions after it are noise
  if (sp.some(x => /^Size /.test(x))) sp = sp.filter(x => !/^\d+\s*x\s*\d+/i.test(x)).sort((a, z) => (/^Size/.test(z) ? 1 : 0) - (/^Size/.test(a) ? 1 : 0))
  return { brand: b, specs: sp, variants: variants.map(x => x.v), head, before, others, words, spell: spellings(name) }
}

function build(p, { extra = [], qualifiers = 2 } = {}) {
  const make = (q) => {
    const core = p.head ? [...p.before.slice(-q), p.head] : p.others.slice(0, 2)
    const seen = new Set(), out = []
    for (const part of [p.brand, ...extra, ...core, ...p.variants].filter(Boolean)) {
      for (const w of String(part).split(' ')) {
        const k = w.toLowerCase()
        if (!w || (seen.has(k) && w !== '&')) continue
        seen.add(k)
        const own = p.spell.get(k)
        // The name's own spelling only where it's deliberate: PVA, TidyZ, FlexiSheets, Dri-Pak, Fusion5
        const keep = own && (/[a-z][A-Z]|^[A-Z0-9]{2,4}$|\d|[A-Z][a-z]*-[A-Z]/.test(own))
        out.push(keep ? own : (/\d/.test(w) ? w : cap(w)))
      }
    }
    // Sizes and counts go in whole, exactly once: 457x305x305 keeps its three numbers
    for (const sp of p.specs) if (!out.includes(sp)) out.push(sp)
    return tidy(out.join(' '))
  }
  let n = make(qualifiers)
  if (n.length > 40 && qualifiers > 1) n = make(1)
  return n
}

/** Suggestions for a whole catalogue at once, so no two are the same. items: [{ id, name, brand }] */
export function suggestNicknames(items = []) {
  // Brands nobody typed in: a first word (or two) that starts several product names
  const firsts = new Map()
  for (const it of items) {
    const w = String(it.name || '').split(/\s+/)
    const two = w.slice(0, 2).join(' '), one = w[0]
    if (one) firsts.set(one, (firsts.get(one) || 0) + 1)
    if (two && w.length > 2) firsts.set(two, (firsts.get(two) || 0) + 1)
  }
  const brandOf = (it) => {
    if (it.brand) return it.brand
    const w = String(it.name || '').split(/\s+/)
    if (w[1] === '&' && w[2] && /^[A-Z]/.test(w[2])) return w.slice(0, 3).join(' ')
    const two = w.slice(0, 2).join(' ')
    if ((firsts.get(two) || 0) >= 2 && !/\d/.test(w[1] || '') && !FILLER.has(w[1]?.toLowerCase()) && !NOT_BRAND.test(w[0])) return two
    if (NOT_BRAND.test(w[0]) || w.length < 3) return ''
    // A capitalised first word on a longer name is nearly always the brand (Rentokil, CarPlan, Vogue, 151)
    return /^[A-Z0-9]/.test(w[0]) ? w[0].replace(/[-–]$/, '') : ''
  }
  const parsed = items.map(it => ({ it, p: nameParts(it.name, brandOf(it)) }))
  const out = new Map(parsed.map(({ it, p }) => [it.id, build(p)]))
  // Same suggestion for two products: add what differs, a word at a time
  for (let round = 0; round < 4; round++) {
    const byNick = new Map()
    for (const { it } of parsed) { const k = out.get(it.id).toLowerCase(); if (!byNick.has(k)) byNick.set(k, []); byNick.get(k).push(it.id) }
    let clash = false
    for (const ids of byNick.values()) {
      if (ids.length < 2) continue
      clash = true
      const group = parsed.filter(x => ids.includes(x.it.id))
      for (const x of group) {
        const mine = new Set(x.p.words)
        const theirs = new Set(group.filter(y => y !== x).flatMap(y => y.p.words))
        const differ = [...mine].filter(w => !theirs.has(w) && !FILLER.has(w)).slice(0, round + 1)
        out.set(x.it.id, build(x.p, { extra: differ, qualifiers: 1 + round }))
      }
    }
    if (!clash) break
  }
  return out
}

/** One product's suggestion, checked against the rest of the catalogue when it's given. */
export function suggestNicknameFor(item, catalogue = []) {
  const all = catalogue.some(x => x.id === item.id) ? catalogue : [...catalogue, item]
  return suggestNicknames(all).get(item.id) || ''
}

/** The old single-name call, kept for anything still using it. */
export const suggestNickname = (name, brand = '') => suggestNicknames([{ id: 'x', name, brand }]).get('x') || ''
