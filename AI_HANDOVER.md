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
2. **Never store customer personal data** from HELM: no names, addresses, phones or emails. (Since 14 Nov 2026 the owner
   allows ONE exception: the delivery **postcode**, in `helm_orders.postcode`, to price pallets for open orders.)
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


---

## Addendum — 13 Nov 2026, v2.77.0: pallet carriers and bulk orders (release 1 of 3)

- **Farrall's** (pallet carrier) lives in `settings.app_settings.palletCarriers.farralls`: `fuelPct`, `defaultService`,
  `sizes` (Quarter 250kg / Half 500kg / Full 1,250kg) and `bands` (id, areas, districts with ranges, rates per service as
  8 prices: Qtr, Half, Full, 2, 3, 4, 5 pallets, each-over-5; `null` = price on application). Dated in `cost_versions`
  kind `pallet`. Edited in Cost Settings → Pallet carriers (`PalletSettings` in `SettingsPage.jsx`, `palletChanges` in
  `costVersions.js`).
- **All costing is in the database** (migration 094): `postcode_parts`, `pallet_band`, `pallet_carrier_on`, `pallet_cost`
  (internal), `pallet_quote` (people who see costs), `parcels_cost` (internal; mirrors `parcelsCost()` in `calc.js`) and
  `bulk_ship_options` (anyone active; strips every £ unless `sees_costs()`). Warehouse-only users cannot read cost
  settings, so never move this to the browser.
- **Dispatch → ⋯ → Cheapest way to send** (`BulkShipCheck.jsx`): parcels vs pallet (+ one tracked parcel for
  marketplace orders), before a label exists.
- **The owner's decisions for releases 2 and 3** (not built yet):
  - Three kinds under Wholesale: **Stone & Surfaces** (drop-ship: they collect, no shipping cost; revenue from the price
    list in `Stone_Surface_Salt_Price_List.xlsx` — per bundle by bag size, count and white/brown, valid from Oct 2026;
    profit = price − product cost); **Bulk Orders** (an Amazon / eBay / TikTok order sent by Farrall's pallet with one
    DHL/Evri parcel for the tracking; linked to the HELM order by **channel order reference**, never the HELM id);
    **Salt 4 U Bulk Orders** (whole order by pallet, no parcel).
  - The one parcel label is uploaded to Dispatch as normal; the bulk order finds it by channel order reference.
    **Dispatch must not put that order on hold** for having 1 label for many units.
  - A **Bulk check on open orders**, before labels: flag orders cheaper by pallet. He has agreed that `helm-sync` may
    now **keep the delivery postcode** (this relaxes rule 2 for postcodes only; names, addresses, phones and emails are
    still dropped).
  - Costs, savings and profit only for people who see costs.
  - Farrall's bills Quarter / Half / Full by weight as above; usual service 24hr; fuel surcharge 18% (changeable).


## Addendum — 13 Nov 2026, v2.78.0: bulk orders (release 2 of 3)

- Built: `bulk_orders`, `bulk_order_money`, `wholesale_prices` and the functions in migration 095; `src/lib/bulkOrders.js`
  (the upload link — read its header), `BulkOrders.jsx` (`BulkOrderModal`, `BulkOrdersPanel`), the hook in
  `dispatchJobs.js` (before `planUpload`), `slip.bulk` skipping the label-hint check in `dispatch.js`, `carrier` added to
  `findExistingOrders`. `WholesaleOrders.jsx` now records each Stone & Surfaces order (`kind: 'stone'`) and its label
  maker draws Farrall's pallet labels too (`head`, `bigLabel`, `big`).
- The pallet label's order in Dispatch: carrier "Farrall's", tracking / slip id `PAL` + last 9 of the order number,
  `channel_ref` = the channel order number (same as the parcel label), `slip.wholesale` set (skips weight and count checks).
- **Release 3, still to build:** `helm-sync` keeps the delivery postcode (owner agreed) → a "Bulk check" of OPEN orders
  that would be cheaper by pallet, before any label; and the P&L takes a bulk order's delivery cost from
  `bulk_order_money` (instead of costing the HELM parcels) and Stone & Surfaces orders as the Wholesale channel.
- Things the owner should be asked: the Amazon order 206-4547069-2001937 (58 × Peacock 10kg, "AM96325") went through
  the GForce form — it is filed as Stone & Surfaces with no list price; "Unbranded Brown De-Icing Rock Salt 10kg" has
  no cost or weight on its product.


## Addendum — 14 Nov 2026, v2.79.0: bulk orders (release 3 of 3)

- `helm-sync` v10 (live, and in the repo): asks HELM for `shippingAddress` and saves only `shipping_address.address.postcode`
  through `helm_orders_set_postcodes()`; if HELM refuses the include (422) the run carries on without it. Tracking was
  checked after the deploy (500 of 500 labelled orders still had theirs). Labelled orders mostly come back without an
  address, so postcodes are there for OPEN orders — which is what the check needs.
- `bulk_check_open()` → Dispatch banner (`palletOpen` in `DispatchPage.jsx`) and `OpenCheck` in `BulkOrders.jsx`.
- Parcels are costed by the box: `units_per_box()` (25kg). `bulk_ship_options` and `bulk_order_cost` both use it.
- P&L: `report_pl_lines` returns `bulk` and Wholesale lines; `buildPnl({ bulk })` in `pnl.js` (`shipFrom: 'pallet'`,
  `wholesale: true`, `source: 'wholesale'`, `cogs_fixed`). The new P&L module (Option 2 as the base — see the handover
  note) must keep these when costing moves to the database.
- `helm-probe` (scratch slot) currently holds the address probe; safe to retire.
- Open with the owner: is the Stone & Surfaces price list ex VAT (assumed yes)? Did any parcel go with order
  206-4547069-2001937 (costed as all 58 on the pallet)? "Unbranded Brown De-Icing Rock Salt 10kg" has no cost or weight.
  Bulk orders are one product for now. The packaging review Excel, P&L design improvements (Option 2), Plenty answers
  and the items in the 13 Nov handover's "Waiting on Taimoor" are all still open.


## Addendum — 14 Nov 2026, v2.80.0: uploading a pallet price sheet

- `src/lib/palletSheet.js` rebuilds Farrall's table from the PDF's positioned text (`pdfItems()` in `pdfText.js`):
  `parsePalletSheet`, `parsePostcodes`, `bandFor` (mirrors `public.pallet_band`), `diffPalletSheets`. Tested on
  `tests/fixtures/farralls_oct_2026_items.json` — it reproduces the hand-loaded data exactly.
- UI: `PalletSettings` → `SheetReview` in `SettingsPage.jsx`. Admin only. It only edits the draft; the normal save asks
  the "applies from" date (today or earlier). A sheet that starts in the future should be uploaded on the day it starts.
- Confirmed by the owner on 14 Nov: DHL £4.59 first parcel + £3.00 each extra; DPD £5.10 for a single parcel, £3.50 for
  EVERY parcel when a consignment has two or more (rule `all`) — both already set that way. Stone & Surfaces prices are
  ex VAT. Order 206-4547069-2001937 went 1 bag by parcel + 57 by Farrall's pallet.


## Addendum — 14 Nov 2026, v2.81.0: eBay and TikTok reports in the sales ledger

- `src/lib/salesImport.js`: `readSalesReport(sheets)` picks the reader from the headers; `ebayTransactionsToLines`,
  `tiktokIncomeToLines`; `sheetRows(ws, XLSX.utils)` works out the real sheet size from its cells (TikTok's `<dimension>`
  is wrong). Tests: `tests/salesImport.test.mjs` (in `npm test`).
- Database (live): `sales_import_report(p_source, p_rows, p_by)` for `ebay_report` / `tiktok_report` (admin only);
  `sales_lines.source` check widened; view `sales_ledger` now prefers ANY report line over HELM's for the same channel +
  order ref, and takes fees as: Amazon and eBay ÷ 1.2 (their fees include VAT), TikTok as charged (owner to confirm
  whether TikTok's fees carry VAT). `item_code` holds the eBay item number / TikTok SKU ID; `listing_sku` is the eBay
  custom label (or item number) / TikTok SKU ID.
- eBay kinds: Order → sale; Refund, Claim, Payment dispute → refund; Other fee and the rest → charge (amount in
  `other_fees` and `total`); Payout, Hold, Charge, Transfer, Reserve, Withheld tax → transfer.
- Item codes: on 14 Nov about 290 eBay and TikTok codes (item numbers, custom labels, seller SKUs) were linked to
  products in `inv_channel_skus` (logged in `activity_log` and `inv_code_log`). 67 eBay listings were given SKUs equal to
  portal codes by file upload (File Exchange format: `*Action(...)`, `ItemID`, `CustomLabel`) — it works, and eBay's
  "deprecated policy" warnings changed nothing buyers see.
- Owner's decisions (14 Nov): every eBay sale includes 20% VAT; a P&L section per channel plus all channels; packaging
  for eBay/TikTok listings copied from the Amazon listing with the same contents; fee changes found in reports must
  update the Listings section and be logged (NOT built yet — do it with the Referral Fee Preview report); Salt 4 U takes
  payment through Stripe (he has no access to Stripe's balance report). Full list: project doc "Portal master plan".
- Next: product cost per order line from item codes (FIFO from 1 Aug: pre-live stock, then PO deliveries), eBay/TikTok
  listings in the Listings page, estimated fees for unsettled TikTok orders, listing fee sync.


## Addendum — 15 Nov 2026, v2.82.0: overheads with dates

- Tables `overheads` (name, category, note, start_date, end_date = last day charged, removed_at…), `overhead_amounts`
  (from_date, monthly; the earliest row is the starting amount; soft-removed with removed_at) and `overhead_log` (every
  change WITH amounts). RLS: select only for `can_open('overheads')`; all writes through functions (migration 104).
- `overheads_cost(from, to)` (internal) is the one sum everything uses: each day costs that day's monthly amount ÷ the
  days in its month. `overheads_list(from, to)` feeds the page; `overheads_for_pl(from, to)` gives the P&L a total and a
  split by category (sees_costs + Reports or Overheads page) — never names. `overhead_save`, `overhead_set_amount`,
  `overhead_remove_amount`, `overhead_end`, `overhead_remove`. `uk_today()` = today's date in London.
- `activity_log` gets a line per change with NO amount (it is read by everyone who sees costs; wages are in here).
- Frontend: `src/lib/overheads.js` mirrors the sum for the form previews (tests in `tests/overheads.test.mjs`, same
  cases as were run against the database); `OverheadsPage.jsx` loads itself; `loadOverheads()` in `db.js` now returns
  what is running today, for Build a Month. `ReportsPage.jsx` → `PnlView` calls `loadOverheadsForPl` (All channels only).
- The old undated list is still in `settings` key `overheads` (nine items), unused. Ask the owner before deleting it.
- Owner's decisions (15 Nov): overheads = fixed monthly costs only; part months by days; amounts ex VAT; the list
  starts empty and he adds each with its date; the new P&L screens are built from **Option 3** (control room in portal
  colours), not Option 2. STILL OPEN: how one-off costs, other running costs and equipment are recorded; quarterly lock.
- Also agreed 15 Nov for the costing release: Goods In refuses a put-away more than 10% over the PO unless an admin
  confirms; `cost_rebuild()` runs nightly and after every report upload; a listing cannot be approved while its product
  has no cost (17 small products have none, and none of them is on a listing today).


## Addendum — 15 Nov 2026, v2.82.1: overhead frequency, Gross / Net profit, overheads by day

- Migration 105: `overhead_amounts.monthly` renamed `amount`, new `every` (week | month | quarter | year) — the
  frequency belongs to the amount row, so it can change from a date. `overhead_day_cost(amount, every, day)` is the
  rule: week ÷ 7, month ÷ days in the month, quarter ÷ days in the calendar quarter, year ÷ days in the year.
  `overheads_daily(from, to)` (internal) gives every overhead's cost per day; `overheads_cost` sums it;
  `overheads_for_pl` now also returns `by_day`. `overhead_amount_on` replaces `overhead_rate_on`.
  `overhead_set_amount(p_id, p_from, p_monthly, p_every default null)` — `p_monthly` is the amount for the frequency
  (name kept from v2.82.0); null frequency keeps the current one. `monthly_now` in the list is the average month.
- `src/lib/overheads.js` mirrors it (`dayCost`, `amountOn`, `monthlyEquivalent`, `FREQUENCIES`); tests use the same
  cases as were run against the database.
- **Terms the owner set for the P&L module (use accounting terms wherever possible):** Gross profit = sales less cost
  of sales (refunds, fees, Amazon's other charges and credits incl. cashback, product cost, shipping, packaging);
  Net profit = gross profit less fixed overheads. Never "profit before / after overheads".
- `ReportsPage.jsx` → `PnlView`: `shown` adds `overheads` and `net` to Day and Month rows from `by_day`, and adds a
  row for a day / month that has overheads but no sales. Row gross profit still excludes Amazon's other charges
  (they are only in the totals) — the footnote says so.
- v2.82.2: the owner confirmed "Sales ex VAT" → **Revenue** (ex VAT) and "Product cost" → **Cost of goods sold** in Reports. Use these in every new P&L screen.
- v2.82.3: the card that groups refunds, fees, other charges, cost of goods sold, shipping and packaging is called
  **Direct costs** (the owner agreed, 15 Nov) — not "Cost of sales". Gross profit = Revenue − Direct costs.
- v2.82.4: `OverheadsPage.jsx` redesigned after the owner called the first version "extremely basic": blue hero with
  the month, six-month bars (worked out in the browser with `costBetween`; the month shown uses the database total),
  `Tile` panels, `FreqTag`, fixed column widths, no blank columns. The word on screen is **Active**, never "Running"
  (the database status is still `running`). New screens in this module should start from this look, not plain
  MetricCards and a bare table.


## Addendum — 15 Nov 2026, v2.83.0: real cost of goods sold in the P&L (part 1 of the costing release)

- Read `supabase/migrations/106_…` and `107_…` (summaries; the functions are live). `report_pl_lines` returns
  `lines[].cogs_real`, `cost_other` and `costed_at`; `buildPnl` uses `cogs_real` when present (`cogsFrom: 'fifo'`) and
  the old PO-price working otherwise; `groupPnl().cogsCurrent` now counts sale lines NOT costed by the costing.
- `PnlView`: Replacements (and losses from 1 Dec) come off Gross profit, in the totals only (like Amazon's other
  charges); the "Not in the P&L" block shows returned to supplier, start-up differences and losses before 1 Dec.
- `refreshCosting()` (`cost_refresh` RPC, admins) runs after a report import; pg_cron `cost-rebuild-nightly` at 02:30.
- Known gap to look at next: about 330 sale lines since 1 Aug (325 Amazon, 5 eBay) get no `cogs_real` — find out why
  (order refs that differ between the ledger and the despatch movement, products the costing skips, or lines it could
  not match) before trusting per-listing figures to the penny.
- Not done yet from the agreed release: stock value at a date + pre-live section, per-channel tabs, Goods In cases /
  units wording and the 10% guard, costSource / barcodeSource on the product page, no approval without a cost,
  migration summary files 100–103 and the doc-text function in the repo.
- The Artmix 12 x 600ml product cost in the portal is still £9.98 (he pays £8.98 by the pallet): change it on the
  product page, not in the database, so listings follow.

- v2.83.1: `StockView` in `ReportsPage.jsx` (tab "Stock value") reads `report_stock(date)`; see migration 108. The
  "about 330 lines not costed" gap is closed (see 108) — what is left is recent undespatched orders and one eBay line
  (item 366734463018). `PnlView` totals now start from zeros (an empty period used to crash the page).
  Cost of goods sold since 1 Aug after all of 15 Nov's changes: £54,389 (Aug £4,231, Sep £10,289, Oct £26,554,
  Nov to the 14th £13,315); stock on hand £79,327.24; pre-live stock £34,503.07 in, £8,289.01 sold, £23,589.71 left.
- v2.83.2: channel tabs in `PnlView`; `caseSize` / `countWord` / `farOver` in `lib/goodsIn.js` used by `ReceiveSheet`
  (GoodsInPage) and a matching check in `PutAwaySheet` — both in the browser only: `inv_put_away` and the booking RPC
  do NOT enforce the 10% rule yet. `handleApproveReview` refuses a listing with a no-cost product. `ProductPage` shows
  `costSource` / `barcodeSource`. Not checked: whether warehouse logins receive `data.packUnits` on PO lines (if not,
  the box says "units" and the 10% check still applies to the number typed).


## Addendum — 15 Nov 2026, v2.84.0: the Finance section and the new Profit & Loss screen

- **Sidebar:** "Planning" → **Finance**, every page `adminOnly` in `src/lib/access.js`: `pnl` (Profit & Loss), `sales`,
  `stock-value`, `overheads`, `uploads`. `reports` and `buildmonth` are no longer pages; `REDIRECTS` in `App.jsx` sends
  both to `pnl`. Nobody but admins had `reports` / `overheads` ticked. The database still checks `can_open('reports')`
  / `can_open('overheads')` in `report_stock`, `overheads_for_pl` and the overheads functions — admins pass every
  `can_open`, so nothing was changed there. `report_sales` and `report_pl_lines` still only ask for an active user
  (costs need `sees_costs()`): the pages are admin-only, the two functions are not. Ask the owner before tightening.
- **Files:** `ReportsPage.jsx` is gone. `PnlPage.jsx` (new screen), `SalesPage.jsx` (was SalesView), `StockValuePage.jsx`
  (was StockView), `UploadsPage.jsx` (was ImportView, plus the log), `FinanceParts.jsx` (money, dayName, CHANNELS,
  chargesOf, `Tile`). `lib/pnlScreen.js` is the screen's sums, with tests in `tests/pnlScreen.test.mjs`.
- **How the screen gets its figures** (nothing is costed differently from v2.83): ONE load per period and channel —
  `report_pl_lines` + `buildPnl` for every line, `report_pl_days` (new) for what sits outside any one order BY DAY
  (charges by channel, replacements, losses from 1 Dec, and `outside` = returned to supplier / start-up differences /
  losses before 1 Dec), `overheads_for_pl().by_day`. `spanFor()` says which dates the load must cover (the period,
  the one before, the chart, the 7 days before and the month to date); `summarise(ctx, from, to)` adds up any run of
  days; `byDay` / `byWeek` feed the chart. `report_pl_days` adds up to `report_pl_lines`' own `amazon_charges` and
  `cost_other` (checked for 1 Aug – 14 Nov).
- **Comparison rule (the owner, 15 Nov):** each period against the one before — `periodRange()`. A running period is
  compared with the same days of the one before; nothing is compared with dates before 1 Aug 2026 (`START`).
- **Break-even** = the period's overheads ÷ its gross margin, so "cleared" always agrees with the sign of net profit.
- **Headline:** Net profit when overheads apply (All channels, at least one overhead set up); Gross profit for a
  single channel.
- **Breakdown table:** Day / Month rows include their share of charges, replacements and overheads (column "Other"),
  so they add up to the totals. Listing rows carry a state (`stateOf`) and chips filter them.
- **Uploads log:** table `report_uploads` (RLS: admins read; written only by `report_upload_log()`), read with
  `report_uploads_list()`, which also gives each channel's latest report date. `UploadsPage` logs after each import.
- **Build a Month:** off the menu and no longer rendered or loaded (`loadMonths` / `loadOverheads` are not called at
  start-up). `BuildMonthPage.jsx`, the month handlers in `App.jsx`, `loadOverheads()` / `runningForPlan` and the
  `months` table are still there — the owner wants the code deleted a release or two later.
- **Timings as a signed-in admin** (8-second limit): `report_pl_lines` 0.9 s for 1–14 Nov, 1.4 s for 1 Aug – 14 Nov
  (5 MB); `report_pl_days` under 50 ms; `report_uploads_list` 12 ms; `report_stock` 0.5 s.
- **Not built, agreed for later:** the optional target (how it is set is not decided: ask), "what if" inside Profit &
  Loss, Other costs (one-offs, equipment), Month close (the quarterly lock), replacements split by channel.
- **Not tested:** signed in on the live portal with real data. It was run in a browser against made-up data shaped
  like the database's.


## Addendum — 15 Nov 2026 (evening), v2.85.0: the owner's feedback on Finance

- **Open orders (migration 110, `report_pl_open(p_channel)`):** the orders open in HELM right now (`closed_at is null
  and labelled_at is null and status <> 8`, with money) as lines in `report_pl_lines`' shape, dated today, `open: true`,
  `fee_estimated: true`, `cogs_real: null`. Money is worked out as `sales_refresh_helm` does. `PnlPage` and `SalesPage`
  add them to the lines whenever the dates reach today, so `buildPnl` costs them like any uncosted line (latest PO
  price, the listing's shipping and packaging). When an order is labelled it leaves this list and reaches the sales
  ledger on its despatch day — never both. `summarise()` gives `openOrders` / `openSales`. 447 ms as a signed-in admin
  with 369 open orders.
- **A "day" is still the despatch day.** The owner asked for orders "received" in a period; the Orders card counts
  the orders in the P&L (despatched in the period, plus those open today). Order date is not used anywhere yet.
- **Profit split:** `SPLIT` in `lib/pnlScreen.js` (Adrian Marsh 33%, "Our share" 67%). All channels only. A net loss
  shows the same shares, headed "Net loss, split" — whether a loss is shared is NOT agreed; ask before relying on it.
  Never name Homey: the second party is "Our share" until the owner gives a name.
- **Statement:** `% of revenue`, the amount before, and the % change in the amount (`Change`). Revenue and profit are
  green when up; a cost is coloured by its SHARE of revenue (red when it took more of each pound). Where a percentage
  means nothing (from zero or from a loss) the change is in pounds.
- **Shared Finance pieces** (`FinanceParts.jsx`): `ChannelTabs`, `PeriodPicker`, `Bars` (hover caption, click to open
  the day or week), `Delta`, `ChangeChip`, `NameLink` (a listing's or product's FULL name, opening it in place — use
  it instead of the truncating link chips in any Finance list), `spanText`, `longDay`.
- **By product:** `productShares()` / `groupByProduct()` in `lib/pnlScreen.js`; a bundle's line is shared between its
  products by cost (qty × cost price), equally when none has a cost.
- **Sales page:** `lib/salesScreen.js` (`salesTotals`, `salesGroups`, `salesByDay`, `movers`). It reads
  `report_pl_lines` + `report_pl_open`, not `report_sales` (which nothing in the app calls any more; `loadSalesReport`
  is still in `db.js`).
- **Shipping template / Prime (asked, not built):** HELM's order has no template or Prime flag (checked the stored
  order shape in `helm_probe_results`: only `preferred_courier_service`). Needs Amazon's order report as an upload, or
  the SP-API keys.
- **Still open with the owner:** the target; the name for his side of the split; whether a loss is split; whether
  orders should also be counted by order date; lock `report_sales` / `report_pl_lines` to admins.

## Addendum — 15 Nov 2026 (night), v2.86.0: HELM's order tags, Prime against not Prime

The owner now tags every Prime order "Prime" in HELM (other tags exist too, e.g. "PRIME - Dispatched", "Label Created
from Amazon (Prime Order)", "Already Dispatched"). He asked to see order tags in the portal.

**HELM's API.** `GET /orders?includes=tags.tag` gives `order.tags = [{ id, tag_id, tag: { id, name } }]`. Other
spellings (`tags`, `orderTags`, `labels`) return 422. `GET /orders/tags` lists every tag.

**Database (migration 111).** `helm_orders.tags text[]` — null = never read, {} = read, none. `helm_orders_set_tags(jsonb)`
(service role) writes only where changed. `report_order_tags(from, to, channel)` (admins) →
`{ tagged: { order ref: [tags] }, known_from, names }`; `known_from` is the first despatch day on which any order
carried a tag. `report_pl_open` lines now carry `tags`. Timed as a signed-in admin: 34 ms and 0.6 s.

**Job.** `supabase/functions/helm-tags` (deployed, `verify_jwt: false`, `x-notify-key`), cron `helm-tags` every 5
minutes: open orders (every status before the label) + labelled orders of the last 36 hours, tags only — about 8
seconds. `{ "backfill_days": 14 }` reaches further back, by hand. **helm-sync was not touched** (still v10): Dispatch
depends on it every minute, so tags got a job of their own. A probe function `helm-probe` is also deployed (not in
this repo; it only reads HELM and writes `helm_probe_results`).

**Screen.** `lib/pnlScreen.js`: `attachTags(lines, info)`, `isPrime(tags)` (any tag with the word "prime"),
`tagLabel`, `groupByTag`, `primeSplit`. A line's `tags` is an array, or null = not known (despatched before
`known_from`, or never in HELM). `PnlPage`: `PrimeTile` on the Amazon tab, Prime counts on the Orders card, "Tag" in
the breakdown, `TagChip` in the losing-orders drawer. `SalesPage`: Prime counts on the Orders card (Amazon), "Tag" in
the table (no "before" column there — earlier periods have no tags). A failed tags call never stops either page.

**Confirmed by the owner (15 Nov):** "Our share" is the right name; a net loss is split 33 / 67 like a profit; orders
are counted on their despatch day only (plus open orders with today) — no second count by order date.

**Tested:** 166 automated tests; both pages in a browser with made-up data (desktop and phone width); the job and the
database functions against the live HELM and database. **Not tested:** the screens signed in on the live portal. On
15 Nov only 13 open Amazon orders carried "Prime" and no tagged order had been despatched yet, so despatched days
show "Not known" until tagged orders start going out.

## Addendum — 15 Nov 2026 (late), v2.86.1: wording, product names on losing orders; a shipping fault found, NOT fixed

Built (screen only, no figures changed): `orderProducts(order, stockItems)` in `lib/pnlScreen.js` (each order now
carries `items`) → product names in full in "Orders that lost money" and its CSV; the comparison column is headed with
the dates compared (`spanText(range.prev.from, range.prev.to)`) instead of "Before" on Profit & Loss and Sales;
"units an order" on the Orders card.

**Found, waiting for the owner's yes before fixing (it changes figures):** `report_pl_lines` counts EVERY row of
`helm_parcels` as a parcel, including label attempts that never became a label (`shipment_status = 2`, no tracking
number, no events). Orders 026-7048998-6620305 and 206-7447066-2115562 (1 × Peacock Salt 25KG, DHL) each have one
failed attempt and one real label, so they were costed as two DHL parcels: £4.59 + £3.00 = £7.59 instead of £4.59.
Since 9 Oct: 116 orders have a real label plus failed attempts (335 extra "parcels": DHL 49 orders / 200, Hermes 48
63 / 131, Evri Next Day 4 / 4), and 96 orders have only failed attempts (86 Evri Next Day — the label was probably
bought elsewhere, e.g. from Amazon). Proposed fix: count only rows with a tracking number; an order left with none
uses the listing's own shipping, marked estimated.

**Proposed, not built:** Prime in Dispatch — see the project doc "Prime in Dispatch — proposal (15 Nov)".

## Addendum — 16 Nov 2026, v2.87.0: Prime orders in Dispatch

**Why.** The owner needs a Prime order to be plain to see and handled first. He tagged Prime orders in HELM (HELM
adds the tag itself as the order arrives), then asked for: a mark on the label, "PRIME" on the header pages, Prime in
its own batch even from a mixed file, a mark on the Dispatch screens, HELM to win over what was uploaded, and
NOTHING ELSE in Dispatch to change — it is used by several people all day and cannot break.

**Decided by the owner.** Evri label = full "PRIME" bar; DHL = "P" box (tried on real labels: the bar runs into the
depot name on DHL); header pages = full "PRIME"; a mixed file = two batch numbers, Prime first; Amazon's own Prime
badge on a Buy Shipping slip is NOT read (HELM + the tick are enough, so file reading was not touched).

**How it works.**
- Database (migration 112, additive): `prime boolean default false` on `dispatch_labels`, `dispatch_batches`,
  `dispatch_uploads`; `dispatch_labels.prime_source` (helm | upload | both). `tags_prime(text[])`: any tag with the
  word "prime". `dispatch_prime_orders(p_refs, p_postcodes)` → `{ refs, postcodes }` HELM has tagged Prime (postcodes
  only for labels with no order number, and only when exactly one HELM order is at that postcode).
  `dispatch_follow_helm_prime()` + cron `dispatch-prime-follow` (every 5 min): a label still to go whose HELM order is
  Prime is marked Prime — only the two Prime columns change, so the status triggers (stock, cancel guard) don't fire.
- `lib/dispatch.js`: `primeOf(order, prime)`, `splitPrime(batches, held)`; `planUpload(..., { prime })` marks orders
  AFTER every check (`o.prime`, `o.primeSource`); `buildBatches` adds `|PRIME` to a Prime order's group key and
  `prime: true` to the group. With `prime` null, or nothing Prime, the objects are exactly what they were.
- `lib/db.js`: `loadPrimeOrders`; `saveDispatchUpload` stores the file once, then `insertBatch` for each part of
  `splitPrime` (Prime first) and `afterBatchSaved` (units, older held copies, ClickUp) once every part is in. All or
  nothing across both. Result: `{ upload, batches, uploads, label? }` — `label` ("B7 PRIME and B8") only when Prime.
- `lib/dispatchJobs.js`: the lookup runs beside the others; a failure → nothing Prime, `prime.checked = false`.
  `meta.prime` = the tick.
- `lib/dispatchPdf.js`: `drawStamp` draws the mark when `label.prime || batch.prime`; `drawCover` / `drawBatchSummary`
  draw `primeBox`. Otherwise untouched.
- `DispatchPage.jsx`: `PrimeChip`, `PrimeTick`; files sorted Prime first; `nextToPrint` prefers Prime; CloseDay's
  `primeToPrint` / `primeLeft` warning.

**Tested (16 Nov).**
- 172 automated tests (5 new in `tests/dispatchPrime.test.mjs`, the first being "with nothing Prime, an upload plans
  exactly as it did before"); the 125 existing calc/Dispatch tests untouched and passing.
- Print check: the same file printed with v2.86.1's `dispatchPdf.js` and the new one is byte-for-byte identical when
  nothing is Prime (whole batch and reprints). Prime output looked at page by page.
- Save check: the same plan saved with v2.86.1's `db.js` and the new one against a recording stand-in for the
  database makes exactly the same 8 calls when nothing is Prime; a mixed file saves as B1 PRIME + B2 with the file
  stored once; a failure in the second batch removes both and sends no message.
- The real Dispatch page in a browser with made-up batches: day list, batch drawer, upload drawer, review screen, the
  tick, an automatic save, HELM unreachable. No page errors.
- Database: the lookup takes 0.14 s as a signed-in user; inserts with the new columns tried and rolled back.
- **Not tested:** a real upload on the live portal, and real labels through the real printer with the new code (the
  mark's position was tried on copies of real labels beforehand, with the same drawing code).

**Known limits.**
- A Prime label released from On hold joins a batch by the existing release rules, so it can sit in a normal batch.
  It keeps its PRIME mark on the label and on screen.
- No chip yet on: the Orders tab, Post Dispatch, the Print Station list, ⌘K. The printed pages carry it.
- DPD: no DPD label has ever gone through the portal; it would be stamped like Evri. Needs a sample.
- Full-page Amazon Buy Shipping files (label and slip on ONE 612×792 page): the slip is not removed and the stamp
  lands between slip and label. The owner wants this fixed as the next, separate step.

**Then: the costing audit** the owner ordered (see the project doc "Prime in Dispatch — proposal (15 Nov)").

## Addendum — 16 Nov 2026, v2.88.0: full-page Amazon Buy Shipping files

**What the files are (measured on the real ones).** A label bought in Seller Central (Amazon Buy Shipping) is two
PICTURES, no words: the Evri label at 1216x1824 and Amazon's packing slip at 812x1218.
- Saved as 6x4: two pages — page 1 the label, page 2 the slip. The portal reads page 1 as an Evri label with no
  packing slip (the office says what it is) and page 2 as a second "label" it can't recognise, which is held and
  cancelled by hand. **This build does not change that.**
- Saved as a full sheet (612x792): ONE page, both pictures lying a quarter turn anti-clockwise — label at
  matrix [0,252,-378,0,465.5,108] (x 87.5–465.5, y 108–360), slip at [0,288,-432,0,523.1,432]. Until now the whole
  sheet was the label: carrier not read, the slip printed with it, the stamp between the two (lineY ~355). 3 such
  labels so far, all 13 Nov.

**The fix (`lib/dispatchPdf.js`).** `twoPictures(pdfjs, page)` — only called for a page with no words that is wider
and taller than 500 pt — finds exactly two pictures lying that way and takes the bigger as the label (must be 6x4
shaped). `readAmazonSheet` cuts the label out upright (`cutUpright`) and reads it with the unchanged
`readPictureLabel`; sets `page.stamp = { lineY (measured on the label as a 6x4), crop: { left, bottom, right, top,
turn: -90 } }`; then reads the slip twice (as is, and 1.5x) and sets `page.slipRef` only if both give the same single
`ddd-ddddddd-ddddddd`. If the label isn't recognised, everything is put back and the sheet is read as before.
`buildPrintFile`: a label with `stamp.crop` is not copied as a page — `embedPage` with that box, drawn by
`sheetLabel` on a new 288x432 page, then stamped as any upright label.
`lib/dispatch.js`: the label carries `slipRef`; `manualSlip` uses it as `channelRef` unless the person gives an
order; `primeOf` and the Prime lookup include it.

**Tested.** 173 automated tests. Test files built with the real files' exact picture sizes and positions, read in a
real browser with the real text recognition by v2.87.0's code and the new code: the 6x4 two-page file is read
identically by both; the full sheet goes from "nothing read, stamp mid-sheet" to Evri / Next Day / postcode / order
number / stamp under the line. Printed and looked at. Ordinary labels still print byte-for-byte as v2.86.1.
On the three REAL sheets (in the owner's browser, same cutting and reading steps): label recognised on all three,
order number read on all three with both readings agreeing — one of them matching the number already on record.
**Not tested:** a real sheet uploaded through the live portal with this version.

**Not done, worth doing next (told to the owner):** the 6x4 two-page Buy Shipping files still need the office to say
what the parcel is and to cancel the slip page. The same slip reading would give the order number, and HELM's own
record of that order would give the products — so they could go through with no hand work.

## Addendum — 16 Nov 2026, v2.89.0: Amazon's own packing slip is read

**Why.** A label bought in Seller Central (Amazon Buy Shipping) comes with Amazon's packing slip. The portal took
the label as "no packing slip" (the office picked the product by hand) and the slip page as a second label it could
not recognise (held, then cancelled by hand, every time). The owner agreed the chain below.

**The slip** is a picture (812x1218): Order ID (with a Prime badge on Prime orders — NOT used), ship-to, and for each
line the quantity, title, price, SKU (the listing SKU), ASIN, listing ID, order item ID. Text recognition gets it
mostly right but not always: a digit of an order number was once read wrongly, ASINs come out with O for 0, long SKUs
are cut at a hyphen. So: everything is read twice at two sizes, and an order number is only ever kept once something
else has confirmed it.

**How it works.**
- `lib/dispatchPdf.js`: `readAmazonSlip(canvas)` → `{ ref (both readings agree, else ''), seen, lines: [{qty, sku,
  asin}], sure }`. `amazonSlipPage` marks a standalone slip page (`page.amazonSlip`) — only looked at when the words
  already read say "ship to / order id / thank you for buying". On a full sheet the label page carries `page.amazon`.
- `lib/dispatch.js`: `looksAmazonSlip`, `parseAmazonSlip` (tested on the words as they really come out);
  `pageKind` → `'amazon-slip'`; `pairPages` gives it to the label before it (`label.amazon`, with `slipPage`) and
  never makes a label of it; `amazonAsks(orders)`; `applyAmazon(orders, found)`:
  HELM has it → `order.slip = { amazon: true, from: 'helm', channelRef, items }` and `label.slipRef`;
  only the listing → `order.suggest = { ref, items, lines }`; neither → the same object back.
  `manualSlip`: `channelRef = originalRef || amazonRef || label.slipRef`.
- `lib/dispatchJobs.js`: asks `loadAmazonOrders(asks)` right after pairing; any failure → labels with no slip, as before.
- Database (migration 113, read-only): `dispatch_amazon_orders(p)` → `{ ref: { helm, listing } }`. Listing = the
  portal's `saved_products` by ASIN (0/O alike; `listingSku` only to choose between listings of one ASIN that hold
  different products) → `components` × quantity → `inv_products.code` by `stock_item_id`. Every line must resolve to
  one set of products. 67 ms as a signed-in user.
- `DispatchPage.jsx` `ManualLabels`: the suggestion with **Confirm**; the order number read (or the two readings).

**Tested.** 175 automated tests (the slip reader on real recognition output, pairing, the three-step chain).
Test files with the real files' exact layout read in a real browser with real text recognition: the two-page file
goes from "a label and a page nobody recognises" to one order carrying the slip's order number, quantity and ASIN;
the full sheet the same. The review screen with made-up orders: suggestion, Confirm, save — the order number is kept
for both the HELM one and the confirmed one. The database lookup with real orders and listings: HELM order found;
listings found by ASIN including a misread one; a two-line order; an unknown ASIN → nothing. Ordinary labels still
print byte-for-byte and ordinary uploads still save with the same calls.
**Not tested:** a real Buy Shipping file uploaded through the live portal with this version.

**Limits.** The Prime badge on the slip is not read (HELM's tag decides). Buy Shipping DHL labels have not been seen.
A listing with a product that has no inventory product gives no suggestion.

## Addendum — 16 Nov 2026 (early morning), v2.90.0: costing put right, part 1

**Read `docs/COSTING_SCENARIOS.md` first.** It is the register of every costing scenario found in the deep dive of
15–16 Nov, the owner's decisions, and THE FIX LIST (24 items, agreed by the owner on 16 Nov). Keep adding to it; it
ships in every zip. The owner's rule: nothing in costing is fixed silently, and nothing is guessed.

**Done in v2.90.0**
- Migration 114 — `report_pl_lines` counts only HELM parcels with a tracking number (a voided label only if it moved).
- Migration 115 — `cost_rebuild` takes each order's despatch movements net of its `despatch_undo` movements (grouped by
  `inv_movements.order_key`); the "despatch undone" layer is gone. The old function text is in `public.fn_backups`.
  After the rebuild: sale units 23,173 → 23,166, replacements 390 → 389.
- Migration 116 — `ledger_charge_net(channel, description, total)`: eBay charges and Amazon "Service Fee" lines / 1.2;
  used by `report_pl_days` and `report_pl_lines`.
- Migration 117 — `fee_categories` (a copy of `src/lib/feeSchedule.js`), `fee_referral`, `listing_fee_pct`;
  `report_pl_open` uses `listing_fee_pct(s.data)`. `tests/feeSchedule.test.mjs` fails if the two schedules drift.
  **Still to do:** `sales_refresh_helm` also estimates fees from `data->>'refFee'` — patch it the same way (its body is
  only in the database; read it first).
- `PickList.jsx` `SubstituteModal`: a ratio other than 1 needs a tick against the totals (`sureFor` holds exactly what
  was ticked, so any change unticks). `BulkOrders.jsx` `BulkOrderModal`: a warning + tick when units or product differ
  from HELM's single item. Both tested in a real browser against a mock database.
- 15 listing fees corrected in `saved_products` (activity log: "Fee corrected", source `fees`).

**NOT done — waiting for the owner**
- `supabase/corrections/2026-11-16_order_corrections.sql` (glue 16 → 4, salt 58 → 30, TidyZ ×3). The database tool asked
  the owner to confirm the block and timed out while he slept. Do NOT split it up or re-word it to get round the
  question: run it again when he is there to answer, then `select public.cost_rebuild();` and show him before/after.
  Expected stock afterwards: Multipurpose Glue 449 → 461, Peacock Salt 10kg 1,841 → 1,871, TidyZ Handy Bags 666 → 630.
- Product costs: Plenty FlexiSheets 12 Rolls → £14.79; Harpic Power Plus Max 10 Original and Citrus → £1.04 with a
  case size of 12 on PO-HI-20261111-002's lines (owner confirmed both). Daler-Rowney: a pallet discount of 10% from
  13 Oct 2026 — stock received from then should be costed 10% under the invoice price (Artmix already has its rule).

**The rest of the fix list, in the agreed order** (A, B, C first; then D; then E; F alongside)
- A6 pair the 165 hand-made ("manual") labels with their orders; B9 shipping from the portal's own label when HELM has
  none (Buy Shipping = our Evri rates); B10 multi-unit orders before 19 Oct estimated from how the listing really ships;
  B11 only a declared replacement is a replacement, a top-up belongs to its order (units and postage), a parcel with
  no order can also be a "manual order" with details (samples); B14 "last price paid" by the latest PO date; B15
  carrier invoices with extras as their own line.
- C18 labels with no packing slip: suggest the open HELM order by postcode, warn on a mismatch; C19 a PO or price-list
  price far from the product's cost stops and asks "is this a case price?".
- D20 Finance → Checks (5p or 1% tolerance, agreed); D21 the order audit shows everything about an order.
- E22 eBay and TikTok listings built and linked — the owner: "EXTREMELY careful … with the correct packaging selected".
  Propose them for his review; do not create them unreviewed. E23 listing fees follow the reports.
- F24 Inventory: changes in tabs (stock in, moves, despatches, counts and corrections) with "View more".

**How the owner wants it delivered:** build in stages, each a complete zip; he deploys only the latest. Database-only
fixes to figures may go live as they are built; nothing that changes a Dispatch screen is live until he deploys.

## Addendum — 16 Nov 2026 (early morning), v2.91.0: costing put right, part 2

Built while the owner slept (he asked for the build to carry on stage by stage). Nothing here needed his approval;
the record corrections of v2.90.0 are STILL waiting for him (see the v2.90.0 addendum — do not work round the
database's question).

**Database (live)**
- 118 — `sales_refresh_helm` uses `listing_fee_pct(s.data)`.
- 119 — `report_pl_ship(p_from, p_to, p_channel)` → `{ extra_labels, weights, ship_patterns }`. LESSON: these were first
  added to `report_pl_lines` and made it take 45s instead of 3s (signed-in users are cut off at 8s). It was rolled back
  within minutes from `fn_backups` and rebuilt as its own function with MATERIALIZED steps (1.9s for the whole period).
  Always time a changed report function as a signed-in admin before leaving it live:
  `with s as (select set_config('request.jwt.claims', '{"sub":"<admin id>","role":"authenticated"}', true) a) select …, clock_timestamp() - statement_timestamp() from s, …`
  (a single statement — a DO block makes the database tool ask the owner to confirm).
- 120 — `report_checks(p_from)` (admins; ~1s). Ten checks; see `supabase/migrations/120_report_checks.sql` for the list.

**App**
- `src/lib/pnl.js` `buildPnl({ …, ship })`: portal labels beyond HELM's count as parcels (carrier by name, "Standard" =
  48 hour); an order with no listing takes its weight from `ship.weights`; one line of several units with no label uses
  `ship.ship_patterns["listingId|qty"]`. With `ship` absent every figure is exactly as before (`tests/pnlShip.test.mjs`).
  `PnlPage` loads `loadPlShip` alongside the rest and ignores a failure.
- `InventoryPage.jsx` `ChangesPanel` (tabs + View more) replaces the two "Recent changes" lists; `loadMovements` takes
  `offset`. `HistoryView` pages 300 at a time.
- `ChecksPage.jsx` + nav item `checks` (Finance, admins) + `loadChecks`.

**Tested:** 183 unit tests; the Changes panel and the Checks page in a real browser against a mock database;
`report_pl_ship` and `report_checks` run as a signed-in admin against the live database with timings.
**Not tested:** the new screens against the live database in a browser; the Inventory drawers end to end (the panel
was tested on its own).

**Found on the way, parked in docs/COSTING_SCENARIOS.md:** the postage of a replacement parcel is not costed anywhere;
283 older multi-unit orders have no shipping pattern; 9 labels voided in HELM (2 of them moved).

**Next (stage 3):** D21 order audit showing everything; C18 labels with no packing slip (suggest the HELM order, warn,
or declare a replacement / manual order); C19 case-price stop on POs and price lists; B14 last price paid by date; the
dated per-order cost check; then eBay and TikTok listings as a PROPOSAL for the owner's review.

## Addendum — 16 Nov 2026 (early morning), v2.92.0: costing put right, part 3

Built while the owner slept. Nothing needed his approval. STILL WAITING FOR HIM: the record corrections
(`supabase/corrections/2026-11-16_order_corrections.sql`), the product cost corrections (FlexiSheets 12 Rolls, Harpic,
Daler-Rowney 10% from 13 Oct), and his review of the eBay/TikTok proposal. Do not work round the database's question.

- **Order audit** — `order_audit_more` (migration 121) + `OrderAuditPage.jsx`: `more` is loaded beside `d` and never
  stops the page. New cards (`data-audit-stock`, `-other`, `-money`, `-log`) and timeline entries. Money only when
  `sees_costs()`.
- **Case-price stop** — `PoBuilder.jsx` `priceJump(i)`: price for one (unit_cost ÷ packUnits) against the product's
  cost; ratio ≥ 2 or ≤ 0.5 blocks sending until packUnits is set or `data.priceConfirmed` is ticked. NOT covered: a
  price changed later in `PurchaseOrderDrawer`, a supplier price-list import, and there is no guard in the database
  (`item_learn`, migration 052, still applies whatever a sent PO says). A database guard should come with the owner
  aware of it, because it changes what happens when an order is sent.
- **B14** — nothing to fix: `item_learn` already takes the last PO by `created_at`.
- **eBay/TikTok proposal** — `report_channel_listing_proposals` (migration 122), shown at the bottom of Finance →
  Checks (`ListingProposals` in `ChecksPage.jsx`), loaded only when asked for. `docs/EBAY_TIKTOK_LISTINGS_PROPOSAL.md`
  has the seven decisions. `sales_ledger` is a VIEW — never count over it row by row.
- **Plan, not built** — `docs/NO_SLIP_LABELS_PLAN.md` (fix list item 18).

**Tested:** 183 unit tests; order audit, PO builder and the proposal section in a real browser against a mock database;
`order_audit_more` and `report_channel_listing_proposals` run as a signed-in admin with timings (0.1s, 1.2s).
**Not tested:** any of the new screens in a browser against the live database.

**What is left on the fix list:** 1, 3, 4, 5 (corrections — waiting for the owner) · 6 pairing the hand-made labels ·
11 replacements / top-ups / manual orders in the costing · 15 carrier invoices · 18 labels with no slip (planned) ·
19 the rest of the case-price stop (drawer, price lists, database) · 20 the dated per-order cost check, the daily run,
the ClickUp alert and the count on the P&L · 22 creating the listings after his review.

## Addendum — 16 Nov 2026, 11:20: the corrections are done

The owner approved the database's question and `supabase/corrections/2026-11-16_order_corrections.sql` was run, then
`cost_rebuild()`. Results are in docs/COSTING_SCENARIOS.md ("the owner approved the record corrections"). Harpic's case
size (12) was put on PO-HI-20261111-002 and the cost corrected itself to £1.0408. Still open in fix list item 5:
Plenty FlexiSheets 12 Rolls → £14.79 (he is verifying the order) and Daler-Rowney's 10% pallet discount from 13 Oct.
These notes are newer than the v2.92.0 zip; they go into the next one.

## Addendum — 16 Nov 2026 (midday), v2.93.0: the P&L screen as the owner asked

**What changed (screen only — no profit total moves):** see CHANGELOG v2.93.0. In short: Orders and units at equal
size; Channels card at the top in place of Break-even (which moved to the lower row); Gross profit and Revenue swapped;
a boxed date label on the big card and a bar that stays at the top when scrolled (`data-sticky-bar`, shown by an
IntersectionObserver on the big card, `sticky top-14 lg:top-0`); gross cards in a different colour (`Tile tone="gross"`,
`GROSS_HERO` in FinanceParts.jsx — net is royal-500, gross is ink); an "All time" period (`periodRange('all')`: START to
yesterday, no comparison); lines that open (`StatementRow` takes `r.detail = [{ name, v }]`).

**Losing money and cashback.** `report_pl_ship` (migration 123) returns `order_cashback` { order → amount } — ONLY the
"Incentive disbursement" lines — and `charge_days`. `summarise(ctx)` reads `ctx.orderCashback`; each order gets
`credit`, `before` (on its own) and `profit` (= before + credit); `t.losing` is orders with profit < 0;
`t.savedByCredit` counts those the cashback covered. Totals do not change (cashback is already in `t.charges`).
Do not widen `order_cashback` to every charge: return postage would turn a returned order into a "loss" although the
list is "before any refund", and Amazon-bought labels are already in shipping.

**Shipping by carrier.** `buildPnl` sets `l.shipCarrier` on every line with shipping: the carrier's name, "More than
one carrier", "Pallet and parcel (bulk orders)", or "Estimated, no label yet (Evri)". `summarise` adds them up in
`t.shipBy`; anything without a name falls under "Carrier not known" so the parts always make the whole.

**Also done on 16 Nov (records, with the owner's go-ahead):** Plenty FlexiSheets 12 Rolls is £14.79 a case of six
2-roll packs (PO-HI-20261110-002 line: `packUnits: 1`, `systemCost: 14.79`); costing rebuilt — sale cost £54,620.33.

**Open, waiting for the owner:** Daler-Rowney's 10% pallet discount from 13 Oct (he said yes; one question first — is
the 10% taken off at the foot of the invoice, or are the line prices already net? Only Washable 5L and Multipurpose 5L
are at 0.9 × the PO price today; setting `paidUnitCost` on a PO line makes `item_learn` reset the product cost, so the
discount needs to be a dated supplier discount known to both `item_learn` and `cost_rebuild`). How to book the
FlexiSheets delivery (the PO is 60 × "12 Rolls"; stock is kept as 2-roll packs). Labels with no packing slip: agreed,
see docs/NO_SLIP_LABELS_PLAN.md.

## Addendum — 16 Nov 2026 (afternoon), v2.94.0: labels with no packing slip

**The rule (owner, 16 Nov):** look for the order in HELM by postcode — carefully, postcodes are sometimes read slightly
wrong; suggest it for one click; warn when what is chosen by hand differs from HELM; otherwise the person must say it is
a replacement for a named order or a manual order with details (a sample, for example).

**How it is built**
- `dispatch_no_slip_orders(postcodes[])` (migration 124, read-only): HELM orders with no HELM label, open or closed in
  the last 3 days, items known, not already on a Dispatch label, postcode equal or one character out.
- `src/lib/dispatch.js` (end of file): `helmGuessAsks`, `applyHelmGuess` (sets `o.helm = [candidates]`, exact first;
  orders with a slip are returned as the same objects), `contentsOf` / `contentsDiffer` (compared through `codeInfo`
  as inventory products × units), `contentsText`, `manualHold(m, { helm, codeInfo })`. `hasManual` now also needs
  `!m.hold`.
- `src/lib/dispatchJobs.js`: one lookup after the Amazon one, only when a file has labels with no slip, never for a
  preset (pallet) or a replacement arranged from Order Audit; failure ignored.
- `DispatchPage.jsx`: `weighManual` puts `hold` on an entry; `ManualLabels` shows HELM's order, the mismatch tick, the
  reason and its needed field; the On Hold block for a slip-less label asks the same. `ManualPicker` has `ask`
  (no default reason; adds "An order (give its number)").
- Reasons on `dispatch_labels.reason`: `order` (a sale; number in `channel_ref`), `replacement` (`original_ref`),
  `manual`, `other`. An order's number is kept in the entry's `amazonRef` field (legacy name) so it never lands in
  `original_ref`. `releaseHeldLabels` now writes `channel_ref` when it is given one.
- `inv_despatch_order` treats every reason except '' and 'order' as a replacement — unchanged. So manual orders
  (samples) still come out under Replacements in the P&L until fix list item 11 gives them their own line.

**Do not** fill anything in without a click, widen the postcode match beyond one character, or let a second label
take the same order's full contents (the "It is this order" path exists for second parcels).

**Checks kept for next time:** `/home/claude/build/plancheck/run.mjs` (old plan vs new plan), `savecheck/run.mjs`,
`uicheck/noslip.py` and `uicheck/held.py` (need the Dispatch harness with `window.__startNoSlip` and `?held=1`).

## Addendum — 16 Nov 2026 (13:50), v2.94.1: the Channels card

The owner's screenshot showed revenue running into gross profit on "All time". The card was a grid of fixed column
shares in a one-tile-wide card. Now a `<table data-channel-table>` (columns size to their content) in a card that is
`sm:col-span-2 lg:row-span-2`. **Lesson: test every money card with six-figure numbers and at laptop width with the
sidebar's 258px taken off** — `uicheck/chan.py` does this (harness with `?big=1`, 14 widths, measures overlap,
clipping and heading alignment).

## Addendum — 16 Nov 2026 (14:15), v2.95.0: "At a glance" on the big P&L card

`glance(ctx, from, to, { k, range, today })` in pnlScreen.js → `{ rows, days, up, best, worst, total, perDay, course }`.
PnlPage's `atGlance` uses the period's own days, or the chart's 14 days when the period is one day. `course` (the pace)
exists only for a running week/month/quarter with two or more full days; today is never a full day. `Spark` draws the
trend line. The owner did NOT want break-even in this card ("doesn't really make sense much to me") — it stays in its
own tile lower down; do not add it back here.

## Addendum — 17 Nov 2026, v2.96.0: "Orders that lost money" list

Frozen headings (the list is its own scroller: `table-shell !overflow-auto max-h-[calc(100dvh-16rem)]`, `th sticky top-0`,
table `border-separate`), ASIN beside each listing SKU (`o.asins = { sku: asin }` from `summarise`), and each row is a
link to `#/order-audit?focus=<order number>` opened in a new tab. `OrderAuditPage` takes `focusId` (App passes its
`focusId`): it searches for the number and opens the order when exactly one matches — once only, so Back returns to the
results. Any screen can now deep-link to an order this way.

## Addendum — 17 Nov 2026, v2.97.0: orders with no listing name their product; two Amazon listings added
- **Why some orders said "(not linked to a product)":** `orderProducts` (pnlScreen.js) named products through the
  line's listing. All eBay and TikTok sales and a few Amazon SKUs have no listing (`saved_products`) in the portal.
- **Fix (screen only):** `report_pl_ship` returns `order_products` { order ref → [{ id, name, units }] } from
  `cost_uses` (kind 'sale') for orders with a no-listing line (migration 125, applied). `orderProducts(order,
  stockItems, left)` uses it for the WHOLE order when any line has no listing (so nothing is counted twice); orders
  carry `unlinked: true`; the row says "SKU: … · not set up as a listing in the portal". Without the map, or with no
  stock recorded, the old wording stays. `groupByProduct` (the Products table) is NOT changed — it still gathers
  these under NO_PRODUCT, because sharing an order's money between products needs the listing.
- **Listings made in the database (not in the zip):** "5-Litre PVA Glue-Shipping" and "25kg Brown Salt", each a copy
  of the existing Amazon listing of the same product (`copiedFromSku` on the listing; products, packaging, carrier,
  service, fee copied; ASIN blank; reviewStatus 'none'; logged as "Listing created for Listing SKU" by Claude).
  14 sale lines link to them. This changes those orders' figures (packaging and fee estimate now counted).
- **Asked, not done:** "1x Plenty Flexi 2DAYS" (Amazon's title says 1 roll; the stock that left was a 2-roll pack)
  and "12.5kg clay Terracotta-2DAYS" (Amazon's title says Stone; Terracotta left the shelf). Do not create these
  until the owner says which product each sends. Also asked: the PVA "-Shipping" SKU sells at £11.95 and £15.95 —
  is postage charged to the customer on top; and whether a 25kg salt bag really goes in the "10KG Box" packaging
  the existing brown-salt listing has.
- **eBay and TikTok listings (fix list 22):** still waiting on the owner's decisions; see
  `docs/EBAY_TIKTOK_LISTINGS_PROPOSAL.md`. Nothing created.

## Addendum — 17 Nov 2026, v2.98.0: Command K looks things up in the database
- **Two kinds of search now.** `buildSearchItems` (search.js) is still the index built in the browser from what the
  portal has loaded. NEW: `looksLikeCode(q)` → `commandSearch(q)` (db.js → `command_search`, migration 126) →
  `remoteItems(res, { me, go })` → `withRemote(local, remote, 20)`. App.jsx holds `commandFound { q, res, busy }`;
  the effect waits 300ms, ignores answers for text that has since changed, and clears when the text stops looking
  like a code. Looked-up rows come first and may wrap (`wrap: true`).
- **Rule kept: nothing extra is loaded on sign-in or when ⌘K opens.** Add new "old or large" things to
  `command_search`, not to the browser index. Names and ordinary words must never trigger the lookup.
- `command_search` returns only what the caller may open (`can_open`), no customer details, no money; at most 6 of
  each kind; matches the start of the text after `inv_norm`; needs 5 characters. The first step is dynamic SQL so the
  prefix indexes are used (8–25 ms; 400 ms without).
- **Order rows open Order Audit** (`go('order-audit', ref)`). OrderAuditPage: when its own search finds nothing and
  the text looks like a code it calls `commandSearch` and shows a card per order with no label (`data-audit-known`).
- **ReturnsPage and CustomerCarePage take `focusId`** (an RT-… / CP-… number) and open that record once.
- Whole-app test harness: `harness-kit/app` (fake `db.js` AND fake `supabase.js`; `app.html`). It mounts the real
  `<App />`, so ⌘K, the sidebar and navigation can be tested in a browser. `?member=1` signs in as a non-admin.
- Not covered: refunds by their own number; finished tasks by product name; Delivery tracking has no row of its own
  (a tracking number finds its order).

## Addendum — 17 Nov 2026, v2.99.0: Prime and Total tiles at the top of Dispatch
- The row of carrier tiles (`byCarrier` in DispatchPage.jsx) gains two tiles: `primeOrdersOfDay(batches, dayLabels,
  statOf)` and `dayLabelTotal(byCarrier)` (both at the end of src/lib/dispatch.js, tested in
  tests/dispatchTiles.test.mjs). Display only.
- Prime counts ORDERS from `dayLabels` in batches with `prime` (order key = `upload_id|order_key`, as the Orders tab),
  statuses ready and dispatched only; falls back to the batches' label counts until `dayLabels` has loaded.
  Batch-level and label-level Prime agree on every label in the live database (checked 17 Nov), so the batch flag is used
  and `loadDayOrders` was NOT changed.
- Total is the carrier tiles added up, so the row always agrees with itself.

## Addendum — 17 Nov 2026, v2.100.0: Fulfilment cost on the P&L, fulfilment share on each overhead
- **Definition (the owner's):** fulfilment cost = shipping + packaging + the overheads marked as fulfilment. Not all
  overheads ÷ orders. It regroups costs already in the P&L and must never change gross or net profit.
- **Database (127):** `overheads.fulfilment_share` 0–100; `overhead_set_fulfilment(id, share)`; `overheads_for_pl`
  returns `fulfilment`, `fulfilment_by_category`, `fulfilment_by_day`; `overheads_list` returns each item's
  `fulfilment_share` plus `fulfilment` and `fulfilment_monthly`. The share is NOT dated.
- **Client:** `extrasByDay({ …, fulByDay })` → `e.fulfilOh`; `summarise` → `t.fulfilOh`, `t.fulfilment` (null on a
  single channel / when overheads are off), `t.fulfilmentPerOrder`, `t.fulfilmentPerUnit`. PnlPage: the band is the
  `data-fulfilment` Tile above the Break-even row. OverheadsPage: `FulfilmentForm` (mode 'fulfil'), tag in `Row`,
  line in the drawer, `data-fulfil-monthly` in the Active now tile. `fulfilmentShare` / `fulfilmentWord` in overheads.js.
- **Shares set on 17 Nov (by Claude, from the owner's list):** Warehouse Rent, Helm, Starlink Warehouse, and the
  three warehouse / dispatch staff = 100. Alsa Idrees is senior management and Ubaid-Ullah is a developer: not counted.
- **Not done:** cost a parcel (buildPnl does not expose a parcel count per line); the figure in the breakdown table
  and CSV; a dated share. This figure is also the FBM side of the owner's FBA-vs-FBM comparison.
- P&L harness tip: give the fake listings `carrierId/carrierCatId/serviceLevel/packagingId` and pass `settings` with
  `carriers: { evri: { categories: [{ id, maxKg, rates: { nextday } }], maxWeight } }` so shipping and packaging are not £0.

## Addendum — 17 Nov 2026, v2.101.0: the fulfilment share is dated — and the rule that goes with it
- **THE OWNER'S RULE (17 Nov): "wherever the costs are involved they should be dated."** Anything that changes a cost
  — an amount, a share, a rate, a price — is saved with the date it applies from, and earlier periods keep what they
  had. Never add an undated cost setting again. (v2.100.0 shipped an undated share; he corrected it within minutes.)
- **Database (128):** `overhead_fulfilment` (dated rows; removed ones kept), `overhead_fulfilment_on(id, day)`,
  `overhead_set_fulfilment(id, share, from)`, `overhead_remove_fulfilment(row)`. `overheads.fulfilment_share` no longer
  exists. `overheads_list` items: `fulfilment_share` (today's), `period_fulfilment`, `fulfilment_shares`.
- **Client:** `shareOn(shares, day)` in overheads.js (same rule as the database); `FulfilmentForm` has "Applies from";
  the drawer lists the dated shares (`data-fulfil-dated`). The P&L code did not change: it reads `fulfilment_by_day`.
- A v2.100.0 browser still works against this database (its two-argument save means "from today").
- Still undated elsewhere and worth checking against the rule when next touched: packaging costs (they keep a
  history but the P&L's use of it by date should be confirmed), listing fee percentages, product weights.


## Addendum — 18 Nov 2026, v2.102.0: eBay and TikTok listings, one listing under several codes

**What exists now.** 72 listings with `data.channel` eBay (50) or TikTok (22), created by Claude from the plan in
`public.channel_listing_plan` (migration 132; every row says where its packaging, carrier and service came from, and
holds the `data` that was inserted). They are saved listings (`reviewStatus: 'none'`), not marked live. Each is logged
in `activity_log` as "Listing created for eBay / TikTok".

**The rule the owner agreed (17 Nov): one listing per channel for the same products and quantities, holding every
code it is sold under.** `data.listingSku` is the main code; `data.otherCodes` (array of text) are the rest.
- `listing_codes (channel, code_key, listing_id)` holds every code of every non-Amazon, non-archived listing,
  `code_key = upper(trim(code))`. Trigger `listing_codes_sync` on `saved_products` keeps it in step. First listing to
  claim a code keeps it (the Calculator warns on a clash: `sameListingSku` now compares every code).
- `sales_ledger`: a line with no listing by its Listing SKU is looked up in `listing_codes` by
  `coalesce(listing_sku, item_code)`, **only when the channel is not Amazon**. Amazon is untouched by construction
  (checked: `report_pl_days` for Amazon has the same md5 before and after).
- Why `item_code` when there is no Listing SKU: HELM sends some eBay/TikTok lines with no listing SKU, only its own
  product code. That code is one of the listing's other codes (confirmed by the owner in the sheet for five products).
- `sales_refresh_helm` and `report_pl_open` find the listing the same way.
- A code is NOT added as an "other code" when it is ambiguous: an eBay item number shared by several variations
  (366706836318 FlexiSheets, 366701642473 Plenty Original, 366768722348 Peacock salt, 366663276300 Zippo), or a
  product's own code on a multi-pack listing.

**How the plan was worked out** (re-run the same way for new codes): code = `coalesce(listing_sku, item_code)` of
each eBay/TikTok sale line -> products from `inv_channel_skus` (source 'portal') by that code, else the product whose
own code it is -> grouped by channel + products -> packaging from the owner's sheet, else the Amazon listing with the
same products and quantities (most sold, packaging set) -> weight = product weights x qty -> carrier = that Amazon
listing's, else its own labels (DHL if mostly DHL or over 15 kg, else Evri) -> band by weight (Evri: up to 2 kg, 2-15 kg)
-> service = its own labels (Hermes 48 -> `standard`, Hermes 24 -> `nextday`), a tie or none -> the Amazon listing's,
else `standard`. `refFee` and `feeCategory` are blank on purpose.

**Left open**
- eBay `PEACOCK-WS-10KG-X002` (2 x Peacock White Salt 10kg, 20 kg, sent by DHL): no packaging chosen. Held in the plan.
- "3 in 1 Kids Role Play Costumes" (eBay 366734463018; TikTok "Default"): HELM does not say which costume. Proposed:
  a SKU per variation on eBay and TikTok equal to the costume's HELM code. Waiting on the owner.
- Channel fees: nothing set on these listings. The Calculator, the readiness list and the drawer still speak Amazon
  ("Amazon fee", "Push live once it's listed on Amazon"). That is the per-channel work still to do.
- HELM-estimated TikTok orders carry no TikTok fee until the Income report replaces them.

**TikTok price before discount (129, 130).** `sales_refresh_helm` and `report_pl_open` add `money.discount` back to
`money.total` for TikTok only. The owner runs no promotions of his own there (18 Nov), and TikTok's Income report
confirms a platform discount does not reduce `Gross sales` / `Net sales`. If he ever starts his own promotions this
rule must change.

**Security fix (131).** `sales_ledger` was readable by the `anon` role (a view runs as its owner unless
`security_invoker` is set, so the row rules on `sales_lines` did not apply). Now `security_invoker = true` and `anon`
has no rights. Every function that reads the view is a definer function. **Any new view must be created with
`security_invoker = true` and `revoke all ... from anon`.**


## Addendum — 18 Nov 2026, v2.103.0: channel fees (dated), Advertising on the P&L, the Calculator per channel

**Channel fees.** Table `channel_fees` (migration 133): a row for a channel (`listing_id` null: `pct`, `per_order`,
and optionally `per_order_small` for orders up to `small_order_max`) and a row for a listing whose percentage differs
(`pct` only). Every row has `from_date`; the one in force on a day is the latest dated on or before it; a wrong row is
removed (`removed_at`), never edited. `pct` is a share of what the customer paid, giving the fee before VAT.
- `channel_fee_pct(channel, listing_id, day)` → the listing's own %, else the channel's, else NULL (a channel with no
  rule: Amazon, where `listing_fee_pct(data)` is still used). `channel_fee_fixed(channel, day, order_total)`.
- `sales_refresh_helm` and `report_pl_open`: fee = total x % + the fixed amount shared across the order's lines.
- `channel_fee_set / channel_fee_remove` (admins) log the change and call `channel_fee_reapply(channel, from)`, which
  re-estimates the HELM lines of that channel from the date. `channel_fees_list()` feeds the page (people who see costs).
- App: `src/lib/channelFees.js` holds the rules in a module variable (`setChannelFees`, loaded once in `App.jsx` and
  again by the settings page), because `calcProduct` is called from about 50 places with no settings argument.
  `channelFeeFor(p)` matches a listing by channel + Listing SKU. With no rules loaded (people who do not see costs) an
  eBay listing falls back to the entered percentage; nothing crashes.
- Rules on 18 Nov: eBay 12.55% + 40p (30p up to £10) from 1 Aug 2026, 45 listings with their own % from eBay's reports;
  TikTok 9% + 50p from 1 Aug 2026; Shopify (Plenty&More) 1.7% + 25p from 1 Nov 2026. WooCommerce (Salt 4 U): none yet,
  waiting for the owner's Stripe rate. eBay's model was checked against 428 report orders: within a listing the
  percentage is constant to a few hundredths (Pyrex jug 500ml 12.22–12.30% over 131 orders).
- **New eBay listings need their own percentage** once they have report orders (the page offers it; or re-run the
  insert at the end of migration 134).

**Advertising.** `isAdvertising(what)` in `pnlScreen.js` picks the advertising kinds out of `report_pl_ship`'s
`charge_days` ("Promoted listings"). `t.advertising` is a positive cost; `t.charges` still includes it, so gross and net
are untouched and the charges row shows `-t.charges - t.advertising`. If `report_pl_ship` fails the line simply is not
shown and the charges row holds everything, as before.

**Plenty&More.** Channel id `Shopify` (as HELM sends it), shown as "Plenty&More": in `FinanceParts.CHANNELS`,
`listing.CHANNELS`, `channelFees.feeName`. One order so far (17 Nov, not yet sent).

**Still open after tonight**
- TikTok: the seller funds free delivery on orders of about £20 and over ("Seller shipping fee discount" in the Income
  report). Migration 129 adds that delivery back as if TikTok paid it. Three orders, £18.89. Fix once the owner confirms
  the offer and its threshold: do not add back the delivery part on those orders, and take it out of the fee base.
- Website baskets (agreed, not built): packaging for an order = the dearest of its products' "packaging when sent on
  its own", per real parcel; a monthly check of boxes costed against boxes used. Needs a packaging setting on the
  product (dated) and a branch in `pnl.js` for lines with no listing on a website channel.
- Open orders: four orders at HELM status 12 have sat in "orders not yet sent" since 6–16 Nov (two Salt 4 U, one TikTok
  costumes, one eBay "1.2 tons rock salt bulk tote bags" at £197.94, item 364784521771, which has no product link).
  ASK the owner what status 12 means and whether these should count.
- On a phone the P&L statement's hint text ("stock sent again" under Replacements) runs into the amount. Existing, small.
- The kids' costumes; the Stripe rate; eBay listings that have never sold.


## Addendum — 18 Nov 2026 (01:30), v2.104.0: the channel mark, and a correction to how eBay listings were grouped

**The owner's complaint:** the eBay listings looked "really really messy" — listings named by item numbers — when the
decision had been "each eBay SKU is a listing". What had happened: listings were grouped by "same products on the same
channel" (a generalisation of the TikTok decision that was never agreed for eBay), and where eBay has no SKU on an item
the item number became the listing's SKU.

**The rule for eBay, as the owner means it:** one listing for each eBay SKU (custom label). An item number is never
the name of a listing where a SKU exists. Do not merge two eBay SKUs into one listing, even when they send the same
products. (TikTok is different: one listing holds the seller SKU and TikTok's product ID, which are the same listing.)

**Done on 18 Nov:** five listings switched to their SKU-like code (the HELM code the orders arrive under), item
numbers kept as other codes; Zippo split into two listings (one per eBay SKU). **Left:** 12 eBay listings still go by
an item number because nothing else exists for them; suggested SKUs were sent to the owner. When he agrees, set
`listingSku` to the SKU and move the item number into `otherCodes` (the trigger keeps `listing_codes` right). Six
listings still hold more than one item number of SKU-less eBay items for the same product: once those items have
SKUs on eBay, split them if the SKUs differ.

**Channel mark:** `ChannelChip` in `UI.jsx` (and `channelChipName`). Use it wherever a listing is shown.


## Addendum — 18 Nov 2026 (overnight), v2.105.0: website orders as baskets; and database steps that wait for the owner

**READ FIRST — a database step is waiting.** `supabase/migrations/136_product_packaging.sql` is written but NOT applied:
the Supabase tool asked the owner to confirm while he was asleep and the client cancelled it (twice, same text). Do not
re-word or split a statement to get past a confirmation — wait for him, then apply the file as it is and check
`select count(*) from product_packaging` (about 111 rows expected) and the Amazon checksum.

**The rule (owner, 18 Nov):** a website order (channel `Shopify` = Plenty&More, `WooCommerce` = Salt 4 U) has no
listing. Packaging = the dearest of its products' "packaging when sent on its own" on the order's day × real parcels
(1 when there is no label yet). Other channels never use this: an eBay/TikTok order with no listing still has no
packaging and shows as needing a listing.

- `product_packaging (stock_item_id, from_date, packaging_id | own_packaging, note, created/removed)` — dated, rows are
  removed not edited; RPCs `product_packaging_list()`, `product_packaging_set(p_item, p_packaging, p_own, p_from,
  p_note)`, `product_packaging_remove(p_id)` (people who see costs; logged to activity_log under the product).
- `src/lib/productPackaging.js`: `packagingOn`, `basketPackaging`, `groupProductPackaging`, `packagingStates`,
  `isWebsiteChannel`. `buildPnl` takes `productPackaging` (rows) and has a basket branch BEFORE the label/estimate
  branches; the order's products come from `ship.order_products[ref]` (the stock that left), else the lines' own
  product codes matched to `stock_items.data.sku`. `packFrom` is `'basket'` or `'none'`.
- `PnlPage` loads the rows with `loadProductPackaging().catch(() => null)` — the page must never fail on it.
- `src/components/ProductPackaging.jsx` is the Packaging → Products tab.
- Not built: boxes costed vs boxes used each month. Only 2 of 26 packaging items are in `inv_products`, so usage is
  not recorded. Ask the owner before building anything on it.

**Also in v2.105.0 (app only, no database):**
- `src/lib/channels.js` is THE list of sales channels (`SALES_CHANNELS`: id, name, label, listings, website, item, chip,
  charges). `listing.js` CHANNELS, `FinanceParts` CHANNELS/channelName/CHARGES, `UI` CHANNEL_CHIPS, `feeName`,
  `isWebsiteChannel` and the CSV import are derived from it. Add a channel there only. Not derived: the database's
  HELM shop-name mapping (in `sales_refresh_helm`), and BulkOrders/WholesaleOrders (left alone on purpose).
- Listing field `deliveryCharged` (inc VAT, an order; ignored on Amazon). `calcProduct` works on `customerPays =
  sellPrice + deliveryCharged` for VAT, revenue, the fee and the margin; result has `deliveryCharged`, `customerPays`.
  `breakEven` and `priceForTargetMargin` stay PRICES (what the customer pays less the delivery). The P&L does not use
  this field: real orders carry the delivery actually paid.
- `src/lib/compare.js` `compareChannels(calc, { savedProducts, carriers, packaging, stockItems, excludeId })` — the
  Calculator's "On the other channels" box (`AcrossChannels` in CalculatorPage). Read-only.
- `buildPnl` puts `parcels` on every sale line (labels × the line's weight share; a shipping pattern's count; else
  the listing's parcels × qty; 0 when nothing is known). `summarise` gives `t.parcels` and `t.fulfilmentPerParcel`.
  Timed table rows carry `fulfilment` (CSV only — the on-screen table is full at laptop width).
- `casePriceSuspects(rows)` in `priceLists.js`; `ImportPanel` lists the suspects and leaves them out unless unticked.
- Not built, needs the database: a replacements report (the P&L only has daily totals), dates on packaging costs and
  product weights, the channel on returns, wholesale clients and price lists, the TikTok discount split.


## Addendum — 19 Nov 2026, v2.106.0: case actions, replacement requests, carrier surcharges

**Database: migrations 136 and 137 are APPLIED (19 Nov, 11:50, approved by the owner).** Next number: 138. Earlier
notes in this file saying 136 waits are out of date. A database step needs the owner at the screen to approve it: if
the prompt gets no answer, stop, say so, and never re-word the statement to get past it.

**Cases** (`CustomerCarePage.jsx`, `CareParts.jsx`, `src/lib/careReplacements.js`)
- Kinds `undeliverable`, `held_at_depot` (kinds are free text in the database; `CASE_KINDS` lists them; both count as
  the carrier's). `complaints.held_since date`, `complaints.actions jsonb` (keys of `CASE_ACTIONS`). The app sends
  those two columns only when used, so a plain case still saves before migration 137.
- The request forms are rendered AFTER the drawers in the page so they open on top of an open case. Keep that order.

**Replacement requests** (`CareReplacements.jsx`, table `replacement_requests`, ref `RP-0001`)
- status is only `requested | approved | declined` (trigger `replacement_requests_rules`: admin decides; the label
  fields only once approved, by an admin). Everything after approval is DERIVED: `replacementStage(req, labels)` reads
  the request's Dispatch labels from RPC `care_replacement_labels()` — labels with `reason = 'replacement'` whose
  upload is the request's, or whose `original_ref` is the order and which were made after the request.
- The label upload calls `startJob(file, { title, me, onLog, manualAll: { items, note, originalRef } })` from
  `dispatchJobs` — exactly what `ReplacementModal` in Order Audit does. **Dispatch's code is not changed by this**
  apart from the display-only `ReplacementChip` (shown where `label.reason === 'replacement'`, beside `PrimeChip`).
  If the reader stops for review the request stays "approved" until the batch is saved in Dispatch, then picks it up.
- Stock and cost: a replacement label takes stock off and lands on the P&L's Replacements line, as before.
- `loadCare()` returns `replacement_requests` and `replacement_labels` (both empty when 137 is not applied).
  `CustomerCarePage` now takes `onLog`.

**Carrier surcharges** (`src/lib/surcharges.js`, `SettingsPage.jsx` `Surcharges`)
- Stored in Cost Settings as `carrierSurcharges: [{ id, carrierId, name, amount, from, to }]` — top level, NOT inside
  `carriers`, so a surcharge edit is not a dated "rate version" (it carries its own dates). No database change.
- `buildPnl` adds `surchargeOn(list, carrierId, sale_date)` to every parcel: label hits (HELM + portal labels), the
  shipping-pattern estimate, and the listing estimate (× the listing's parcels). Each line carries `surcharge`
  (already inside `shipping`). `summarise` puts it under `shipBy['Carrier surcharges']` and `t.surcharges`.
- **v2.107.0 (the owner: "Yes"):** `calcProduct` includes the surcharge charged TODAY: `shippingSurcharge` =
  `surchargeToday(p.carrierId)` × the listing's parcels, already inside `shippingCost`. The list comes from a registry
  in `surcharges.js` that `App` fills from Cost Settings (`setCarrierSurcharges`, in the `settings` memo); tests fix the
  day with `setSurchargeDay`. **`buildPnl` must keep using `shippingCost − shippingSurcharge` for its listing
  estimate** and then add the surcharge of the order's day — otherwise an order is charged twice or on the wrong day.
- REPLACEMENT is not printed on labels (the owner: does not matter). The 15p is before VAT (confirmed).
- Pallet carriers have their own fuel surcharge (dated versions) — unrelated to this.

**v2.108.0 — which Dispatch day a replacement label from Cases belongs to.** `replacementShipDate(now)` in
`careReplacements.js`: London hour ≥ 17, or a Sunday → the next working day (Mon–Sat, the same rule as Dispatch's
`nextWorkingDay`); else today. `ReplacementDrawer` passes it as `shipDate` in `startJob`'s meta (the reader already
uses `meta.shipDate || londonDate()`), so both the straight-to-batch and the review path honour it. The 5pm is the
constant `REPLACEMENT_CUTOFF_HOUR`; working days are fixed in code — if Sunday ever becomes a working day, change both
this and `nextWorkingDay`. Order Audit's `ReplacementModal` and Dispatch's own uploads are NOT changed.


## Addendum — 19 Nov 2026 (evening), v2.109.0: Off Shore — remote zones, the cheapest carrier, writing the courier to HELM

**HELM is no longer strictly read-only.** The owner approved ONE write (19 Nov, after a test): edge function
`helm-courier` sets an open order's courier service — `PATCH /orders/{id}/preferred-courier-service {courier_service_id}`
(204 on an open order; 422 "The selected Order is invalid" on a despatched one). It re-reads the order from HELM first,
refuses anything not in HELM's open statuses `[2,3,4,5,6,7,10,11,12]`, anything `is_locked`, and any service id not set
against a carrier in Cost Settings (`helmServices[].helmId`). It acts only for a user with `can_open('offshore')`
(`helm_courier_allowed()`), and logs every try to `helm_courier_changes`. **No other HELM write exists — keep it that
way unless the owner asks.** Tags can be added by the API (`POST /orders/{id}/tags {name}`) but not removed (no DELETE
route): the test tag "Portal test" is still on despatched order 4805346 — the owner should remove it in HELM.
`helm-probe` (the test) is retired (a stub answering 410). **Security note:** HELM's `GET /couriers/{id}` returns the
carriers' API credentials in clear; the probe saved them once and the row was scrubbed. The owner was told and should
consider rotating the DHL and Evri credentials held in HELM.

**Remote zones** (`src/lib/offshore.js`): `settings.carrierZones = [{ id, carrierId, name, postcodes, bands:[{maxKg,
rate}], next, from, to, note, checked }]` — top level beside `carrierSurcharges`, dated per zone, NOT inside `carriers`
(so not a rate version). `rate` is the whole parcel price there ex VAT incl. fuel/levies; `next` each further parcel
(empty = each at its band). Postcode specs: areas `BT`, districts `PH3`, ranges `AB31-AB38`; `parsePostcodes` reports
what it can't read. Only the postcode DISTRICT is ever used. Seeded 19 Nov: Evri H&I (its "Scottish H&I (Finance)"
billing list, £4 packet / £5 parcel), IoM, NI, IoW, CI, Scilly; DHL Zone C (13.58 / next 8.57), Zone D (18.96 / 11.95),
IoW & Scilly (11.17 / 9.57); DPD H&I two day 12.97, IoM 13.52, NI 10.77, CI 17.92, IoW 17.92 (from 9 Nov). Carriers
gained `active` (DPD false) and `primeOk` (DHL false) — `carrierChanges` ignores both (no rate version).

**Cheapest carrier** (`bestCarrier`): units from the order's items × product `weightKg` (else the listings' weight,
a bundle split into its units); packed first-fit decreasing into parcels ≤ `parcelCap(carrier)` = min(maxWeight, 25),
Evri just under 15; each active carrier (Prime → only `primeOk`) priced at its zone or mainland `bandRate` +
`parcelsCost` + the day's surcharges; cheapest wins (ties: the order's current carrier, then fewer parcels). Status:
surcharged / free (off shore postcode, no extra with that carrier) / mainland / no-carrier / no-weight.

**One engine, two callers:** edge function `offshore-check` (verify_jwt false). Cron (x-notify-key) → orders over
`OFFSHORE_ALERT_GBP` (£10) or no-carrier → `offshore_alert_queue()` (once per order, `offshore_alerts`) → event
`offshore_extra` (rule: Warehouse Team). The page calls it with the user's session → `helm_courier_allowed()` → rows;
£ fields stripped unless `sees_costs`. Warehouse logins can't read Cost Settings, which is why the engine runs
server-side. **`supabase/functions/offshore-check/offshore.js` is a copy of `src/lib/offshore.js`** (imports from
`deps.js`, copies of `parcelsCost` and `surchargeOn`); `tests/offshore.test.mjs` fails if they differ. The deployed
copy has shorter comments, same code. Cron `offshore-check` `*/15 6-19 * * 1-6` (UTC) — switched on only after the
page was deployed.

**P&L:** `buildPnl` reads `ship.districts` (`report_order_districts(from,to)`: `order_districts` from the Amazon
report > `helm_orders.postcode` > `dispatch_labels.postcode`). HELM/label parcels, the pattern estimate and the listing
estimate use the zone price when the order's district is in that carrier's zone on its day; each line carries `remote`
(the extra, inside `shipping`) and `remoteZone`. `summarise` → `shipBy['Off shore postcodes']`, `t.offshore`. Without a
district nothing changes. `amazonTransactionsToLines` returns `districts` from "order postal"; Uploads saves them with
`order_districts_save` (sees_costs). Backfill of 19 Nov: the 277 off shore orders of 3 Aug – 17 Nov (mainland orders
need no district).

Database: 138 (`postcode_district`, `order_districts`, `order_districts_save`, `report_order_districts`,
`offshore_open_orders`), 139 (`offshore_orders_all` service-only, `helm_courier_changes`/`_log`/`_recent`/`_allowed`,
`offshore_alerts`, `offshore_alert_queue`, notification rule, cron). Page id `offshore` (Warehouse group, COST_FREE,
in the warehouse role); give it to Jignesh in Team & Access.


## Addendum — 19 Nov 2026 (evening), v2.110.0: Premium orders in Dispatch
Premium = Amazon's paid faster delivery on a non-Prime offer. HELM's order `meta.shipping_method` (shown in HELM rules as
"Requested Shipping Service", reached with `includes=meta`) is "UK Next" for Premium, "SFP - UK Next" for Prime, "Std UK
Dom_1" for normal. The owner's HELM rule tags these "Premium"; the portal reads tags (`helm-tags`) and treats Premium
exactly like Prime: `planUpload(..., { premium })` (Prime wins), groups keyed `|PREMIUM`, `splitPrime` returns Prime,
Premium, rest; `premium`/`premium_source` columns (migration 140), `dispatch_premium_orders`, `dispatch_follow_helm_premium`
(cron every 5 min). Print: `drawStamp` draws "PREMIUM" (Evri) / "N" (DHL) in Prime's place; `primeBox(..., 'PREMIUM', room)`.
Screen: `PremiumChip` (green #16A34A); `PrimeChip` is Prime blue #00A8E1 on screen. Tests: `tests/dispatchPremium.test.mjs`.

---

## Addendum — 19 Nov 2026 (night), v2.111.0: Returns rebuilt (phases 1–3 of the owner's plan)

Plan and decisions: project doc "Returns rebuild — full plan and scope (19 Nov)"; the report's contents: "Amazon returns
report — what it holds and how to use it (19 Nov)". Phase 4 (eBay and other channels, team metrics) is NOT built.

**READ FIRST — database.** Supabase approval prompts were cancelled automatically by the owner's app (apply_migration AND
execute_sql, 0.4 s, nothing ran). The owner chose to run 141, 142, 143 himself in the SQL Editor. Check before relying on
them: `select to_regclass('public.amazon_returns')`, `returns_stats` exists, `cost_rebuild` source contains
'customer return'. After 142 the costing must rerun (`select public.cost_rebuild()`, or wait for the nightly run). The
notify Edge Function in the repo has the two new messages but was NOT deployed; the two rules start switched off.

- **Data:** `amazon_returns` (RMA primary key; the report's fields; `items` = our products from the order's listing via
  `returns_sku_items`; `return_id` = the box logged). It IS the Expected list for Amazon — no copy in `returns`.
  `returns` gained `rma, amazon_reason, match_how (rma|tracking|order|expected|suggestion|office), match_score,
  expected_items`. Trigger `returns_link_rma` links a return naming an RMA. `claims` gained `kind (carrier|safet),
  return_id, rma, safet_claim_id, deadline`; unique SAFE-T per RMA.
- **RPCs:** `amazon_returns_upsert(rows, file, by)` (also logs report_uploads source 'amazon_returns', links boxes via
  `returns_link_amazon`, writes Amazon's SAFE-T decision onto our SAFE-T claim), `returns_lookup(code)`,
  `returns_suggest(products[], carrier, qty, exclude)`, `returns_uploads()`, `returns_stats(from, to)` (sold per product;
  admins: refunds/fees, return postage, SAFE-T, credit, written-off value, claims won), `returns_product(product, days)`.
  `returns_scan` and `claims_scan` now treat `returned_at` / RETURNED_TO_SENDER as a return (HELM never sends 10).
  `returns_daily_summary` queues `returns_digest`; `returns_upload_reminder` (cron 11:30/15:30 London).
- **Costing (142):** an inv_movements 'add' with reason "Customer return" is source 'customer return' in `cost_rebuild`: its
  layer is at the cost that order's units left at (its own `_draw` rows; order from the RT ref in the note → returns.order_ref),
  else the last cost; a `cost_uses` row kind 'customer return' with NEGATIVE cost is the credit. Orders' COGS (kind 'sale')
  is untouched. `report_pl_days.returns` [{d, credit, units}] → `extrasByDay` `returnsCredit` → `summarise` adds it to gross.
  `isReturnCharge(what)` splits return postage / SAFE-T out of other charges for display only (no total moves).
- **Frontend:** `lib/returnsReport.js` (XML/TSV reader, no DOMParser so tests run), `lib/returnsLogic.js` (classifyCode,
  REASONS/CAUSE_OF/OUTCOMES, amazonState, buildTodo, summarise, returnsByDay; constants OVERDUE 14, NOT_COMING 21, SAFET 30,
  RATE_ALERT 3%), `ReturnsPage.jsx` (tabs by role: admin/office Dashboard·To do·Expected·Scan·All·Upload; warehouse
  Scan·Expected·Logged), `ReturnsDashboard.jsx` (AdminView with £ for admins only; OfficeView no £), `CameraScan.jsx`
  (BarcodeDetector, else @zxing/browser lazy-loaded — new dependency), Claims SAFE-T tab (`SafetBits`), Product page
  `ProductReturns`, Order Audit timeline (amazon_returns), ⌘K (command_search patched). `CareParts.RETURN_REASONS` is now
  `returnsLogic.REASONS`.
- **Stock notes:** back-in-stock lines still go through `inv_adjust` with reason "Customer return" and note
  "RT-xxxx · order" — the costing reads that. Do not change the wording.
- **Not built / to confirm:** SAFE-T deadline of 30 days is a setting in returnsLogic (owner to confirm against Seller
  Central); faulty items → supplier return/credit note (only flagged, no flow); outbound postage of returned orders is not
  in "what returns cost the P&L" (it stays with the order in the P&L); eBay/other channels' returns reports (phase 4).
- Tests: tests/returns.test.mjs (10). Browser-checked with a harness (not in the repo) on made-up data shaped from the real
  report: admin/office/warehouse views, scan → log, H01F warning, suggestions, SAFE-T start, Claims SAFE-T, upload preview.
