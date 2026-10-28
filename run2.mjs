import { JSDOM } from 'jsdom'
import { readFileSync } from 'fs'
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
  { runScripts: 'outside-only', url: 'https://x.test/', pretendToBeVisual: true })
const { window } = dom
window.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} })
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
window.scrollTo = () => {}
const errs = []
const origErr = console.error
window.console = { ...console, error: (...a) => errs.push(a.map(String).join(' ')) }
try { window.eval(readFileSync('/tmp/app.js', 'utf8')) } catch (e) { errs.push('THROWN: ' + (e.stack || e)) }
await new Promise(r => setTimeout(r, 1200))
const root = window.document.getElementById('root')
console.log('root HTML length:', root.innerHTML.length)
console.log('errors:')
console.log(errs.slice(0, 4).map(e => e.split('\n').slice(0, 6).join('\n')).join('\n---\n') || '  none')
