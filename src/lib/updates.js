/**
 * Getting new releases onto phones.
 *
 * The portal saved to a phone's home screen stays open in the background for
 * days, so it never reloads by itself and keeps running the version it
 * started with. Every build publishes /version.json; the portal checks it
 * when it's opened, when it comes back to the front, and every few minutes.
 * When there's a newer build it says so (with an Update button), and if the
 * phone was put away for a while and nothing is half done, it updates itself
 * the moment it's opened again.
 */
import { BUILD_TIME } from '../version'
import { currentJobs } from './dispatchJobs'

const EVERY = 5 * 60 * 1000          // look for a new release this often while open
const AWAY = 10 * 60 * 1000          // away this long and it updates itself on return

let latest = null                     // { version, built } of the newest release seen
const listeners = new Set()
const tell = () => listeners.forEach(fn => fn(latest))

export async function checkForUpdate() {
  if (!BUILD_TIME) return null       // running locally: nothing to compare with
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const v = await res.json()
    if (v?.built && v.built !== BUILD_TIME && Date.parse(v.built) > Date.parse(BUILD_TIME)) {
      latest = v; tell()
    }
    return v
  } catch { return null }               // offline: try again later
}

/** Something that would be lost by reloading: a file still being read, an upload waiting for review, an open form. */
export function busy() {
  if (currentJobs().some(j => ['reading', 'saving', 'review'].includes(j.status))) return true
  if (document.querySelector('[role="dialog"]')) return true
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && !!el.value
}

export function applyUpdate() {
  // Ask the server for the page, not the copy already held
  window.location.reload()
}

/** Starts watching; calls onChange(latest) when a newer release appears. Returns a stop function. */
export function watchForUpdates(onChange) {
  listeners.add(onChange)
  let hiddenAt = null
  const onVis = async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    const away = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = null
    await checkForUpdate()
    if (latest && away >= AWAY && !busy()) applyUpdate()
  }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', onVis)
  const timer = setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate() }, EVERY)
  checkForUpdate()
  return () => {
    listeners.delete(onChange)
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('focus', onVis)
    clearInterval(timer)
  }
}

/**
 * A page's code is fetched the first time it's opened. After a release the old
 * files are gone, so an old copy of the portal can't open a page it hasn't
 * opened yet. Reload once to pick up the new release instead of showing an error.
 */
export function loadPage(load) {
  return load().catch((err) => {
    const key = 'reloadedForUpdate'
    let last = 0
    try { last = Number(sessionStorage.getItem(key)) || 0 } catch { /* private mode */ }
    if (Date.now() - last > 60 * 1000) {
      try { sessionStorage.setItem(key, String(Date.now())) } catch { /* private mode */ }
      window.location.reload()
      return new Promise(() => {})   // the reload takes over
    }
    throw err
  })
}
