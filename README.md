# Good & General Commerce Operations

An internal Amazon UK commerce portal for profitability modelling, stock-linked costs, pre-live listing workflow, review/approval, live catalogue monitoring and monthly P&L forecasting.

See `UI_REDESIGN_NOTES.md` for the Good & General brand-led interface overhaul and interaction model.

---

## Setup

### 1. Create a Supabase project

1. Go to Supabase and create a project.
2. Choose the appropriate UK/EU region for your deployment.
3. Keep the project URL and anon/public key for the environment configuration below.

### 2. Create the database tables

1. Open **SQL Editor** in Supabase.
2. Create a new query.
3. Paste the contents of `supabase_setup.sql`.
4. Run the query and confirm it completes successfully.

### 3. Configure environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then set:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Install and run

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

Before deploying a change, run:

```bash
npm run build
```

---

## Core workflow

The listing workflow is intentionally visible in the navigation:

1. **Calculator** — model product cost, Amazon fees, fulfilment and margin.
2. **Saved Listings** — calculated listings that have not moved into the live catalogue yet. This includes drafts and listings currently in review.
3. **Review Queue** — focused approval work for listings submitted for review.
4. **Live Products** — active/paused catalogue monitoring, price changes, cost history and margin health.

Catalogue and planning tools sit alongside that flow:

- **Stock Items** links shared supplier costs/weights to listings.
- **Brands** and **Suppliers** show portfolio exposure and live commercial health.
- **Bulk Upload** validates and imports many listing models at once.
- **Build a Month** combines listing economics, volume assumptions and overheads into a forecast P&L.
- **Overheads** maintains recurring operating costs.
- **Archive** retains old listing models without cluttering active work.
- **Settings** controls carriers, packaging, smart routing and team profiles.

Use `⌘K` on macOS or `Ctrl+K` on Windows to search pages, listings and stock items from anywhere in the portal.

---

## Deploy to Vercel

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables.
4. Deploy.

---

## Tech stack

- React 18 + Vite
- Tailwind CSS
- Supabase (Postgres + REST API)
- Vercel-compatible deployment
