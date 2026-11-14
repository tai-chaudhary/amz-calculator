# Good & General Commerce Operations — UI overhaul

This branch rebuilds the presentation layer around the Good & General Brand Pack v2.0 while keeping the existing commercial logic and Supabase data model intact.

## Brand system applied

- Standard Blue `#032FAA` is the corporate anchor and primary action colour.
- Open Sky `#D4EFFF` is used for explanations, selected navigation and system guidance.
- Paper `#F7F6F2` is the application ground rather than stark grey/white SaaS chrome.
- Signal Coral `#F05A47` is reserved for decisions, exceptions and warnings.
- Possibility Lime `#C8EF3F` is used sparingly for positive/live state.
- The UI type stack is Avenir Next → Avenir → Helvetica Neue → Arial, with moderate weights and tabular numerals for financial data.
- Layout uses rules, alignment, spacing and hierarchy before containers. Radii and shadows are deliberately restrained.
- The supplied `public/logo.png` remains the master wordmark artwork; the application does not rebuild the logo in text.

## Listing workflow

The navigation now makes the operating flow explicit:

`Calculator → Saved Listings → Review Queue → Live Products`

**Saved Listings** remains a first-class page. It is the pre-live workspace for listings that have been calculated and saved but are not currently in the live catalogue. Review items remain visible in Saved Listings with an `In review` state, while Review Queue acts as the focused action queue for approvals.

## Major interaction changes

- Grouped sidebar navigation with consistent stroke icons and live counts.
- Global `⌘K` / `Ctrl+K` command search for pages, listings and stock items.
- Dashboard reorganised as `attention → health → analysis` rather than equal-weight cards.
- Calculator rebuilt as a two-column workspace with a sticky live profitability result.
- Shipping detail uses progressive disclosure so normal pricing work stays simple.
- Saved Listings rebuilt as a dense catalogue table with filters, views and a right-hand detail drawer.
- Review Queue rebuilt as a decision-oriented table.
- Stock, Live, Brands, Suppliers and Archive share a consistent filter/header language.
- Login experience now uses the Good & General masterbrand rather than the previous generic calculator treatment.
- Emoji navigation/status graphics have been replaced with a coherent internal SVG icon system.

## Files added / substantially changed

- `src/components/Icons.jsx`
- `src/components/UI.jsx`
- `src/index.css`
- `tailwind.config.js`
- `src/App.jsx`
- `src/components/DashboardPage.jsx`
- `src/components/CalculatorPage.jsx`
- `src/components/SavedPage.jsx`
- `src/components/ReviewPage.jsx`
- `src/components/LiveProductsPage.jsx`
- `src/components/StockItemsPage.jsx`
- `src/components/PortfolioPage.jsx`
- `src/components/BulkUploadPage.jsx`
- `src/components/BuildMonthPage.jsx`
- `src/components/OverheadsPage.jsx`
- `src/components/ArchivePage.jsx`
- `src/components/SettingsPage.jsx`
- `src/components/LoginPage.jsx`

## Validation

The source has been parsed with TypeScript's JSX parser after the overhaul. A full Vite production build could not be run in the working environment because package installation did not complete; run `npm ci && npm run build` in the normal project environment before deployment.
