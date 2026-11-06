# AI handover: read this first

This file is for an AI assistant (Claude chat, Claude Code, or any other) picking up work on this
project with no earlier conversation. It explains what the portal is, how it's built, how the
important logic works, **why** it works that way, and the rules the owner has set. Read it fully
before changing anything. The code itself has comments that explain the reasoning too; the
`CHANGELOG.md` is the full history of every release, written in plain English.

Last updated: 20 Oct 2026, at v2.53.0.

---

## 1. What this is

**Good & General Commerce Operations**: an internal web portal for a UK Amazon seller.
It began as a profit calculator for Amazon listings and grew into the whole operation:

- **Listings:** Calculator → Saved Listings → Approvals → Live Products (profit per listing,
  Amazon fees, carriers, packaging, cost history)
- **Sourcing:** Product Hunter, Products (stock items with supplier costs), Suppliers, Carriers,
  Companies, Brands, price lists
- **Purchasing:** Purchase Orders, Pending Payments, Delivery Problems
- **Warehouse** (the most important part now, used all day on iPhones): Dispatch, Post Dispatch (page id still `dispatch-dashboard`),
  Stock Requests, Goods In, Inventory, Tasks, Delivery tracking
- **Optimise / Planning / Tools:** Product Families, Shipping, Packaging, Build a Month (P&L
  forecast), Overheads, Bulk Upload, Archive, Cost Settings, Team & Access, ClickUp messages

**People** (as of Oct 2026):
- The owner, who is the admin and writes the requests
- **Ali**: office
- **Jignesh**: warehouse lead; uploads labels
- **Sagar and Ankesh**: warehouse team

All three warehouse staff use the portal as a home-screen app on iPhones. They use laptops mainly
for printing batches. The warehouse works **Monday to Saturday; Sunday is off**.

**HELM** is the warehouse management system (WMS) the business recently moved to
(https://app-api.helmwms.app, API v2, company 1932). Orders come from Amazon into HELM. The portal
**reads** HELM; it never writes to it (see rules).

---

## 2. Tech stack and where things live

- **Frontend:** React 18 + Vite 5 + Tailwind 3. Plain JavaScript (no TypeScript). Pages are
  lazy-loaded (`PAGE_MODULES` in `src/App.jsx`).
- **Backend:** Supabase (Postgres, RLS, SECURITY DEFINER functions, Edge Functions, pg_cron).
  - Project ID: `amuqewxxvlggtsyzbyry` (URL `https://amuqewxxvlggtsyzbyry.supabase.co`).
  - Almost all business logic that touches stock is in **Postgres functions** called through
    `rpc()`, not in the browser.
- **Hosting:** Vercel, deployed automatically from the `main` branch on GitHub
  (`tai-chaudhary/amz-calculator`). Environment variables: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` (see `.env.example`). The `.env` file is never committed.
- **PDF / OCR:** pdf-lib, pdfjs-dist and tesseract.js read the label PDFs in the browser. xlsx is
  used for spreadsheets.

```
src/App.jsx                 shell: nav, page loading, update banner, phone bottom tabs, ⌘K search
src/lib/access.js           permissions: nav list, capabilities (e.g. "link-codes"), seesCosts, canApproveProducts
src/lib/db.js               every Supabase call (tables and rpc wrappers)
src/lib/dispatch.js         label/slip pairing, order checks, AUTO STAMPS (autoMapping), upload planning
src/lib/dispatchJobs.js     background upload jobs: read PDF → pair → check → auto-save or review
src/lib/dispatchPdf.js      reading label PDFs, stamping, building print files
src/lib/inventory.js        shelves (A–H aisles), stock state, cover days, search
src/lib/tracking.js         delivery tracking rules (late = 2 working days, Sunday not counted)
src/lib/updates.js          phone app update checker (/version.json)
src/lib/calc.js, feeSchedule.js   the original profit calculator
src/components/DispatchPage.jsx   the Dispatch page: batches, UploadFlow, HeldList (On hold), close day…
src/components/PickList.jsx       pick list per batch or whole day; substitutes
src/components/NewOrdersCard.jsx  HELM orders not yet labelled (Today / later days / All open …)
src/components/InventoryPage.jsx  stock, shelves, product drawer, "Office to verify" approval
src/components/ItemCodes.jsx      Inventory → Item codes (to verify, sent instead, verified, history)
src/components/VerifyCode.jsx     the "what is this code?" screen
src/components/GoodsInPage.jsx + PutAwaySheet.jsx   deliveries arriving and going onto shelves
src/components/WarehouseTasksPage.jsx               top-ups, counts, codes to verify, products to approve
src/components/TrackingPage.jsx                     Delivery tracking
src/components/TeamPage.jsx                         Team & Access (pages + "Trusted to" capabilities)
supabase/migrations/NNN_*.sql     every database change, in order (see section 8)
supabase/functions/helm-sync      reads HELM orders every minute (drops all customer details)
supabase/functions/helm-tracking  reads HELM shipments/tracking at :07 and :37 past each hour
supabase/functions/notify         sends portal messages to ClickUp (retries every 5 minutes)
supabase/functions/supplier-sync  supplier catalogue sync (00:00–05:59, every 3 minutes)
supabase/functions/admin-users    admin user management
tests/calc.test.mjs               the test suite (node --test)
scripts/check-*.cjs               static checks run by `npm run check`
CHANGELOG.md                      every release, newest first
HELM_IDEAS.md                     parked ideas for the HELM API
```

Edge Function secrets (set in Supabase, never in the repo): `HELM_API_TOKEN`, `HELM_COMPANY_ID`,
`SUPABASE_SERVICE_ROLE_KEY`; the ClickUp token is in the Supabase vault. Cron jobs call the
functions with an `x-notify-key` header from `public.notify_key()`.

---

## 3. Rules the owner has set (follow these)

1. **HELM is read-only.** "Right now it's on read only just to be on the safe side." Never write
   to HELM.
2. **Never store customer personal data** from HELM: no names, addresses, phones or emails.
   `helm-sync` drops them. Label rows hold only what's needed to dispatch.
3. **Stock accuracy comes first.** "We need to get this 1000% right, it's EXTREMELY important."
   When unsure, the portal holds an order for a person rather than guessing.
4. **Only the office (or someone ticked "Cancel labels") cancels labels.** Cancelling never deletes,
   and never touches an order with a dispatched label.
5. **Only trusted people link item codes**: the owner, Jignesh and Ali, ticked as "Link item codes"
   in Team & Access. "If you connect it wrong once to the wrong product, all future orders will be
   despatched wrong."
6. **Stamps are never typed.** They come from the inventory product name and the units in the box.
7. **New products from the warehouse need office approval** (the name is checked and a SKU given).
8. **Sunday is off.** No tasks or counts are due on Sunday, and delivery deadlines skip Sunday.
9. **Every release:** bump `src/version.js`, add a `CHANGELOG.md` entry in the same plain style,
   and run `npm run check` and `npm run build` before shipping.
10. **Mobile first** for anything in Warehouse. Big tap targets, nothing hidden off-screen, works
   one-handed on an iPhone. It must also work on a laptop.
11. **Brand:** Good & General. Standard Blue `#032FAA` (royal), Open Sky `#D4EFFF`, Paper
    `#F7F6F2`, Signal Coral `#F05A47` for exceptions, Lime `#C8EF3F` used sparingly. The font is
    Figtree. Keep changes consistent with the existing UI (`src/components/UI.jsx`,
    `tailwind.config.js`, `UI_REDESIGN_NOTES.md`).
12. **Wording:** plain, short, British English, written for warehouse staff ("Office to verify",
    "Sent instead of …"). No jargon in the UI.
13. **Ask before** anything hard to undo (deleting data, bulk changes to live stock).

---

## 4. The dispatch flow, end to end (the most important logic)

### 4.1 Upload labels
Jignesh uploads the day's label PDF (Amazon/HELM labels + packing slips). `dispatchJobs.js`:
1. Reads every page (text + OCR), finds **labels** (carrier, tracking, order ref, postcode) and
   **packing slips** (order ref, item codes, item names, quantities).
2. Pairs labels to slips by order reference. If a reference is missing, it falls back to page
   order, and that is flagged as a "check" problem.
3. Calls `loadCodeInfo(codes)` → database `dispatch_code_info`, which says what every item code
   is (section 5).
4. `planUpload()` / `checkOrders()` in `dispatch.js` checks every order and gives it a level:
   - `hold`: can't be sent safely (unreadable, already uploaded, weight over the limit, boxes
     that don't share evenly…)
   - `manual`: no slip; a person says what it is
   - `verify`: an item code nobody has verified yet (or a product the office hasn't approved)
   - `map`: old flow only (no code info)
   - `check`: matched by page order / no reference; a person should look
   - `ok`
5. **Orders blocked by `verify` or `per-box` are never ticked through.** If nothing else needs a
   person, the upload **saves automatically**: good orders go into the batch, and blocked ones go
   to **On hold within the same upload**, with every reason recorded.
6. Otherwise the person reviews (UploadFlow), and can verify codes right there
   ("Check what these codes are — once").

### 4.1b Labels with no packing slip
A hand-made label (replacement, manual order) has no slip, so the order is level `manual` and always waits
for a person. `ManualPicker` (`ManualParcel.jsx`, products from `inv_product_picker`) chooses products from
Inventory **by our own SKU** with quantities (several products = one mixed parcel), plus a reason
(replacement / manual order / other), original ref and note. "Replacement for …" chips fill the items from
an earlier order to the same postcode (that order's own codes). `manualSlip()` turns the choice into slip
items, so `autoMapping()` stamps it and `inv_expand` takes the stock exactly as for any order; codes are
looked up (`loadCodeInfo`) as they're chosen. Pending products / unverified codes hold as usual. The old
typed-mapping value (`{ mapping, qty }`) is still accepted by `manualSlip()`/`hasManual()` but no longer
offered. The same picker is used in On hold.

**Repeat uploads** are caught by order reference **and by tracking number** (`trackKey`: 8+ characters):
`findExistingOrders(refs, tracking)` matches `tracking` and `tracking_read` (what the label said when HELM
corrected it), ignoring cancelled and held labels; the same tracking twice in one file holds the second.

### 4.2 Stamps (automatic, from inventory)
`autoMapping(items, labelCount, codeInfo)` in `src/lib/dispatch.js`:
- For each slip line: **units = slip qty × units per code**. For example, a "2-pack" code
  verified as 2 × Pyrex Jug, with 2 on the slip, gives **4 jugs**.
- One product: **per box = total units ÷ number of labels**. The stamp is
  `"4 X PYREX GLASS MEASURING JUG 500ML"` (just the name when it's 1). The name comes from the
  product's **stamp name** if the office set one, otherwise its inventory name, shortened by
  `stampName()` to at most 54 characters.
- If the units don't share evenly over the labels, the order holds (`per-box`): a person says
  what's in each box.
- Two or more products in **one** box: `"1 X A + 2 X B"`. Over **more than one** box, it holds
  ("can't tell what's in each box") until a person confirms.
- Any code not `own`/`verified` stops the whole order (no partial stamps).
- A code with nothing readable in it holds as unreadable.
- Substitute links add "· sent instead of X" to the contents, so batches and the pick list show it.

### 4.3 On hold → release into the same batch
`HeldList` in `DispatchPage.jsx`: held orders show what's missing, as steps (codes loaded, codes
verified, mapping, mixed boxes ticked, boxes filled, carrier, checked). Once all steps pass,
**Release** (`releaseHeldLabels`) puts them into **the batch of the upload they came from**,
stamped automatically. Hold reasons are split on `; ` and each part is judged on its own (one
"boxes" reason must not excuse an "already uploaded" or "label check" reason).

### 4.4 Batches, picking, packing
- Each batch has a responsible person (who printed it). "The person whose name was chosen when
  printing the batch is ultimately responsible for that batch." People help on each other's
  batches.
- **Pick list** (`PickList.jsx`, database `dispatch_pick_list`): per batch or the whole day,
  grouped by aisle, pick shelves first, ticks kept on the phone. It shows "Sent instead of …" for
  substitute links, and a section for codes not linked to our products.
- **Substitutes** (oversold items where something else is sent and the customer accepts it) can
  be recorded at any point: pick list, Ready for dispatch, despatch, after. They're logged in
  `dispatch_substitutes` with a ratio; stock comes off the substitute product. **Close day** asks
  about anything short ("Sent as ordered" / "Something else").

### 4.4b Cancelling labels
`dispatch_cancel_labels(ids, reason, by)` (migration 042) cancels **whole orders**: every label of each
order the ids belong to. Labels stay on record (`status='cancelled'`, `hold_reason`, `cancelled_at`,
`cancelled_by_name`), stop reserving stock (`inv_open_order_units` only counts ready/held) and can be
uploaded again (the duplicate check ignores cancelled). Orders with **any dispatched label are skipped**:
`inv_label_changed` would not put their stock back. Allowed by `can_cancel_labels()` = Dispatch page **and**
(`sees_costs()` or the `cancel-labels` capability); frontend `canCancelLabels(me)`. One sheet,
`CancelLabels.jsx`, is used from the batch card (whole upload, via `loadUploadLabels`), the batch drawer,
Find & reprint, On hold and Delayed. It reminds people to bin printed labels and to cancel the carrier label
in HELM/Amazon (the portal never writes to HELM). Once cancelled, the HELM order shows in New Orders again
while HELM still has it open.

### 4.5 Despatch → stock comes off
When a label is marked dispatched, the trigger `inv_label_changed` → `inv_despatch_order` works
out the order's products with `inv_expand` and takes the units with `inv_take` (pick shelves
first), applying substitutes.
- Units whose code isn't resolved go to `inv_unmatched`.
- When someone later verifies that code, `inv_link_catch_up` takes those units off then.
- Errors are logged in `inv_despatch_errors` (shown in Item codes) instead of failing silently.
- Open (uploaded, not yet despatched) orders **reserve** stock (`inv_open_order_units`), so
  Inventory shows on shelves / in open orders / available.

---

## 5. Item codes: how a packing-slip code becomes our product

Every product in Inventory has **our own SKU** (`inv_products.code`, normalised into `code_key`
by `inv_norm`: upper-case, letters and digits only). The SKUs came from the owner's stock file
(`Helm_Full_Stock_By_Location_16_Oct_2026`, counted Saturday 17 Oct 2026; there was no inventory
before that).

`inv_expand` / `dispatch_code_info` resolve a slip code in this order:

1. **Own SKU**: the code *is* one of our products → status `own`. (If that product is still
   waiting for the office → status `pending`, and the order holds.)
2. **Person-verified link**: `inv_channel_skus` with `source='portal'` and `how='person'`; items
   are `[{code: OUR_SKU, qty: N}]`, plus `kind` ('same' | 'substitute'), `wanted_name` (what the
   listing should be when we send something else), `verified_by` / `verified_at` → `verified`.
   Status `broken` if a linked product no longer exists.
3. **HELM pack split**: `dispatch_item_units.components` (HELM says "2PK = 2 × X") → status
   `unverified`. It holds stock in the meantime, but **never** produces a stamp; a person must
   verify it.
4. Nothing → `unknown` (takes no stock until verified; catch-up happens then).

Further rules:
- **Suggestions** (`how='suggested'`) only pre-fill the verify screen. They **never** count for
  stock. They hold the owner's known answers (e.g. Plenty Original → Ultrasorb 3RL, a substitute;
  Pyrex 500ml bowl 2-pack → 2 × 0.7L bowl, a substitute; Sanmex 006 → 6 × Sanmex; FlexiSheets
  12RL → 6 × FlexiSheets 2RL; Swirl with basket = Swirl 145ml).
- Older automatically "learned" links (`how='orders'`) were **switched off** for stock on purpose:
  only a person's verification counts.
- **Linking** (`inv_link_code`): only `can_link_codes()` (admin or the "link-codes" capability).
  The product must be live, quantities must be whole numbers above 0, and the code must not be
  one of our SKUs. There is one link per code however it's spelled. Every change is written to
  `inv_code_log`. The UI makes the person tick "I've checked…" and choose **same product** or
  **we send this instead** (then "what the listing should be" is required).
- The older `inv_save_sku` / `inv_import_sales` refuse `source='portal'`, so links that count for
  stock are only made through Item codes.
- **Inventory → Item codes** shows: codes on open orders still to verify (`inv_codes_to_verify`,
  with order counts), "Sent instead, every time" (so the office can fix the listing or source the
  right product), verified codes (change/remove), the history, and despatch errors. **Tasks**
  shows the codes to verify to the people who can link them.

---

## 6. Products: new products, approval, SKUs

- `inv_products.status`: `live` (default) or `pending`.
- **Goods In → put away** (`PutAwaySheet.jsx`): when something arrives that Inventory hasn't seen,
  the warehouse adds it. The SKU is optional for them; if left blank, the product gets a temporary
  code `NEW-0001…` (sequence `inv_new_product_seq`). It is **pending**: stock goes on the shelf
  straight away, it shows in Inventory as **"Office to verify"**, and orders for it hold.
- **The office approves** it (product drawer → `inv_approve_product`): check the spelling, give
  the real SKU (not `NEW-…`) and optionally a short stamp name. Then it goes live. Tasks lists
  products to approve for the office.
- "The office" = `can_approve_products()` = `sees_costs()` (anyone with a non-warehouse page, or
  an admin) **or** `can_link_codes()`. In the frontend this is `canApproveProducts(me)`.
- **Inventory → Add product** (`AddProductSheet.jsx`): for stock already here with no delivery. Same rules
  as Goods In (`inv_save_product` with no id: office → live with its SKU; anyone else → `NEW-…`, pending).
  Opening stock and shelf are optional; stock goes in through `inv_adjust` (reason "New product: opening
  stock", logged with who). Without a shelf the units sit at location '' and the product shows under the
  **No location** tab. The stamp name fills in from the name via `stampName()` (here and in the approval
  panel) so it's usually just confirmed.
- **One product, two views** (migration 044). `inv_products` (SKU, name, stamp, shelves, stock) and
  `stock_items` (Products: cost, supplier, supplier SKU, weight, barcode, brand) are the same product,
  **one to one** (unique `inv_products.stock_item_id`). Triggers: `inv_pair_on_insert` makes the Products
  entry for any new inventory product; `inv_name_to_item` / `item_name_to_inv` keep one name;
  `item_keep_if_in_inventory` stops Products deleting what Inventory holds; `inv_delete_product` archives
  the Products entry too. Office RPCs: `inv_item_stock` (SKU, on hand, on open orders, available, per
  product), `inv_link_stock_item` (Inventory name wins; no second name is kept — PO lines follow via `item_name_to_po_lines`),
  `inv_pair_new_items`, `inv_add_from_stock_item`, `inv_set_kind`, `inv_unlink_stock_item` (migration 046: undo restores
  the Products entry's `preLinkName`/`preLinkSku`; one made for it is archived, never deleted). Clean-up screen: `LinkProducts.jsx`
  (Set up), matching in `lib/productLink.js` (sizes and pack counts compared separately; a clear match must
  be same-size, ≥0.75 and mutual). **Packaging** is `inv_products.kind = 'packaging'`: its own Inventory
  tab, excluded from `inv_link_candidates`, `inv_product_picker` (so code linking, substitutes and
  no-slip labels). Products page shows SKU and Available stock (`inv_item_stock`).
  **Products is the master record**: it can exist with no stock (testing, listings, on order) and only
  comes into Inventory through Goods In (step 2, not built). **Our SKU on Products** (migration 045):
  `data.sku`, always the Inventory SKU when stocked (trigger `inv_name_to_item` syncs name and code); for a
  product not stocked yet it's set when its first listing is approved (`SkuPrompt`, `item_set_sku`), unique
  across both (`item_sku_owner`). Suggestions: `lib/skuSuggest.js` (BRAND-TYPE-VARIANT-SIZE-PACK, learns
  brand/type codes from existing SKUs, packs …PK), shown by `SkuField`. Office "Create a product" in
  Inventory writes Products details with `item_set_details`.
  **Agreed build order:** 1 clean-up + SKU (v2.40.0) → 2 Goods In creates the stock side from the PO's
  product → 3 Product page (image, details, ASINs, listings, sales, timeline) → 4 packaging bands per
  product and quantity (per parcel; seeded from listings' packaging; packer can change; learns).
  **Phase 2 (not built): packaging rules** — per product and quantity, the packaging each parcel uses,
  taken off on despatch; packer can change it; seeded from a sheet built from order history before it
  goes live; afterwards a parcel with no rule holds until Jignesh, the office or an admin sets it.
  Boxes and mailers only (no fillers).
- **Product suppliers / last price paid** (migration 052): `item_learn(item, dry)` rebuilds
  `stock_items.data.suppliers` (one entry per supplier: supplierSku, packUnits, packPrice, costPrice, lastPrice,
  lastPackPrice, lastBoughtAt, lastPo, orders, preferred) and `data.lastPaid` from all counted PO lines (status not
  draft/cancelled, kind order, line not cancelled, unit_cost > 0), and sets `costPrice` (+ packUnits/packPrice) to
  the latest line's per-unit price. Triggers `po_line_learn` / `po_learn` run it on any PO line or status change.
  Supplier matching: `same_supplier()` / `sameSupplier()` (exact or prefix). PO builder: `supplierTermsFor(si, supplier)`.
  `supplierName`/`supplierSku` on the product = preferred supplier.
- **Packaging** (`PackagingPage.jsx` + `PackagingParts.jsx`, `lib/packaging.js`, migration 050). Types stay in
  `settings.packaging`, now with `components: [{ stockItemId, qty }]`, `extraOn/extraCost/extraNote` and
  `history`. App resolves every type's `cost`/`weightKg` from its items (`resolvePackaging`, so `settings` in
  App is the resolved view of `rawSettings`); unbuilt types keep their typed cost. Packaging items are
  `stock_items` with `data.packaging` (+ `alsoSold`), unit cost = `packPrice / packUnits` when bought in
  packs; triggers keep `inv_products.kind` in step. Packs: `data.packUnits`/`packPrice`; PO lines use
  `poUnitCost` (pack price) and `data.packUnits`; `inv_put_away_plan` (migration 051) puts away
  `packs × pack_units`. `data.unitName` (each/metre/quilt/cushion/litre), `data.dims` {l,w,h} on boxes,
  `tapeMetres(dims)` for "Tape it". Kite data loaded from the invoices (`data.priceSource`).
  **Not done yet:** building the 12 types from items, and taking packaging off on despatch (Step 4 bands).
- **Product page** (`ProductPage.jsx`, shown by the Products page when `focusId` is `p:<stock item id>`,
  i.e. `#/stock?focus=p:<id>`; office only). Data: stockItems, savedProducts (listings via `components`),
  liveProducts, inventory (`inv_overview` product with `stock_item_id`), and migration 049's
  `product_sales` (despatch movements by day + item codes via dispatch_labels), `product_purchases` (PO
  lines) and `product_timeline` (activity_log for the product, its inventory product, listings, POs and
  deliveries, plus stock movements and daily despatch roll-ups). Details are edited in place and saved only
  after a confirm listing the changes (`onUpdateStockItem`, which cascades cost to listings). The Listings
  tab reuses `LiveProductRow` (exported from `LiveProductsPage.jsx`) for live listings, with the same handlers.
- **Goods In from the PO** (migration 048, `PutAwaySheet.jsx`): `inv_put_away_plan` gives each line a `match`:
  `product` (PO line's stock item is in Inventory — locked), `new` (stock item not in Inventory: `inv_put_away`
  creates the inventory product from it, SKU = `data.sku` or NEW-… pending), `name`/`none` (no stock item:
  old search / new product path), `not_stock` (PO line with no stock item — skipped by default). A different
  product on a `product` line needs `reason` (logged on the movement as "Sent instead of …"). Put-away no
  longer writes `si:` aliases or sets `stock_item_id` (the one-to-one link is the truth).
- **Listings → Products** (`ListingLinks.jsx` on the Products page, `lib/listingLink.js`): listings with no
  `components` are grouped (supplier SKU, else product name + supplier) and linked to an existing
  `stock_items` row (`data.components = [{ stockItemId, qty }]`, `productLinkedAt/ByName`); App handlers
  `handleLinkListings` / `handleUnlinkListings`. The old `MigrationModal`/`planMigration` is no longer shown
  (it planned over already-linked listings and only ever created new Products).
- **Deleting a product** (admins only, `inv_delete_product(id, by, dry)`, migration 043; `DeleteProduct.jsx`
  in the product drawer). Every table referencing `inv_products` cascades, so a hard delete is only done
  when there's **no history** (no movements, damages or substitutes). With history and no stock it's
  archived: `active = false`, code renamed `…-DELETED-<time>` (frees `code_key`, because
  `dispatch_code_info` matches own SKUs without looking at `active`), open tasks removed, note says who.
  Stock on hand → refused. Verified links to it then resolve as `broken` (orders hold) — expected.
- **Setup → Selling, but not in inventory** links a code with `VerifyCode` first; "New product" opens
  `AddProductSheet` prefilled (`initial`) — never a one-tap create.
- **Only the office changes a product's name or SKU** (`inv_save_product` enforces it; the UI
  locks the fields). Changing a SKU (`inv_rename_sku`) moves every link with it, and the **old SKU
  becomes a verified code for the new one** (so slips/HELM orders still carrying it keep working).
  It's all logged.
- A SKU can't clash with a packing-slip code already linked, or with a HELM *pack* code
  (`inv_code_clash`), because our own SKU always wins and would quietly take over those orders.
- SKUs show quietly (small grey monospace "SKU …") under products, and Inventory search matches
  them.

---

## 7. Other warehouse features (short)

- **New Orders** (`NewOrdersCard.jsx`): HELM orders not yet labelled, from `helm_new_orders` /
  `helm_open_rows`. Tabs: Today / later days / Past ship-by / Labelled / All open (including back
  orders and holds) / Needs attention. Sorted by most orders first. Full-screen view on laptops.
  It scrolls inside the card, and is folded by default on phones.
- **Batch cards** show a breakdown of what each batch holds (product × labels), open by default
  and sorted by most labels.
- **Find & reprint** has a label preview.
- **Tracking numbers:** read off labels (Evri and DHL). `dispatch_apply_helm_tracking` checks them
  against HELM: verified / corrected / filled. "✓ HELM" shows when it came from HELM.
- **Delivery tracking page:** parcels from HELM shipments (`helm-tracking` function, no personal
  data). A parcel is **late** if not delivered within **2 working days** (Next Day service; Sunday
  not counted); late parcels hurt Amazon account health. Exceptions: failed attempt, on hold,
  address problem, returned to sender, tracking expired, waiting for collection. It includes a
  courier comparison and returns/damage **by product**, to improve packing.
- **Inventory:** aisles A–H, bays (D has 11), shelves 0–7, sections. Pick shelves vs overflow;
  top-up tasks; counts (Mon–Sat); damages (the office decides); value (office only); cover days
  with a 15-day buffer; slow (60 days) and overstock (120 days).
- **Phone app:** `public/manifest.webmanifest`, icons and full screen. Every build writes
  `/version.json`; `updates.js` checks it on open, on return to the front, and every 5 minutes. It
  shows an "Update" bar, and updates itself if the phone sat unused for 10 minutes or more with
  nothing half done. Lazy pages whose old file is gone reload onto the new release. `vercel.json`
  stops caching of `/`, `index.html`, `version.json` and the manifest.
- **Phones:** bottom tabs (Dispatch, Tasks, Inventory, Goods in, or that person's top four) plus
  Menu.

---

## 8. Database: how changes are made

- `supabase/migrations/` holds every change, numbered 001–052, applied in order to the live
  database. **Each file is safe to re-run.** Files 037–041 are the item-codes / approval work; 042 is cancelling labels; 043 is deleting products; 044 is one product (Inventory = Products); 045 is our SKU on Products; 046 is undoing a link; 047 is one name everywhere (PO lines follow the product name; no supplierProductName); 048 is Goods In from the PO; 049 is the Product page; 050 is packaging items; 051 is packs at put-away; 052 is product suppliers and last price paid; 054 is nicknames and claims; 053 is `tracking_parcels` (Delivery tracking in one request, no scan history in the list).
  037 was only partly applied (its header says what), and 038 replaced the rest.
- `supabase_setup.sql` (root) was a combined fresh-setup file but is **out of date** (last
  regenerated around v2.30). For a fresh database, run the migrations in order instead.
- **Security pattern:** tables have RLS. Writes go through `SECURITY DEFINER` functions that check
  `is_active_user()`, `can_open('page-id')`, `sees_costs()`, `can_link_codes()` or
  `can_approve_products()`. EXECUTE is revoked from `anon`/`public` on internal functions
  (migration 031 closed a hole where anon could run `inv_take`).
- **Testing safely on live data:** run a `do $$ … $$` block that impersonates a user
  (`set_config('request.jwt.claims', json_build_object('sub', <profile id>, 'role','authenticated')::text, true)`
  and `request.jwt.claim.sub`), does the work, then `raise exception 'RESULT …'` so everything
  rolls back.
- **Practical gotchas** (when using the Supabase MCP tools):
  - A function body containing `delete` can make the tool wait for a confirmation and time out;
    prefer `update … set units = 0` style.
  - Apply policies as separate statements.
  - Use `set lock_timeout` for ALTERs on busy tables.
  - To patch a big existing function, `execute replace(pg_get_functiondef(...), old, new)` inside
    a DO block (guarded so it's safe to re-run).
- **Deploying:** database changes go live the moment they're applied (before any code merge), so
  make them backwards-compatible with the current frontend. Frontend changes go live when merged
  to `main` (Vercel).

---

## 8b. UI conventions added in v2.48.0

- **Title Case** comes from CSS (`text-transform: capitalize` on `.page-title`, `.section-title`, `.tab`, `.btn`,
  `.label`, `.metric-label`, table headers, `.modal-title` and `.title-case`). Give new headings one of these
  classes; don't hand-type capitals. Explainer sentences stay sentence case.
- **Colour labels**: `Flag` (tone red/amber/green/blue/grey) and `CoverFlag` (days of stock left) in `UI.jsx`;
  `StatusBadge` also takes `warn` and `info`. Red = act now, amber = warning, green = fine, blue = information.
  Important information should be a label, not plain grey text.
- **Search**: every search box uses `src/lib/match.js` — `smartFilter(list, q, toText)` for lists (keyword match,
  best first, closest fill-in), `matches(text, q)` for yes/no, `hay(...)` to join fields. Never use `.includes(q)`.
- **Nicknames** (`lib/nicknames.js`, migration 054): `stock_items.data.nickname`, unique, set by `item_set_nickname`
  (office), read by everyone via `product_nicknames()`. Shown by swapping text nodes on screen (MutationObserver)
  when the person's switch is on (localStorage `gg-nicknames:<id>`); `[data-no-nick]` opts out. Search gets them
  through `setSearchExpander` in `match.js`. Stamps: `loadCodeInfo` sets `items[].stamp` to the nickname.
- **Claims** (`ClaimsPage.jsx`, table `claims`, `claims_scan()` on pg_cron every 30 min and on page load, photos in
  bucket `claim-photos`). Carrier claim windows: carrier company `data.claimDays` / `data.claimsContact`.
  `helm_orders.order_total` is filled by helm-sync's `orderTotal()` (field names guessed; check after deploy).
- **Releasing held labels** (`releaseHeldLabels` / `releaseTarget`): own batch only if not fully printed, else the
  newest unprinted batch of the day, else a new "Back from hold" upload. A label's page lives in `label.upload_id`'s
  file (`file:` embed), which can differ from its batch's upload — always print from `l.file?.storage_path`.
- **Dispatch day tools** (migration 055, `DispatchDay.jsx`): `dispatch_labels.kept_back*` via `dispatch_keep_back`;
  `dispatch_collections` (+ bucket `collection-signatures`); `dispatch_days.summary`; pick-list orders carry
  `seqs`, `batch_code`, `stamp`; `helm_labels_not_uploaded()` + cron `labels-not-uploaded` (14:30/15:30 UTC, only
  15:xx London posts) → notify event `labels_not_uploaded`. Walking route: `byWalk` in inventory.js.
- **Stock rules** (`inventory.js`): `REORDER_DAYS` 25, `salesSpike` (last 2 selling days, Sundays skipped, each
  ≥ 1.4 × normal and ≥ 2 units) feeds `stockState`. `loadInventory` merges `inv_planning()` (recent days, last
  sale, goods-in layers) into each product. Stock age: `stockAge()` in StockPlanningPage (FIFO over layers).
- **Customer care** (migration 056, `CustomerCarePage.jsx`, page id `customer-care`): tables `complaints`,
  `returns`; `care_find_order()`; `returns_scan()` cron; bucket `care-photos`. Complaint `kind` → cause
  (packing / carrier / product) drives packing-error counts for team metrics later.
- **Undo** (migration 060, `Undo.jsx`): trigger `undo_capture` on the main tables logs every signed-in change to
  `undo_log` grouped by txid; `my_undoable()` / `undo_action(txid)` (5 min, own actions, refuses if someone changed
  the row since). inv_movements are undone with an opposite movement; 'despatch' movements follow their label.
  A new table that people change should get the trigger (see the list in 060).
- **Print Station** (migration 063, `lib/printStation.js`, `PrintStationPage.jsx`): `printPdf` routes every print
  (`routePrint`); `printHere` is the old local print. Jobs: `print_jobs` + bucket `print-jobs`, claimed with
  `print_claim()`; station heartbeat in `print_stations`. Device prefs in localStorage (`gg-print-station`,
  `gg-print-to`). New prints should call `printPdf`, never window.print directly.
- **Core display rules:** dates DD-MM-YYYY (`lib/dates.js`: `fmtDate()`, plus a page-wide text swap started in App);
  badges/labels start with a capital (`capFirst` in UI.jsx, applied by StatusBadge and Flag). Hand an order to a form
  on another page with `sendPrefill` / `takePrefill` (OrderAuditPage.jsx).
- **Replacement window**: `findCustomerHistory` only looks back `REPLACEMENT_WINDOW_DAYS` (45).

## 9. How to work on it

```bash
npm ci
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
npm run check             # static checks + tests (108 passing at v2.47.0)
npm run build             # must pass before shipping
```

- Make changes on a branch, then open a PR into `main`; the owner merges it (Vercel deploys).
- For each release: bump `src/version.js` (minor = feature, patch = fix), add a CHANGELOG entry
  and run check + build.
- Code style: match the surrounding code. Short comments that explain *why*, plain names, and no
  TypeScript.
- Don't save real order data to files on disk. Work from aggregate SQL or made-up test data.

---

## 10. Where things stand (19 Oct 2026)

- **v2.36.0** (item codes, auto stamps, upload hold, office approval, SKUs in Inventory, review
  fixes) is in **PR #7** on branch `claude/funny-hopper-mlwjb7`. If it isn't merged yet, merge it.
  Database migrations 037–041 are **already applied** to the live database.
- **v2.40.0**: Inventory and Products one to one; Packaging tab; Products shows Available stock. Migration
  044–046 are applied. **To do:** run the clean-up in Inventory → Set up → Inventory and Products.
- **v2.39.0**: link-first for unmatched codes; admins can delete products. Migration 043 is applied.
- **v2.38.0**: labels with no slip are told what they are from Inventory; repeat uploads caught by
  tracking number. No database change.
- **v2.37.0** (cancel labels, Add product, No location tab, stamp suggestion) builds on it. Migration 042
  is **already applied** to the live database. After deploying, tick "Cancel labels" for Jignesh.
- **To do after merging:**
  1. Tick "Link item codes" for the owner, Jignesh and Ali (Team & Access → Trusted to).
  2. Verify the codes on open orders in Inventory → Item codes (24 at the time of writing, most
     pre-filled). Two need the owner's decision:
     - `PESTSH-PESTPWD-ANT-200G`: only the 150g is in stock; check what is actually sent.
     - Pestshield Fly & Wasp 300ml: out of stock; the product is to be added on Monday.
  3. Do this before despatching the day's batches, so stock comes off cleanly (otherwise it's
     caught up when the codes are verified).
- **Shelf counts** created for Sunday 18 Oct were left as they are; the team does them on the next
  working day.
- **Parked ideas** are in `HELM_IDEAS.md`. Fetching label files straight from HELM instead of
  uploading PDFs is "a great idea, needs proper testing": remind the owner before building it.
  Writing notes/returns to HELM waits until HELM is no longer read-only. HELM's own stock is out of
  date (the portal's is the accurate one), and the owner is sorting a bulk update in HELM.
- **The owner's wider goal:** the warehouse runs from phones; nothing gets missed; every order
  takes the right stock and gets the right stamp; anything uncertain waits for the right person.
