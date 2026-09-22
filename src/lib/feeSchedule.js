/**
 * Amazon UK referral fee schedule.
 * Source: https://sellercentral.amazon.co.uk/help/hub/reference/external/H78LW99F4XF3Z38 (public page, read 21 Sep 2026)
 *
 * Two tier types, and the difference matters:
 *   whole   — the WHOLE price is charged at the rate for the band it falls in
 *             ("8% for products with a total price up to £10, 15% above")
 *   portion — the price is SPLIT at each threshold and each part charged
 *             at its own rate ("15% for the portion up to £45, 9% above")
 *
 * A 2% digital services fee is added on top of every referral fee for
 * UK-established sellers, which is why a 15% category costs 15.3%.
 */
export const FEE_SCHEDULE_DATE = '2026-09-21'
export const DIGITAL_SERVICES_FEE = 0.02

export const FEE_CATEGORIES = [
  {
    "name": "Amazon Device Accessories",
    "flat": 45,
    "min": 0.25
  },
  {
    "name": "Automotive and Powersports",
    "type": "portion",
    "tiers": [
      [
        45,
        15
      ],
      [
        null,
        9
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Baby Products",
    "type": "whole",
    "tiers": [
      [
        10,
        8
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Baby Pushchairs and Safety Equipment",
    "type": "whole",
    "tiers": [
      [
        10,
        8
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Rucksacks and Handbags",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Beauty, Health and Personal Care",
    "type": "whole",
    "tiers": [
      [
        10,
        8
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Reusable Work and Safety Gloves",
    "type": "whole",
    "tiers": [
      [
        10,
        8
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Beer, Wine and Spirits",
    "flat": 10,
    "min": 0.25
  },
  {
    "name": "Books",
    "flat": 15,
    "min": null
  },
  {
    "name": "Business, Industrial & Scientific Supplies",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Compact Appliances",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Clothing and Accessories",
    "type": "whole",
    "tiers": [
      [
        15,
        5
      ],
      [
        20,
        10
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25,
    "note": "FBA/SFP above \u00a340: 15% portion up to \u00a340, 7% above"
  },
  {
    "name": "Commercial Electrical and Energy Supplies",
    "flat": 12,
    "min": 0.25
  },
  {
    "name": "Computers",
    "flat": 7,
    "min": 0.25
  },
  {
    "name": "Consumer Electronics",
    "flat": 7,
    "min": 0.25
  },
  {
    "name": "Cycling Accessories",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Electronic Accessories",
    "type": "portion",
    "tiers": [
      [
        100,
        15
      ],
      [
        null,
        8
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Printer and Scanner Accessories",
    "type": "portion",
    "tiers": [
      [
        100,
        15
      ],
      [
        null,
        8
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Eyewear",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Eyewear Protection",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Footwear",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Full-Size Appliances",
    "flat": 7,
    "min": 0.25
  },
  {
    "name": "Furniture",
    "type": "portion",
    "tiers": [
      [
        175,
        15
      ],
      [
        null,
        10
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Furniture Accessories",
    "flat": 13,
    "min": 0.25
  },
  {
    "name": "Grocery and Gourmet",
    "type": "whole",
    "tiers": [
      [
        10,
        5
      ],
      [
        null,
        15
      ]
    ],
    "min": null
  },
  {
    "name": "Handmade",
    "flat": 12,
    "min": 0.25
  },
  {
    "name": "Home Products",
    "type": "whole",
    "tiers": [
      [
        20,
        8
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Kitchen",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Home Linen and Rugs",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Jewellery",
    "type": "portion",
    "tiers": [
      [
        225,
        20
      ],
      [
        null,
        5
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Lawn and Garden",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Luggage",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Luggage Accessories",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Mattresses",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Music, Video and DVD",
    "flat": 15,
    "min": null
  },
  {
    "name": "Musical Instruments and AV Production",
    "flat": 12,
    "min": 0.25
  },
  {
    "name": "Office Products",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Packing Materials",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Pet Supplies",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Pet Clothing and Food",
    "type": "whole",
    "tiers": [
      [
        10,
        5
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Software",
    "flat": 15,
    "min": null
  },
  {
    "name": "Sports and Outdoors",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Tyres",
    "flat": 7,
    "min": 0.25
  },
  {
    "name": "Tools and Home Improvement",
    "flat": 13,
    "min": 0.25
  },
  {
    "name": "Door, Window and Shower Accessories",
    "flat": 13,
    "min": 0.25
  },
  {
    "name": "Home Adhesives and Cable Ties",
    "flat": 13,
    "min": 0.25
  },
  {
    "name": "Toys and Games",
    "flat": 15,
    "min": 0.25
  },
  {
    "name": "Video Games and Gaming Accessories",
    "flat": 15,
    "min": null
  },
  {
    "name": "Video Game Consoles",
    "flat": 8,
    "min": null
  },
  {
    "name": "Vitamins, Minerals and Supplements",
    "type": "whole",
    "tiers": [
      [
        10,
        5
      ],
      [
        null,
        15
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Watches",
    "type": "portion",
    "tiers": [
      [
        225,
        15
      ],
      [
        null,
        5
      ]
    ],
    "min": 0.25
  },
  {
    "name": "Everything else",
    "flat": 15,
    "min": 0.25
  }
]

export function findFeeCategory(name) {
  return FEE_CATEGORIES.find(c => c.name === name) || null
}

/** Headline rate before the digital services fee, at a given price. */
export function baseRateAt(cat, price) {
  if (!cat) return null
  if (cat.flat !== undefined) return cat.flat
  if (cat.type === 'whole') {
    const band = cat.tiers.find(([limit]) => limit === null || price <= limit)
    return band ? band[1] : cat.tiers[cat.tiers.length - 1][1]
  }
  return null // portion categories don't have a single rate
}

/**
 * The referral fee Amazon charges on a sale, in pounds, including the
 * per-item minimum and the digital services fee.
 */
export function referralFeeFor(cat, price) {
  if (!cat || !(price > 0)) return 0
  let fee = 0
  if (cat.flat !== undefined) {
    fee = price * cat.flat / 100
  } else if (cat.type === 'whole') {
    fee = price * baseRateAt(cat, price) / 100
  } else if (cat.type === 'portion') {
    let from = 0
    for (const [limit, rate] of cat.tiers) {
      const to = limit === null ? price : Math.min(price, limit)
      if (to > from) fee += (to - from) * rate / 100
      if (limit === null || price <= limit) break
      from = limit
    }
  }
  if (cat.min !== null && cat.min !== undefined) fee = Math.max(fee, cat.min)
  return fee * (1 + DIGITAL_SERVICES_FEE)
}

/** The effective percentage at a price, for display. */
export function effectiveRate(cat, price) {
  if (!cat || !(price > 0)) return null
  return referralFeeFor(cat, price) / price * 100
}

/** Short description of how a category charges, e.g. "8% up to £20, 15% above". */
export function describeCategory(cat) {
  if (!cat) return ''
  if (cat.flat !== undefined) return `${cat.flat}%`
  const parts = cat.tiers.map(([limit, rate], i) => {
    if (limit === null) return `${rate}% above`
    return cat.type === 'portion'
      ? `${rate}% on the first £${limit}`
      : `${rate}% up to £${limit}`
  })
  return parts.join(', ')
}

/** Every price at which a category's rate changes — where margins can jump. */
export function thresholdsFor(cat) {
  if (!cat || !cat.tiers) return []
  return cat.tiers.map(([limit]) => limit).filter(l => l !== null)
}

/** Plain rates that were entered without the digital services fee. */
export const PLAIN_RATES = [5, 7, 8, 9, 10, 12, 13, 15, 20, 45]

/**
 * Works backwards from the fee Amazon shows to the categories that would
 * charge it. Amazon's calculator may show the fee with or without the 2%
 * digital services fee, so both are tried. Returns matching category names,
 * grouped so identical fees at this price read as one answer.
 */
export function categoriesForFee(price, feeShown, tolerance = 0.011) {
  if (!(price > 0) || !(feeShown >= 0)) return []
  const out = []
  for (const cat of FEE_CATEGORIES) {
    const withDsf = referralFeeFor(cat, price)
    const withoutDsf = withDsf / (1 + DIGITAL_SERVICES_FEE)
    if (Math.abs(withDsf - feeShown) <= tolerance) out.push({ name: cat.name, basis: 'including the 2% fee' })
    else if (Math.abs(withoutDsf - feeShown) <= tolerance) out.push({ name: cat.name, basis: 'before the 2% fee' })
  }
  return out
}

/**
 * Words that suggest a product belongs in a category. Used only to choose a
 * sensible *name* when several categories charge exactly the same fee — the
 * fee itself comes from Amazon. Deliberately broad: household cleaning and
 * DIY both sit under Tools and Home Improvement on Amazon UK.
 */
const CATEGORY_HINTS = {
  'Tools and Home Improvement': ['clean', 'cleaner', 'cleaning', 'washing', 'wash', 'liquid', 'detergent', 'degreaser', 'bleach', 'spray', 'paint', 'primer', 'varnish', 'tool', 'drill', 'screw', 'household', 'home improvement', 'diy', 'mould', 'descaler', 'drain', 'unblocker', 'pest', 'insect', 'killer', 'repellent'],
  'Home Adhesives and Cable Ties': ['glue', 'adhesive', 'pva', 'tape', 'cable tie', 'sealant', 'superglue'],
  'Door, Window and Shower Accessories': ['door', 'window', 'shower', 'curtain', 'draught', 'letterbox'],
  'Furniture Accessories': ['furniture', 'cushion', 'chair', 'sofa', 'table leg', 'castor', 'drawer'],
  'Home Products': ['home', 'household', 'storage', 'bin', 'laundry', 'air freshener', 'candle', 'decor'],
  'Kitchen': ['kitchen', 'jug', 'bowl', 'pyrex', 'pan', 'baking', 'cook', 'utensil'],
  'Beauty, Health and Personal Care': ['shampoo', 'conditioner', 'razor', 'blade', 'shave', 'shaving', 'deodorant', 'skin', 'cream', 'lotion', 'toothpaste', 'dental', 'health', 'beauty', 'personal care', 'perfume', 'fragrance', 'cosmetic'],
  'Grocery and Gourmet': ['food', 'grocery', 'coffee', 'tea', 'snack', 'drink', 'sauce', 'salt', 'sugar'],
  'Pet Supplies': ['pet', 'dog', 'cat', 'flea', 'poop', 'poo bag'],
  'Baby Products': ['baby', 'nappy', 'infant', 'toddler'],
  'Office Products': ['office', 'stationery', 'pen', 'marker', 'notebook', 'paper'],
  'Toys and Games': ['toy', 'game', 'play', 'puzzle', 'crayon', 'craft', 'clay', 'sand'],
  'Lawn and Garden': ['garden', 'compost', 'lawn', 'plant', 'seed', 'soil'],
}

/** Ranks category names by how well they fit a product description. */
export function rankByRelevance(names, text) {
  const t = String(text || '').toLowerCase()
  const score = (name) => (CATEGORY_HINTS[name] || []).reduce((s, w) => s + (t.includes(w) ? (w.includes(' ') ? 2 : 1) : 0), 0)
  return [...names].map((name, i) => ({ name, s: score(name), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => ({ name: x.name, score: x.s }))
}
