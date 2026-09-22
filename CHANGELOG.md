# Changelog

Version shown at the bottom of the sidebar, with the time it was built.
Minor versions (2.x) add features; patch versions (2.2.x) fix or refine.

## v2.6.0 — 22 Sep 2026
- Renamed: "Stock Items" are now "Products" everywhere; "Settings" is "Cost Settings"
- Buttons show what has already happened: "Sent for review", "Approved", "Live", "Saved",
  "Sending…" — on saved listings, the calculator and the product hunter. The saved-listing
  panel now always shows the listing's current state
- Approvals: a Review panel beside the queue with the full calculation, where it came from,
  and editable price, volume, fee (with verification), service, carrier and packaging.
  "Save changes & approve" does both in one step and records the edits; Previous / Next
  move through the queue
- Auto-fill: choosing products fills supplier, supplier code, barcode, brand and a suggested
  name; opening a listing fills anything its products already know; hunted listings arrive
  with their supplier details
- "Create listing" from any product, from gaps in a product family, and from Model pack
  sizes — the calculator opens already filled in
- Everything links to everything: products, suppliers, brands and listings are clickable chips
  wherever they appear, and every listing has the same Amazon button
- Product families rebuilt: summary figures, views (worth reviewing, losing money, wide spread),
  family cards with margin-coloured pack chips, ladder with observations, and Model pack
  sizes as a panel with fee category, profit chart and best size
- Activity log records which hunt a listing came from (ASIN, match, supplier and code), and
  hunt decisions (skips, saved for later) against the hunt
- Confirmations offer "View" to jump to what was just created or approved

## v2.5.0 — 22 Sep 2026
Includes v2.4.0 (online supplier sync), which was held for this release.

Trust and correctness
- Break-even solved properly: it no longer moves with the price being modelled, and uses
  VAT correctly (the old formula overstated it by several percent)
- A missing stock item, missing cost, unset carrier rate or deleted packaging makes a listing
  "incomplete" — never a silent £0. Incomplete listings are flagged and left out of averages
- Stock items used by any listing are archived, never deleted (with undo)
- Shipping savings are proposed for approval instead of switched directly
- Settings are edited as a draft with Save / Discard
- Saves are refused if someone else changed the same listing, stock item or settings first
- Login loads 39 supplier rows instead of ~48,000; each hunt loads only what it can match;
  pages are built only when opened
- Versioned database migrations (supabase/migrations) and a rebuilt supabase_setup.sql
- CSV exports can't run formulas in Excel; 24 automated tests; `npm run check`

Structure and design
- Sidebar reorganised: Overview, Listings, Sourcing, Optimise, Planning, Tools
- Approvals: new listings and proposed changes in one place
- Suppliers: one page per supplier — terms, price freshness, exposure, waiting changes,
  price list or sync history; Price Lists folded in
- Shared Tabs and SegmentedControl; one font (Figtree); 12px minimum text; icons instead of
  text symbols; labelled fields; dialogs close on Escape and hold focus; keyboard-reachable rows

Decisions
- Dashboard split into "needs you" and "opportunities", with supplier data freshness
- Proposed changes show their £ monthly effect where listings have a volume
- Product families: price-per-unit ladder, pricing observations, losing rungs, ladder gaps
- Saved listings: readiness checks and a full history
- Live products: one-click views and monthly profit
- Build a Month: base, conservative and target scenarios plus a stress test
- Activity log of every significant change, in Settings and on each listing
- Undo on approved changes and archived stock items

## v2.4.0 — 21 Sep 2026
- Overnight catalogue sync for MX Wholesale and JD Catering, run on Supabase every 3 minutes
  between midnight and 6am until each supplier is done; progress saved after every page
- Case prices divided to a per-item cost and VAT removed where the site includes it (set per supplier)
- JD's store only allows the first ~25,000 products to be read in bulk; products you stock
  from them are looked up individually by code, so they are always covered
- Synced prices that differ from your stock item costs raise Proposed Changes automatically
- Price Lists > Online suppliers: last run, products on file, your products checked, errors,
  VAT setting and Sync now
- Pound Wholesale excluded: its site uses bot protection, so it stays manual
- Sync job secured by a private key (scheduler) or a signed-in portal user

## v2.3.1 — 21 Sep 2026
- Name matching rebuilt: every meaningful word in the supplier's product name must appear in
  the listing, so product lines and scents can't be confused (Platinum vs Original, Apple vs Original)
- Model numbers must agree (Blue II vs Blue 3, Mach3 vs Fusion5)
- A more specific supplier line always beats a less specific one (Platinum Plus vs Platinum)
- Quantities worked out from counts: "Pack of 8" Mach3 blades is 2 x the 4-pack, 84 capsules is 3 x 28
- Model names no longer read as counts ("Mach 3 Blades" is not 3 blades)
- Leading pack sizes recognised ("3X ...", "3 X 7pc"); marketing like "2X longer lasting" ignored
- Different pack sizes rejected rather than guessed (42 tablets can't come from boxes of 77)
- Refills no longer match the razor they fit; mixed bundles flagged
- Washing powder counted by washes and scoops

## v2.3.0 — 21 Sep 2026
- Hunts: every Helium import becomes a named hunt with its own progress, shown as tiles;
  several can be imported at once and worked through separately
- Progress saved as you go — tab, filters and last item — with "Pick up here" on return
- Every listing has a status: to decide, sent to review, saved for later, or skipped with a reason
- Sent listings show where they've got to (in review, approved, sent back with the note, live)
- Previous/Next in the detail panel, moving on automatically after each decision
- Bulk skip: everything Amazon sells, everything that loses money, or everything shown
- Skips from earlier hunts shown (not repeated automatically)
- Checks before sending: stale Helium data, stale price lists, weight disagreements, existing listings
- Sending to review requires a verified Amazon fee
- Review Queue shows the hunt, market data and fee verification status
- Dashboard shows hunts in progress

## v2.2.3 — 21 Sep 2026
- Fee verification: where several categories charge the same fee, the one that best fits the
  product is chosen (washing-up liquid no longer lands in Furniture Accessories), with the
  equivalent categories shown so you can switch to the one Amazon names

## v2.2.2 — 21 Sep 2026
- Fee verification: one button copies the ASIN and opens Amazon's Revenue Calculator; type
  the referral fee it shows and the portal works out the fee category and marks it verified
- In both the calculator and the product hunter panel
- Listings sent to review carry the verified status

## v2.2.1 — 21 Sep 2026
- Product hunter: every result opens a full breakdown — product cost, supplier, Amazon fee
  and its source, carrier and weight band, packaging and why it was chosen, market data
- Adjust supplier, units, price, fee category, weight, service, carrier and packaging in the
  panel, with profit recalculating live; "Send to review" uses the adjusted figures
- Carrier, packaging and fee shown on each result at a glance
- Version and build time shown in the sidebar

## v2.2.0 — 21 Sep 2026
- Product hunter: import Helium 10 exports, match to supplier price lists by barcode or name,
  cost with real carriers, packaging and conservative fees, confirm or reject matches
  (remembered), send to the Review Queue
- Name matching checks brand, size, product type and count; quantity worked out from piece
  counts; barcode conflicts flagged

## v2.1.1 — 21 Sep 2026
- Price list import: repeated product codes kept as volume price breaks instead of failing

## v2.1.0 — 21 Sep 2026
- Amazon fee categories with price tiers, minimum fee and 2% digital services fee
- Suppliers and terms; price list import for Pricecheck, Sian and Daler-Rowney
- Proposed Changes: every change to existing products needs approval
- Barcodes on stock items; cost change, cheaper supplier and discontinuation alerts

## v2.0.0 — 20 Sep 2026
- UI overhaul, product families, pack size modelling, target pricing, shipping review
