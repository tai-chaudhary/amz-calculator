# Database migrations

Run in number order on a new database. Every file is safe to re-run on the
existing one. `001_base.sql` was generated from the live database; later files
are exactly what was applied, in order.

The supplier sync job lives in `supabase/functions/supplier-sync/`.

`supabase_setup.sql` at the project root is all of these combined, for a fresh setup.
