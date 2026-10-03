/**
 * Reading the text out of a PDF in the browser, laid out roughly as it appears
 * on the page — words on the same line stay on the same line, with spacing
 * kept where there are gaps, because the invoice readers rely on that shape.
 */
// The PDF reader is a big library, so it's fetched only when a document is
// actually read — it isn't part of what everyone downloads to use the portal.
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

export async function pdfToText(file, { maxPages = 10 } = {}) {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    // Group the pieces into lines by their position down the page
    const rows = new Map()
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3)       // tolerate small wobble
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x: item.transform[4], s: item.str })
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])                      // top of the page first
      .map(([, parts]) => {
        parts.sort((a, b) => a.x - b.x)
        let out = '', lastEnd = 0
        for (const p of parts) {
          // Keep the gaps: the readers use them to tell columns apart
          const gap = lastEnd ? Math.max(1, Math.round((p.x - lastEnd) / 5)) : 1
          out += (out ? ' '.repeat(Math.min(gap, 40)) : '') + p.s
          lastEnd = p.x + p.s.length * 5
        }
        return out
      })
    pages.push(lines.join('\n'))
  }
  return pages.join('\n\n')
}

export const canReadFile = (file) => /\.pdf$/i.test(file?.name || '')
