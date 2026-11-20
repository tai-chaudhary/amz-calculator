# eBay and TikTok listings — proposal for review (16 Nov 2026)

**Nothing has been created.** The owner asked for these listings to be built "EXTREMELY carefully … with the correct
packaging selected", so this is the proposal to check first. The full list, line by line, is in the portal:
**Finance → Checks → eBay and TikTok listings → Show the proposal** (with a download). It is worked out live by
`report_channel_listing_proposals()` (migration 122), so it stays current as codes are linked and reports uploaded.

## How each proposed listing is worked out
| Part of the listing | Where it comes from | How sure |
|---|---|---|
| Channel, code, title | The channel's own report / HELM (eBay item number, TikTok seller SKU or product ID) | Certain |
| Products and quantities | The item code's link to products (`inv_channel_skus`, all 388 verified on 14 Nov) | Certain where a link exists |
| Packaging, carrier, service | Copied from the Amazon listing that sends **exactly the same products and quantities** (the owner's rule of 14 Nov). Where several Amazon listings match, the one with packaging set and the most sales | Certain only where such a listing exists and they agree |
| Weight | The products' own weights × quantity | Certain where every product has a weight |
| Fee % | What the channel really charged on those sales, ex VAT, as a share of the price | From the reports; missing until a report is uploaded |
| Sell price | The last price it sold at | A starting point — the owner sets it |

## Where it stands (83 items that have sold)
| | eBay | TikTok |
|---|---|---|
| Ready — every part known | 32 (363 orders) | 28 (63 orders) |
| No Amazon listing with the same products → **packaging has to be chosen** | 19 (57 orders) | 2 (3 orders) |
| The matching Amazon listing has no packaging set | 1 (10 orders) — Plenty FlexiSheets 2 Rolls | — |
| No product linked to the code | 1 — eBay 366734463018 "3 in 1 Kids Role Play Costumes" | — |

## Things that need the owner's eye before anything is made
1. **eBay items sold at very different prices under more than one SKU (8 items).** An eBay item number can hold
   several variations (pack sizes). Examples: 366706836318 sold from £8.95 to £29.95 under 3 SKUs; 366701642473 from
   £9.95 to £17.95; 366768722348 from £9.95 to £17.95; 366663276300 from £6.95 to £12.95. Each variation needs its
   own listing, keyed on the SKU — not one listing for the item number. **Decision: key eBay listings on the SKU
   (custom label) wherever one exists, and on the item number only where it does not?**
2. **The same products under two codes (34 items).** Mostly TikTok, where HELM reports the seller SKU
   (e.g. `SCOLA-PVAGLUE-5L`) and TikTok's own report uses its product ID (e.g. `1729942466680429257`) for the same
   listing. **Decision: one listing holding both codes?** (Recommended — otherwise fees from the report and sales from
   HELM land on different listings.)
3. **Packaging for the 21 items with no matching Amazon listing** — sets and multi-packs sold only on eBay/TikTok
   (Pyrex bowl packs and jug sets, Plenty 12 rolls as 6 × 2, 6 × Sanmex, Sharp Sand & Cement, Brown Salt 10kg, Cotton
   Tree, Canbrush, Goodyear Ice Scraper…). These cannot be copied; the owner picks the packaging for each.
4. **9 items where a product has no weight** (so postage cannot be estimated): the product needs its weight first.
5. **20 items with no fee seen yet** — sold through HELM but not yet in an uploaded channel report (all TikTok's
   seller-SKU lines). Upload TikTok's Income report; until then no fee is proposed rather than a guessed one.
6. **Fees are a percentage of the price, but eBay's include a fixed amount per order**, so the same item shows 20.7%
   at £5.74 and 13–15% at £15–£35. **Decision: hold eBay's fee as "percentage + fixed amount per order" rather than
   one percentage?** (Recommended; the report has both parts.)
7. **Listings that have never sold** are not in this proposal (about 290 codes are linked; 83 have sold). They can be
   proposed the same way when wanted.

## What happens after the review
For each line the owner marks ready: one listing is created for that channel with those products, packaging, carrier,
weight and fee; the item code(s) are attached; the sale lines link to it (so fees, packaging and postage estimates
appear and the "Sales not linked to a listing" check clears). Each creation is logged on the listing. Nothing is
created in bulk without that review.
