/**
 * Product nicknames (team review, Oct 2026).
 *
 * A product can have a short everyday name ("500 Jug" for Pyrex Glass Measuring Jug 500ml). Each person
 * chooses whether they see nicknames: a switch in the menu, open to everyone whatever their access,
 * on by default for the warehouse and off for the office.
 *
 * With it on, every product name on screen shows as its nickname — on every page, including ones built
 * later — by swapping the text where a full name appears. Hovering shows the full name; on a phone, press
 * and hold. Inputs are never touched, and anything inside [data-no-nick] keeps the full name (the
 * Product page heading, the nickname editor). Search finds products by either name, for everyone.
 * Label stamps use the nickname whatever the switch says, because the warehouse reads them.
 */
import { normText, setSearchExpander } from './match.js'

let list = []                  // [{ stock_item_id, inv_id, code, name, stamp_name, nickname }]
let byCode = new Map()         // normalised SKU → nickname
let byFull = new Map()         // lower-cased full name / stamp name → { nick, full }
let pattern = null             // one regex for every full name, longest first
let loaded = null
const listeners = new Set()

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const codeKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function rebuild(rows) {
  list = (rows || []).filter(r => r.nickname && r.name)
  byCode = new Map(list.filter(r => r.code).map(r => [codeKey(r.code), r.nickname]))
  byFull = new Map()
  for (const r of list) {
    for (const n of [r.name, r.stamp_name].filter(Boolean)) {
      const k = n.trim().toLowerCase()
      if (k.length >= 4 && k !== r.nickname.toLowerCase()) byFull.set(k, { nick: r.nickname, full: r.name })
    }
  }
  const names = [...byFull.keys()].sort((a, b) => b.length - a.length)
  pattern = names.length ? new RegExp(`(^|[^A-Za-z0-9])(${names.map(esc).join('|')})(?![A-Za-z0-9])`, 'gi') : null
  listeners.forEach(fn => fn())
}

/** Search finds a product by its nickname too: the text gets the nicknames of any full names in it. */
setSearchExpander((text) => {
  if (!pattern || !text) return text
  const extra = []
  const t = String(text)
  pattern.lastIndex = 0
  let m
  while ((m = pattern.exec(t))) { const hit = byFull.get(m[2].toLowerCase()); if (hit) extra.push(hit.nick) }
  // and the full name of a nickname typed somewhere (e.g. a note)
  return extra.length ? `${t} ${extra.join(' ')}` : t
})

export async function loadNicknames(force = false) {
  if (loaded && !force) return loaded
  const { supabase } = await import('./supabase.js')
  loaded = supabase.rpc('product_nicknames').then(({ data, error }) => { if (!error) rebuild(data); return list }).catch(() => list)
  return loaded
}
export const nicknames = () => list
export const nickForCode = (code) => byCode.get(codeKey(code)) || null
export const nickForName = (name) => byFull.get(String(name || '').trim().toLowerCase())?.nick || null
export const onNicknamesChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
/** After the office saves one: update straight away, no reload needed. */
export function patchNickname(row) {
  const rest = list.filter(r => r.stock_item_id !== row.stock_item_id)
  rebuild(row.nickname ? [...rest, row] : rest)
}

// ── Each person's switch ─────────────────────────────────────────────────────
const KEY = (id) => `gg-nicknames:${id || 'me'}`
export function nicknamesOn(me, warehouseDefault) {
  try { const v = localStorage.getItem(KEY(me?.id)); if (v === '1') return true; if (v === '0') return false } catch { /* private mode */ }
  return !!warehouseDefault
}
export function setNicknamesOn(me, on) {
  try { localStorage.setItem(KEY(me?.id), on ? '1' : '0') } catch { /* private mode */ }
}

// ── Showing nicknames on screen ──────────────────────────────────────────────
const original = new WeakMap()   // text node → the text the page put there
const ours = new WeakMap()       // text node → the text we last wrote, so our own change isn't redone
let observer = null
let active = false
const SKIP = /^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|CODE|PRE)$/

function swap(node) {
  const el = node.parentElement
  if (!el || SKIP.test(el.tagName) || el.isContentEditable || el.closest('[data-no-nick]')) return
  const cur = node.nodeValue
  if (ours.get(node) === cur) return
  if (!pattern || !cur || cur.length < 4) return
  pattern.lastIndex = 0
  const fulls = []
  const out = cur.replace(pattern, (m, pre, name) => { const hit = byFull.get(name.toLowerCase()); if (!hit) return m; fulls.push(hit.full); return pre + hit.nick })
  if (out === cur) return
  original.set(node, cur)
  ours.set(node, out)
  node.nodeValue = out
  el.setAttribute('data-nick', [...new Set(fulls)].join(' · '))
  if (!el.title) { el.title = [...new Set(fulls)].join(' · '); el.setAttribute('data-nick-title', '1') }
}

function walk(root) {
  if (!root) return
  if (root.nodeType === 3) { swap(root); return }
  if (root.nodeType !== 1 || SKIP.test(root.tagName)) return
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = tw.nextNode())) swap(n)
}

function restoreAll() {
  document.querySelectorAll('[data-nick]').forEach(el => {
    for (const n of el.childNodes) if (n.nodeType === 3 && original.has(n) && ours.get(n) === n.nodeValue) { n.nodeValue = original.get(n); ours.delete(n) }
    if (el.getAttribute('data-nick-title')) { el.removeAttribute('title'); el.removeAttribute('data-nick-title') }
    el.removeAttribute('data-nick')
  })
}

/** Turn nicknames on screen on or off for this person. */
export function showNicknames(on) {
  active = !!on
  if (observer) { observer.disconnect(); observer = null }
  if (typeof document === 'undefined') return
  if (!active) { restoreAll(); return }
  walk(document.body)
  observer = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') swap(m.target)
      else m.addedNodes.forEach(walk)
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
}
onNicknamesChange(() => { if (active) { restoreAll(); showNicknames(true) } })

// Phones: press and hold a nickname to see the full name
if (typeof window !== 'undefined') {
  let timer = null, bubble = null, held = false
  const hide = () => { bubble?.remove(); bubble = null }
  window.addEventListener('touchstart', (e) => {
    const el = e.target.closest?.('[data-nick]')
    hide(); held = false
    if (!el || !active) return
    const t = e.touches[0]
    timer = setTimeout(() => {
      held = true
      bubble = document.createElement('div')
      bubble.className = 'nick-bubble'
      bubble.textContent = el.getAttribute('data-nick')
      document.body.appendChild(bubble)
      const w = Math.min(320, window.innerWidth - 24)
      bubble.style.maxWidth = `${w}px`
      bubble.style.left = `${Math.max(12, Math.min(t.clientX - w / 2, window.innerWidth - w - 12))}px`
      bubble.style.top = `${Math.max(12, t.clientY - 64)}px`
      setTimeout(hide, 3500)
    }, 450)
  }, { passive: true })
  const cancel = () => clearTimeout(timer)
  window.addEventListener('touchmove', cancel, { passive: true })
  window.addEventListener('touchend', cancel, { passive: true })
  // A hold isn't a tap: don't open whatever was underneath
  window.addEventListener('click', (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false } }, true)
}

/**
 * A nickname that leaves out what tells products apart (500ml, 2kg, 6PK, a colour) is a mix-up waiting to
 * happen on a stamp. Returns what's missing from the full name, if anything.
 */
export function nicknameMissing(full, nick) {
  if (!nick) return []
  const f = normText(full).split(' '), n = new Set(normText(nick).split(' '))
  const sizes = f.filter(w => /\d/.test(w))
  const digits = (w) => w.replace(/[^0-9.]/g, '')
  return sizes.filter(s => !n.has(s) && ![...n].some(x => x.includes(s) || (digits(x) && digits(x) === digits(s))))
}

/** Suggestions now live in nickSuggest.js (whole-catalogue, keeps size, count, colour and scent). */
export { suggestNickname } from './nickSuggest.js'
