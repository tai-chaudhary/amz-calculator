# Amazon Profit Calculator

A personal Amazon UK FBM profit calculator with VAT handling, smart carrier routing, saved products, and monthly P&L forecasting.

---

## Setup (one-time, ~15 minutes)

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up / log in
2. Click **New project**
3. Give it a name (e.g. `amz-calculator`), set a database password, choose a region (EU West for UK)
4. Wait ~2 minutes for it to provision

### Step 2 — Create the database tables

1. In your Supabase project, go to **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase_setup.sql` from this project and paste the entire contents
4. Click **Run**
5. You should see "Success. No rows returned"

### Step 3 — Get your API keys

1. In Supabase, go to **Project Settings** → **API**
2. Copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon / public key** (the long string under "Project API keys")

### Step 4 — Configure environment variables

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Open `.env` and fill in your values:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

### Step 5 — Install dependencies and run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the app should load.

---

## Deploy to Vercel via GitHub

### Step 1 — Push to GitHub

1. Create a new repository on [github.com](https://github.com) (call it `amz-calculator`)
2. In your terminal, from the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/amz-calculator.git
   git push -u origin main
   ```

### Step 2 — Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up / log in with GitHub
2. Click **Add New Project**
3. Import your `amz-calculator` repository
4. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` → your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` → your Supabase anon key
5. Click **Deploy**

Vercel will give you a URL like `https://amz-calculator-xxx.vercel.app` — that's your live app.

Every time you push to GitHub, Vercel auto-deploys.

---

## Usage

1. **Settings** → Enter your carrier rates for Evri, DPD, DHL, Amazon Shipping (Royal Mail is pre-filled)
2. **Settings** → Configure smart routing rules for automatic carrier selection
3. **Calculator** → Enter a product, see profit / VAT / break-even instantly
4. **Saved Products** → Save products for quick reference and monthly forecasting
5. **Build a Month** → Create a month, add products with unit volumes, see full P&L

---

## Tech stack

- React 18 + Vite
- Tailwind CSS
- Supabase (Postgres + REST API)
- Deployed on Vercel
