# Supabase database changes

Read `SUPABASE.md` before changing the database. Supabase no longer guarantees automatic grants for new public tables after 2026-10-30.

- Add explicit, least-privilege grants for the actual client roles and service_role in the same migration as every new table. Include required sequence privileges and RPC EXECUTE decisions.
- Enable RLS and appropriate policies before exposing client access. Preserve the existing authorization model; never grant anonymous access by default.
- Existing data inserts/updates/deletes do not require new schema grants. Do not change RLS or broaden defaults for this platform transition.
- Verify fresh schema changes with automatic grants disabled in an isolated test environment. Verify positive and negative access and update the permission audit for intentional changes.
- The permissions export is a snapshot of the existing schema, not a complete database bootstrap or a template for future tables.

