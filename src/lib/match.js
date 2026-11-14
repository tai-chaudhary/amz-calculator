/**
 * Search by keywords, everywhere in the portal (team review, Oct 2026).
 *
 * People type a few words, not the exact name: "pyrex jug 500ml" must find
 * "Pyrex Glass Measuring Jug 500ml". So a search is split into words, and each
 * word only has to appear somewhere — in any order, as the start of a word, inside
 * a code, or with a small typo ("pyrx"). Sizes are read the same however they're
 * written: "500 ml", "500ml", "500-ML". Results come back best first, and when
 * nothing has every word, the closest ones (most of the words) are shown instead
 * of an empty list.
 */

const UNITS = /^(ml|l|ltr|litre|litres|liter|cl|g|gm|gram|grams|kg|kgs|mg|oz|lb|cm|mm|m|pk|pack|packs|x|rl|roll|rolls|ct|pc|pcs|w|v|mah)$/

/** Lower case, letters and numbers only, sizes joined up: "500 ml" → "500ml". */
export function normText(s) {
  const raw = String(s ?? '')
    .replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'")
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d),(\d{3})\b/g, '$1$2')          // 1,000 → 1000
    .replace(/(\d)\.(\d)/g, '$1p$2')              // keep 0.5 together as one token
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)p(\d)/g, '$1.$2')
    .trim()
  if (!raw) return ''
  // Number then unit becomes one word; a letter–digit run like "500ml" stays as it is
  const parts = raw.split(' ')
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i]
    if (/^\d+(\.\d+)?$/.test(w) && parts[i + 1] && UNITS.test(parts[i + 1])) { out.push(w + parts[i + 1]); i++; continue }
    out.push(w)
  }
  return out.join(' ')
}

const words = (s) => normText(s).split(' ').filter(Boolean)

// Lets nicknames be found too: given a record's text, adds the nicknames of any products named in it
let expand = (t) => t
export const setSearchExpander = (fn) => { expand = typeof fn === 'function' ? fn : (t) => t }

/** How many single-letter changes turn a into b, stopping early once over `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      // a swap of two letters next to each other counts as one change
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] === undefined ? cur[j] : prev[j - 1])
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/**
 * How well one typed word matches the text's words: 1 the whole word, 0.9 the
 * start of one, 0.75 inside one (codes), 0.6 a near miss (a typo), 0 not there.
 */
function wordScore(q, hay, joined) {
  let best = 0
  for (const w of hay) {
    if (w === q) return 1
    if (w.startsWith(q)) best = Math.max(best, 0.9)
    else if (q.length >= 2 && w.includes(q)) best = Math.max(best, 0.75)
  }
  if (best) return best
  // Typed without the spaces ("glassjug") or across a code's parts
  if (q.length >= 3 && joined.includes(q)) return 0.7
  // A small typo, on longer words only — a number or size must be right
  if (q.length >= 4 && !/\d/.test(q)) {
    const max = q.length >= 7 ? 2 : 1
    for (const w of hay) if (w.length >= 3 && !/\d/.test(w) && editDistance(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1))), max) <= max) return 0.6
  }
  return 0
}

/**
 * How well `text` matches what was typed: { score 0–1, all: every word found, hits }.
 * An empty search matches everything.
 */
export function matchScore(text, query) {
  const qw = words(query)
  if (!qw.length) return { score: 1, all: true, hits: 0, of: 0 }
  const hay = words(expand(text))
  const joined = hay.join('')
  let total = 0, hits = 0
  for (const q of qw) {
    const s = wordScore(q, hay, joined)
    if (s > 0) hits++
    total += s
  }
  let score = total / qw.length
  // The words in the same order, or the name starting with them, ranks higher
  const flat = hay.join(' ')
  if (hits === qw.length && flat.startsWith(qw[0])) score += 0.05
  if (hits === qw.length && flat.includes(qw.join(' '))) score += 0.1
  return { score, all: hits === qw.length, hits, of: qw.length }
}

/** True when every typed word is in the text (in any order, typos allowed). */
export function matches(text, query) {
  return matchScore(text, query).all
}

/**
 * A list searched by keywords: everything with every word, best match first.
 * When fewer than `fillTo` have every word, the closest of the rest (at least
 * half the words) follow, so a near miss still shows something useful.
 *   toText: item → the text to search (name, codes, supplier …)
 * Leaves the list as it was when nothing is typed.
 */
export function smartFilter(list = [], query, toText, { fillTo = 5, closest = true, keepOrder = false } = {}) {
  const qw = words(query)
  if (!qw.length) return list
  const scored = []
  for (const item of list) {
    const m = matchScore(toText(item), query)
    if (m.hits) scored.push({ item, ...m })
  }
  const full = scored.filter(x => x.all)
  if (!keepOrder) full.sort((a, b) => b.score - a.score)
  let out = full.map(x => x.item)
  if (closest && full.length < fillTo && qw.length > 1) {
    const near = scored.filter(x => !x.all && x.hits / x.of >= 0.5).sort((a, b) => b.score - a.score)
    out = out.concat(near.slice(0, fillTo - full.length).map(x => x.item))
  }
  return out
}

/** The text of several fields, for smartFilter: hay(a, b, [c, d]) → "a b c d". */
export const hay = (...xs) => xs.flat(Infinity).filter(x => x != null && x !== '').join(' ')
