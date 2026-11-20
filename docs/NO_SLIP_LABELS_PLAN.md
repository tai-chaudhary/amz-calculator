# Labels with no packing slip (fix list item 18) — BUILT in v2.94.0 (16 Nov 2026)

**Built as planned below, with these differences:** the postcode match is "the same or one character out" (not the
sector); "An order (give its number)" was added for an order HELM offered nothing for; the same question is asked in
On Hold; manual orders do not yet have their own P&L line (fix list 11). See CHANGELOG v2.94.0 and AI_HANDOVER.

---

# The plan as written before building

**Why.** A label uploaded with no packing slip has its product and quantity chosen by hand. That is where the wrong
product or quantity gets in (TidyZ, the glue), and where a parcel ends up with no order number: 165 dispatched labels
are "manual" today, their stock counted as replacements and their orders costed twice.

**What the owner asked for (16 Nov).**
1. The portal looks for the order in HELM — by postcode "and stuff" — and suggests it with one click.
2. It warns when the product or quantity chosen by hand does not match HELM's record.
3. If there is no order, the person says what the parcel is: a **replacement** for a named order, or a **manual order**
   with details (a sample, for example).

**How it would work**
- At upload, for each label with no slip: `dispatch_no_slip_orders(postcodes[])` (new, read-only) returns the open or
  just-closed HELM orders at that postcode (HELM keeps the postcode on `helm_orders` since v2.79.0 while an order is
  open; labels bought through Amazon, Veeqo or DHL's site leave the HELM order open or freshly cancelled).
  Exactly one order at the postcode → a suggestion box like the Amazon one (v2.89.0): order number, HELM's products and
  quantities, **Confirm**. More than one → the person picks. None → step 3.
- Postcodes read off a label are sometimes slightly wrong (the owner's warning): match on the outward code + the first
  character of the inward code, show the full postcode from HELM beside the label's, and never confirm without a click.
- Choosing a product by hand when a HELM order was found: compare with HELM's items; if they differ, an amber box
  "HELM says 12 × TidyZ Handy Bags, you chose 1" with a tick to confirm (the same pattern as v2.90.0's bulk form).
- No HELM order: the reason must be chosen — **Replacement** (asks for the original order number, suggests that
  order's products) or **Manual order** (who it is for and why, free text). "Manual" with nothing said is no longer
  possible. Stored in `dispatch_labels.reason` (`replacement` | `manual_order`) with `original_ref` / `note`.
- Costing: `manual_order` parcels get their own line in the P&L ("Parcels sent with no sale"), apart from
  Replacements; a label tied to an order is that order's cost.

**Files**: `src/lib/dispatch.js` (`manualSlip`, `applyAmazon`-style `applyHelmGuess`), `src/lib/dispatchJobs.js` (one
extra lookup after pairing; failure ignored, as with Prime and Amazon), `src/components/DispatchPage.jsx`
(`ManualLabels`), `src/lib/db.js`, one read-only migration; later `cost_rebuild` for the new reason.

**Checks before it ships (Dispatch must not break)**: `tests/dispatchPrime.test.mjs` plus new tests for the guess and
the mismatch; the print check (`/home/claude/build/printcheck/check.mjs`: old and new print files byte-identical for
files with slips); the save check (`/home/claude/build/savecheck/run.mjs`: identical database calls when every label
has a slip); the review screen in a real browser. A file where every label has a slip must behave exactly as today.

**Why it was not built in this run**: it changes the Dispatch upload screen, the busiest screen in the portal, and
should be built with the owner awake to try it on a real file.
