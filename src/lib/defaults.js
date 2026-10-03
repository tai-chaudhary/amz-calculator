export const DEFAULT_CARRIERS = {
  royalmail: {
    name: 'Royal Mail',
    maxWeight: 20,
    services: { standard: true, nextday: true, prime: true },
    categories: [
      { id: 'll', name: 'Large Letter (Letterbox)', maxKg: 0.75, rates: { standard: 1.55, nextday: 2.90, prime: 2.90 } },
      { id: 'sm', name: 'Under 500g', maxKg: 0.5, rates: { standard: 2.85, nextday: 3.99, prime: 3.99 } },
      { id: 'md', name: '500g – 2kg', maxKg: 2, rates: { standard: 3.99, nextday: 5.25, prime: 5.25 } },
      { id: 'lg', name: '2kg – 10kg', maxKg: 10, rates: { standard: 6.50, nextday: 8.99, prime: 8.99 } },
      { id: 'xl', name: '10kg – 20kg', maxKg: 20, rates: { standard: 9.99, nextday: 13.50, prime: 13.50 } },
    ],
  },
  evri: {
    name: 'Evri',
    maxWeight: 15,
    services: { standard: true, nextday: true, prime: false },
    categories: [
      { id: 'sm', name: 'Under 500g', maxKg: 0.5, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'md', name: '500g – 2kg', maxKg: 2, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'lg', name: '2kg – 5kg', maxKg: 5, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'xl', name: '5kg – 15kg', maxKg: 15, rates: { standard: 0, nextday: 0, prime: 0 } },
    ],
  },
  dpd: {
    name: 'DPD',
    maxWeight: 30,
    services: { standard: true, nextday: true, prime: true },
    categories: [
      { id: 'sm', name: 'Under 500g', maxKg: 0.5, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'md', name: '500g – 2kg', maxKg: 2, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'lg', name: '2kg – 15kg', maxKg: 15, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'xl', name: '15kg – 30kg', maxKg: 30, rates: { standard: 0, nextday: 0, prime: 0 } },
    ],
  },
  amazonshipping: {
    name: 'Amazon Shipping',
    maxWeight: 25,
    services: { standard: true, nextday: true, prime: true },
    categories: [
      { id: 'sm', name: 'Under 500g', maxKg: 0.5, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'md', name: '500g – 2kg', maxKg: 2, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'lg', name: '2kg – 15kg', maxKg: 15, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'xl', name: '15kg – 25kg', maxKg: 25, rates: { standard: 0, nextday: 0, prime: 0 } },
    ],
  },
  dhl: {
    name: 'DHL',
    maxWeight: 30,
    services: { standard: true, nextday: true, prime: false },
    categories: [
      { id: 'sm', name: 'Under 500g', maxKg: 0.5, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'md', name: '500g – 2kg', maxKg: 2, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'lg', name: '2kg – 15kg', maxKg: 15, rates: { standard: 0, nextday: 0, prime: 0 } },
      { id: 'xl', name: '15kg – 30kg', maxKg: 30, rates: { standard: 0, nextday: 0, prime: 0 } },
    ],
  },
}

export const DEFAULT_PACKAGING = [
  { id: 'p1', name: 'Small Poly Bag', cost: 0.08 },
  { id: 'p2', name: 'Medium Poly Bag', cost: 0.14 },
  { id: 'p3', name: 'Small Box', cost: 0.45 },
  { id: 'p4', name: 'Medium Box', cost: 0.75 },
  { id: 'p5', name: 'Large Box', cost: 1.20 },
]

export const DEFAULT_ROUTING_RULES = [
  { id: 'r1', priority: 1, serviceLevel: 'prime', letterbox: true, weightMax: 0.75, carrierId: 'royalmail' },
  { id: 'r2', priority: 2, serviceLevel: 'prime', letterbox: false, weightMax: 2, carrierId: 'royalmail' },
  { id: 'r3', priority: 3, serviceLevel: 'nextday', letterbox: false, weightMax: 2, carrierId: 'evri' },
  { id: 'r4', priority: 4, serviceLevel: 'standard', letterbox: false, weightMax: 2, carrierId: 'evri' },
  { id: 'r5', priority: 5, serviceLevel: 'standard', letterbox: false, weightMax: 99, carrierId: 'dpd' },
]

export const REF_FEE_OPTIONS = [
  { value: '15.3', label: '15.3% — default' },
  { value: '10', label: '10%' },
  { value: '7.14', label: '7.14%' },
  { value: 'custom', label: 'Custom %' },
]

export const SERVICE_LABELS = { standard: 'Standard', nextday: 'Next Day', prime: 'Prime' }
