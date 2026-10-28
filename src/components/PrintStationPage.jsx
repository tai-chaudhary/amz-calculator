import React, { useState, useEffect, useRef, useCallback } from 'react'
import { PageHeader, Icon, StatusBadge, SegmentedControl, EmptyState } from './UI'
import {
  isStation, setIsStation, printTarget, setPrintTarget, stationStatus, heartbeat, claimJob, jobFile,
  recentJobs, requeue, sendToStation, jobDone, jobFailed, cancelJob, canCancel,
} from '../lib/printStation'
import { printHere } from '../lib/dispatchPdf'

const PORTAL = 'https://amz-calculator.vercel.app'
const LAUNCHER = `printf '#!/bin/bash\\nopen -na "Google Chrome" --args --user-data-dir="$HOME/.print-station-chrome" --kiosk-printing "${PORTAL}/#/print-station"\\n' > ~/Desktop/Print\\ Station.command && chmod +x ~/Desktop/Print\\ Station.command`
const SETUP_CHROME = `open -na "Google Chrome" --args --user-data-dir="$HOME/.print-station-chrome" "${PORTAL}/#/print-station"`
const STATUS = {
  queued: { label: 'Waiting', tone: 'warn' }, printing: { label: 'Printing', tone: 'info' }, printed: { label: 'Printed', tone: 'live' },
  failed: { label: 'Failed', tone: 'alert' }, cancelled: { label: 'Cancelled', tone: 'quiet' },
}
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')

/**
 * Some printer set-ups (Chrome + the Zebra driver on a Mac) put the last page out first. The station can flip the
 * pages before printing so they come out in order — a per-station switch, remembered on that Mac.
 */
const flipKey = 'gg-station-reverse'
const flipOn = () => { try { return localStorage.getItem(flipKey) === '1' } catch { return false } }
export async function reversePages(bytes) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(bytes)
  const n = src.getPageCount()
  if (n < 2) return bytes
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, [...Array(n).keys()].reverse())
  pages.forEach(pg => out.addPage(pg))
  return out.save()
}

/** A one-page 4×6 test print, made here so it needs nothing from the server. */
async function testPage() {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const page = doc.addPage([288, 432])
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawRectangle({ x: 8, y: 8, width: 272, height: 416, borderWidth: 3, borderColor: rgb(0, 0, 0) })
  page.drawText('PRINT STATION', { x: 40, y: 300, size: 30, font: bold })
  page.drawText('test page — 4 x 6', { x: 72, y: 268, size: 16, font: bold })
  page.drawText(new Date().toLocaleString('en-GB'), { x: 70, y: 230, size: 13, font: bold })
  page.drawText('The border should sit just inside the label.', { x: 28, y: 40, size: 11, font: bold })
  return doc.save()
}

/**
 * Print Station: on the warehouse Mac, takes prints sent from phones and prints them on the Zebra. On any other
 * device: where this device's prints go, and whether the station is online.
 */
export default function PrintStationPage({ me, showToast }) {
  const [station, setStation] = useState(isStation())
  const [target, setTarget] = useState(printTarget())
  const [status, setStatus] = useState(null)
  const [jobs, setJobs] = useState([])
  const [flip, setFlip] = useState(flipOn())
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    setStatus(await stationStatus().catch(() => null))
    setJobs(await recentJobs().catch(() => []))
  }, [])

  // The station's loop: check in, take the next job, print it. Ticks come from a worker so a window that's behind
  // others (or minimised) isn't slowed to once a minute by the browser.
  useEffect(() => {
    if (!station) { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t) }
    let wake = null
    navigator.wakeLock?.request('screen').then(l => { wake = l }).catch(() => {})
    const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(1), 2000)'], { type: 'text/javascript' })))
    let n = 0
    const tick = async () => {
      n++
      if (n % 2 === 1) heartbeat('Warehouse Mac', me?.name).catch(() => {})
      if (busy.current) return
      busy.current = true
      try {
        const job = await claimJob()
        if (job) {
          try {
            let bytes = await jobFile(job.file_path)
            if (flipOn()) bytes = await reversePages(bytes)   // so page 1 comes out first on this printer
            printHere(bytes, job.title)
            // Kiosk printing sends it straight to the printer; give it a moment before calling it printed
            await new Promise(r => setTimeout(r, 3500))
            await jobDone(job.id)          // also marks its batches printed, by whoever sent it
          } catch (e) {
            await jobFailed(job.id, String(e?.message || e).slice(0, 200))
          }
          refresh()
        } else if (n % 3 === 0) refresh()
      } catch { /* try again next tick */ } finally { busy.current = false }
    }
    worker.onmessage = tick
    tick()
    return () => { worker.terminate(); wake?.release?.().catch?.(() => {}) }
  }, [station]) // eslint-disable-line react-hooks/exhaustive-deps

  const online = !!status?.online
  return (
    <div>
      <PageHeader eyebrow="Warehouse / print station" title="Print Station"
        description="Print from your phone: the warehouse Mac prints it on the Zebra. Phones send their prints here automatically while the station is online." />

      {station ? (
        <div className="card mb-4 border-l-2 border-l-gain flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-gain animate-pulse" /><b className="text-ink">This Mac is the Print Station</b></div>
            <div className="text-sm text-ink/60 mt-1">Keep this window open (it can sit behind others). Prints sent from phones come out on this Mac's default printer.</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={async () => printHere(await testPage(), 'Print Station test')}><Icon name="printer" size={14} /> Test print</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setIsStation(false); setStation(false); showToast?.('This Mac is no longer the Print Station') }}>Stop being the station</button>
          </div>
          <label className="w-full flex items-center gap-2 text-sm text-ink cursor-pointer pt-1 border-t border-rule">
            <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={flip}
              onChange={e => { try { localStorage.setItem(flipKey, e.target.checked ? '1' : '0') } catch { /* private mode */ } setFlip(e.target.checked) }} />
            <span><b>This printer puts the last page out first</b> — flip the pages so page 1 comes out first</span>
          </label>
        </div>
      ) : (
        <div className={`card mb-4 border-l-2 ${online ? 'border-l-gain' : 'border-l-coral'} flex items-center justify-between gap-3 flex-wrap`}>
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-gain' : 'bg-coral'}`} />
              <b className="text-ink">{online ? 'The Print Station is online' : 'The Print Station is offline'}</b>
            </div>
            <div className="text-sm text-ink/60 mt-1">{online
              ? `${status?.station?.name || 'Warehouse Mac'}${status?.station?.signed_in_as ? ` · signed in as ${status.station.signed_in_as}` : ''}`
              : status?.station?.last_seen ? `Last seen ${new Date(status.station.last_seen).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — prints will come out on this device instead` : 'Not set up yet — see below'}</div>
          </div>
          {online && <button className="btn btn-secondary btn-sm" onClick={async () => {
            try { await sendToStation(await testPage(), 'Test from ' + (me?.name || 'a phone'), { kind: 'test' }); showToast?.('Test sent to the Print Station'); refresh() }
            catch (e) { showToast?.(e?.message || 'Couldn’t send', 'error') }
          }}><Icon name="send" size={14} /> Send a test</button>}
        </div>
      )}

      {!station && (
        <div className="card mb-4">
          <div className="section-title mb-2">Where this device's prints go</div>
          <SegmentedControl value={target} onChange={(v) => { setPrintTarget(v); setTarget(v) }} label="Print to" items={[
            { id: 'auto', label: 'Automatic' }, { id: 'station', label: 'Always the Print Station' }, { id: 'here', label: 'Always this device' },
          ]} />
          <div className="text-xs text-ink/55 mt-2">Automatic: phones and tablets send to the Print Station when it's online; computers print themselves.</div>
        </div>
      )}

      <div className="card p-0 overflow-hidden mb-4">
        <div className="section-title px-4 py-3 border-b border-rule bg-paper">Recent prints</div>
        {!jobs.length ? <EmptyState icon="printer" title="Nothing yet" sub="Prints sent from phones show here." /> : jobs.map(j => {
          const st = STATUS[j.status] || STATUS.queued
          return (
            <div key={j.id} className="px-4 py-2.5 border-b border-rule/70 last:border-0 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink font-medium truncate">{j.title}</div>
                <div className="text-[11px] text-ink/45">{j.sent_by || 'Someone'} · sent {time(j.created_at)}{j.printed_at ? ` · printed ${time(j.printed_at)}` : ''}{j.error ? ` · ${j.error}` : ''}{j.cancelled_by ? ` · cancelled by ${j.cancelled_by} at ${time(j.cancelled_at)}` : ''}</div>
                {j.status === 'queued' && Date.now() - Date.parse(j.created_at) > 30000 && (
                  <div className="text-[11px] text-loss font-semibold">Waiting since {time(j.created_at)}{!online && !station ? ' — the station is offline' : ''}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                {j.status === 'queued' && canCancel(j, me) && <button className="btn btn-ghost btn-xs" onClick={async () => {
                  try { await cancelJob(j.id); showToast?.('Cancelled — back to print') } catch (e) { showToast?.(e.message, 'error') }
                  refresh()
                }}>Cancel</button>}
                {['printed', 'failed', 'cancelled'].includes(j.status) && <button className="btn btn-ghost btn-xs" onClick={async () => { await requeue(j); showToast?.('Sent again'); refresh() }}><Icon name="printer" size={12} /> Again</button>}
              </div>
            </div>
          )
        })}
      </div>

      {!station && (
        <div className="card space-y-3">
          <div className="section-title">Set up the Mac (once)</div>
          <ol className="text-sm text-ink space-y-3 list-decimal pl-5">
            <li><b>Make the Zebra the default printer:</b> System Settings → Printers &amp; Scanners → Default printer → the Zebra. In its options, set the paper to 4 × 6 in.</li>
            <li><b>Make the Print Station shortcut:</b> open Terminal on the Mac, paste this and press Enter. A "Print Station" icon appears on the desktop.
              <CopyBox text={LAUNCHER} showToast={showToast} /></li>
            <li><b>First time only — set Chrome's print settings:</b> paste this in Terminal to open the station's Chrome normally, sign in to the portal, open this page and press <i>Use this Mac as the Print Station</i>, then <i>Test print</i>. In the print box choose the Zebra, paper 4 × 6, margins None, scale 100%, and print. Then quit that Chrome (⌘Q).
              <CopyBox text={SETUP_CHROME} showToast={showToast} /></li>
            <li><b>From then on:</b> double-click <i>Print Station</i> on the desktop each morning. Prints come out with no print box. Keep the window open; the Mac mustn't go to sleep (System Settings → Lock Screen / Energy).</li>
          </ol>
          <button className="btn btn-primary btn-sm" onClick={() => { setIsStation(true); setStation(true); showToast?.('This device is now the Print Station') }}>
            <Icon name="printer" size={14} /> Use this Mac as the Print Station
          </button>
        </div>
      )}
    </div>
  )
}

function CopyBox({ text, showToast }) {
  return (
    <div className="mt-2 flex items-start gap-2">
      <code className="flex-1 block text-[11px] bg-paper border border-rule rounded-[6px] p-2 break-all">{text}</code>
      <button className="btn btn-secondary btn-xs shrink-0" onClick={() => navigator.clipboard?.writeText(text).then(() => showToast?.('Copied'))}>Copy</button>
    </div>
  )
}
