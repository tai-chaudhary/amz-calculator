export function fmt(n) {
  return '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtSigned(n) {
  return (n < 0 ? '-' : '') + fmt(n)
}

export function pct(n) {
  return n.toFixed(1) + '%'
}

export function calcProduct(p, carriers, packaging) {
  const sellPrice = parseFloat(p.sellPrice) || 0
  const costPrice = parseFloat(p.costPrice) || 0
  const adCost = parseFloat(p.adCost) || 0
  const vatRate = p.vatZero ? 0 : 0.20
  const refPct = (parseFloat(p.refFee) || 15.3) / 100
  const weightKg = parseFloat(p.weightKg) || 0
  const numParcels = p.parcelSplit ? (parseInt(p.numParcels) || 1) : 1

  const vatAmount = sellPrice * (vatRate / (1 + vatRate))
  const exVatRevenue = sellPrice - vatAmount
  const referralFee = sellPrice * refPct

  let shippingCost = 0
  let shippingWarning = ''

  if (p.carrierId && p.carrierCatId && p.serviceLevel) {
    const carrier = carriers[p.carrierId]
    if (carrier) {
      if (weightKg > carrier.maxWeight) {
        shippingWarning = `Weight (${weightKg}kg) exceeds ${carrier.name} max of ${carrier.maxWeight}kg`
      }
      const cat = carrier.categories.find(c => c.id === p.carrierCatId)
      if (cat) {
        const rate = cat.rates[p.serviceLevel] || 0
        if (p.parcelSplit && p.parcelWeightsOverride && p.parcelWeights?.length) {
          shippingCost = p.parcelWeights.reduce((sum, pw) => {
            const w = parseFloat(pw) || 0
            const matchCat = carrier.categories.find(c => w <= c.maxKg) || carrier.categories[carrier.categories.length - 1]
            return sum + (matchCat ? (matchCat.rates[p.serviceLevel] || 0) : rate)
          }, 0)
        } else {
          shippingCost = rate * numParcels
        }
      }
    }
  }

  let packCost = 0
  if (p.packagingId && packaging) {
    const pk = packaging.find(x => x.id === p.packagingId)
    if (pk) packCost = (parseFloat(pk.cost) || 0) * numParcels
  }

  const totalCosts = costPrice + referralFee + shippingCost + packCost + adCost
  const netProfit = exVatRevenue - totalCosts
  const margin = sellPrice > 0 ? (netProfit / sellPrice) * 100 : 0
  const breakEven = totalCosts > 0 ? totalCosts / (1 - vatRate) : 0

  return {
    sellPrice, exVatRevenue, vatAmount, referralFee,
    shippingCost, packCost, adCost, costPrice,
    totalCosts, netProfit, margin, breakEven, shippingWarning,
  }
}

export function getSmartCarrier(weightKg, serviceLevel, isLetterbox, carriers, routingRules) {
  const sorted = [...routingRules].sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (rule.serviceLevel && rule.serviceLevel !== serviceLevel) continue
    if (rule.letterbox !== undefined && rule.letterbox !== isLetterbox) continue
    if (rule.weightMax && weightKg > rule.weightMax) continue
    const carrier = carriers[rule.carrierId]
    if (!carrier) continue
    if (weightKg > carrier.maxWeight) continue
    if (!carrier.services[serviceLevel]) continue
    return rule.carrierId
  }
  return null
}
