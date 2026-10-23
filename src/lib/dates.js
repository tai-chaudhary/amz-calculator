/**
 * Core rule (Oct 2026): every date on screen reads DD-MM-YYYY. Dates often arrive from the database as
 * 2026-10-22 (or as 22/10/2026 from the browser); rather than relying on every page to format them, any such date
 * in the page's text is shown as 22-10-2026 — on every page, including ones built later. Inputs and code blocks
 * are left alone (a date box must keep its own format), and CSV exports keep YYYY-MM-DD so spreadsheets sort them.
 * New code should still use fmtDate().
 */
export const fmtDate = (v) => {
  if (!v) return ''
  const s = String(v)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(v)
  return isNaN(d) ? s : `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

const ISO = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b(?![-\d])/g
const SLASH = /\b(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d{2})\b/g
const SKIP = /^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|CODE|PRE)$/
const fix = (t) => t.replace(ISO, '$3-$2-$1').replace(SLASH, '$1-$2-$3')

function swap(node) {
  const el = node.parentElement
  if (!el || SKIP.test(el.tagName) || el.isContentEditable || el.closest('[data-raw-dates]')) return
  const cur = node.nodeValue
  if (!cur || cur.length < 8 || !(/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(cur))) return
  const out = fix(cur)
  if (out !== cur) node.nodeValue = out
}
function walk(root) {
  if (!root) return
  if (root.nodeType === 3) return swap(root)
  if (root.nodeType !== 1 || SKIP.test(root.tagName)) return
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = tw.nextNode())) swap(n)
}
let started = false
export function startDateFormat() {
  if (started || typeof document === 'undefined') return
  started = true
  walk(document.body)
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') swap(m.target); else m.addedNodes.forEach(walk) } })
    .observe(document.body, { subtree: true, childList: true, characterData: true })
}
