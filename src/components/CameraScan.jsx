import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './UI'

/**
 * Phone camera barcode scanner (v2.111.0; reader rebuilt v2.111.2). The warehouse has no scanner guns (the owner,
 * 19 Nov 2026), so the phone's back camera reads the return label: Evri and Royal Mail 1D barcodes, Royal Mail's 2D
 * code, the RMA on Amazon's slip. Typing always works instead — this never blocks the page.
 *
 * v2.111.2 (owner, 20 Nov: "it just doesn't seem to be scanning anything"): the old reader handed ZXing the whole
 * low-resolution frame, so a 16-character Evri barcode only read when it filled the screen. Now:
 *   - asks for a 1920-wide picture, continuous autofocus and, where the phone allows, a little zoom;
 *   - reads only the green box, cut out of the full-resolution frame and enlarged (a thin barcode becomes big), and
 *     every few tries the whole frame too;
 *   - uses the phone's own BarcodeDetector only if it really supports the label formats, else ZXing told to try hard
 *     and to look only for the formats on our labels;
 *   - a torch button where the phone has one, and a line saying it's working.
 */
/** Grey, contrast stretched (2nd–98th percentile) and sharpened across the bars: blurred barcodes read again */
function boost(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h
  const g = new Uint8ClampedArray(n), hist = new Uint32Array(256)
  for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; g[i] = v; hist[v]++ }
  let lo = 0, hi = 255, c = 0
  while (lo < 255 && (c += hist[lo]) < n * 0.02) lo++
  c = 0; while (hi > 0 && (c += hist[hi]) < n * 0.02) hi--
  const span = Math.max(1, hi - lo)
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let x = 0; x < w; x++) {
      const i = r + x, l = x > 1 ? g[i - 2] : g[i], rr = x < w - 2 ? g[i + 2] : g[i]
      const v = ((2 * g[i] - (l + rr) / 2) - lo) * 255 / span      // sharpen sideways (bars are vertical), then stretch
      const o = i * 4; d[o] = d[o + 1] = d[o + 2] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  ctx.putImageData(img, 0, 0)
}

const FORMATS = ['code_128', 'code_39', 'itf', 'ean_13', 'data_matrix', 'qr_code']

export default function CameraScan({ onCode, onClose, hint = 'Hold the barcode inside the green box' }) {
  const video = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [torch, setTorch] = useState(null)        // null = phone has no torch; false/true = off/on
  const track = useRef(null)
  const box = useRef(null)
  const done = useRef(false)
  const onCodeRef = useRef(onCode)
  useEffect(() => { onCodeRef.current = onCode }, [onCode])

  useEffect(() => {
    let stream = null, timer = null, live = true
    const finish = (text) => {
      if (done.current || !text) return
      done.current = true
      try { navigator.vibrate?.(60) } catch { /* not on iPhone */ }
      onCodeRef.current?.(String(text).trim())
    }
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This phone or browser can’t use the camera here. Type the number instead.')
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
        if (!live) { stream.getTracks().forEach(t => t.stop()); return }
        const t = stream.getVideoTracks()[0]
        track.current = t
        // Sharp close-ups: continuous focus, and a little zoom so the label needn't be held close (where the phone allows)
        try {
          const caps = t.getCapabilities?.() || {}
          const adv = {}
          if ((caps.focusMode || []).includes('continuous')) adv.focusMode = 'continuous'
          if (caps.zoom && caps.zoom.max >= 1.5) adv.zoom = Math.min(2, caps.zoom.max)
          if (Object.keys(adv).length) await t.applyConstraints({ advanced: [adv] })
          if (caps.torch) setTorch(false)
        } catch { /* phone doesn't allow it — fine */ }
        video.current.srcObject = stream
        await video.current.play()
        if (!live) return
        setReady(true)

        // The reader: the phone's own if it reads our formats, else ZXing
        let detect = null
        if (typeof window.BarcodeDetector === 'function') {
          try {
            const have = await window.BarcodeDetector.getSupportedFormats()
            const use = FORMATS.filter(f => have.includes(f))
            if (use.includes('code_128')) {
              const det = new window.BarcodeDetector({ formats: use })
              detect = async (canvas) => (await det.detect(canvas))?.[0]?.rawValue || null
            }
          } catch { detect = null }
        }
        if (!detect) {
          const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
          const hints = new Map([[DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.EAN_13, BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]]])
          const reader = new BrowserMultiFormatReader(hints)
          detect = async (canvas) => { try { return reader.decodeFromCanvas(canvas).getText() } catch { return null } }
        }

        // Each try: the green box cut out of the full picture and enlarged; every third try the whole picture
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        let n = 0
        const tick = async () => {
          if (!live || done.current) return
          const v = video.current, vw = v?.videoWidth, vh = v?.videoHeight
          if (vw && vh) {
            const whole = n++ % 3 === 2
            // The green box, mapped from the screen into the picture (the video fills the screen, object-cover), with
            // a margin round it — exactly what the person is aiming at
            let sx = 0, sy = 0, sw = vw, sh = vh
            if (!whole && box.current) {
              const vr = v.getBoundingClientRect(), br = box.current.getBoundingClientRect()
              const k = Math.max(vr.width / vw, vr.height / vh)
              const ox = (vr.width - vw * k) / 2, oy = (vr.height - vh * k) / 2
              const mx = br.width * 0.08, my = br.height * 0.25
              sx = Math.max(0, Math.round((br.left - vr.left - mx - ox) / k)); sy = Math.max(0, Math.round((br.top - vr.top - my - oy) / k))
              sw = Math.min(vw - sx, Math.round((br.width + 2 * mx) / k)); sh = Math.min(vh - sy, Math.round((br.height + 2 * my) / k))
            }
            const scale = whole ? Math.min(1, 1920 / Math.max(vw, vh)) : Math.max(1, 1600 / sw)
            canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale)
            ctx.imageSmoothingEnabled = true
            ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            let text = await detect(canvas)
            // Blurred or dim: try again with the contrast pushed and the edges sharpened
            if (!text) { boost(ctx, canvas.width, canvas.height); text = await detect(canvas) }
            if (text) return finish(text)
          }
          timer = setTimeout(tick, 120)
        }
        tick()
      } catch (e) {
        setError(/denied|NotAllowed/i.test(String(e?.name || e?.message)) ? 'The camera isn’t allowed. Allow it in the phone’s settings for this site, or type the number.' : e?.message || 'Couldn’t start the camera. Type the number instead.')
      }
    }
    start()
    return () => {
      live = false
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const flip = async () => {
    try { await track.current.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch) } catch { setTorch(null) }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col" role="dialog" aria-label="Scan a barcode">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div ref={box} className="relative w-[88%] max-w-lg h-36 border-2 border-lime rounded-[10px] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] overflow-hidden">
            {ready && !error && <div className="absolute inset-x-2 h-0.5 bg-lime/80 animate-pulse top-1/2" />}
          </div>
        </div>
        <div className="absolute top-0 inset-x-0 p-4 text-center text-white" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="text-[15px] font-semibold">{hint}</div>
          <div className="text-[12px] text-white/70 mt-1">{error ? '' : ready ? 'Looking for a barcode… hold steady, about a hand’s length away' : 'Starting the camera…'}</div>
        </div>
        {torch !== null && !error && (
          <button type="button" onClick={flip} className={`absolute right-4 bottom-6 w-12 h-12 rounded-full flex items-center justify-center ${torch ? 'bg-lime text-ink' : 'bg-white/20 text-white'}`} aria-label={torch ? 'Torch off' : 'Torch on'}>
            <Icon name="zap" size={20} />
          </button>
        )}
        {error && <div className="absolute inset-x-4 bottom-6 bg-white text-ink rounded-card p-4 text-sm">{error}</div>}
      </div>
      <div className="p-4 bg-black" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <button type="button" className="btn btn-secondary w-full justify-center text-base py-3" onClick={onClose}><Icon name="close" size={16} /> Cancel — type it instead</button>
      </div>
    </div>
  )
}
