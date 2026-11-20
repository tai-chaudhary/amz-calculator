/**
 * One product across the sales channels (v2.105.0), for the Calculator.
 *
 * For every channel that has listings, other than the one being worked on:
 *   - a saved listing there that sends exactly the same products → that listing's own figures (its price, its
 *     packaging, its fee); the most profitable where there are several
 *   - none → "what if": this listing's price and costs, with that channel's fee. A channel with no fee set is said
 *     so, never worked out with a guess.
 * Nothing here is saved or used by the P&L.
 */
import { calcProduct } from './calc.js'
import { channelFeeFor } from './channelFees.js'
import { LISTING_CHANNEL_IDS } from './channels.js'

const chan = (d) => (d && d.channel) || 'Amazon'

/** "id×qty|id×qty" for a listing costed from products, '' when it is not */
export function productsKey(d) {
  if (!d || !d.useComponents || !Array.isArray(d.components)) return ''
  const parts = d.components.filter(c => c && c.stockItemId).map(c => `${c.stockItemId}×${Number(c.qty) || 1}`)
  return parts.sort().join('|')
}

export function compareChannels(calc, { savedProducts = [], carriers, packaging, stockItems = [], excludeId = null } = {}) {
  const here = chan(calc)
  const key = productsKey(calc)
  const out = []
  for (const id of LISTING_CHANNEL_IDS) {
    if (id === here) continue
    const twins = key ? savedProducts.filter(s => s.id !== excludeId && !s.data?.archived && chan(s.data) === id && productsKey(s.data) === key) : []
    if (twins.length) {
      const best = twins.map(s => ({ s, r: calcProduct(s.data, carriers, packaging, stockItems) })).sort((a, b) => b.r.netProfit - a.r.netProfit)[0]
      out.push({ channel: id, kind: 'listing', listing: best.s, others: twins.length - 1, r: best.r })
      continue
    }
    // what if: the same price and costs, sold there. An eBay or TikTok fee is that channel's own rule; Amazon's is
    // this listing's fee category or percentage (15.3% where it has neither).
    const p = { ...calc, channel: id, listingSku: '', otherCodes: [], deliveryCharged: id === 'Amazon' ? '' : calc.deliveryCharged }
    const noFee = id !== 'Amazon' && !channelFeeFor(p)
    out.push({ channel: id, kind: 'what-if', noFee, r: noFee ? null : calcProduct(p, carriers, packaging, stockItems) })
  }
  return out
}
