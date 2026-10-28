/**
 * A month's P&L under changed assumptions. Each lever moves profit per unit by
 * an exact amount (cost and carrier changes don't depend on price; a fee change
 * is a share of the sell price, plus the 2% digital services fee), so this is
 * the real calculation, not an approximation. Tested against full recalculation.
 */
export function runScenario(rows, overheads, s) {
  let revenue = 0, contribution = 0
  for (const { r, u } of rows) {
    if (r.incomplete) continue
    const units = u * (1 + (s.volume || 0) / 100)
    const perUnit = r.netProfit
      - r.costPrice * (s.cost || 0) / 100
      - r.shippingCost * (s.carrier || 0) / 100
      - r.sellPrice * (s.fee || 0) / 100 * 1.02
    revenue += r.sellPrice * units
    contribution += perUnit * units
  }
  const operating = contribution - overheads
  return { revenue, contribution, overheads, operating, margin: revenue > 0 ? operating / revenue * 100 : 0 }
}
