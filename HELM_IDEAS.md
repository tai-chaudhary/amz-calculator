# HELM API — ideas parked for later

What else HELM's API (https://api.helmwms.app) could do for the portal, and where each idea stands.
HELM is read only from the portal for now, on purpose.

| # | Idea | Status |
|---|------|--------|
| 1 | Delivery tracking from HELM: late parcels, courier problems, returns by product | **Built** in v2.32.0 (Warehouse → Delivery tracking) |
| 2 | Write notes back to HELM orders (e.g. substitutes sent, why an order is held) | Not now. Needs writing to HELM |
| 3 | Sales history and lead times from HELM for restock planning | Later. Worth doing |
| 4 | Stock levels from HELM | No. The portal's stock is the accurate one; HELM's is out of date and some portal products don't exist in HELM yet. Being sorted out in HELM first (bulk update) |
| 5 | Fetch label files straight from HELM instead of uploading the PDF | **Great idea, needs proper testing.** Bring it up again before building |
| 6 | Book returns into HELM | When the portal starts writing to HELM |
