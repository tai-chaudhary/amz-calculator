# Changelog

Version shown at the bottom of the sidebar, with the time it was built.
Minor versions (2.x) add features; patch versions (2.2.x) fix or refine.

## v2.33.0 — 18 Oct 2026
- New Orders: a new "All open" list shows every order HELM hasn't shipped in one place: new,
  processing, picking, picked, packing, sorted, labelled but not uploaded, back orders and holds.
  It's grouped by courier like the other lists, each line says how many orders are at each stage,
  and each order shows its HELM status. Search works on the status too (e.g. "back order")
- Back orders and holds were only shown to admins. The whole warehouse team now sees them, under
  "Back orders & holds". Clearing orders is still for the office only
- Database: supabase/migrations/036_helm_all_open_orders.sql (applied 18 Oct)

## v2.32.2 — 18 Oct 2026
- Dispatch: the products in each batch are listed with the most labels first. The print order is unchanged

## v2.32.1 — 18 Oct 2026
- Dispatch: each batch shows what's in it again (every product and its number of labels) as soon as
  the page opens, as it did before the redesign. Since v2.31.0 a batch with more than 12 products
  started folded away, and the only way to open it was tapping the batch code. A clear
  "What's in this batch · Show / Hide" bar now sits under each batch

## v2.32.0 — 18 Oct 2026
- New: Warehouse → Delivery tracking. Every parcel HELM booked in the last 30 days, as the courier
  sees it, refreshed from HELM every half hour (read only, nothing is written to HELM)
- Parcels go Next Day, so one not delivered within 2 working days of its label being booked (Sunday
  off) is late. Late parcels, courier problems (failed attempt, on hold, address problem, returned)
  and labels the courier never scanned are listed under "Needs attention", oldest first, and the
  menu shows how many there are
- Couriers: on-time rate, late, delivered late, problems, returns and the usual time to delivery,
  side by side. The courier is taken from the service: labels bought through Amazon are Evri Next
  Day. Evri account labels (Hermes 24/48) don't report tracking to HELM and show as "Not tracked"
- Products: which products keep being returned, failing delivery or arriving late, to see what may
  need better packing. Tap one to see its parcels
- Each parcel opens to its courier history, what was in it and a link to the courier's tracking page
- No customer details are stored: no names, addresses, phones or emails, and courier messages and
  tracking links have anything like a name or postcode taken out
- New permission "Delivery tracking" (on for the Warehouse role); like the other warehouse sections
  it doesn't let anyone see costs
- Database: supabase/migrations/035_delivery_tracking.sql (applied 18 Oct); new edge function
  supabase/functions/helm-tracking, on a schedule at :07 and :37

## v2.31.5 — 18 Oct 2026
- Tracking numbers come from HELM. helm-sync reads each labelled order's shipment with it
  (shipment.parcels.tracking, per HELM's API docs) at no extra cost, and every minute checks the
  labels against it. Same as read off the label: verified. Different (one label, one number): HELM's
  is used, and what was read is kept. None read: HELM's fills it in. Several parcels on one order are
  left as they are
- Every label from the last fortnight now has a tracking number. Evri: 556 filled in from HELM, 16
  verified, 9 read off the label only. DHL: 109 verified, 2 filled in, 2 read off the label only
- Most Evri numbers are T00FFA… (16 characters). The H-08AN-A-… code on the label is often a routing
  code, not the tracking number, which is why reading it off the label was never enough
- "✓ HELM" beside a tracking number (batch labels, Find & reprint) means HELM confirmed or supplied it
- Database: supabase/migrations/034_helm_tracking.sql (applied 18 Oct); helm-sync redeployed

## v2.31.3 — 18 Oct 2026
- New Orders: lines with the most orders come first
- Find & reprint: "View label" shows the label exactly as it prints, the HELM label with the product
  stamped on it, with "Reprint this" underneath. The reprint window shows the same picture
- Evri tracking numbers: since 15 Oct HELM's Evri labels have been pictures, and the tracking
  number (H-08AN-A-000000837-1) read from them was usually slightly off (spaces, long dashes,
  O for 0, I for 1), so it wasn't saved: 27 of 583 Evri labels had one, against 113 of 115 for DHL.
  It's now read enlarged and the usual misreads are put right. Labels already uploaded keep what
  they had

## v2.31.2 — 18 Oct 2026
- Fix: the "…" button on each batch opened an empty white box (the menu was cut off by the card's
  edge). Its options are now buttons on the card: Substitute, and Print again once it's all printed
- New Orders: full-screen button (top right, laptops and up). Opens it over the page with Evri and DHL
  side by side, each scrolling on its own. Esc or the same button puts it back where it was

## v2.31.1 — 18 Oct 2026
- New Orders rebuilt to be easier to read. One list at a time, chosen from tabs: Today, each later
  day (Mon 19 Oct…), Past ship-by, Labelled and Needs attention (office). Each line shows the quantity
  per parcel as a badge, then the product in normal case, then how many orders; tap it for the order
  refs. Couriers have their own headings that stay at the top while scrolling. A search box appears
  on longer lists. Flags (past ship-by, short, not linked in HELM, oldest) sit under the totals
- On a laptop the card fits the screen and its list scrolls on its own: scrolling through Monday's
  orders no longer scrolls the whole page

## v2.31.0 — 18 Oct 2026
- Dispatch redesigned. The day at the top (‹ day ›, time to the cut-off, delayed and on-hold
  flags), then one bar for every label from To print → Picking & packing → Ready → Dispatched; tap a
  stage to see it. Each batch is a card with whose batch it is (whoever printed it, otherwise who it
  was uploaded for), its own progress bar and one button for the next step (Print → Ready for
  dispatch → Mark dispatched). Pick list and Substitute sit beside it; the rest is under "…".
  New Orders sits beside the batches on a wide screen and above them on a phone
- Pick list (phones first): for one batch or everything still to go today. Each line shows the shelf to
  go to, how many, and from where after that (pick shelf first, then overflow), in aisle order.
  Tap a line when it's in the tote; ticks stay on that phone. Shows anything short, any substitutes
  already recorded, and item codes not linked in HELM
- Substitutes: "Sent something else" from the pick list, the batch, at Ready for dispatch, at
  dispatch, or after it's gone. Pick what went (closest matches first), how many for each one
  ordered, which orders and who. The substitute's stock comes off instead of the ordered product's
  (put right straight away if it's already gone). Ready for dispatch and Mark dispatched now ask
  about anything short on the shelves: "Sent as ordered" or "Something else". The Dispatch dashboard
  counts substitutes and lists what was swapped for what, and by whom
- New Orders: "Past ship-by" is its own section. The office can clear them all at once (orders already
  shipped another way, e.g. Amazon labels from the old portal), clear one at a time, or clear labelled
  orders over a day old. Unlinked item codes say "not linked in HELM — fix the link in HELM"
- Shelf counts are planned Monday to Saturday only
- Database: migrations 032 (indexes; counts Mon–Sat) and 033 (dispatch_substitutes, pick list,
  substitutes at despatch), applied 18 Oct

## v2.30.2 — 17 Oct 2026
- Tasks: "Selling, but no pick shelf" lists products that are selling or on open orders but have all
  their stock in overflow. Top-up tasks need a pick shelf to fill, so these were never raised (White
  De-Icing Rock Salt: 1,150 in A-10-0-1, ~22 a day). Tap one to give it a pick shelf. Counted in the
  Tasks number in the menu
- New Orders: "N not in inventory" badge when HELM sends item codes Inventory doesn't know. There's
  no stock check and nothing held for those, and it used to show only as grey text on the line
- New Orders: clearing an order or changing the cut-off is logged under the person's name, not their email
- Inventory on phones: the search box stays at the top while scrolling, and the list shows 40 at a time
  with "Show more" (all 221 products made a very long page)
- Dispatch on phones: smaller summary boxes, so New Orders is higher up the screen. "0 batchs" now reads "0 batches"
- The phone top bar is a fixed height
- Database (applied 17 Oct): supabase/migrations/031_lock_internal_functions.sql stops signed-out
  visitors calling stock functions directly (inv_take, inv_despatch_order, inv_undo_despatch,
  inv_ensure_location, inv_open_order_units and others) with the public key

## v2.30.1 — 17 Oct 2026
- Faster to open: each page now downloads the first time it's used (and quietly in the background
  after sign-in), instead of the whole portal up front. The first download is about a quarter of
  what it was (~190 KB instead of ~710 KB compressed), and libraries sit in their own files so a new
  release only re-downloads the portal's own code
- Spreadsheet reading (Inventory set up, supplier price lists) loads only when a file is chosen
- Product Hunter's market listings load when Product Hunter is opened, not for everyone at sign-in;
  large lists (market listings, hunt items) now fetch their pages side by side
- Sign-in no longer waits on the supplier catalogue lookup; ⌘K only builds its index while open
- Search (⌘K): arrow keys move through the results; on phones there's a close button and the list
  fits above the keyboard
- Phones: the menu fills the real screen height (Sign out no longer hides under the browser bar), closes
  with Escape, and the page behind it no longer scrolls. Pop-ups open as sheets from the bottom and
  stop the page behind from scrolling. Bigger tap targets for buttons, menu items, tabs and filters.
  Wide tables scroll inside their own box instead of dragging the whole page sideways. Messages
  run full width at the bottom of the screen
- Calculator on phones and tablets: profit and margin stay pinned at the bottom while you type; tap
  it to jump to the full result
- Cost Settings: carrier and packaging tables no longer squash their boxes on phones
- Font loads in parallel with the app rather than after it

## v2.30.0 — 17 Oct 2026
- HELM connected (read only): the portal reads HELM's orders every minute through HELM's Public API.
  The key is in the helm-sync function's secrets. Customer names, addresses, phones and emails are
  never kept — only what's in each order, its courier, channel, status and dates
- New Orders (top of Dispatch): every order in HELM without a label yet (New Order, Picking, Picked…),
  as it'll be stamped — "3 X SANMEX FLY & WASP KILLER 300ML · 12 orders" — Evri first, then DHL, same
  product together in pack-size order. Uses the parcel mapping's name where there is one. Total
  orders and units, oldest order (amber after a day, red after two), tap a line for its order refs
- Ship-by day: an order placed after the channel's cut-off (3pm Monday to Friday, 1pm Saturday; the
  office can change them at the bottom of New Orders) or on a Sunday ships the next working day (Monday to Saturday). It's
  left off today's list and shown under "For Monday 19 Oct…" instead — it still holds stock straight
  away. Anything past its ship-by day is flagged red. HELM's own despatch target is used if it sets one
- Stock check on every line, against everything waiting in HELM on top of uploaded labels: short
  (red, need vs in stock), top up the pick shelf (amber), or not in inventory
- Labelled – awaiting upload: orders HELM has marked Despatched (label made) that haven't been
  uploaded here yet. Shown to everyone; amber once one has waited over 30 minutes. Drops off when
  its label is uploaded (matched by order ref or HELM order number)
- Needs attention (office only): HELM back orders and holds. The office can clear an order that
  will never come through Dispatch
- Inventory: open orders now include HELM's new, labelled-not-uploaded and back orders, so available
  stock is right from the moment an order comes in. Each order counts once — when its label is
  uploaded it moves over, never twice. A product's open orders say which are still in HELM
- ⌘K finds HELM orders not yet through Dispatch, by order ref or HELM number
- HELM inventory is not read: the portal's stock stays the one to trust
- Database: supabase/migrations/029_helm_orders.sql and 030_helm_ship_day.sql (applied 17 Oct); function supabase/functions/helm-sync

## v2.29.2 — 17 Oct 2026
- Undoes most of 2.29.1's hiding: everyone in Inventory sees how long stock will last, sales rate,
  suggested order, Need ordering, Sells / day, Lasts, Days left and the Order now / Under 15 days
  badges, and Stock Requests' "Running low" — so anyone can spot it and ask for stock. Product
  Settings (and anything with a cost) stay office only
- "Raise stock request" on a product's page in Inventory: fills in the product, HELM code, suggested
  quantity, urgency and why. If it's already been asked for, the button shows the request instead

## v2.29.1 — 17 Oct 2026
- Phones no longer zoom in when you tap a search box or any other text box (and get stuck zoomed):
  every text box, dropdown and search is 16px on touch screens, across the whole portal
- Warehouse staff see what they need to work with stock, not how it's worked out. Office only now:
  product Settings, "How long it'll last" (sales rate, lead time, suggested order), Need ordering,
  Sells / day, Lasts, Days left, the Order now / Under 15 days badges, unmatched item codes, and the
  "Running low" suggestions in Stock Requests. The rule from here on: costs, settings and forecasts
  are for the office; the warehouse gets the doing

## v2.29.0 — 17 Oct 2026
- Damage reports (Inventory → Damages, and "Report damage" on a product or shelf): product, shelf,
  how many, what happened (picking, packing, found when opened, arrived damaged, storage, leaking or
  out of date, customer return, other) and a photo. The units come off the shelf straight away and wait
  for the office to write off, send back to the supplier or put back on a shelf. Breakdown by reason,
  product and person; the office also sees the cost
- Daily cycle counts: Tasks gets a set number of shelves to count each day (12 by default, set under
  Set up), chosen by longest since counted, fast sellers and anything that didn't add up. Counts are
  blind — the recorded number shows after saving. "Count this shelf" on any shelf too. Accuracy over
  the last 30 days shows on Tasks
- Value (office only): stock value at cost, value by aisle, products not sold in 60+ days, more than
  four months' stock, and products with no cost price (set here or linked to Products). 59 products
  linked to Products by name automatically
- Database: supabase/migrations/028_inventory_damage_counts_value.sql (applied 17 Oct)

## v2.28.1 — 17 Oct 2026
- Inventory: warehouse staff can move, add (with a reason) and count stock, but can't remove it —
  Remove is office only, in the screens and in the database. A count that comes out lower than
  recorded needs a note from the warehouse
- History: filter by person; every change shows who did it and when, and can't be edited or deleted
- Fix: the Inventory page showed no data once sales rates were due a refresh (the API refused the
  refresh); fixed in the database on 17 Oct

## v2.28.0 — 17 Oct 2026
- Inventory (Warehouse → Inventory, locked until granted; included in the Warehouse role). Stock by
  product and by shelf (Aisle-Bay-Shelf-Section, e.g. A-10-0-1; aisles A–H, 10 bays, D has 11,
  shelves 0–7, sections 1–4). Every shelf is a pick shelf or overflow, and either can be switched
- Stock: on the shelves, in open orders, available, sells a day, how long it lasts, with search by
  name, code or shelf and filters (need ordering, pick shelf low, not in HELM, needs a count, no pick
  shelf). Cards on phones, a table on wider screens. Shelves: aisle by aisle, what's on each
- Linked to Dispatch: uploading labels holds the stock as open orders straight away; when an
  order's last label is dispatched its units come off (pick shelf first, then overflow), HELM
  bundles split into their parts. A label taken back from dispatched puts them back. Despatched
  shows the units out per product per day (the Close of Day log)
- Move, add, remove or count by hand. Adding and removing need a reason (and a note for some) and
  a name; every change is kept in History and can't be edited, only corrected
- Products not in HELM yet are treated as normal stock and flagged "Add to HELM". Item codes on
  orders that aren't in inventory are listed under Set up to add
- Tasks (Warehouse → Tasks): when a pick shelf drops under 3 days of sales (or a minimum you set)
  and there's more in overflow, a task asks for it to be topped up. Done it records the move;
  tasks clear themselves if the shelf is topped up another way
- Stock Requests: "Running low, from stock and sales" — anything with under 15 days' stock plus the
  time it takes to arrive, not asked for yet; one tap fills in the request with a suggested qty.
  Sales rate is the busier of the last 7 and 28 days; a seasonal rate can be set per product
- Goods In: putting a delivery away now asks which product each line is and which shelf it went on
  (split across shelves if needed; new shelves are logged), and remembers it for next time
- Set up (office only): load the opening stock from the HELM "Stock by Location" sheet (packs counted
  as singles; orders dispatched after the count are taken off), later stock counts, Amazon sales
  history (no customer details kept; SKUs worked out from orders that went through Dispatch, the rest
  set once by hand)
- In ⌘K: stock by name and code, shelves, and open tasks
- Database: supabase/migrations/027_inventory.sql

## v2.27.0 — 17 Oct 2026
- ClickUp messages (Tools → ClickUp messages, admins only). Connect ClickUp once with an API token
  (stored encrypted in the database vault, never readable again), then switch each event on or
  off, pick its channel, and send a test. Recent messages show what went, where, and any errors
- Events: batch uploaded (who, batch, orders, labels, by stamp, anything on hold), day closed (orders
  dispatched and left over, by stamp), stock requested, request ordered, request not ordered,
  delivery date confirmed or changed, delivery booked in, problems at goods in, and arrived with
  no order. Starts with warehouse messages in "Warehouse Team" and office ones in
  "General - Adrian Marsh"
- Messages are sent by the database itself, so they go whichever phone or laptop did the action,
  and anything that fails is retried every 5 minutes. No prices are ever included
- New Supabase function: notify. Database: supabase/migrations/026_clickup_notifications.sql

## v2.26.0 — 17 Oct 2026
- Dispatch: new Orders tab next to Batches. The day's orders grouped by what's stamped on the label,
  with Orders, To print, Printed, Ready and Dispatched for each — every order counted once, at the
  stage all its parcels have reached — plus a progress bar and the day's totals at the top
- Tap a stamp to see its orders (customer, postcode, ref, batch, stage), or search for one order
- Built for phones: a card per stamp on small screens, a table on wider ones. Refreshes every 30
  seconds while it's open, so it keeps up as other people print, pack and dispatch

## v2.25.1 — 17 Oct 2026
- Dispatch dashboard: new "This week" filter (Monday to today), between Today and 7 days

## v2.25.0 — 17 Oct 2026
- Goods In (Warehouse → Goods In, locked until granted; included in the Warehouse role). Built for
  phones first
- Expected: every placed stock and packaging order with something still to come, grouped Overdue,
  Due today, Next 7 days, Later, On back order, and No delivery date yet. Only dates confirmed with
  the supplier are shown — never an estimate. No prices anywhere
- Booking in: "Everything arrived OK" fills every line with what's due in one tap; anything
  different is changed per line. Per line: damaged, wrong item sent, and "missing — report it",
  with a note and a photo. The delivery: photo of the delivery note, delivery note number, cartons,
  pallets, and "signed as unchecked" — plus who booked it in
- Booking in updates the PO's received quantities, marks a back-ordered line back with the order
  when it arrives, and adds a line to any stock request on it. Damaged, wrong and missing items go
  straight into Delivery Problems with their value, ready to raise with the supplier
- To put away: everything booked in that hasn't been put away yet, with one Put away button
- Arrived with no order: log who it's from, what came, cartons and a delivery note photo. The office
  matches it to an order (and books the quantities in on the PO) or notes what was done
- For the office (anyone with Purchase Orders): deliveries with problems and unmatched deliveries,
  with a count in the menu, marked Sorted with a note. POs show every delivery booked in against
  them, with the delivery note photo
- Deliveries are in ⌘K by GI number, supplier, PO and delivery note number
- Database: supabase/migrations/025_goods_in.sql

## v2.24.0 — 17 Oct 2026
- Stock Requests (Warehouse → Stock Requests, locked until granted). The warehouse asks for stock
  that's running low — from Products, or by name if it isn't in Products yet (with barcode, HELM SKU
  and a photo from the phone camera) — with how urgent it is, roughly how many, and who's asking.
  Asking for something that already has an open request opens that one instead
- Each request follows its order on its own: Waiting for the office → Seen → Being ordered → Ordered,
  awaiting a date → Arriving (only once a date is confirmed) → Arrived. Back orders, part
  deliveries, late deliveries and supplier cancellations show in plain words. PO number, supplier
  and units ordered are shown; prices never are. Every step is on the request's history, with notes
- Office side (anyone with Purchase Orders): "For the office" list with a count in the menu, mark as
  seen, decline with a reason the warehouse sees, select several and Raise PO (one supplier at a
  time, quantities and products filled in), link a request to a line already on an open order, and
  link or add a typed-in product to Products. PO lines show which request they came from
- Warehouse logins can no longer read costs at all — not on screen and not from the database:
  products, listings, suppliers, price lists, purchase orders, invoices, cost settings and the
  activity log are only readable by people with a section beyond Dispatch / Stock Requests. Dispatch
  still gets its packers and cut-off time
- New "Warehouse" role (Dispatch, Dispatch dashboard, Stock Requests). Requests are in ⌘K by SR
  number and product
- Mobile: the Stock Requests page is built for phones first (cards, big buttons, camera)
- Database: supabase/migrations/024_stock_requests_and_cost_lock.sql

## v2.23.0 — 17 Oct 2026
- Delivery dates on purchase orders. Every stock or packaging order that's been placed now has a
  Delivery panel: confirm the date the supplier gives you (with a note, e.g. "AM delivery, 2
  pallets"), change it if they move it, or take it off. Who confirmed it and when is logged
- Until a date is confirmed, admins see an estimate from the supplier's lead time (working days,
  from when the order was placed — when it's paid, or when it's raised on account). It's a guide for
  chasing only: once the estimate passes with no confirmed date, the order is flagged "ask the
  supplier", and a confirmed date that passes without the goods is flagged as overdue
- New "Chase a date" view on Purchase orders, and the delivery date shows in the list and the export
- Back orders and cancellations per line: any line can be marked "On back order" (with its own
  date, or TBC) or "Cancelled by supplier". Cancelled lines stop counting as still to come, so an
  order can be closed off; when only back-ordered lines are left, their date is what's shown.
  "Everything arrived" fills only the lines due with the order
- Typed-in lines on stock and packaging orders show "Not in Products", with Link (to an existing
  product) and Add to Products (pre-filled from the line). Nothing is added to Products automatically
- Database: supabase/migrations/023_po_delivery_dates.sql

## v2.22.5 — 16 Oct 2026
- "View" on any order that needs checking — on the upload review and in On hold — shows its
  packing slip and label(s) side by side, what the portal read from each (customer, postcode,
  order number, items), what's wrong, and exactly what will be stamped on each label. Checking by
  eye before ticking "I've checked" is now one click
- Database: supabase/migrations/022_dispatch_slip_page.sql (already applied). Orders held before
  this version show the label and the slip's details; the slip picture shows for uploads from now on

## v2.22.4 — 16 Oct 2026
- Fixed: packs named by what's in them ("6 ROLLS", "12 PIECES", "2 PAIRS"…) were wrongly held as
  "Each box holds 6, but the stamp says 1". Checked against every product in the HELM list, at one
  and two of each: none is flagged wrongly, and a real wrong count still is

## v2.22.3 — 16 Oct 2026
- Uploading no longer asks who's picking the batch — the uploader doesn't know. It's asked when the
  batch is printed: whoever prints it becomes the batch's picker, shown on the batch card, the pick
  list page and the cover pages, and their labels count towards them on the dashboard

## v2.22.2 — 16 Oct 2026
- An item set up for any quantity is now used for every quantity of it, so the same box is always
  stamped the same way: one bag is just its name, two is "2 X …" — whether the order was for 1, 3 or
  10 bags. Older set-ups for single quantities of those items are no longer used
- A box holding one is stamped with the item's name alone (no "1 X"), matching single orders, so
  they print and pack together

## v2.22.1 — 16 Oct 2026
- Box weight rules: no box over 25kg (DHL's limit), and nothing 15kg or more on an Evri label. An
  order that breaks either is held with the weight it would be, before anything is stamped
- Setting up a heavy item for "any quantity" suggests units per box from its weight: 10kg and
  12.5kg → 2 a box, 15kg and over → 1 a box
- Set up for any quantity, by weight: Peacock White Salt 10kg (2 a box), 15kg, 20kg and 25kg
  (1 a box), Scola Air Dry Clay Stone and Terracotta 12.5kg (2 a box), Unbranded Brown Rock Salt
  25kg and Kiln Dried Sand 25kg (1 a box) — alongside the White Rock Salt 25kg already set up

## v2.22.0 — 16 Oct 2026
- Dispatch dashboard is its own page (Warehouse → Dispatch dashboard), locked until granted like
  any new section. Dispatch is purely labels now
- Collection sheet lists parcels by what's stamped on them, added up across all the day's batches,
  instead of batch by batch
- Stamp safety — the stamp is what the warehouse packs by, so nothing goes on a label unless every
  check agrees, and anything unsure waits for a person:
  - The label's own record of what's in the parcel (Evri "Reference 2", DHL "AltRef":
    "2xPEACOC-SALT-WHITE-" or "MULTI_ITEM_ORDER") must agree with the packing slip, or the order is
    held. DHL's reference block is read a second time close up, so a 1 misread as a 4 can't decide it
  - Each stamp's count is checked against HELM's units: a mapping stamped "2 X …" on boxes that each
    hold 1 is held, with the corrected name and "Fix all" under Parcel mappings. (One existing
    mapping had this — "2 X KILN DRIED SAND 25KG" on an order of 2 bags in 2 boxes — and has been
    corrected to "UNBRANDED KILN DRIED SAND 25KG")
  - "Any quantity" items: each box is stamped with exactly what it holds — 5 bags at 2 a box prints
    "2 X …", "2 X …", "1 X …". If the labels don't add up, it's held and On hold asks what's in
    each box (the counts must add up before it can go back in)
  - Orders the portal couldn't fully check (no reference on the label and the postcode couldn't be
    read) are no longer added automatically: they wait for a tick, or "I've checked them all"
  - A new item whose code isn't in HELM's product list is flagged before it's set up
  - Setting up an item for more than one box asks for what's "Stamped on each box", and warns if
    the count doesn't match what each box will hold
  - Exact set-ups always win; a quantity with no set-up is asked about, never stamped as another
- Tested against every order in the files uploaded so far: every stamp matches its slip

## v2.21.0 — 16 Oct 2026
- Printing asks "Who's printing this?" every time — Ankesh or Sagar (or someone else; an admin can
  add them to the list). The warehouse shares one login, so whoever prints a batch is recorded as
  the person picking, packing and dispatching those labels. Press 1 or 2 to choose quickly; the
  last person is offered first. Reprints ask too
- Dashboard by person: a table of orders, parcels and units each person dispatched, day by day.
  Click a name, or choose them at the top, to see only their work
- Dashboard breakdown in two views: Products (real units per product) and Orders as stamped (orders
  and parcels for each label name). Plus orders dispatched per day as bars
- Cut-off countdown on today's batches: "2h 15m to the 18:00 cut-off — 34 labels still to go",
  turning red in the last hour and after it
- Collection sheet: one A4 page per carrier with the parcel count, Next Day / Standard split, the
  batches and products, and a box for the driver's name, signature and time — proof of hand-over
- Database: supabase/migrations/021_dispatch_packer.sql (already applied)

## v2.20.2 — 16 Oct 2026
- Saturday is a dispatch day: uploads after Friday's cut-off go on Saturday's list; after
  Saturday's, Monday's

## v2.20.1 — 16 Oct 2026
- Fixed: reading a file stopped while the tab was in the background. Pages were drawn with the
  browser's animation timer, which browsers pause for hidden tabs; they're now drawn without it, so
  reading carries on whatever tab or app you're in. The tab also tells the browser it's busy, so it
  isn't frozen or put to sleep, and asks before closing if a file is still being read
- Choose the dispatch day when uploading: Today, the next working day, or any later date. After
  the cut-off it starts on the next working day (Friday evening → Monday), and says plainly that
  these labels are not on today's dispatch list — on the upload, the review, the message when it's
  saved and the batch itself
- Today's Batches shows what's already been uploaded for later days, one click to see them
- Labels for a later day can be printed and packed early; they only count as late after their own
  day's cut-off

## v2.20.0 — 16 Oct 2026
- HELM's product list is built in: all 294 item codes (236 products, 58 bundles) load into the
  portal the first time Dispatch opens. Update it any time with "Import HELM products" under
  Dispatch → Parcel mappings, using HELM's Inventory Products and Groups export
- Exact units from HELM: a bundle counts as its parts ("FAIRY…-10PK" = 10 × Fairy 320ml) and a
  mixed set as each thing in it (the Pyrex 250ml + 500ml set = one of each). The dashboard reports
  under HELM's product names; anything not in the file still uses guess-and-confirm
- The batch pick list page adds up real products: "34 × Sanmex 300ml" across singles and packs
- Label names that keep what matters. New items are named from HELM's full product name, kept
  whole when it fits; when it's too long, only filler goes — never the size, weight, count or the
  variety (Stone vs Terracotta, 250ml vs 500ml). Checked against every product in the HELM list
- Long names on the stamp wrap onto a second (or third, on Evri) line, slightly smaller, instead
  of being cut short
- Parcel mappings flags any existing label name missing a size, weight or variety, with the
  corrected name, and "Fix all"
- Setting up a new item warns if the name you type drops a detail, with the full one a click away
- Database: supabase/migrations/020_dispatch_helm_products.sql (already applied)

## v2.19.0 — 16 Oct 2026
- Dispatch Dashboard (Dispatch → Dashboard): for today, 7, 30 or 90 days or any dates — orders,
  parcels, units dispatched and still to go, replacements, % gone by the cut-off, reprints, parcels
  per carrier and per picker, and a table of every product with its orders and real unit counts
- Units are exact, not read off the stamp: each item code is a base product and a number of units
  ("SANMEX…-3PK" = 3 of Sanmex Fly & Wasp Killer 300ml). The portal guesses this from the code and
  name the first time it sees an item; confirm the guesses once on the dashboard and the figures
  are exact — past uploads included. Singles, 2-packs and 3-packs of one product add up together
- Units count as dispatched only when every label in the order is marked dispatched
- Labels with no packing slip (hand-made replacements and the like) can now be uploaded. Each is
  its own order. The portal looks up what's been sent to that postcode before and offers
  "Replacement for 205-… (3 x Sanmex, B2, 14 Oct)" in one click — or pick the product, say why
  (Replacement, Manual order, Other), add the original order ref and a note. "Same for the rest"
  fills in a whole file of one product. They batch, stamp, print and dispatch like any other
- Replacements are counted apart from sales on the dashboard
- Labels with no slip that end up On hold can be told what they are there too
- Database: supabase/migrations/019_dispatch_units_manual.sql (already applied)

## v2.18.0 — 16 Oct 2026
- Uploads read in the background. Say who's picking, drop the file in, and carry on — the rest of
  the portal stays free to use. A small "Reading labels 12/40" note sits in the corner on every
  page, and a message says when it's done
- When every order in the file checks out, it's saved as a batch on its own — no review needed.
  If anything needs a person (a new item, a label that doesn't match), it waits on the Dispatch
  page with "Review & save"
- Much faster reading: several labels are read at once, and only the parts that matter are read
  (Evri: the service, the Destination box and the tracking number; DHL: the label turned the right
  way up) instead of the whole label two or three times
- Print order within a batch: Evri first, then DHL; Next Day before Standard; and the same product
  side by side, smallest pack first (2 x, then 3 x, then 4 x), so like is packed with like. The
  batch card, the pick list page and the printed labels all follow this order
- Keep the browser tab open while a file is being read
- Database: supabase/migrations/018_dispatch_sort.sql (already applied)

## v2.17.1 — 15 Oct 2026
- Fixed: a packing slip long enough to run onto a second page (big bulk orders) had its second page
  read as a label — "carrier not recognised" — and lost the items on it. The second page is now
  joined to its slip
- Fixed: Amazon's Evri labels were being held for a postcode mismatch when text recognition had
  misread one character (0/Q, 3/5, B/8…). One misread character is now allowed, and a matching
  customer name confirms it too. A genuinely different postcode and name are still held
- New: "Any quantity" set-up for an item. Bulky items ordered in any number (6 bags, 2 bags, 30
  bags) are set up once with how many go in each box, instead of once for every quantity. The label
  count is checked against it (30 bags at 2 a box = 15 labels) and flagged if it's out

## v2.17.0 — 15 Oct 2026
- On hold now lets you fix each order where it sits, then puts it back into its own batch:
  pick the carrier when a label couldn't be read (DHL, or Evri Next Day / Standard), set up a new
  item right there, or tick "I've checked the label against the packing slip" for a reference,
  postcode or label-count mismatch. Each order shows exactly what's left to fix
- "Add to B1" on each fixed order, or "Add all fixed back to their batches" in one go. If that
  product in the batch hasn't printed yet, the labels join it; if it has, they go in as a new line
  under the same batch number, so only the new labels print
- At upload, a label whose carrier couldn't be read can be set to DHL or Evri on the spot, so it
  goes straight into the batch instead of On hold
- Evri labels without a measured line under the barcode now stamp in the right place by default
- The four orders held from today's B1 and B2 were fixed and added back to those batches

## v2.16.1 — 15 Oct 2026
- Fixed: Evri labels bought through Amazon Buy Shipping were stamped in the wrong place. These labels
  are pictures, and the line under the barcode wasn't being found, so the stamp fell back too high.
  The line is now found reliably, and if a label has none, the stamp goes in the first clear space
  on the right under the barcode
- Fixed: labels on the last page of a file (and where files had been merged) were held as "carrier
  not recognised". Those pages carry a "Powered by TCPDF" line, which made the portal think the label
  had readable text; that line is now ignored and the label is read properly
- Fixed: after a DHL label, the next Evri label could be read on its side, getting the service wrong.
  Each label is now read the way up that actually reads as its carrier
- Amazon's Evri labels carry no order reference, so they're now checked by the customer's postcode,
  read close up from the Destination box: a match is confirmed, a different postcode is held. The
  customer's name is read too, for Find & reprint. Next Day is read from a close-up of the service band
- Uploading orders again that were on hold: the new upload takes over and the old held copies are
  cancelled, instead of being treated as duplicates

## v2.16.0 — 14 Oct 2026
- New step: Ready for dispatch. Labels go Upload → Print → Ready for dispatch → Dispatched, with who
  and when recorded at each step
- Mark a whole batch ready from its card, or one product from its row or drawer. Any not packed
  yet? Type their stamped numbers (e.g. 10-25) and the rest are marked ready
- Batches and products show where they've got to: Printed, Part ready (12 of 40 packed), Ready for
  dispatch, then dispatched. Once a product is all ready, its row offers Dispatched in one click
- Each label shows "Ready 14:32 · Ali"; Close day shows how many of each product are ready, and
  still dispatches everything printed except the numbers left over
- The day's export includes when each label was ready and who packed it
- Database: supabase/migrations/017_dispatch_ready.sql (already applied)

## v2.15.0 — 14 Oct 2026
- A batch is now one uploaded file — one HELM pick list. Every label in the file shares its batch
  number (B1, B2… for the day), however many products it's split into. Existing uploads have been
  renumbered the same way
- Batches screen shows each batch with its products underneath: labels, orders, carriers, who's
  picking it, when it was uploaded and printed, and how far it's got
- Print batch prints the whole file in one go: a pick list page first, then each product with its
  cover page and stamped labels. Print one product on its own from its row, select several batches,
  or Print all
- The pick list page: who's picking, the pick list name, labels, orders, the products in the order
  they'll print, and every item to pick added up across the batch (an order with three labels is
  picked once)
- At upload, say who's picking the batch (remembered names offered) and the pick list's name —
  prefilled from the file name. Both show on the batch, the cover pages and in search
- Duplicate guard: an order that's already in an earlier batch is held at upload, saying which batch
  and day and whether it's already gone — so re-generating labels in HELM can't send it twice
- Mark dispatched works on a whole batch from its card
- Database: supabase/migrations/016_dispatch_batch_per_file.sql (already applied)

## v2.14.1 — 14 Oct 2026
- Fixed: uploads from HELM held every order. Packing slips with numeric or mixed-case item codes
  (e.g. 366601900474, ScolaArtmix-Pearl-6x150ml-001) and product names over two lines are now read —
  the code is the bold line under the name, whatever it looks like
- Fixed: DHL labels were flagged as not matching their slip. HELM puts the shipment number (SH-…)
  in DHL's Ref and something else in AltRef; a label now matches if any of its references is on
  the slip — the SH- number at the top, or the channel order number beside the postcode
- New items start with a better suggested name: brand and product from the start of the listing

## v2.14.0 — 13 Oct 2026
- Close day: one button marks everything printed as dispatched. Labels left over? Type the numbers
  stamped on them (e.g. 10-25, 31) for each batch; everything else goes, the rest stay waiting.
  Typos and numbers outside the batch are caught before anything is saved. Works on any day, and on
  a single batch from its drawer
- Batches show where they've got to: To print, Printed (who, when), Part dispatched (75 of 100 gone)
  or Dispatched. Each label in a batch shows its own status
- Delayed: anything not dispatched by the cut-off (6pm, changeable by an admin) on its dispatch day.
  Grouped by batch — "Labels 10–25 pending (16 of 40)", how many days late, and any never printed.
  Open a batch to see each label; select some or all to mark dispatched, reprint or cancel
- Find & reprint: search by order reference, postcode (with or without the space), customer or
  tracking number. Each result shows the product, items, customer, batch and label number and its
  status before you print. Prints just that label, stamped as before, and records why (damaged,
  ripped, lost…), who and when. Warns if the label was already dispatched; can mark it dispatched
  in the same step
- Export day: every label for a day as CSV — batch, label number, parcel, items, carrier, tracking,
  order ref, customer, postcode, status, and who printed and dispatched it, with reprints. Useful as
  proof of dispatch
- Every dispatch, part dispatch, late dispatch, reprint and cancellation is in the activity log
- Database: supabase/migrations/015_dispatch_reprints.sql (already applied to the live database)

## v2.13.1 — 13 Oct 2026
- Dispatch reads HELM's 6x4 packing slips, which have no table headings: each item's name, its
  code underneath and the quantity in the box beside it
- HELM files put each slip before its label(s); that's recognised automatically, so files either
  way round pair up correctly
- The customer and postcode now come from the label's own Destination box where there is one,
  read by position so the routing codes beside it aren't mixed in
- Evri labels from HELM carry the HELM order number as Reference 1, matched against the slip

## v2.13.0 — 13 Oct 2026
- New Dispatch section (Warehouse). Upload the HELM file with labels and packing slips together;
  the slips are read and taken out, each label is checked against its slip, and labels are sorted
  into batches by what goes in each parcel — a 5-pack, a 2-pack and a single of the same bag all
  land in one batch, because each bag is its own box and label
- Every label is stamped small, clear of barcodes and routing: Evri under the top divider on the
  right, DHL just above "DHL eCommerce UK" — the parcel name, its number in the batch and the batch
  code (e.g. 25KG PLAY SAND 7/23 · B3). Each batch prints with a 6x4 cover page first
- Print one batch, a selection, or Print all. Printed batches show who printed them and when, and
  printing anything a second time asks first
- Checks before anything prints: wrong number of labels for the order, a label whose reference
  doesn't match its slip, an unrecognised carrier, or a slip with no label are held back. Labels
  whose reference couldn't be read are matched by page order and shown for a quick look
- Parcel mappings: the first time an item code turns up you say what's stamped on the label, what
  each parcel holds and how many labels an order should have — prefilled from the slip — and it's
  remembered from then on. Editable under Parcel mappings
- On hold: everything kept back, with why. Set up a missing item there, then add the orders to
  today's batches, or cancel them
- DHL labels are pictures, so their text is read by text recognition in the browser (about a second
  a label; the first use downloads its reading data once). Amazon's "List of orders" page is left out
  and not counted
- Every upload is kept, listed under Uploads; batches can be looked up by day
- ⌘K finds batches, and labels by customer, postcode, order reference or tracking number
- Dispatch is locked until granted in Team & Access. The menu shows how many batches are waiting
  to print today
- Database: supabase/migrations/014_dispatch.sql (already applied to the live database)

## v2.12.2 — 7 Oct 2026
- Rebuilt the Packaging page to work like Products: figures along the top, a filter bar
  (search, packaging type, live/not live, sort) and a table, rather than cards and a drawer
- Export CSV from the header: everything, or just the current filter — pick a packaging type and
  the export is only those listings. Columns include the packaging, its cost and weight, the
  products behind the listing, cost, shipping, profit, margin, volume and monthly packaging cost
- Select rows and change their packaging in one go, with the margin effect shown first, as before
- Calculations asked for before the cost settings load now return "cannot calculate" instead of
  throwing — the same fault that blanked the page in 2.12.0, fixed at the source this time

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
