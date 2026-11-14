import React, { useState } from 'react'
import { categoriesForFee, findFeeCategory, describeCategory, rankByRelevance } from '../lib/feeSchedule'
import { fmt } from '../lib/calc'
import { Icon } from './UI'

const CALC_URL = 'https://sellercentral.amazon.co.uk/revcalpublic?mons_sel_locale=en_GB'

// Categories that charge identically at every price are interchangeable
const signature = (name) => {
  const c = findFeeCategory(name)
  return JSON.stringify({ f: c.flat, t: c.type, tiers: c.tiers, m: c.min })
}

/**
 * Verifying a fee in two steps: open Amazon's calculator with the ASIN on the
 * clipboard, then type the fee it shows. The fee identifies the category.
 */
export default function FeeVerifier({ asin, price, preferred, hint = '', verified, current, onVerify }) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState('')
  const [choices, setChoices] = useState(null)
  const [error, setError] = useState('')
  const [alternatives, setAlternatives] = useState([])

  const open = async () => {
    if (asin) {
      try { await navigator.clipboard.writeText(asin); setCopied(true); setTimeout(() => setCopied(false), 4000) } catch { /* clipboard blocked */ }
    }
    window.open(CALC_URL, '_blank', 'noopener')
  }

  const check = () => {
    setError(''); setChoices(null)
    const fee = parseFloat(shown)
    if (!(price > 0)) { setError('Enter a sell price first.'); return }
    if (!(fee >= 0)) { setError('Enter the referral fee in pounds, as Amazon shows it.'); return }
    const matches = categoriesForFee(price, fee)
    if (!matches.length) {
      setError(`No category charges ${fmt(fee)} at ${fmt(price)}. Check the price you entered in Amazon's calculator matches ${fmt(price)}.`)
      return
    }
    // Group categories that behave identically at every price
    const groups = new Map()
    for (const m of matches) {
      const k = signature(m.name)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(m.name)
    }
    // Within each group, put the categories that fit the product first
    const list = [...groups.values()].map(names => rankByRelevance(names, `${hint} ${preferred || ''}`).map(x => x.name))
    if (list.length === 1) {
      const names = list[0]
      // Categories in a group charge the same at every price, so any is right
      // for the maths — choose the one that best describes the product
      const pick = names.includes(preferred) ? preferred : names[0]
      setAlternatives(names.filter(n => n !== pick))
      onVerify(pick)
      setShown('')
      return
    }
    setChoices(list)
  }

  if (verified) {
    return (
      <div className="text-[13px]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-gain font-medium"><Icon name="check" size={13} /> Fee verified on Amazon</span>
          <button className="text-ink/45 hover:text-royal-600" onClick={() => { setAlternatives([]); onVerify(null) }}>Re-check</button>
        </div>
        {alternatives.length > 0 && (
          <div className="mt-2 p-2.5 rounded-lg bg-paper border border-rule">
            <div className="text-ink/65">
              These categories charge exactly the same, so the fee is right whichever it is.
              If Amazon's calculator named a different one, pick it:
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {[current, ...alternatives].filter(Boolean).map(n => (
                <button key={n} onClick={() => { if (n !== current) { setAlternatives([current, ...alternatives].filter(x => x && x !== n)); onVerify(n) } }}
                  className={`px-2 py-1 rounded-md border text-[12px] ${n === current ? 'border-royal-400 bg-royal-50 text-royal-600 font-medium' : 'border-rule bg-white text-ink/70 hover:border-royal-300'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-3 rounded-lg border border-royal-200 bg-royal-50/60">
      <div className="text-[13px] font-semibold text-ink mb-2">Verify the fee on Amazon</div>
      <ol className="text-[13px] text-ink/70 space-y-2">
        <li className="flex items-center gap-2 flex-wrap">
          <span className="w-5 h-5 rounded-full bg-royal-500 text-white text-xs font-bold flex items-center justify-center">1</span>
          <button className="btn btn-secondary btn-xs" onClick={open}>
            <Icon name="external" size={12} /> {asin ? 'Copy ASIN & open Amazon\'s calculator' : 'Open Amazon\'s calculator'}
          </button>
          {copied && <span className="text-gain">{asin} copied — paste it into the search box</span>}
        </li>
        <li className="flex items-start gap-2">
          <span className="w-5 h-5 rounded-full bg-royal-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
          <span>Enter your price of <b>{price > 0 ? fmt(price) : '—'}</b> there, then type the <b>referral fee</b> it shows:</span>
        </li>
        <li className="flex items-center gap-2 pl-7">
          <span className="text-ink/60">£</span>
          <input type="number" step="0.01" className="input py-1.5 w-24" value={shown}
            onChange={e => setShown(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} placeholder="0.00" />
          <button className="btn btn-primary btn-xs" onClick={check}>Verify</button>
        </li>
      </ol>
      {error && <div className="text-[13px] text-loss mt-2">{error}</div>}
      {choices && (
        <div className="mt-3">
          <div className="text-[13px] text-ink/70 mb-1.5">
            That fee fits more than one kind of category. They charge the same at {fmt(price)} but differ at other
            prices — pick the one Amazon names:
          </div>
          <div className="flex flex-col gap-1.5">
            {choices.map((names, i) => (
              <button key={i} className="text-left px-3 py-2 rounded-lg border border-rule bg-white hover:border-royal-300 text-[13px]"
                onClick={() => { onVerify(names.includes(preferred) ? preferred : names[0]); setChoices(null); setShown('') }}>
                <b>{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3} more` : ''}</b>
                <span className="text-ink/50"> — {describeCategory(findFeeCategory(names[0]))}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="text-[12px] text-ink/45 mt-2">
        Amazon's calculator shows FBA figures too — you only need the referral fee line.
      </div>
    </div>
  )
}
