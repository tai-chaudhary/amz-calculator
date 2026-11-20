/**
 * Fill in what's already known. A listing made from products already knows its
 * supplier, supplier codes and usually its brand — nobody should type them twice.
 */

const productsOf = (components, stockItems) => (components || [])
  .map(c => ({ si: stockItems.find(s => s.id === c.stockItemId), qty: parseInt(c.qty) || 1 }))
  .filter(x => x.si)

/** Everything the listing's products tell us about it. */
export function detailsFromProducts(components, stockItems) {
  const items = productsOf(components, stockItems)
  if (!items.length) return null
  const d = (x) => x.si.data || {}
  const suppliers = [...new Set(items.map(x => d(x).supplierName).filter(Boolean))]
  const brands = [...new Set(items.map(x => d(x).brand).filter(Boolean))]
  const units = items.reduce((s, x) => s + x.qty, 0)
  return {
    supplierName: suppliers.join(' + '),
    supplierSku: items.map(x => d(x).supplierSku).filter(Boolean).join(' + '),
    supplierUrl: items.length === 1 ? (d(items[0]).supplierUrl || '') : '',
    barcode: items.length === 1 ? (d(items[0]).barcode || '') : '',
    brand: brands.length === 1 ? brands[0] : '',
    suggestedName: items.length === 1
      ? `${items[0].si.name}${units > 1 ? ` x ${units}` : ''}`
      : items.map(x => `${x.qty} x ${x.si.name}`).join(' + '),
  }
}

/**
 * What to change on a calculation when its products change. Supplier details
 * always follow the products; brand and name are only filled if still empty,
 * so nothing someone typed is overwritten.
 */
export function fillFromProducts(calc, components, stockItems) {
  const d = detailsFromProducts(components, stockItems)
  if (!d) return {}
  const patch = { supplierName: d.supplierName, supplierSku: d.supplierSku }
  if (d.supplierUrl) patch.supplierUrl = d.supplierUrl
  if (d.barcode) patch.barcode = d.barcode
  if (d.brand && !String(calc.brand || '').trim()) patch.brand = d.brand
  if (!String(calc.name || '').trim()) patch.name = d.suggestedName
  return patch
}

/** A new calculation for a product sold at a given pack size. */
export function calcFromProduct(si, qty = 1) {
  const components = [{ stockItemId: si.id, qty }]
  return { useComponents: true, components, bundleQty: String(qty), ...fillFromProducts({}, components, [si]) }
}
