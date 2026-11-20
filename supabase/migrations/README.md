# Database migrations

Run in number order on a new database. Every file is safe to re-run on the
existing one. `001_base.sql` was generated from the live database; later files
are exactly what was applied, in order.

The supplier sync job lives in `supabase/functions/supplier-sync/`.

`supabase_setup.sql` at the project root is all of these combined, for a fresh setup.

`109_finance_pages.sql` (v2.84.0): `report_pl_days`, the `report_uploads` log and its two functions.

`110_pl_open_orders.sql` (v2.85.0): `report_pl_open` — HELM's open orders as P&L lines dated today.

`111_order_tags.sql` (v2.86.0): `helm_orders.tags`, `helm_orders_set_tags`, `report_order_tags`, tags on
`report_pl_open`'s lines, and the `helm-tags` job every 5 minutes (`supabase/functions/helm-tags/`).

`112_dispatch_prime.sql` (v2.87.0): Prime in Dispatch — `prime` on labels, batches and uploads (default false),
`dispatch_labels.prime_source`, `tags_prime`, `dispatch_prime_orders`, `dispatch_follow_helm_prime` + its 5-minute job.

`113_dispatch_amazon_orders.sql` (v2.89.0): read-only `dispatch_amazon_orders(p)` — what HELM, or failing that the
portal's listings, say is in an Amazon Buy Shipping order. The file holds the description; the body is in the database.

`114_pl_real_parcels_only.sql`, `115_cost_undone_despatch_once.sql`, `116_other_charges_ex_vat.sql`,
`117_fee_schedule_in_database.sql` (v2.90.0): the first costing fixes — the P&L counts only real labels; an undone
despatch is charged once (the old `cost_rebuild` is kept in `fn_backups`); other charges ex VAT
(`ledger_charge_net`); Amazon's fee schedule in the database (`fee_categories`, `fee_referral`, `listing_fee_pct`).
114–116 patch the live functions in place, so they need those functions to exist.

`supabase/corrections/` holds one-off corrections to records, each agreed with the owner. They are not migrations.

`118_helm_sales_fee_by_category.sql`, `119_pl_ship_extras.sql`, `120_report_checks.sql` (v2.91.0): `sales_refresh_helm`
estimates fees with `listing_fee_pct`; `report_pl_ship(from, to, channel)` — portal labels HELM does not hold, weights
for orders with no listing, real shipping patterns; `report_checks(from)` for Finance → Checks. The bodies of
`dispatch_amazon_orders` (113) and `report_checks` (120) are only in the database — export them into these files when
there is a chance.

`121_order_audit_more.sql`, `122_channel_listing_proposals.sql` (v2.92.0): `order_audit_more(upload, order_key)` — an
order's stock movements, other parcels, corrections and money (read-only, beside `order_audit`);
`report_channel_listing_proposals()` — eBay and TikTok listings as they would be set up (read-only, admins). Bodies in
the database.

`124_dispatch_no_slip_orders.sql` (v2.94.0): `dispatch_no_slip_orders(postcodes[])` — the unlabelled HELM orders at
these postcodes (same or one character out), for labels with no packing slip; `pc_squash`, `pc_near`. Read-only; full
body in the file.

`123_pl_ship_order_cashback.sql` (v2.93.0): `report_pl_ship` also returns `order_cashback` (the Ship+ cashback paid on
each order of the period) and `charge_days` (the charges by day, channel and kind). Read-only; full body in the file.
