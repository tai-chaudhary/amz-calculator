/**
 * Reading a pallet carrier's price sheet (v2.80.0) — Farrall's PDF: a table of postcode bands, each with two service
 * rows (48hr / 24hr, or 72hr / 48hr for the far north and islands) and eight prices a row: Quarter, Half, Full,
 * 2, 3, 4, 5 pallets, and each pallet over 5. "P.O.A" (price on application) is kept as no price.
 *
 * The PDF gives pieces of text with their place on the page, not a table. The table is rebuilt from the places:
 *   - a rate row is a "24hr / 48hr / 72hr" label with eight values on the same line;
 *   - a band's two rate rows sit either side of its band number, and its cell reaches half a row beyond each;
 *   - the postcode text inside that cell is the band's postcodes ("CH1-5, 41-49 CV CW …" → whole areas and districts).
 * Nothing is guessed: a band that can't be read whole is reported as a problem and the sheet isn't used.
 *
 * parsePalletSheet() and the helpers are plain functions (tested against the October 2026 sheet); only
 * readPalletSheetFile() touches the PDF library.
 */
const BAND = /^(local|\d{1,2})$/i
const SERVICE = /^(\d{2})\s*hr$/i
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

/** "CH1-5, 41-49, 60-66,88 CV CW" → { areas: ['CV','CW'], districts: [{ area: 'CH', ranges: [[1,5],[41,49],[60,66],[88,88]] }] } */
export function parsePostcodes(text) {
  const clean = String(text || '').toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim()
  const areas = [], districts = [], bad = []
  const re = /([A-Z]{1,2})\s*((?:\d+\s*(?:-\s*\d+|\+)?\s*,?\s*)*)/g
  let m, last = 0
  while ((m = re.exec(clean))) {
    const between = clean.slice(last, m.index).trim()
    if (between) bad.push(between)
    last = re.lastIndex
    const nums = m[2].trim()
    if (!nums) { areas.push(m[1]); continue }
    const ranges = []
    for (const part of nums.split(',').map(s => s.trim()).filter(Boolean)) {
      const r = part.match(/^(\d+)\s*(?:-\s*(\d+)|(\+))?$/)
      if (!r) { bad.push(part); continue }
      const a = parseInt(r[1], 10)
      ranges.push([a, r[3] ? 999 : r[2] ? parseInt(r[2], 10) : a])
    }
    if (ranges.length) districts.push({ area: m[1], ranges })
  }
  const tail = clean.slice(last).trim()
  if (tail) bad.push(tail)
  return { areas, districts, bad }
}

/** The outward half of a postcode: "TF9 2DU" → { area: 'TF', district: 9 }; "M14" → { area: 'M', district: 14 } */
export function postcodeParts(postcode) {
  const pc = String(postcode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const out = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(pc) ? pc.slice(0, -3) : pc
  const area = (out.match(/^[A-Z]{1,2}/) || [])[0] || null
  const d = out.match(/^[A-Z]{1,2}([0-9]{1,2})/)
  return { area, district: d ? parseInt(d[1], 10) : null }
}

/** Which band a postcode falls in — the same rule as public.pallet_band(): named districts beat a whole area */
export function bandFor(bands, postcode) {
  const { area, district } = postcodeParts(postcode)
  if (!area) return null
  if (district != null) {
    const hit = (bands || []).find(b => (b.districts || []).some(d => d.area === area && d.ranges.some(([a, z]) => district >= a && district <= z)))
    if (hit) return hit
  }
  return (bands || []).find(b => (b.areas || []).includes(area)) || null
}

const price = (s) => {
  const t = String(s).replace(/\s/g, '')
  if (/^P\.?O\.?A\.?$/i.test(t)) return null
  const m = t.match(/^£?(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)$/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : undefined
}

/**
 * pages: [[{ s, x, y }]] — each page's pieces of text, y counted up from the bottom of the page (as PDFs do).
 * Returns { title, bands: [{ id, postcodes, areas, districts, rates: { '24hr': [8 prices] | null, … } }], problems: [text] }
 */
export function parsePalletSheet(pages = [], { fileName = '' } = {}) {
  const bands = [], problems = []
  let title = ''
  pages.forEach((items, pi) => {
    const list = (items || []).filter(i => i && String(i.s || '').trim()).map(i => ({ ...i, s: String(i.s).trim() }))
    if (!title && pi === 0) {
      const top = list.filter(i => !/^(email|tel)\b/i.test(i.s) && i.s.length > 6).sort((a, b) => b.y - a.y)[0]
      if (top) title = top.s
    }
    const svcHead = list.find(i => /^service$/i.test(i.s))
    const labels = list.filter(i => SERVICE.test(i.s) && (!svcHead || near(i.x, svcHead.x, 25)))
    if (!labels.length) return
    const svcX = Math.min(...labels.map(l => l.x))
    // Rate rows: the label and the eight values on its line
    const rows = labels.map(l => {
      const vals = list.filter(i => i !== l && near(i.y, l.y, 1.5) && i.x > l.x + 5).sort((a, b) => a.x - b.x)
      const prices = vals.map(v => price(v.s))
      const svc = `${l.s.match(SERVICE)[1]}hr`
      const ok = prices.length === 8 && prices.every(p => p !== undefined)
      const poa = ok && prices.every(p => p === null)
      return { y: l.y, svc, ok: ok && (poa || prices.every(p => p !== null)), rates: poa ? null : prices, raw: vals.map(v => v.s).join(' ') }
    }).sort((a, b) => b.y - a.y)
    // Band numbers: in the first column, each between its two rate rows
    const bandItems = list.filter(i => BAND.test(i.s) && i.x < svcX - 60).sort((a, b) => b.y - a.y)
    const cells = bandItems.map(b => {
      const above = rows.filter(r => r.y >= b.y - 0.5).sort((x, y) => x.y - y.y)[0]
      const below = rows.filter(r => r.y < b.y - 0.5).sort((x, y) => y.y - x.y)[0]
      const d = above && below ? above.y - below.y : 12
      return { b, above, below, top: (above?.y ?? b.y) + d / 2, bottom: (below?.y ?? b.y) - d / 2 }
    })
    const used = new Set()
    const text = list.filter(i => i.x < svcX - 8 && !bandItems.includes(i) && !/^(band|postcodes)$/i.test(i.s))
    for (const c of cells) {
      const id = /^local$/i.test(c.b.s) ? 'Local' : c.b.s.padStart(2, '0')
      if (!c.above || !c.below) { problems.push(`Band ${id}: couldn't find its two price rows`); continue }
      if (used.has(c.above) || used.has(c.below)) { problems.push(`Band ${id}: its price rows are shared with another band`); continue }
      used.add(c.above); used.add(c.below)
      for (const r of [c.above, c.below]) if (!r.ok) problems.push(`Band ${id} ${r.svc}: couldn't read the eight prices (“${r.raw}”)`)
      if (c.above.svc === c.below.svc) problems.push(`Band ${id}: both rows say ${c.above.svc}`)
      const lines = text.filter(t => t.y <= c.top + 0.5 && t.y >= c.bottom - 0.5).sort((a, b) => b.y - a.y || a.x - b.x)
      const pcText = lines.map(l => l.s).join(' ').replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim()
      const pc = parsePostcodes(pcText)
      if (!pc.areas.length && !pc.districts.length) problems.push(`Band ${id}: no postcodes found`)
      if (pc.bad.length) problems.push(`Band ${id}: couldn't read “${pc.bad.join(' ')}” in its postcodes`)
      bands.push({ id, postcodes: pcText, areas: pc.areas, districts: pc.districts,
        rates: { [c.above.svc]: c.above.ok ? c.above.rates : null, [c.below.svc]: c.below.ok ? c.below.rates : null } })
    }
    const orphans = rows.filter(r => !used.has(r))
    if (orphans.length) problems.push(`Page ${pi + 1}: ${orphans.length} price row${orphans.length === 1 ? '' : 's'} not matched to a band`)
  })
  const seen = new Set()
  for (const b of bands) { if (seen.has(b.id)) problems.push(`Band ${b.id} appears twice`); seen.add(b.id) }
  // The same area whole in two bands would make the price depend on the order of the sheet
  const owner = new Map()
  for (const b of bands) for (const a of b.areas) { if (owner.has(a)) problems.push(`${a} is in band ${owner.get(a)} and band ${b.id}`); else owner.set(a, b.id) }
  if (!bands.length) problems.push('No price table found in this file')
  return { title: title || String(fileName).replace(/\.pdf$/i, ''), bands, problems }
}

/** What changed between two sheets, in numbers: for the "use these prices?" check before saving */
export function diffPalletSheets(before = [], after = []) {
  const a = new Map(before.map(b => [b.id, b])), z = new Map(after.map(b => [b.id, b]))
  const added = after.filter(b => !a.has(b.id)).map(b => b.id), removed = before.filter(b => !z.has(b.id)).map(b => b.id)
  let up = 0, down = 0, same = 0, sumBefore = 0, sumAfter = 0, postcodes = 0
  const moves = []
  for (const [id, n] of z) {
    const o = a.get(id)
    if (!o) continue
    if (JSON.stringify([o.areas, o.districts]) !== JSON.stringify([n.areas, n.districts])) postcodes++
    for (const svc of new Set([...Object.keys(o.rates || {}), ...Object.keys(n.rates || {})])) {
      const x = o.rates?.[svc], y = n.rates?.[svc]
      if (!x || !y) { if (!!x !== !!y) moves.push({ id, svc, col: null, from: x ? 'priced' : 'P.O.A', to: y ? 'priced' : 'P.O.A' }); continue }
      for (let k = 0; k < 8; k++) {
        if (x[k] === y[k]) { same++; continue }
        if (y[k] > x[k]) up++; else down++
        sumBefore += x[k]; sumAfter += y[k]
        moves.push({ id, svc, col: k, from: x[k], to: y[k], pct: x[k] ? ((y[k] - x[k]) / x[k]) * 100 : null })
      }
    }
  }
  moves.sort((p, q) => Math.abs(q.pct ?? 1e9) - Math.abs(p.pct ?? 1e9))
  return { added, removed, up, down, same, postcodes, moves, avgPct: sumBefore ? ((sumAfter - sumBefore) / sumBefore) * 100 : 0,
    identical: !added.length && !removed.length && !up && !down && !postcodes && !moves.length }
}

/** Read a price sheet PDF in the browser → parsePalletSheet() */
export async function readPalletSheetFile(file) {
  const { pdfItems } = await import('./pdfText.js')
  return parsePalletSheet(await pdfItems(file, { maxPages: 6 }), { fileName: file?.name || '' })
}
