import React, { createContext, useContext, useState } from 'react'
import { Icon } from './UI'

/**
 * One way to get from anything to anything. The app provides the navigation;
 * every page renders the same link chips, so a supplier, brand, product or
 * listing is clickable wherever it appears — and looks the same everywhere.
 */
const Links = createContext({})
export const LinksProvider = Links.Provider
export const useLinks = () => useContext(Links)

const stop = (fn) => (e) => { e.stopPropagation(); e.preventDefault?.(); fn?.() }

function Chip({ icon, label, title, onClick }) {
  if (!label) return null
  return (
    <button type="button" className="link-chip" title={title || label} onClick={stop(onClick)} disabled={!onClick}>
      <Icon name={icon} size={12} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** Opens the product on Amazon UK. Used identically on every listing. */
export function AmazonLink({ asin, label = 'Amazon', className = '' }) {
  const a = String(asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null
  return (
    <a className={`link-chip link-chip-amazon ${className}`} href={`https://www.amazon.co.uk/dp/${a}`}
      target="_blank" rel="noopener noreferrer" title={`Open ${a} on Amazon`} onClick={e => e.stopPropagation()}>
      <Icon name="external" size={12} /><span>{label}</span>
    </a>
  )
}

export function SupplierLink({ name }) {
  const { openSupplier } = useLinks()
  return <Chip icon="truck" label={name} title={`Open supplier ${name}`} onClick={name && openSupplier ? () => openSupplier(name) : null} />
}

export function BrandLink({ name }) {
  const { openBrand } = useLinks()
  return <Chip icon="tag" label={name} title={`See everything from ${name}`} onClick={name && openBrand ? () => openBrand(name) : null} />
}

export function ProductLink({ id, name, qty }) {
  const { openProduct } = useLinks()
  const label = name ? (qty > 1 ? `${qty} × ${name}` : name) : null
  return <Chip icon="package" label={label} title={`Open product ${name}`} onClick={id && openProduct ? () => openProduct(id) : null} />
}

/** A product's Supplier SKU as its own label: tap to copy it, to look the product up on the supplier's site or price sheet */
export function SupplierSkuCopy({ sku }) {
  const [copied, setCopied] = useState(false)
  const code = String(sku || '').trim()
  if (!code) return <span className="link-chip text-warn" title="This product has no Supplier SKU">No Supplier SKU</span>
  const copy = stop(async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  })
  return (
    <button type="button" className="link-chip" title={`Copy Supplier SKU ${code}`} aria-label={`Copy Supplier SKU ${code}`} onClick={copy}>
      <span className="text-ink/45">Supplier SKU</span>
      <span className="font-mono">{code}</span>
      <Icon name={copied ? 'check' : 'copy'} size={12} className={copied ? 'text-gain' : ''} />
      {copied && <span className="text-gain">Copied</span>}
    </button>
  )
}

/** A purchase order: opens it over the page you're on */
export function PoLink({ id, number, detail }) {
  const { openPo } = useLinks()
  const label = detail ? `${number} · ${detail}` : number
  return (
    <button type="button" className="link-chip max-w-[420px]" title={`Open ${number}`} onClick={stop(id && openPo ? () => openPo(id) : null)} disabled={!(id && openPo)}>
      <Icon name="receipt" size={12} /><span className="truncate">{label}</span>
    </button>
  )
}

export function ListingLink({ id, name }) {
  const { openListing } = useLinks()
  return <Chip icon="bookmark" label={name} title={`Open listing ${name}`} onClick={id && openListing ? () => openListing(id) : null} />
}

/**
 * Everything a listing connects to, in one row: its products, supplier,
 * brand and Amazon page.
 */
export function ListingConnections({ p, stockItems = [], className = '' }) {
  const comps = (p?.components || []).map(c => ({ si: stockItems.find(s => s.id === c.stockItemId), qty: parseInt(c.qty) || 1 })).filter(x => x.si)
  const suppliers = [...new Set(comps.map(x => x.si.data?.supplierName).filter(Boolean))]
  const supplier = suppliers.length ? suppliers : [p?.supplierName].filter(Boolean)
  return (
    <div className={`flex flex-wrap gap-1.5 items-center ${className}`}>
      {comps.map(x => (
        <span key={x.si.id} className="inline-flex flex-wrap items-center gap-1.5">
          <ProductLink id={x.si.id} name={x.si.name} qty={x.qty} />
          <SupplierSkuCopy sku={x.si.data?.supplierSku || (comps.length === 1 ? p?.supplierSku : '')} />
        </span>
      ))}
      {supplier.map(s => <SupplierLink key={s} name={s} />)}
      {p?.brand && <BrandLink name={p.brand} />}
      <AmazonLink asin={p?.asin} />
    </div>
  )
}
