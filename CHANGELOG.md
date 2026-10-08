# Changelog

Version shown at the bottom of the sidebar, with the time it was built.
Minor versions (2.x) add features; patch versions (2.2.x) fix or refine.

## v2.12.1 — 7 Oct 2026
- Fixed a blank page on load introduced in 2.12.0: the ⌘K search index read the cost settings
  during the first render, before they had loaded, which threw and stopped the whole app drawing.
  Nothing else was wrong with the data or the deploy

## v2.12.0 — 7 Oct 2026
- New Packaging section (Optimise): every packaging type with how many listings use it, how many
  are live, what it costs each and roughly what it costs a month at current volumes
- Click a type to see the listings using it, each with the products behind it and its margin
- Select some or all and move them to another packaging type in one go. Before committing, it
  shows how many listings end up better or worse off, the monthly effect at current volumes, and
  warns if any would stop making a profit or are live
- Listings with no packaging set are grouped and flagged
- Packaging types are searchable with ⌘K

## v2.11.0 — 2 Oct 2026
- Products now has a second export, "Listings CSV": every listing with the products it's built
  from — one row per product per listing, with the quantity of that product, its unit and line
  cost, and the listing's ASIN, status, sell price, total cost, shipping, profit, margin and
  monthly volume. Bundles appear once per component, so the file pivots by listing or by product
- Listings not built from products appear once, marked as such

## v2.10.1 — 2 Oct 2026
- Fixed: Pricecheck proformas lost any line where the description ran up against the barcode —
  5 of 13 lines on one order, leaving the total £1,004.81 short. Their lines are now read from the
  figures rather than the column spacing, so all 13 come through and add up to the document
- An order that disagrees with the document it was read from now says so in red next to the
  totals, and can't be sent for payment until it's resolved

## v2.10.0 — 2 Oct 2026
- Purchase orders can now be built from the supplier's own document. "New from invoice" reads a
  PDF — supplier, invoice number, dates, goods, delivery, VAT, total and the line items — matches
  lines to your products by code or barcode, and opens the order filled in for checking
- Uploading a proforma or invoice onto an existing order does the same: it shows what it read and
  waits for "Use these details" rather than changing anything on its own
- Readers for Pound Wholesale, Kite, JD Catering, Daler-Rowney, Pricecheck, Regal, EFG, KD, the
  IPO and Currys, plus a general reader for anyone else. All ten tested against real invoices
- It checks its own work: if net + VAT doesn't equal the total, or the lines don't add up to the
  goods figure, it says so instead of quietly using the numbers. Nothing it can't read is invented
- Photos and scans can't be read — those still have to be typed in

## v2.9.6 — 1 Oct 2026
- The portal now keeps itself current. Everything loaded once at sign-in, so anyone who left the
  tab open never saw work other people did — listings sent for review simply didn't appear.
  Shared data (listings, live products, approvals, purchase orders, hunts, people) is re-read when
  you come back to the tab and every couple of minutes while it's open
- The sidebar shows how current the data is, and clicking it refreshes immediately

## v2.9.5 — 29 Sep 2026
- The dashboard is now admins only: it summarises the whole business, so it's hidden from the
  menu, from search and from direct links for everyone else
- Everyone else lands on the first section they've been given — accounts staff go straight to
  Pending Payments, a product hunter to the Calculator. Anyone with no sections yet is told so
  rather than bounced between pages

## v2.9.4 — 29 Sep 2026
- Fixed: confirming a match in the product hunter didn't stick when the supplier's product has no
  barcode (MX Wholesale and JD lines, for example). The confirmation was saved, but was only ever
  looked up by barcode, so the listing kept reappearing under "Needs confirming". Confirmed
  matches are now found by supplier code as well, and record which supplier they were for
- "Check weight" is no longer shown on bundles that take their weight from their products
- Cleared the out-of-date per-item cost and weight copies stored on 45 listings (the figures the
  portal already ignored); what was removed is kept on the listing in case it's ever needed

## v2.9.3 — 29 Sep 2026
- Fixed: a bundle's breakdown showed the per-item cost and weight saved with the listing when it
  was created, not the product's current figures — so a 12-pack still read "12 × £0.94" after the
  product moved to £0.85, even though the total (£10.20) was right. Both now come from the
  calculation itself

## v2.9.2 — 28 Sep 2026
- ⌘K search now finds purchase orders and credit notes (by PO number, invoice number, payment
  reference, payee or what was on them), suppliers, carriers, companies, hunts and brands —
  and products by barcode, listings by ASIN
- The search index lives in one file (src/lib/search.js) with a register of how every section is
  searched. A test fails if a new module is added without deciding how it's found, so nothing
  can be built and left invisible to search again
- Results put pages first, then the closest matches

## v2.9.1 — 28 Sep 2026
- Attach invoices in bulk: drop the whole pile in and each is matched to its order by file name,
  then by the invoice number in the name. Anything unrecognised is left for you to place by hand
- The "Missing an invoice" figure opens straight into it

## v2.9.0 — 28 Sep 2026
- Credit notes in Purchasing: money coming back from a supplier — a refund, a credit for damage,
  a return. Raise one against an order ("Credit note" on the order) or on its own, numbered
  CN-HI-YYYYMMDD-001. They carry negative amounts, skip delivery and payment steps, show on the
  order they relate to and on the supplier, and reduce reported spend automatically
- Imported July–September purchase history: 32 orders and 3 credit notes, £41,651.14 net of credits

## v2.8.4 — 28 Sep 2026
- The status shown on an order is now worked out from its lines, so an order whose stock has
  all arrived can never show as "awaiting delivery" — whatever is stored against it
- Corrected the one existing order left in that state by the earlier bug

## v2.8.3 — 28 Sep 2026
- Split the one company list into three: Suppliers (stock and packaging), Carriers, and
  Companies (marketing, professional services, anything else). Each has the same profile —
  purchase orders, spend, what's owed — shaped for what they are
- A carrier's profile shows the rates you have for them in Cost Settings and how many listings
  ship on them, instead of price lists and margins
- "Add a supplier / carrier / company" on each list, with the tag that decides where they appear
  and which orders can be raised against them
- Links to a company open the right list

## v2.8.2 — 28 Sep 2026
- Companies you pay are now tagged by what they're for — stock supplier, carrier, packaging,
  marketing, professional services — and each order only offers the right ones. Add a company
  without leaving the order; adding an existing name just tags them for that kind too
- Evri, DPD and DHL added as carriers
- Each kind of spending now behaves as it really works: stock is quoted then paid then
  delivered; carriers and agencies invoice you in arrears (invoice-first, on account by default,
  no delivery steps); packaging is delivered and checked in like stock
- Repeating bills: mark an order monthly, quarterly or yearly and raise the next one with
  "Raise the next one" — any order can also be re-ordered with the same lines
- Suppliers page filters by kind, and a carrier's page shows account reference and terms
  rather than price lists, catalogue size and margins

## v2.8.1 — 28 Sep 2026
- Purchase orders now say what they're for: stock, carrier, packaging, marketing, professional
  services or other. Non-stock orders take typed lines and skip the delivery steps entirely
- Fixed: an order with everything received said "awaiting delivery". New status "Delivered —
  to close off"
- The order list is a table, so a 60-line order reads as easily as a 3-line one, with delivery
  progress, payment state, invoice number and a running total
- Paperwork reworded to "Final invoice", with "the document above is the final invoice" for
  when the proforma is the invoice
- Invoice number and total now need saving rather than saving as you type, and warn if the same
  invoice number is already on another order from that supplier
- Invoice numbers and payment references are searchable, and shown on the order row
- Spend breakdown by category and supplier for the month, quarter or year; CSV export of
  everything shown; views for orders missing an invoice and money due in the next 30 days
- Each order has a full audit trail on its History tab
- Order stock buttons made obvious on products, saved listings and live products
- Pending Payments has its own money icon

## v2.8.0 — 28 Sep 2026
- New Purchasing section: Purchase Orders, Pending Payments and Delivery Problems
- Raise a PO (PO-HI-YYYYMMDD-001, numbered in the database): choose a supplier, add products —
  creating any the portal doesn't have yet — check prices against what's on file, add VAT and
  delivery so the total matches the proforma, attach the proforma or an online basket link,
  then send for payment
- Payment terms: pay-before-release, or on account with a due date. Pending Payments lists
  what's owed, overdue first, with the proforma or basket to hand and a paid record
  (method, date, reference, who)
- Deliveries checked against the order, including part deliveries; problems (missing, damaged,
  wrong, short dated) are reported per line with their value, then chased through
  reported → chasing → replacement or credit
- Prices actually paid raise cost changes in Approvals when they differ from the portal
- "Order stock" from any product or saved listing, and a Purchase Orders tab on every supplier
  with spend and what's owed
- Accounts role: Pending Payments only. Proformas and invoices are stored privately and opened
  through short-lived links; supplier logins are named, never stored as passwords

## v2.7.0 — 28 Sep 2026
- Team & Access (admin only): everyone who can sign in, with a checklist of the sections
  each person can open. Roles (Admin, Manager, Product hunter, Custom) tick the checklist,
  and every box can then be changed by hand
- Create accounts from the portal with a starting password — no emails are ever sent.
  Set a new password, turn access off and on again from the same place
- The checklist is built from the portal's own navigation, so a new module appears
  automatically — and is locked for everyone until an admin ticks it
- Locked sections are hidden from the sidebar and the quick search; following a link to one
  shows a clear "you don't have access" page naming who to ask
- Database locked down: every table was open to the public key in the browser and is now
  restricted to signed-in, active accounts. Cost settings can only be changed by admins,
  and only admins can grant access. Deactivated accounts see nothing at all
- Roles are no longer self-selected in Cost Settings; the tab is now "Your profile"
- Account changes are recorded in the activity log under People
- An admin can't remove their own access, and the last admin can't be demoted or turned off

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
