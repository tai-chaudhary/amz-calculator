import { reportClientError } from './db'
import { VERSION } from '../version'

/**
 * Portal errors reach Taimoor as a ClickUp DM (migration 077). The database groups the same error together and
 * sends at most one message per error every 6 hours; here each distinct error is sent once per page load, and
 * browser noise that isn't the portal's fault is left out.
 */
const sent = new Set()
const NOISE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Load failed$/i, /Failed to fetch/i, /NetworkError/i,
  /AbortError/i, /dynamically imported module/i, /Importing a module script failed/i, /chrome-extension:|moz-extension:/i]

export function reportError(err, where = '') {
  try {
    const message = String(err?.message || err || 'Unknown error').slice(0, 1000)
    const stack = String(err?.stack || '').slice(0, 4000)
    if (NOISE.some(r => r.test(message) || r.test(stack))) return
    const page = (window.location.hash || '#/').replace(/^#\/?/, '').split(/[?/]/)[0] || 'home'
    const key = `${page}|${message}`
    if (sent.has(key) || sent.size > 20) return
    sent.add(key)
    reportClientError(message, stack, page, VERSION, { where, agent: navigator.userAgent.slice(0, 160) }).then(() => {}, () => {})
  } catch { /* reporting must never cause an error of its own */ }
}

export function installErrorReporting() {
  window.addEventListener('error', e => reportError(e.error || e.message, 'window'))
  window.addEventListener('unhandledrejection', e => reportError(e.reason, 'promise'))
}
