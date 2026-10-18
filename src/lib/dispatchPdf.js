/**
 * The browser side of Dispatch: reading a HELM file page by page, recognising
 * text on labels that are only pictures (DHL's always are), and building the
 * print file — a cover page per batch, then its labels with the product
 * stamped on each.
 *
 * The heavy libraries are fetched only when Dispatch actually uses them.
 */
import { pageKind, stampText, realWords } from './dispatch.js'

let pdfjsPromise = null
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

// Several readers at once: labels are read side by side, not one after another
let schedulerPromise = null
async function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const { createWorker, createScheduler } = await import('tesseract.js')
      const scheduler = createScheduler()
      const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
      const workers = await Promise.all(Array.from({ length: n }, () => createWorker('eng')))
      workers.forEach(w => scheduler.addWorker(w))
      return scheduler
    })()
  }
  return schedulerPromise
}
const ocrText = async (canvas) => ((await (await getScheduler()).addJob('recognize', canvas)).data.text || '')
export async function releaseOcr() {
  if (schedulerPromise) {
    try { (await schedulerPromise).terminate() } catch { /* already gone */ }
    schedulerPromise = null
  }
}

/** Part of a canvas, given as fractions of its width and height. */
function crop(src, x0, y0, x1, y1) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(src.width * (x1 - x0))); c.height = Math.max(1, Math.floor(src.height * (y1 - y0)))
  c.getContext('2d').drawImage(src, Math.floor(src.width * x0), Math.floor(src.height * y0), c.width, c.height, 0, 0, c.width, c.height)
  return c
}
function grow(src, f) {
  const c = document.createElement('canvas')
  c.width = Math.floor(src.width * f); c.height = Math.floor(src.height * f)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}
function shrink(src, f) {
  const c = document.createElement('canvas')
  c.width = Math.floor(src.width * f); c.height = Math.floor(src.height * f)
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
  return c
}

/**
 * Reads a label that's only a picture, reading just the parts that matter.
 * The strip across the top says which carrier it is (Evri's prints upright with
 * "ADRIAN MARSH LIMITED … EVRi"; DHL's lies on its side). Evri: the service
 * band, the Destination box and the tracking number. DHL: the whole label,
 * turned the right way up.
 */
async function readPictureLabel(canvas, page) {
  const top = await ocrText(crop(canvas, 0, 0, 1, 0.12))
  if (/EVRI|MARKETPLACE|ADRIAN\s*MARSH/i.test(top)) {
    const [service, address, tracking] = await Promise.all([
      ocrText(crop(canvas, 0, 0.34, 1, 0.45)),
      ocrText(crop(canvas, 0, 0.43, 0.6, 0.85)),
      // The tracking number is small print under the barcode: read it enlarged
      ocrText(grow(crop(canvas, 0, 0.82, 1, 1), 2)),
    ])
    page.ocr = [top, service, address, tracking].join('\n')
    page.ocrService = service
    page.ocrAddress = address
    page.stamp.rotated = false
    return
  }
  const side = await ocrText(rotateCanvas(shrink(canvas, 2 / 3)))
  if (looksDhl(side)) {
    page.ocr = side
    page.stamp.rotated = true
    // The reference block (Ref, AltRef — "1xUNBRND-SALT…") read again close up:
    // a 1 misread as a 4 there would change what the box is said to hold
    page.ocrRefs = await ocrText(crop(rotateCanvas(canvas), 0.5, 0.2, 1, 0.62))
    return
  }
  // Neither: read it whole, upright, and let the checks say what they can
  page.ocr = await ocrText(shrink(canvas, 2 / 3))
  page.stamp.rotated = false
}

function rotateCanvas(src, clockwise = true) {
  const c = document.createElement('canvas')
  c.width = src.height; c.height = src.width
  const ctx = c.getContext('2d')
  ctx.translate(clockwise ? c.width : 0, clockwise ? 0 : c.height)
  ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180)
  ctx.drawImage(src, 0, 0)
  return c
}

/**
 * The first long horizontal rule on the page, in points from the top — where
 * Evri's stamp sits under. Borders round the very edge of a label are ignored,
 * and so is anything past the middle, so a stray line can't put the stamp
 * somewhere silly.
 */
function findDivider(canvas, scale) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  // Fine lines are drawn grey when smoothed, so anything clearly darker than paper counts
  const dark = (x, y) => { const i = (y * width + x) * 4; return data[i] + data[i + 1] + data[i + 2] < 600 }
  for (let y = Math.floor(height * 0.15); y < height * 0.6; y++) {
    let n = 0
    for (let x = 0; x < width; x += 2) if (dark(x, y)) n++
    if (n / (width / 2) > 0.8) return y / scale
  }
  // No rule: the first clear band on the right below the top barcode
  const from = Math.floor(width * 0.66), to = Math.floor(width * 0.97)
  const inkRow = (y) => { for (let x = from; x < to; x += 2) if (dark(x, y)) return true; return false }
  let seenInk = false, run = 0
  for (let y = Math.floor(height * 0.15); y < height * 0.6; y++) {
    if (inkRow(y)) { seenInk = true; run = 0; continue }
    if (seenInk && ++run >= 20 * scale) return (y - run) / scale
  }
  return null
}

const looksDhl = (t) => /DHL|ALT\s*REF|SHIPMENT/i.test(t || '')

/**
 * Every page with its words and positions. Labels are drawn once to find the
 * stamp position and, when they carry no words, to read them.
 * onProgress({ page, pages, step }) keeps the screen honest about what's happening.
 */
export async function readDispatchFile(file, onProgress = () => {}) {
  const pdfjs = await loadPdfjs()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const total = doc.numPages
  const pages = []
  const reading = []          // picture labels being read in the background
  let done = 0
  const tick = (step) => onProgress({ page: Math.min(done, total), pages: total, step })

  for (let n = 1; n <= total; n++) {
    const p = await doc.getPage(n)
    const vp = p.getViewport({ scale: 1 })
    const tc = await p.getTextContent()
    const page = {
      index: n - 1, width: vp.width, height: vp.height, hasPicture: true,
      items: realWords(tc.items.map(t => ({ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width, h: t.height, font: t.fontName }))),
      ocr: '', stamp: {},
    }
    pages.push(page)
    // Slips and Amazon's order lists are read from their words; labels are drawn too
    if (pageKind(page) === 'label') {
      const scale = 3
      const canvas = document.createElement('canvas')
      const v = p.getViewport({ scale })
      canvas.width = Math.ceil(v.width); canvas.height = Math.ceil(v.height)
      // 'print' draws without waiting for animation frames, which browsers stop
      // sending to a tab in the background — so reading carries on when you look away
      await p.render({ canvasContext: canvas.getContext('2d'), viewport: v, intent: 'print' }).promise
      page.stamp.lineY = findDivider(canvas, scale)
      if (!page.items.length) {
        reading.push(readPictureLabel(canvas, page)
          .catch(() => { /* unread: the checks will say so */ })
          .finally(() => { canvas.width = 0; canvas.height = 0; done++; tick('Reading labels') }))
        // Keep a few in hand at once so memory stays small
        if (reading.length % 6 === 0) await Promise.all(reading.slice(-6))
      } else {
        canvas.width = 0; canvas.height = 0; done++
      }
    } else done++
    p.cleanup()
    tick('Reading')
  }
  await Promise.all(reading)
  await doc.destroy()
  return { pages, bytes }
}

// ── Building the print file ──────────────────────────────────────────────────

let pdfLibPromise = null
const loadPdfLib = () => (pdfLibPromise ||= import('pdf-lib'))

// The standard PDF font only knows Western characters
const safe = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

function fitSize(font, text, maxWidth, start, min) {
  let size = start
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25
  return size
}
function truncateTo(font, text, size, maxWidth) {
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxWidth) t = t.slice(0, -2) + '.'
  return t
}

/** The stamp, in the places agreed with the carriers in mind: small, and clear of barcodes and routing. */
function drawStamp(lib, page, font, label, batch, count) {
  const { rgb, degrees } = lib
  const { width: W, height: H } = page.getSize()
  const words = stampText(batch.label_name, label.seq, count, batch.code)
  const black = rgb(0, 0, 0)
  // Long names go onto more lines, a touch smaller, rather than losing words
  const lines = (text, max, start, min, most = 2) => {
    const one = fitSize(font, text, max, start, min)
    if (font.widthOfTextAtSize(text, one) <= max && one >= start - 1) return { size: one, lines: [text] }
    for (let n = 2; n <= most; n++) {
      for (let size = Math.min(start, 6.5); size >= min; size -= 0.25) {
        const ls = wrapWords(font, text, size, max)
        if (ls.length <= n && ls.every(l => font.widthOfTextAtSize(l, size) <= max)) return { size, lines: ls }
      }
    }
    const size = min
    return { size, lines: wrapWords(font, text, size, max) }
  }
  if (label.carrier === 'DHL') {
    // Directly above "DHL eCommerce UK", reading the same way as the label
    const max = H * (140 / 432)
    const x = W * (256 / 288)
    const top = H - H * (6 / 432)
    const name = lines(safe(words.name), max, 7.5, 5, 2)
    const count = safe(words.count)
    // One line: name and count together; more: the count goes on the end of the last.
    // The last line sits nearest "DHL eCommerce UK", the first above it when read.
    const all = [...name.lines]
    all[all.length - 1] = `${all[all.length - 1]}  ${count}`
    const size = Math.min(...all.map(t => fitSize(font, t, max, name.size, 5)))
    all.forEach((t, i) => {
      const back = all.length - 1 - i
      page.drawText(t, { x: x - back * (size + 1.5), y: top - font.widthOfTextAtSize(t, size), size, font, color: black, rotate: degrees(90) })
    })
    return
  }
  // Evri and anything else upright: under the divider line, right-hand side
  // Both Evri layouts have the rule under the barcode at about a third of the way down
  const lineY = label.stamp?.lineY || H * 0.353
  const right = W - 8
  const max = W * 0.31
  const name = lines(safe(words.name), max, 7.5, 5, 3)
  let y = H - (lineY + 4 + name.size)
  for (const l of name.lines) {
    page.drawText(l, { x: right - font.widthOfTextAtSize(l, name.size), y, size: name.size, font, color: black })
    y -= name.size + 1.2
  }
  const c = safe(words.count)
  page.drawText(c, { x: right - font.widthOfTextAtSize(c, 6.5), y: y - 0.8, size: 6.5, font, color: black })
}

function wrapWords(font, text, size, maxWidth) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}

/** A 6x4 cover page: what's in the batch, readable from across the bench. */
function drawCover(lib, doc, fonts, batch, count, orders, { uploadedBy, when } = {}) {
  const { rgb } = lib
  const W = 288, H = 432, M = 18
  const page = doc.addPage([W, H])
  const black = rgb(0, 0, 0), white = rgb(1, 1, 1)
  const { bold, regular } = fonts

  page.drawText(safe(`BATCH ${batch.code}`), { x: M, y: H - M - 14, size: 14, font: bold, color: black })
  const date = safe(when || '')
  page.drawText(date, { x: W - M - regular.widthOfTextAtSize(date, 10), y: H - M - 13, size: 10, font: regular, color: black })
  page.drawLine({ start: { x: M, y: H - M - 24 }, end: { x: W - M, y: H - M - 24 }, thickness: 1.5, color: black })

  // The parcel, as large as it will go
  const name = safe(String(batch.label_name).toUpperCase())
  let size = 40, lines = wrapWords(bold, name, size, W - 2 * M)
  while (size > 18 && (lines.length > 4 || lines.some(l => bold.widthOfTextAtSize(l, size) > W - 2 * M))) {
    size -= 2; lines = wrapWords(bold, name, size, W - 2 * M)
  }
  let y = H - M - 24 - 18 - size
  for (const l of lines) { page.drawText(l, { x: M, y, size, font: bold, color: black }); y -= size * 1.08 }

  const contents = safe(batch.contents || '')
  if (contents && contents.toUpperCase() !== name) {
    y -= 4
    for (const l of wrapWords(regular, `Each parcel: ${contents}`, 11, W - 2 * M).slice(0, 3)) {
      page.drawText(l, { x: M, y, size: 11, font: regular, color: black }); y -= 14
    }
  }

  // Count and carrier
  const countText = String(count)
  page.drawText(countText, { x: M, y: 112, size: 64, font: bold, color: black })
  const cw = bold.widthOfTextAtSize(countText, 64)
  page.drawText(count === 1 ? 'label' : 'labels', { x: M + cw + 8, y: 132, size: 16, font: bold, color: black })
  page.drawText(safe(`${orders} order${orders !== 1 ? 's' : ''}`), { x: M + cw + 8, y: 114, size: 12, font: regular, color: black })

  page.drawRectangle({ x: M, y: 52, width: W - 2 * M, height: 40, color: black })
  const carrier = safe(`${batch.carrier || ''} ${batch.service || ''}`.trim().toUpperCase())
  const cs = fitSize(bold, carrier, W - 2 * M - 20, 20, 10)
  page.drawText(carrier, { x: M + 10, y: 52 + (40 - cs) / 2 + 2, size: cs, font: bold, color: white })

  if (uploadedBy) page.drawText(safe(uploadedBy), { x: M, y: 30, size: 8, font: regular, color: black })
  return page
}

/**
 * The first page of a printed batch: who's picking it, what's in it, and the
 * pick list — every item added up across the batch's orders. Runs onto more
 * pages if the batch is big.
 */
function drawBatchSummary(lib, doc, fonts, summary) {
  const { rgb } = lib
  const W = 288, H = 432, M = 18
  const black = rgb(0, 0, 0)
  const { bold, regular } = fonts
  let page, y
  const newPage = (first) => {
    page = doc.addPage([W, H])
    page.drawText(safe(`BATCH ${summary.code}`), { x: M, y: H - M - 20, size: 22, font: bold, color: black })
    const date = safe(summary.when || '')
    page.drawText(date, { x: W - M - regular.widthOfTextAtSize(date, 10), y: H - M - 17, size: 10, font: regular, color: black })
    y = H - M - 34
    if (first) {
      const who = [summary.picker && `Picker: ${summary.picker}`, summary.title].filter(Boolean).join(' · ')
      if (who) { page.drawText(safe(truncateTo(bold, who, 11, W - 2 * M)), { x: M, y, size: 11, font: bold, color: black }); y -= 15 }
      page.drawText(safe(`${summary.labels} labels · ${summary.orders} orders · ${summary.groups.length} product${summary.groups.length !== 1 ? 's' : ''}`), { x: M, y, size: 10, font: regular, color: black })
      y -= 10
    } else {
      page.drawText('continued', { x: M, y, size: 9, font: regular, color: black }); y -= 6
    }
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: black })
    y -= 16
  }
  const row = (left, right, { size = 10, font = regular, indent = 0 } = {}) => {
    if (y < M + 14) newPage(false)
    const r = safe(right)
    const rw = bold.widthOfTextAtSize(r, size)
    const l = truncateTo(font, safe(left), size, W - 2 * M - rw - 10 - indent)
    page.drawText(l, { x: M + indent, y, size, font, color: black })
    page.drawText(r, { x: W - M - rw, y, size, font: bold, color: black })
    y -= size + 5
  }
  const heading = (t) => {
    if (y < M + 30) newPage(false)
    page.drawText(safe(t), { x: M, y, size: 9, font: bold, color: black }); y -= 13
  }
  newPage(true)
  heading('PRINTED IN THIS ORDER')
  for (const g of summary.groups) row(`${g.label_name} (${[g.carrier, g.service].filter(Boolean).join(' ')})`, `${g.count}`, { size: 10 })
  y -= 6
  heading('TO PICK')
  for (const t of summary.pick) row(t.name, `x${t.qty}`, { size: 9 })
}

/**
 * One print file for any number of batches, in the order given:
 * cover, its labels, cover, its labels…
 * sections: [{ batch, labels: [{ page_index, seq, stamp, carrier }], fileBytes, uploadedBy }]
 */
export async function buildPrintFile(sections, { cover = true, summaries = [] } = {}) {
  const lib = await loadPdfLib()
  const { PDFDocument, StandardFonts } = lib
  const out = await PDFDocument.create()
  const fonts = { bold: await out.embedFont(StandardFonts.HelveticaBold), regular: await out.embedFont(StandardFonts.Helvetica) }
  const sources = new Map()
  const summaryFor = new Map(summaries.map(x => [x.beforeSection, x]))
  for (const [i, s] of sections.entries()) {
    if (summaryFor.has(i)) drawBatchSummary(lib, out, fonts, summaryFor.get(i))
    if (!sources.has(s.fileBytes)) sources.set(s.fileBytes, await PDFDocument.load(s.fileBytes))
    const src = sources.get(s.fileBytes)
    const count = s.batch.label_count || s.labels.length
    if (cover) {
      const when = new Date(s.batch.ship_date || Date.now()).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      drawCover(lib, out, fonts, s.batch, count, s.batch.order_count || new Set(s.labels.map(l => l.order_key)).size, { uploadedBy: s.uploadedBy, when })
    }
    const ordered = [...s.labels].sort((a, b) => a.seq - b.seq)
    const copied = await out.copyPages(src, ordered.map(l => l.page_index))
    copied.forEach((pg, i) => {
      const l = ordered[i]
      drawStamp(lib, pg, fonts.bold, { seq: l.seq, stamp: l.stamp, carrier: l.carrier }, s.batch, count)
      out.addPage(pg)
    })
  }
  return out.save()
}

/** Sends a PDF to the print dialog; if the browser won't, opens it to print by hand. */
export function printPdf(bytes, title = 'labels') {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.title = title
  frame.src = url
  document.body.appendChild(frame)
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print() }
    catch { window.open(url, '_blank') }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
  }
  return url
}

export function downloadPdf(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * The collection sheet for the driver: parcels per carrier for the day, the
 * batches they came from, and a space to sign — proof of what was handed over.
 * groups: [{ carrier, service, label_name, count }] — one line per stamped product
 */
export async function buildCollectionSheet({ date, groups, preparedBy }) {
  const lib = await loadPdfLib()
  const { PDFDocument, StandardFonts, rgb } = lib
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45)
  const carriers = [...new Set(groups.map(g => g.carrier || 'Other'))].sort((a, b) => (a === 'Evri' ? -1 : b === 'Evri' ? 1 : a.localeCompare(b)))
  for (const carrier of carriers) {
    const page = doc.addPage([595, 842])
    const M = 48
    let y = 842 - M
    page.drawText(safe(`${carrier.toUpperCase()} COLLECTION`), { x: M, y: y - 22, size: 22, font: bold, color: black })
    page.drawText(safe(date), { x: 595 - M - regular.widthOfTextAtSize(safe(date), 12), y: y - 18, size: 12, font: regular, color: black })
    y -= 40
    page.drawText('Adrian Marsh Ltd', { x: M, y, size: 10, font: regular, color: grey })
    y -= 18
    const mine = groups.filter(g => (g.carrier || 'Other') === carrier)
    const total = mine.reduce((s, g) => s + g.count, 0)
    page.drawText(String(total), { x: M, y: y - 60, size: 64, font: bold, color: black })
    page.drawText(total === 1 ? 'parcel' : 'parcels', { x: M + bold.widthOfTextAtSize(String(total), 64) + 10, y: y - 40, size: 18, font: bold, color: black })
    y -= 90
    page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: black })
    y -= 18
    const byService = new Map()
    for (const g of mine) byService.set(g.service || '—', (byService.get(g.service || '—') || 0) + g.count)
    for (const [svc, n] of byService) { page.drawText(safe(`${svc}: ${n}`), { x: M, y, size: 12, font: bold, color: black }); y -= 18 }
    y -= 6
    page.drawText('AS STAMPED ON THE LABELS', { x: M, y, size: 8, font: bold, color: grey })
    page.drawText('PARCELS', { x: 595 - M - 50, y, size: 8, font: bold, color: grey })
    y -= 14
    for (const g of mine) {
      if (y < 200) break
      const svc = byService.size > 1 ? `  (${g.service})` : ''
      page.drawText(safe(truncateTo(regular, `${g.label_name}${svc}`, 10, 420)), { x: M, y, size: 10, font: regular, color: black })
      const n = String(g.count)
      page.drawText(n, { x: 595 - M - bold.widthOfTextAtSize(n, 10), y, size: 10, font: bold, color: black })
      y -= 15
    }
    // Hand-over
    const box = 150
    page.drawRectangle({ x: M, y: M, width: 595 - 2 * M, height: box, borderColor: black, borderWidth: 1 })
    const line = (label, yy) => {
      page.drawText(label, { x: M + 14, y: yy, size: 10, font: regular, color: black })
      page.drawLine({ start: { x: M + 130, y: yy - 2 }, end: { x: 595 - M - 14, y: yy - 2 }, thickness: 0.5, color: black })
    }
    line('Parcels collected', M + box - 30)
    line('Driver name', M + box - 62)
    line('Driver signature', M + box - 94)
    line('Time', M + box - 126)
    if (preparedBy) page.drawText(safe(`Prepared by ${preparedBy}`), { x: M, y: M - 16, size: 8, font: regular, color: grey })
  }
  return doc.save()
}

/** Pages of a PDF as pictures, for showing a label and its slip side by side. */
export async function pagesAsImages(bytes, indexes, scale = 1.6) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const out = []
  for (const i of indexes) {
    if (i == null || i < 0 || i >= doc.numPages) { out.push(null); continue }
    const p = await doc.getPage(i + 1)
    const v = p.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = Math.ceil(v.width); c.height = Math.ceil(v.height)
    await p.render({ canvasContext: c.getContext('2d'), viewport: v, intent: 'print' }).promise
    out.push(c.toDataURL('image/png'))
    c.width = 0; c.height = 0
    p.cleanup()
  }
  await doc.destroy()
  return out
}
