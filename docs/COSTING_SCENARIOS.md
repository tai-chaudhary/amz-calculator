# Costing scenarios register

**What this is.** Every situation that decides what an order cost — and how the portal treats it. It exists because
the P&L was called checked when it had only been checked for adding up (Nov 2026). The owner's rule:

> There must be no scenario we are not aware of. If an order's cost differs from what its listing says, one of the two
> is wrong — or the difference is small, genuine and explainable. Anything that does not make sense is flagged,
> discussed with the owner, and fixed with him. Nothing is fixed silently.

**How to use it.** Before changing anything in costing or the P&L, read this. When a new situation turns up, add it
here first — what happens, how the portal treats it, who decided, and the evidence. Never delete a scenario; mark it
settled. Every chat that works on costing keeps adding to this file; it ships in the zip.

**Status words.** `SETTLED` — the owner has decided and the portal does it. `FAULT` — the portal gets it wrong today.
`ASK` — needs the owner's decision. `LOOK` — not yet examined.

Figures below are from the live database on 16 Nov 2026, orders since 1 Aug 2026 (13,123 orders with a sale line).

---

## A. Cost of goods sold (product cost)

How it works: first in, first out from 1 Aug 2026 (`cost_rebuild` → `cost_layers` in, `cost_uses` out). From 19 Oct
every unit out is a stock movement tied to the order; before that, units come from the listing's products × quantity.
`report_pl_lines` gives each order the cost of the stock that actually went out for it.

| # | Scenario | Evidence | How the portal treats it | Status |
|---|---|---|---|---|
| A1 | Order's stock out = what the listing says (same products, same units) | 12,270 orders (93.5%), 21,761 units, £50,045 | Cost of those units, FIFO | SETTLED |
| A2 | **More units went out than were ordered** (same product) | 5 orders: 30→58 salt, 4→16 glue, 3→6, 2→4, 2→4. £249 cost on £321 sales | All units charged to the order → the order shows a loss it did not make | **FAULT / ASK**: was stock really sent twice (then it is a replacement, not this sale), or recorded twice? |
| A3 | A **different product** went out than the listing names | 224 orders | Cost of what went out | see A3a–A3c |
| A3a | Scola Multipurpose Glue 5L → Clear PVA 5L (or Washable PVA) | 160 orders, cost within a few % | Known substitute until Multipurpose was stocked (4 Nov) | SETTLED (14 Nov) |
| A3b | **Plenty FlexiSheets 12 Rolls → 6 × the 2-roll pack** | 57 orders. Stock out cost £15.27 an order; the "12 Rolls" product is costed £2.55 in the portal | Engine charges £15.27 (6 packs). The listing's own cost says £2.55 | **ASK**: one is wrong. £2.55 was set on 10 Nov from Regal's price list — is that the price of ONE 2-roll pack? |
| A3c | Other one-off swaps (Sanmex→Pestshield, Plenty variants, Ant Killer 200g→150g) | 8 orders | Cost of what went out | ASK: genuine substitutes? |
| A4 | **Fewer units went out than the listing says** | 3 orders, TidyZ Handy Bags "Pack of 12": listing = 12 units, 1 went out. Cost £0.54 on an £11.46 sale | Cost of 1 unit → cost understated | **FAULT / ASK**: is the stock item one bag or one pack of 12? Listing and item units disagree |
| A5 | Sale with **no cost yet** | 114 orders, all dated 14 Nov | Labelled in HELM (so a sale that day) but not yet despatched in the portal (Saturday's DHL labels go Monday) → no stock out yet → P&L shows the listing's cost, marked not costed | ASK: is "sale on the label day, cost when it leaves" right, or should both wait for despatch? |
| A6 | Order costed but **its line is not linked to a listing** | 503 orders (eBay / TikTok), £1,714 cost on £4,800 | Cost of what went out; nothing to compare against | ASK / LOOK: link these listings so they can be checked |
| A7 | Stock out as a sale with **no sale line in the ledger** | 4 refs, 43 units, £108: three wholesale references and one hand-made label | Cost is in `cost_uses` but belongs to no P&L line | LOOK: wholesale has its own fixed cost — check it is not counted twice or missed |
| A8 | Unit cost charged vs the product's portal cost | Product by product the two agree within 10% except 10 products, total difference under £700 (largest: White Rock Salt 25kg £3.60 vs £3.17; Washable PVA 5L £6.88 vs £6.19) | FIFO price paid, not today's portal cost | ASK: confirm each of the 10 |
| A9 | Same product bought at very different prices | Pyrex Mixing Bowl 0.7L £2.15 and £4.91; Artmix 12×600ml £7.48–£15.35 (6 prices); Clay Stone 2.5kg £2.19 / £3.44; Pyrex Jug 500ml £3.35–£4.85; Ice Scraper £0.54–£0.76; Unicorn paint £6.64–£9.15 | Each layer at its own price | Artmix SETTLED (15 Nov rules). Others ASK |
| A10 | Products with **no cost** (stock valued at £0) | 18 products, small quantities, plus Coloured Sand (not a product yet) | Cost £0 | ASK (owner said ~90% are Pound Wholesale; supplier list price may be used, logged) |
| A11 | Stock that arrived with no PO (1 Aug–17 Oct) | ~19,500 units | Price paid for the same product in the period → first later PO → pre-live price → portal cost; salt = portal cost | SETTLED (14 Nov) |
| A12 | Pre-live stock, start-up differences, the 17 Oct count | Start-up differences ~£6,400 kept out of the P&L | 17 Oct count wins | SETTLED (14 Nov) |
| A13 | Returned to supplier against a credit note (ESPO Artmix) | 275 units, £4,221 | Not a cost of sales | SETTLED (15 Nov) |
| A14 | Replacements, damages, removed stock | 390 / 4 / 98 units | Own lines in the P&L; losses from 1 Dec | SETTLED |

## B. The listing's own cost, over time

| # | Scenario | Evidence | Status |
|---|---|---|---|
| B1 | A listing's cost is checked against an order from an earlier date | The listing cost log (`cost_history`) only starts 22 Sep 2026: 50 changes, 47 listings. Before that there is no record of what a listing's cost was | **ASK**: for Aug–21 Sep orders, compare with the earliest logged cost? An audit must use the cost in force on the order's date, never today's |
| B2 | **Drastic cost changes** (doubled or halved, or more) | 13. On 10 Nov, from "Regal Wholesale's price list": Plenty FlexiSheets 12 Rolls £14.99→£2.55 (three listings); Kleenex XL 24 £71.94→£14.20; Zoflora 6×250ml £101.94→£10.76; Zoflora single £16.99→£1.79 and £27.99→£2.50; Andrex 4 £9.99→£1.67; Andrex 9 £12.99→£3.25. Earlier: Artmix £9.98→£14.99 (25 Sep), £15.35→£8.98 (28 Oct) | **ASK each**: real, or a pack price put on a multi-pack listing? (See A3b.) Artmix SETTLED |
| B3 | Product (stock item) cost changes | Logged in `activity_log` / `price_history` — not yet read | LOOK |

## C. Shipping

| # | Scenario | Evidence | How the portal treats it | Status |
|---|---|---|---|---|
| C1 | HELM has one real label per parcel | most orders | Carrier's rate for that service and weight, dated | SETTLED |
| C2 | **A label attempt that never became a label** is counted as a parcel | 116 orders with a real label plus failed attempts (335 extra "parcels"); e.g. two orders of 1 × Salt 25kg at £7.59 instead of £4.59. DHL alone ≈ £600 overstated | Every HELM shipment row counted | **FAULT** (owner agreed to fix in the audit): count only parcels with a tracking number |
| C3 | Only failed attempts in HELM | 96 orders (86 Evri Next Day) | Counted as parcels of that service | **FAULT**: see C4 |
| C4 | **Label bought outside HELM** — Amazon Buy Shipping, Veeqo, DHL's own portal | Owner, 16 Nov: HELM shows these cancelled or archived with no shipment; the label is uploaded to the portal | P&L looks only at HELM | **FAULT / ASK**: use the portal's own label (carrier, service) — matched by order number, else postcode with care (postcodes are sometimes misread). What do Buy Shipping labels cost? |
| C5 | No label evidence at all | LOOK | Listing's shipping, marked estimated | LOOK |
| C6 | Multi-parcel orders, pallets, wholesale collections | LOOK | Carrier's multi-parcel rule; bulk orders have their own money | LOOK |
| C7 | Carrier rate changes over time | 4 dated versions in `cost_versions` | Rate in force on the day | LOOK: check each version's dates |

## D. Fees, revenue, refunds — LOOK (not yet examined)
- Fees from the channel's report vs estimated from the listing; how big the estimates' errors are once the report arrives.
- Refunds with and without the stock coming back; refunded fees.
- FBM Ship+ cashback; other charges and credits.
- TikTok fees: VAT on top or not (open since 14 Nov).
- Orders in a report but not in HELM, and the other way round.

## E. Packaging — parked by the owner
He is still changing the packaging mapping and will give start dates; not audited until then.

## F. Timing
| # | Scenario | Status |
|---|---|---|
| F1 | A sale is counted on the day its label is made in HELM; its stock cost arrives when it is despatched in the portal (see A5) | ASK |
| F2 | Costing is rebuilt at 02:30 each night and after each report upload; orders since then show the listing's cost | SETTLED, but must be visible |
| F3 | Open orders count with today as estimates | SETTLED (15 Nov) |

---

## Round 2 findings (16 Nov 2026, 02:30) — what the records show for the open items

**A2 — the five orders with more units out than ordered**
| Order | Ordered (HELM agrees) | What the records show | Reading |
|---|---|---|---|
| 204-0707382-5485143 (3 Nov) | 1 × Pestshield Flea 3-pack | 3 units came off stock twice the same day, one label | Stock taken off twice for one label |
| 204-9504515-1341166 (30 Oct) | 2 × Pyrex Jug 500ml | 2 came off twice the same day | Same |
| 205-9139654-2923535 (3 Nov) | 1 × Pyrex Jug 2-pack | 2 came off twice the same day | Same |
| 206-4547069-2001937 (3 Nov) | 30 × Peacock Salt 10kg | Label stamped "58 X", 58 came off stock | ASK owner: 30 or 58 sent? |
| 205-5139624-8858732 (5 Nov) | 4 × Multipurpose Glue 5L | Label "4 X Scola Clear PVA Glue 5L"; 16 came off stock, £110.08 | ASK / LOOK: the item's units at the time |
The first three: a despatch that was undone and done again. The engine charges both and treats the undo as new stock
in ("despatch undone": 4 layers, 8 units, £18 in all) — **FAULT in the engine**: an undone despatch must cancel its cost.

**A4 — TidyZ Handy Bags "Pack of 12" (3 orders, 28–31 Oct)** — not hand-made labels. They came in a HELM file with
HELM's item "Tidyz 12 Packs of 40". The portal's first guess for that new item code was 1 unit, so the label was
stamped "TIDYZ HANDY BAGS 40CT" (no "12 X") and 1 came off stock. One of the three had a replacement of 8 sent on
4 Nov — so the warehouse very likely sent 1 pack, as the stamp said. The code is now set to 12 and confirmed; since
then a code nobody has verified cannot go through (it waits in On hold). Owner's rule: it should always be 12.

**B2 — the Regal changes of 10 Nov (the owner remembered right; the activity log shows it)**
- Two Regal POs (PO-HI-20261110-001, -002) were entered from invoices and set products' "last price paid" to the
  CASE price: Andrex 4 £1.67→£9.99, Andrex 9 £3.25→£12.99, Zoflora Mandarin & Lime £1.42→£16.99, Zoflora Cosy
  Moments £2.33→£27.99, Kleenex XL £2.00→£11.99.
- The same day Regal's price list was imported (1,663 products, 27 changes proposed) and the owner approved the
  corrections. Those five products now hold unit prices (£1.67, £3.25, £1.42, £2.33, £2.00). SETTLED as costs;
  LOOK: was stock received on those POs put into the costing at the case price?
- **Still wrong: Plenty FlexiSheets 12 Rolls = £2.465**, less than the 2-roll pack (£2.545). PO-HI-20261110-002 is
  £1,064.88 = 432 × £2.465 — 432 two-roll packs booked against the 12-roll product. Effect: 12-roll orders before
  19 Oct were costed at £2.47 each instead of about £15 (≈40 orders, ≈£490 understated); from 19 Oct the stock that
  goes out (6 two-roll packs, £15.27) is right. ASK: is "12 Rolls" simply 6 × the 2-roll pack?

**Owner's answers (16 Nov)**
- Orders before 22 Sep (no listing cost log): compare with the earliest cost on record. SETTLED.
- A sale counted before it is despatched must carry an accurate estimate from the portal's costs. (Today: the
  listing's products at the portal's cost, marked "not costed yet" — to be verified in the audit.) SETTLED.
- A label with no packing slip at all is where a wrong product or quantity can be chosen by hand. Most such orders
  are still in HELM unless a genuine replacement. He will ask Jignesh to make replacement labels in HELM too. Wanted:
  the portal checks HELM for that parcel (by postcode and the like), suggests the order, and warns when the product
  chosen by hand does not match HELM's record.

**A6 — eBay and TikTok (checked 16 Nov)** — there are NO eBay or TikTok listings in the portal (336 Amazon listings,
99 with no channel, none for eBay or TikTok). What was done on 14 Nov: about 290 eBay/TikTok item codes were linked
to products (`inv_channel_skus`), so those orders ARE costed for product cost — all 431 eBay and 68 TikTok sale lines
carry an item code — but 0 of them are linked to a listing, so there is nothing holding their fees, packaging or
shipping estimate, and nothing to check them against. Building the listings from the channels' reports is in the
master plan (C4) and was noted as "next" on 14 Nov; it was never built. The owner believed it had been. **TO BUILD.**

## Round 3 (16 Nov 2026, 03:00) — owner's answers, what the records show, and the first shipping findings

**Correction to Round 2.** "PO-HI-20261110-002 = 432 two-roll packs" was WRONG. The order is one line: Regal code
11259 "Plenty FlexiSheets Kitchen Roll 12 Rolls", **60 × £14.79 = £887.40 ex VAT (£1,064.88 with VAT)**, Regal
invoice SO522607. £14.79 is a case of 6 two-roll packs (£2.465 a pack). So the "12 Rolls" product — which IS the case
— should cost **£14.79**, not £2.465; the price-list import divided the case price by 6 on a product that is the whole
case. Both Regal orders are still "awaiting delivery" with nothing received, so **nothing from them has entered the
costing** (the Round 2 LOOK is closed). ASK: both orders carry invoice number SO522607, and the first order's lines
alone add up to that invoice's total (£4,677.67) — is the Plenty line on a different invoice? Owner is checking.

**A2 — the five orders, settled**
| Order | Owner's answer | Cause found | Correction agreed (not yet made) |
|---|---|---|---|
| 204-0707382-5485143, 204-9504515-1341166, 205-9139654-2923535 | Portal error; fix it and stop it happening again | A despatch undone and done again is charged twice | Engine: an undone despatch cancels its cost. Check: units out for an order may never exceed the label's units |
| 205-5139624-8858732 (glue) | **4 were sent** | The substitute screen. It asks "how many of the substitute for EACH one ordered"; 4 was entered on an order of 4 → 4 × 4 = 16 off stock (the only substitute ever recorded with a number other than 1) | Substitute record to 4: stock +12 Multipurpose Glue, cost £110.08 → £27.52. Screen to ask for the TOTAL sent and warn when it differs from the order |
| 206-4547069-2001937 (salt, ordered 30) | Genuine human error: pallet label made for 58 instead of 28; **28 went on the pallet** (corrected verbally, never in the portal) | Records: two Evri Next Day labels of 1 bag each to the same postcode, made by hand with no order number, 3 minutes before the pallet label "58 X". 2 + 28 = 30. Pallet label was made on the Stone & Surfaces form on 3 Nov, before "Bulk order by pallet" existed | Bulk order to 30 units (2 by parcel, 28 by pallet): stock +30, cost £107.30 → about £55.50, pallet repriced for 280kg, the two Evri labels tied to the order (today they sit in Replacements). ASK: confirm 2 + 28 (owner also wrote "29") |

**Wholesale / pallet labels — what exists and what is missing.** "Bulk order by pallet" (v2.78–2.79, 13–14 Nov) already
takes the channel order number and fills in HELM's product, quantity and postcode, all editable; the Stone & Surfaces
form refuses our own orders and sends them there. The salt order was made 10 days before that. **Missing — TO BUILD:**
a warning when the quantity (or product) is changed away from what HELM says, shown before the pallet label is made.

**A4 — TidyZ "Pack of 12"** — owner: 12 were sent on the two orders. 203-3538541-7487560: 1 pack → 12 units (portal has
1). 204-8292173-1233116: the order was for 2 packs → 24 units (portal has 2). Correction agreed in principle: stock
−11 and −22, cost at 12 a pack. ASK: 202-6365177-2825960 (the one with the replacement of 8 on 3 Nov) — 12 too?

**NEW — A15. Labels with no order number, product chosen by hand ("manual")** — the biggest finding of this round.
- 165 despatched labels are "manual" (271 units), 17 "other" (23 units); only 50 are real replacements (92 units).
- The costing treats every label that is not an order as a replacement. So the P&L's **Replacements line (390 units,
  £943.74) is mostly not replacements**: roughly £650 of it is ordinary parcels whose label came with no packing slip
  — labels bought through Amazon Buy Shipping, Veeqo or DHL's own site.
- The orders those labels belong to are still in the channel reports as sales. Since 19 Oct there are **122 such
  orders (£1,793 ex VAT)**: sold, HELM shows them cancelled or cleared, no HELM label, no portal label under their
  number. Having no stock movement, 119 of them are costed from the listing instead.
- So their product cost is counted **twice** — once on the order (from the listing) and once in Replacements — and
  their shipping is either the failed attempts (wrong service) or the listing's estimate, not the label that was used.
- HELM no longer holds the postcode for those closed orders, so they cannot be paired by postcode from our copy;
  HELM itself may still give the address when asked order by order (to test). From v2.89.0 the Amazon slip is read
  at upload, so new Buy Shipping labels carry their order number. **FAULT. TO DECIDE:** pair each old hand-made label
  with its order (one-off, with the owner reviewing the doubtful ones); from now on a label with no order number must
  be either tied to an order or declared a replacement — never left as "manual".

**C — Shipping, first pass (orders with a sale line since 1 Aug: 13,121)**
| Evidence for the order's shipping | Orders | How the P&L costs it today | Status |
|---|---|---|---|
| Real HELM labels only (from 13 Oct) | 5,716 | Carrier's dated rate per parcel | Rates still to be checked version by version (C7) |
| Real labels plus failed attempts | 115 | Failed attempts counted as parcels | FAULT (C2) |
| Only failed attempts | 69 | Counted as parcels of the service that failed | FAULT (C3 / A15) |
| No HELM parcel, portal label under the order number | 16 | Listing's estimate — the portal's own label is ignored | FAULT (C4) |
| One bulk order (pallet) | 1 | Its own pallet + parcel cost — but worked out on 58 units, 1 parcel | To correct with the salt order |
| No label anywhere, 13–18 Oct | 597 | Listing's estimate (before orders were tied to labels) | as C8 |
| No label anywhere, from 19 Oct | 71 | Listing's estimate; eBay/TikTok have no listing → **£0 shipping** | FAULT: part of A15 and A6 |
| Before 13 Oct | 6,536 | Listing's estimate × units | C8 |

**NEW — C8. Estimated shipping is "listing's shipping × units".** Every order before 19 Oct (7,980) is estimated this
way; 605 of them had more than one unit (1,655 units → costed as 1,655 parcels). Since HELM, the real figures for
multi-unit orders are 1,568 units in 1,013 parcels, and 61% went as ONE parcel. So Aug–mid Oct shipping is overstated
for multi-unit orders. ASK: estimate those by what HELM shows the same listing and quantity actually ships as since
19 Oct (parcels and service), rather than one parcel per unit?

**NEW — C9. eBay / TikTok orders with no parcel evidence get £0 shipping** (no listing to estimate from). Small today
(about 30 orders) but it is silent. Goes away when the eBay/TikTok listings are built (A6).

**Purchase orders entered in cases** — 11 lines on 7 orders carry "how many in a case"; 4 of those lines have been
received. The costing engine does read the case size. LOOK (next round): check those 4 received lines went in at the
unit price and the unit quantity.

**Still to do in the deep dive:** carrier rates version by version (C7), multi-parcel rules against real invoices,
the case-size PO lines, product cost changes in the activity log (B3), fees and refunds (D).

## Round 4 (16 Nov 2026, 03:30) — owner's answers; carrier rates, fees, charges, refunds

**Owner's answers**
- Salt 206-4547069-2001937: 2 bags by Evri + 28 on the pallet = 30. SETTLED (correction as in Round 3).
- TidyZ 202-6365177-2825960: Jignesh uploaded it as 1, Sagar sent 4 although the label said 1, then 8 went as a
  "replacement" on 3 Nov — 12 in all. Two human errors. Portal has 1 as the sale and 8 as a replacement. ASK: count all
  12 as this order's cost (the 8 were the rest of the order, not a replacement for faulty goods)?
- Amazon Buy Shipping labels cost the same as Evri: it is our own Evri account linked to Amazon. So an order whose
  label was bought there is costed at our Evri rate for its service and weight. SETTLED. (The Amazon report backs this
  up: only 7 "Delivery label purchased through Amazon" charges since August, £65.39, with 5 refunded £53.30.)
- C8: estimate shipping for multi-unit orders before 19 Oct from how the same listing and quantity actually ships
  since HELM (parcels and service). SETTLED — to build.

**C7 — Carrier rates.** One version per carrier, all dated from before 1 Aug ("starting rates as set on 6 Nov"):
| Carrier | Rate ex VAT | More than one parcel |
|---|---|---|
| Evri (also Amazon Buy Shipping) | under 2kg: £2.07 next day, £1.97 48hr · 2–15kg: £2.70 next day, £2.50 48hr | each parcel at its own rate |
| DHL | £4.59 up to 30kg | first £4.59, each further parcel £3.00 |
| DPD | £5.10 | £3.50 each when more than one (no DPD labels in HELM so far) |
| Farrall's pallets | Oct 2026 price sheet + 18% fuel | — |
Real labels since HELM: Evri next day 4,844, DHL 1,223, Evri 48hr 221, Evri 24 POD 85.
ASK: (1) were these the rates for the whole period from 1 Aug, or did any change? (2) do Evri or DHL add anything on
their invoices — fuel, peak or Christmas surcharge, oversize, failed collection? The only true check is one recent
invoice from each against the portal's figure for the same days. LOOK when invoices are supplied.

**NEW — C10. An order with no listing is weighed as 0kg.** eBay and TikTok lines have no listing, so their parcels
fall in Evri's "under 2kg" band whatever they weigh (a 10kg salt bag costs £2.70, charged £2.07). Goes away with the
eBay/TikTok listings (A6); until then the product's own weight should be used. FAULT (small).

**Purchase orders entered in cases** — the engine handles them: Sanmex 162 cases → 1,944 at £0.8325; Plenty Ultrasorb
120 cases → 720 at £2.20; Zippo 5 cases → 480 at £1.7575. All correct. **One doubt: PO-HI-20261002-001, Plenty Max
Performance, 60 cases of 6 at £14.34 — the costing has 60 units at £2.39, not 360.** ASK: did 60 packs or 60 cases
(360 packs) arrive?

**D — Fees**
- Amazon and eBay: fees come from the channels' own reports with the VAT taken off. Sale lines: 12,314 Amazon, 431 eBay.
- Listings against what Amazon actually charges (Oct–Nov, 161 listings): 149 agree within 0.3 of a point. **12
  listings are set at 15.3% where Amazon charges about 8.2%** (Air Dry Clay 12.5kg ×3, Readymix Fluorescent, Jungle
  Formula ×2, Radox 6-pack, Gillette SkinGuard and others) and one the other way (Readymix Assorted, set 8.16%,
  charged 11.1%). The P&L uses the report's fee, so past figures are right; the listing pages and the estimates for
  the newest days are about £290 too pessimistic. Owner's rule: the listing should be updated from the report, logged.
  TO DO with his approval, listing by listing.
- 352 Amazon lines (2–14 Nov) are still on estimated fees until the next Amazon report is uploaded. Expected.
- **TikTok: 51 of 68 sale lines carry NO fee at all** (£638 of sales, 15 Oct–14 Nov). They came from HELM and there is
  no listing to estimate from; TikTok's income report has only been uploaded up to 2 Nov. **FAULT**: upload the report,
  and until a report arrives estimate at TikTok's rate. Still open: whether TikTok's fees carry VAT on top.

**D — Other charges and credits**
| What | Lines | Amount in the P&L |
|---|---|---|
| Amazon "Incentive disbursement" (FBM Ship+ cashback) | 8,497 | +£3,146.10 |
| eBay Promoted Listings | 418 | −£439.43 |
| Amazon return postage billed to us | 42 | −£121.05 |
| Amazon subscription | 4 | −£120.00 |
| eBay shop subscription | 4 | −£117.06 |
| Amazon delivery labels bought / refunded | 7 / 5 | −£65.39 / +£53.30 |
| Amazon SAFE-T reimbursements | 5 | +£63 |
**FAULT: this line uses the amounts as the reports show them, VAT included** (Amazon subscription £30 = £25 + VAT;
eBay's charges £556.49 with VAT, £463.75 without). The rule is all costs ex VAT. About £130 overstated so far.
ASK: does the Ship+ cashback carry VAT (does Amazon's credit note show any)?

**D — Refunds and returns**
- 123 refund lines; every one has its sale; none is bigger than its sale; 101 are full refunds. The refund takes the
  sale back and brings back the fee Amazon returns; the product cost stays with the order. SETTLED (14 Nov).
- 17 units came back into stock as customer returns. LOOK (small): confirm they re-enter at the cost they left at.
- Every despatched order label has a sale line, bar 3 references that are not channel orders (see A7).

**What is left to look at:** product cost changes in the activity log (B3), the 10 products whose charged cost is more
than 10% off the portal cost (A8), products bought at very different prices (A9), packaging (parked by the owner).

## Round 5 (16 Nov 2026, 04:00) — owner's decisions; fee corrections made; three checks

**Owner's decisions**
- eBay and TikTok listings are to be built and linked smartly (as discussed on 14 Nov). That is the fix for TikTok's
  missing fees (D), the £0 shipping (C9) and the 0kg weight (C10) — and it "needs to be 100% correct".
- Other charges including VAT: fix it.
- Listing fees should reflect what the channel's report shows. Where the report proves it on several orders, correct
  the listing without asking (this case only).
- Carrier rates: unchanged since 1 Aug. (Surcharges on the carriers' invoices: not answered yet.)
- TidyZ 202-6365177-2825960: all 12 units are this order's cost, AND the second parcel's postage (the 8 sent on
  3 Nov) is charged to the order too.
- **Order audit must hold everything about an order**: every stock movement, each label, any replacement and what was
  in it, refunds, returns, cashback received, fees, corrections. TO BUILD.
- **Inventory "Recent changes"** runs out within the day. Wanted: tabs (stock in, moves, despatches, counts and
  corrections…) each with "View more" to keep going back. TO BUILD (no figures involved).

**Fee corrections made on 16 Nov (15 listings, each logged on the listing as "Fee corrected", by Claude)**
Correction to Round 4: "12 listings set at 15.3%" was misleading. Listings with a fee CATEGORY work their fee out from
Amazon's schedule and price, and those were already right on the listing page; only the plain percentage stored
beside it (used by the database for days not yet in a report) was stale.
| Listing | Before | After | Evidence in the Amazon report |
|---|---|---|---|
| Scola Readymix Fluorescent (£19.95) | 15.3% | category Home Products → 8.16% | 17 orders at £19.95 charged 8%; 9 at £22.75 charged 15% |
| Scola Readymix Assorted ×3 listings (£24.95) | 8.16% | category Home Products → 15.3% | 3 orders at £24.95 charged 15%; 31 at £15.94–£17.95 charged 8% |
| Sanmex Fly & Wasp ×2, Plenty Ultrasorb 2 Pack, Plenty White 100 Sheets | 8% | 8.16% | 384 / 8 / 3 / 3 orders: 8% + the 2% digital services fee |
| Air Dry Clay Stone ×2, Terracotta, Radox 6-pack, Gillette SkinGuard, Jungle Formula ×2-pack | stored 15.3% (page already 8.16%) | stored 8.16% | 101 / 6 / 46 / 17 / 10 / 10 orders at 8% |
| Fairy MaxPower | stored 15.3% (page already 13.26%) | stored 13.26% | 5 orders at 13% |
The rule seen in the report: Readymix paint and the clay are 8% up to £20 and 15% above (Amazon's Home Products tier).
Not changed, one order each (not enough to be sure): Fairy Original Lemon (charged 13%, listing 15.3%); Plenty
Ultrasorb 2 Pack second listing and Zero In 2-pack (8% → 8.16%).

**NEW — D-fault. The database's fee estimate ignores the fee category.** Sales not yet in a report, and open orders,
are estimated from the listing's stored percentage, not its category. Of 88 category listings, 50 store a percentage that differs from what
their category gives at today's price: 37 too high (mostly 15.3% stored where the category gives 8.16% — Beauty/Health
and Baby under £10) and 13 too low (8% or 13% stored without the 2% digital services fee). Their newest days are
estimated on the stored figure until the report arrives. FAULT — fix: the estimate must use the category and price, and a listing's
stored percentage must be kept in step whenever its category or price changes.

**PO-HI-20261110-002 (Plenty FlexiSheets 12 Rolls)** — checked through the POs. It was read from its own document
("Pro_Forma_Invoice_3_.pdf") at 21:18 on 10 Nov, seven hours after PO-…-001; both are proformas, neither has a final
invoice attached. Only these two POs carry SO522607. The first order's five lines add up to exactly £4,677.67; the
second order shows the same number and the same £4,677.67 as "invoice total" although its own total is £1,064.88 —
so the Plenty line is NOT inside that £4,677.67. Either it is a separate Regal document or it was misread. LOOK when
Regal's final invoice(s) arrive; the portal already warns that the final invoice is still needed.

**PO-HI-20261002-001 (Plenty Max Performance, 60 cases of 6)** — cannot be verified from Goods In or the count:
there is no Goods In booking for it, the product is not in Inventory at all, and it was not found at the 17 Oct
count. 10 were sold 2–9 Oct; the PO was marked received on 17 Oct for 60, and those 60 were written to the start-up
difference (£143.40, kept out of the P&L). So nothing in the P&L depends on 60 vs 360. ASK: is any of this product in
the warehouse? If so it needs adding to Inventory.

**Ship+ cashback and VAT** — the report shows flat amounts (30p and 40p a parcel, 60p / 80p / £1 for more) with no
VAT column, so the report cannot settle it. Amazon's monthly credit notes (Seller Central → Tax Document Library)
will. Until then it stays as received. ASK accounts.

## Round 6 (16 Nov 2026, 04:30) — last discovery items, and the fix list

**Owner's answers**
- Ship+ cashback: the 30p / 40p is ex VAT (it is what was promised). Stays as received. SETTLED.
- Plenty Max Performance: he will confirm; it must not hold the build.
- Carrier rates in Cost Settings include every regular surcharge. Carriers sometimes add extras on their invoices,
  and those must be accommodated → carrier invoices (upload, extras as their own P&L line). TO BUILD (already in the
  master plan).

**B3 — product cost changes in the activity log (51 entries since 22 Sep)**
- **LIVE FAULT: Harpic Power Plus Max 10, Original and Citrus — cost £1.04 → £12.49 on 11 Nov** from Regal
  PO-HI-20261111-002 (64 and 10 at £12.49, no case size recorded, not yet delivered). £12.49 is the case of 12. The
  listings using them show the wrong cost today, and when the delivery is booked in 74 units would enter costing at
  £12.49 instead of 888 at £1.04. ASK to confirm, then put the case size on the PO lines and the cost back to £1.04.
- Sanmex Fly & Wasp: £0.8325 → £0.0694 on 11 Nov (divided by 12 twice), put back on 12 Nov. Right now.
- Plenty FlexiSheets 12 Rolls: £14.99 → £2.465 on 10 Nov. Still wrong (should be £14.79) — see Round 3.
- Plenty Ultrasorb / Max Performance: "last price paid" flipped back and forth on 23 and 28 Oct between two POs
  (£4.50 ↔ £4.10, £2.39 ↔ £2.20) — it follows whichever PO was touched last, not the latest by date. FAULT (small).
- The rest are small, each tied to a PO or a decision of the owner's.
- Lesson for the checks: a PO price more than about twice (or under half) the product's cost must stop and ask —
  "is this a case price?" — before it changes any cost.

**A8 — products charged more than 10% away from the portal cost (£683 in all)**
| Product | Units sold | Charged | Portal cost | Extra charged | Why |
|---|---|---|---|---|---|
| White Rock Salt 25kg | 736 | £3.60 | £3.17 | £316 | pre-live stock was registered at £3.60 |
| Scola Washable PVA Glue 5L | 284 | £6.88 | £6.19 | £197 | Daler-Rowney invoices and goods in say £6.88 |
| Scola Multipurpose Craft Glue 5L | 31 | £6.88 | £6.19 | £21 | same |
| Scola Readymix Assorted 600ml pack | 47 | £5.93 | £4.86 | £50 | pre-live stock at £5.93 (portal was £5.40, set to £4.86 on 11 Nov) |
| Scola Readymix Unicorn 300ml pack | 17 | £7.90 | £5.40 | £42 | pre-live stock at £6.64 / £7.90 / £9.15 |
| Pestshield Fly & Wasp 300ml | 359 | £0.90 | £0.82 | £30 | pre-live stock at £0.95 |
| Pyrex Classic Mixing Bowl 0.7L | 28 | £3.04 | £2.15 | £25 | pre-live stock at £4.91, invoice £2.15 |
Also: Pyrex 0.5L Mixing Bowl — stock is in costing at £5.99, portal cost £2.81 (none sold yet).
**ASK — the pattern in the Daler-Rowney lines: the portal cost is exactly 10% under the price on their invoices**
(£6.88 → £6.19, £5.40 → £4.86, Artmix £9.98 → £8.98). Is there a 10% discount that comes off after the invoice? If so
the costing should take it off the PO price for Daler-Rowney, and sales of those products are over-costed by 10%.
ASK: are the pre-live register prices right where they are well above today's cost (salt £3.60, bowl £4.91, Unicorn)?

**Discovery is complete** apart from packaging (parked by the owner) and the carriers' invoices (to be supplied).

---

## THE FIX LIST (for the owner's agreement before anything is built)

**A. One-off corrections to the records** (each shown before and after, each logged)
1. Glue order 205-5139624-8858732: 16 → 4.
2. The three double-charged orders (204-0707382-5485143, 204-9504515-1341166, 205-9139654-2923535).
3. Salt order 206-4547069-2001937: 58 → 30 (2 by Evri + 28 by pallet); the two Evri labels tied to it.
4. TidyZ "Pack of 12": 203-3538541-7487560 → 12; 204-8292173-1233116 → 24; 202-6365177-2825960 → 12 in all (4 + 8)
   plus the second parcel's postage.
5. Plenty FlexiSheets 12 Rolls cost → £14.79; Harpic ×2 cost → £1.04 and case size on the PO (after confirmation).
6. The 165 hand-made labels and their orders: pair each label with its order so the cost is counted once and the
   Replacements line holds only real replacements. Doubtful pairs go to the owner.

**B. Costing engine and P&L**
7. An undone despatch cancels its cost; units out for an order can never exceed its labels.
8. Shipping counts only real labels (with a tracking number), never failed attempts.
9. Orders whose label was bought outside HELM use the portal's own label: carrier, service, our rates.
10. Estimated shipping for multi-unit orders before 19 Oct follows how the listing really ships.
11. A label that is not an order is a replacement only when declared one; a top-up of a short shipment belongs to
    its order (units and postage).
12. Other charges and credits ex VAT (cashback stays as received).
13. Fee estimates use the listing's fee category and price; stored percentage kept in step.
14. "Last price paid" follows the latest PO by date.
15. Carrier invoices: upload, and extras as their own line.

**C. Stopping the errors at the source**
16. Substitute screen asks for the total sent and warns when it differs from the order.
17. Pallet / bulk form: warn when quantity or product is changed away from HELM's.
18. Labels with no packing slip: find the open HELM order by postcode, suggest it with one click, warn when the
    hand-picked product differs; otherwise it must be declared a replacement for a named order.
19. A PO or price-list price far from the product's cost stops and asks whether it is a case price.

**D. Checks that live in the portal**
20. Finance → Checks: every order compared with its listing's cost in force on the day (5p or 1% tolerance, to be
    agreed), every difference explained or listed; drastic cost changes; orders with no label, no listing, no fee,
    no cost; daily run, ClickUp alert, and an "unexplained" count on the P&L.
21. Order audit shows everything about an order: stock movements, labels, replacements, refunds, returns, fees,
    cashback, corrections.

**E. Listings**
22. Build the eBay and TikTok listings from the channels' reports and link them to products (fees, packaging copied
    from the Amazon listing of the same product, shipping, weight).
23. Listing fees follow the reports from now on, each change logged.

**F. Asked for separately**
24. Inventory: changes in tabs (stock in, moves, despatches, counts and corrections) with "View more".

## Progress on the fix list

**v2.90.0 (16 Nov 2026, early morning)**
- DONE 7 (first half) — an undone despatch is charged once (migration 115). The three double-charged orders are right
  after the rebuild: 204-0707382-5485143 = 3 units, 204-9504515-1341166 = 2, 205-9139654-2923535 = 2. So item 2 is done.
- DONE 8 — shipping counts only real labels (migration 114). The two £7.59 orders now have one parcel each.
- DONE 12 — other charges ex VAT (migration 116): eBay's charges and Amazon's subscription. Amazon's delivery labels
  (£65) and return postage (£121) are left as charged: ASK accounts whether they carry VAT.
- DONE 13 for open orders — fee estimates follow the fee category (migration 117). Still to do: the same for sales
  that HELM reports before the channel's report arrives (`sales_refresh_helm`).
- DONE 16 — substitute screen confirms anything that is not like for like. DONE 17 — pallet form warns when the
  quantity or product is not HELM's.
- DONE 23 (first pass) — 15 listing fees corrected from the Amazon report.
- **WAITING FOR THE OWNER — items 1, 3, 4:** the corrections for the glue, salt and TidyZ orders are written
  (`supabase/corrections/2026-11-16_order_corrections.sql`) but the database asks him to confirm them. Item 5 (product
  costs: FlexiSheets 12 Rolls £14.79, Harpic £1.04, Daler-Rowney's 10% pallet discount from 13 Oct) follows them.
- Owner's additions on 16 Nov: Harpic is a case of 12 (confirmed). Daler-Rowney's 10% is a pallet discount from
  13 Oct 2026. The pre-live prices are right (smaller quantities cost more then). Item 18 gains a third choice: a
  "manual order" with details, for samples and the like. Item 22: "EXTREMELY careful", with the correct packaging.

**v2.91.0 (16 Nov 2026, early morning) — built while the owner slept; nothing needed his approval**
- DONE 9 — a label the portal holds that HELM does not counts as a parcel, at our rate for its carrier and service
  (migration 119, `report_pl_ship`). 16 orders today. The 160-odd hand-made labels with no order number are NOT
  covered until they are paired with their orders (item 6).
- DONE 10 — one line of several units with no label is estimated from how that listing and quantity has really shipped
  (seen on at least two orders since 19 Oct). 285 of 568 older orders: 663 units, 403 parcels. **The other 283 orders
  (907 units) have no pattern and stay at one parcel a unit** — ASK: leave them, or use the nearest quantity seen?
- DONE C10 — orders with no listing are weighed by the stock that went out.
- DONE 13 — fee estimates use the fee category for HELM-reported sales too (migration 118).
- DONE 24 — Inventory: "Changes" in tabs with View more, on products, shelves and the History view.
- DONE 20, first version — Finance → Checks (migration 120): ten checks. First run: units 5 orders (all five are the
  corrections waiting for the owner); a different product sent 223 orders in 12 swaps; no label 124 orders (£1,797);
  parcels with no order number 161; no cost 1; charged far from portal cost 10 products (£685); costs doubled or
  halved 10; products with no cost 18; no listing 511 lines (£4,851); no fee 54 lines.
  NOT yet: every order pound for pound against its listing's cost on the day (needs a dated product cost record — the
  listing cost log misses changes made on the product), the daily run and ClickUp alert, the count on the P&L.
- **NEW scenario — the postage of a replacement parcel is not costed anywhere.** The Replacements line is product cost
  only. About 50 real replacement labels so far (roughly £150–£200 of postage). ASK: add it to the Replacements line?
- NEW (small) — 9 labels voided in HELM; 2 of them were moved by the carrier and are counted, 7 are not.

**v2.92.0 (16 Nov 2026, early morning) — built while the owner slept; nothing needed his approval**
- DONE 21 — Order Audit shows everything about an order: stock taken and put back, other parcels, corrections, and
  the money (sale, refunds, fees, cashback and other charges, product cost) for people who see costs.
- DONE 19 in the purchase order builder — a price far from the product's cost stops and asks "is it the price of a
  case?". Not yet covered: prices changed later on a sent order, price-list imports, and a guard in the database.
- CHECKED 14 — "last price paid" already follows the latest order by date; nothing to fix.
- PROPOSED 22 — eBay and TikTok listings: 83 items that have sold; 60 ready, 23 need a decision; nothing created.
  Seven decisions for the owner in docs/EBAY_TIKTOK_LISTINGS_PROPOSAL.md (variations on one eBay item, one listing for
  two TikTok codes, packaging for 21 items, weights, fees not seen yet, eBay's fixed fee per order, unsold listings).
- PLANNED 18 — labels with no packing slip: docs/NO_SLIP_LABELS_PLAN.md. Not built (it changes the Dispatch upload
  screen; to be tried on a real file with the owner).

**What is left:** 1, 3, 4, 5 (waiting for the owner) · 6 · 11 · 15 · 18 · the rest of 19 and 20 · 22 after his review.

**16 Nov 2026, 11:20 — the owner approved the record corrections; they are DONE**
- DONE 1, 3, 4 — glue order 16 → 4 (cost £110.08 → £27.52); salt order 58 → 30 (cost £107.30 → £55.50; pallet now a
  half pallet £55.55 + £10.00 fuel, two Evri parcels £5.40, delivery £71.65 in all); TidyZ orders → 12, 24 and 12.
  Stock: Multipurpose Glue 449 → 461; Peacock Salt 10kg 1,841 → 1,871; TidyZ Handy Bags 666 → 630. Costing rebuilt:
  sale units 23,166 → 23,170 (£54,373.50 → £54,262.90); replacements 389 → 379 units (£941.89 → £933.87). Each order
  has a "Record corrected" entry. The "units" check is clear for all five.
- DONE 5 for Harpic — case size 12 put on both lines of PO-HI-20261111-002; the products' cost went back to £1.0408 by
  itself (logged). Still to do in 5: Plenty FlexiSheets 12 Rolls → £14.79 (the owner is verifying the order) and
  Daler-Rowney's 10% pallet discount from 13 Oct.

**16 Nov 2026, midday (v2.93.0)**
- DONE 5 for Plenty FlexiSheets — the owner confirmed from the proforma: a case of six 2-roll packs. The "12 Rolls"
  product costs £14.79 again (PO line marked as priced per case). 29 older orders re-costed; cost of sales
  £54,262.90 → £54,620.33 (+£357.43).
- Cashback against orders: the P&L's "Losing money" now puts each order's Ship+ cashback against it (8,458 orders,
  £3,146.10 since 1 Aug). Only the cashback — not return postage, not labels bought through Amazon.
- OPEN 5 for Daler-Rowney — the owner said yes to 10% off from 13 Oct. Not changed yet: of the nine products ordered
  since then only Washable 5L and Multipurpose 5L carry the discount today, and one question decides how it is done
  (is the 10% taken off at the foot of the invoice, or are the line prices already net?).
- OPEN — how to book the FlexiSheets delivery: the order is 60 cases of "12 Rolls"; the warehouse keeps 2-roll packs.

**16 Nov 2026, afternoon (v2.94.0)**
- DONE 18 — labels with no packing slip: HELM's order at that postcode is offered for one click; a warning and a tick
  when the product or quantity chosen differs from HELM; otherwise the reason must be given (an order with its number,
  a replacement for a named order, a manual order saying who for and why). A label confirmed as an order is saved as
  that order's sale, not as a replacement — so new ones are no longer costed twice. Old labels are untouched (item 6).
- STILL OPEN from 18 — manual orders (samples) come out under Replacements until item 11 gives them their own line.

**v2.97.0 (17 Nov 2026)**
- "Orders that lost money" names the product on orders with no listing, from the stock that went out (migration 125;
  screen only). 534 of the 544 such orders since 1 Aug are named.
- Two Amazon SKUs with sales and no listing now have listings, copied from the Amazon listing of the same product:
  "5-Litre PVA Glue-Shipping" and "25kg Brown Salt" (14 sale lines). ASIN blank; not approved yet.
- ASK — "1x Plenty Flexi 2DAYS" (title says 1 roll, a 2-roll pack left the shelf; 4 orders in Oct) and
  "12.5kg clay Terracotta-2DAYS" (title says Stone, Terracotta left; 1 order on 1 Oct): which product does each send?
- ASK — the PVA "-Shipping" SKU sold at £11.95 (9 orders) and £15.95 (2): is postage charged on top of £11.95?
- ASK — the brown salt 25kg listing's packaging is "Double Wall Box - (10KG Box)": right for a 25kg bag?
- Item 22 (eBay and TikTok listings) still waits on the owner's seven decisions.

**v2.100.0 and v2.101.0 (17 Nov 2026) — Fulfilment cost**
- The P&L shows Fulfilment cost for every period: shipping + packaging + the overheads marked as fulfilment
  (warehouse rent, HELM, the warehouse's Starlink, the three warehouse and dispatch staff). It regroups costs already
  counted; no profit figure moves. Not "all overheads ÷ orders".
- Each overhead's fulfilment share is DATED: it applies from a date and earlier periods keep what they had.

## Decisions log
- 14 Nov 2026 — FIFO from 1 Aug; PO line price; no-PO rule; 17 Oct count wins; salt at portal cost.
- 15 Nov 2026 — Artmix at the Daler-Rowney price; ESPO return not a cost of sales; orders counted on despatch day only.
- 16 Nov 2026 — FlexiSheets 12 Rolls is a case of six 2-roll packs at £14.79; Daler-Rowney stock received from 13 Oct
  costs 10% under the invoice price; an order is a loss only after its cashback; labels with no slip to be built.
- 16 Nov 2026 — Costing must be audited order by order against the listing's cost in force at the time; every difference explained; checks to live in the portal permanently. Discovery first, in conversation; portal changes only after the decisions.
- 16 Nov 2026 (03:00) — Glue order 205-5139624-8858732: 4 sent, correct the portal. The three double-charged orders: portal fault, fix and prevent. Salt order 206-4547069-2001937: 28 on the pallet, not 58. TidyZ pack of 12: 12 were sent. Corrections to be made together, with before-and-after figures shown to the owner, once discovery is finished. Pallet forms must suggest from HELM and warn on a mismatch.
- 16 Nov 2026 (03:30) — Salt order: 2 by Evri + 28 by pallet. Amazon Buy Shipping labels are costed at our Evri rates. Multi-unit orders before 19 Oct: shipping estimated from how the listing actually ships since HELM. TidyZ 202-6365177-2825960: 4 sent, then 8.
- 16 Nov 2026 (04:00) — eBay/TikTok listings to be built; other charges ex VAT; listing fees follow the report (15 corrected and logged); TidyZ 202-6365177-2825960 = 12 units plus the second parcel's postage; order audit to show everything; Inventory changes in tabs with "View more"; carrier rates unchanged since 1 Aug.
- 16 Nov 2026 (04:30) — Ship+ cashback is ex VAT as received. Carrier rates include regular surcharges; invoice extras to be accommodated. Plenty Max Performance does not hold the build.
- 16 Nov 2026 (05:00) — Fix list agreed in full; tolerance 5p or 1%; build in stages, deploy the latest zip once. Harpic = case of 12. Daler-Rowney pallet discount from 13 Oct. Pre-live prices stand.
- 17 Nov 2026 — Fulfilment cost = shipping + packaging + the overheads marked as fulfilment. **Wherever a cost is involved, a change is dated**: it applies from a date and earlier periods keep what they had.

- **18 Nov 2026 — eBay and TikTok listings created (v2.102.0).** 72 listings (50 eBay, 22 TikTok) from the owner's
  answers and the listings sheet: one listing per channel for the same products, holding every code it is sold under.
  Packaging: the owner's choice (26) or the Amazon listing that sends the same products (46). Several Plenty packs
  sent together are taped, no box, no packaging cost (the owner). Brown salt 10kg goes in the Medium Box (the owner).
  Carrier and service: each listing's own labels (the owner: "ok"). No channel fee set yet. 531 of 533 eBay and TikTok
  sale lines now have a listing. Held: 2 x Peacock White Salt 10kg on eBay (packaging); the kids' costumes (which one).
- **18 Nov 2026 — TikTok: price before discount.** The owner runs no promotions of his own on TikTok, so a discount
  on a TikTok order is TikTok's cost and is paid back in the settlement (confirmed in TikTok's own Income report:
  "Platform discounts" does not reduce "Gross sales"). Orders still on HELM's figures are counted at the price before
  discount; the Income report replaces them. 50 orders, +£113.26.
- **18 Nov 2026 — weights from the owner.** Plenty FlexiSheets 2 Rolls 0.45 kg (was 0.10), Plenty Ultrasorb 4 Rolls
  Family Pack 0.904 kg (was 0.50), Cotton Tree Pleat 80g and Pads 80 Pack 0.08 kg each, Pyrex Bowl 0.7L 0.8 kg,
  Goodyear Ice Scraper 0.1 kg, Canbrush Red 400ml 0.25 kg, Sharp Sand & Cement 10kg 10 kg, Scola Pearl Paint 6 x 300ml 1.9 kg.
- **18 Nov 2026 (00:40) — eBay 2 × Peacock White Salt 10kg:** one parcel, Double Wall Box - (10KG Box) (the owner).
  Listing created; DHL, 20 kg. Only the kids' costumes are left without a listing (1 line).
- **18 Nov 2026 (00:40) — TikTok Income report, statements 30 Oct to 17 Nov, loaded by Claude with the portal's own
  importer** (26 lines, 8 new; 22 TikTok orders now on TikTok's figures, 46 still on HELM's). What it shows:
  - TikTok pays about 33 days after the order (27 Sep → 31 Oct; 16 Oct → 17 Nov).
  - **TikTok's fee:** 9% of the sale plus the delivery the customer paid, plus 50p an order ("Shipping service fee").
    Affiliate commission on 2 of 20 orders. No VAT shown on the fees. Overall 13.5% of sale + delivery.
  - **Discounts:** "Seller discount" £0. "Platform discounts" £22.48 on 5 orders and a TikTok delivery discount of
    £3.95 (paid back as "Shipping fee subsidy"): TikTok's cost. On the three orders that were on HELM's figures with
    a discount, the price-before-discount estimate equals the report to the penny.
  - **ASK — "Seller shipping fee discount" £13.88 on the 3 orders of £22.45, £29.90 and £35.90.** The seller funds
    free delivery on orders of about £20 and over (HELM agrees: every order of £22.95 or more has a discount of at
    least its delivery; none of £19.95 or less has it for that reason). The estimate rule of migration 129 adds that
    delivery back as if TikTok paid it: 3 orders still on HELM's figures, £18.89 too much. To correct once the owner
    confirms the offer and its threshold.
  - **ASK — HELM-estimated TikTok orders carry no fee** (46 orders, £704.95). Proposed: 9% of sale + delivery paid,
    plus 50p an order, until the report replaces them. Same gap on eBay: 32 HELM-estimated orders, £657.63, no fee.
  - Three TikTok product IDs seen for the first time were added to their listings as other codes (same products by
    their verified code links): 1729937383740578505, 1729947089249475273, 1729950635554806473.
- **18 Nov 2026 — website orders (the owner: "Yeah"):** packaging for a basket = the dearest of its products'
  "packaging when sent on its own", per real parcel; a monthly check of boxes costed against boxes used. To build with
  the website channels.
- **18 Nov 2026 (overnight, v2.103.0) — channel fees are dated rules (the owner: "Yes if that's the best way").**
  eBay: each listing's own percentage from eBay's reports plus 40p an order (30p up to £10), before VAT; 12.55% where a
  listing has none. TikTok: 9% of sale + delivery paid, plus 50p an order. Plenty&More: 1.7% + 25p. Orders not yet in
  a channel's report carry the fee in force on their day (D — "TikTok lines carry no fee": SETTLED; the same gap on
  eBay is closed). eBay Promoted Listings is shown as Advertising on the P&L; totals unchanged. A6, C9 and C10 are
  SETTLED by the listings of v2.102.0.
- **ASK — four orders at HELM status 12 counted as "not yet sent" since 6–16 Nov** (two Salt 4 U, one TikTok, one eBay
  bulk tote bag order of £197.94 with no product link): what is status 12, and should they count?
- **18 Nov 2026 (overnight, v2.105.0) — website baskets BUILT in the app; database step waiting for the owner.**
  Each product has a dated "packaging when sent on its own" (Packaging → Products), started from the Amazon listing
  that sends exactly one of it (111 of 322 products). A Plenty&More or Salt 4 U order with no listing: packaging = the
  dearest of its products' packaging on the day × real parcels (one with no label yet). Nothing set = £0 and marked,
  never guessed. Other channels unchanged. Migration 136 is NOT applied (the approval prompt cancelled itself overnight).
- **ASK — boxes costed against boxes used each month:** only 2 of the 26 packaging items are in stock control, so box
  usage is not recorded anywhere. Should packaging items be booked in and counted like products, or is a monthly
  purchase total (boxes bought) enough to compare against?
- **18 Nov 2026 (overnight, v2.105.0) — Calculator: delivery the customer pays.** On eBay, TikTok and the websites a
  listing can carry the delivery charged on top of the price. It counts as revenue (VAT off it) and the channel's fee
  is on price + delivery. Empty means free delivery; Amazon never has it. The P&L is not affected: real orders carry
  the delivery actually paid.
- **19 Nov 2026 (v2.106.0) — carrier surcharges (the owner: Evri charges a peak surcharge of 15p a parcel from
  15 Nov).** Cost Settings → Carriers → Surcharges: £ a parcel before VAT, from a date to a date, all changeable. The
  P&L adds it to every parcel that carrier carried on those days — real labels (Amazon Buy Shipping labels are our
  Evri account, so they carry it) and estimates. Shown as "Carrier surcharges" under Shipping. SETTLED as a rule; the
  15p itself is for the owner to enter (start 15 Nov, end date when known).
  **ASK:** is the 15p before VAT? Should the Calculator and listing pages include a surcharge while it runs (today
  they show the normal rate, so a listing's profit reads 15p high during peak)?
- **19 Nov 2026 (v2.106.0) — replacement requests.** A replacement asked for on a case is approved by an admin, and
  its label goes to Dispatch as a replacement for the order (stock off, cost on the Replacements line, as before).
  Nothing in the costing changed. Still open from v2.91.0: the POSTAGE of a replacement parcel is not costed anywhere.
- **19 Nov 2026, 11:50 — migration 136 applied (website baskets are live in the database).** 111 products have a
  "packaging when sent on its own" (8 of them their own packaging); 185 have none set yet and show as "Not set" on
  Packaging → Products. The one Plenty&More order (Pyrex jug 1L + brown salt 25kg) will be costed with the dearer of
  Medium Glass Item and Double Wall Box (10KG Box), once.
- **19 Nov 2026 (v2.107.0) — the owner's answers on surcharges. SETTLED:** Evri's 15p is before VAT. The Calculator and
  every listing figure include a surcharge while it is being charged (so a listing's profit is 15p a parcel lower
  during peak, and returns to normal the day it ends). The P&L goes by each order's own day, as before.
