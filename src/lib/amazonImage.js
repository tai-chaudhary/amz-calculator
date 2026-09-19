/**
 * Amazon serves product images directly by ASIN via a long-standing media endpoint.
 * No proxy, no scraping, no CORS issues — just an <img src>.
 * If the ASIN has no image, the request 404s and we fall back to a placeholder.
 */
export function amazonImageUrl(asin, size = 'large') {
  if (!asin || asin.trim().length < 5) return null
  const a = asin.trim().toUpperCase()
  // .02 = UK/EU marketplace image
  const sizeCode = size === 'small' ? '_SCTHUMBZZZ_' : '_SCLZZZZZZZ_'
  return `https://images-eu.ssl-images-amazon.com/images/P/${a}.02.${sizeCode}.jpg`
}

/** Fallback to the US endpoint if the EU one has no image. */
export function amazonImageUrlFallback(asin, size = 'large') {
  if (!asin || asin.trim().length < 5) return null
  const a = asin.trim().toUpperCase()
  const sizeCode = size === 'small' ? '_SCTHUMBZZZ_' : '_SCLZZZZZZZ_'
  return `https://images-na.ssl-images-amazon.com/images/P/${a}.01.${sizeCode}.jpg`
}
