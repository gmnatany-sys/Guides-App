# Database permissions

This app uses Supabase project `handniwiwphefterousk`. Supabase stops automatically granting Data API access to new public tables on **2026-10-30**. Ordinary inserts, updates and deletes on existing tables are unaffected.

## Existing-schema compatibility baseline

`supabase-permissions-20260923182627.sql` is an exact export of the migration already applied to the hosted project on 2026-09-23. It explicitly records existing permissions on eight tables and three functions, including server-side service_role access. It preserves existing behavior rather than redesigning authorization. RLS must already be enabled on every listed table; the script fails otherwise. No data, policies, API keys or automatic default privileges are changed.

This repository did not contain the original table-creation migrations at the time of this change. **This export is not a complete empty-database bootstrap.** Restore the matching schema, functions and RLS policies first, then apply this permissions baseline before serving traffic. A full clean rebuild must also include the original schema setup. Do not add this isolated export to a fresh migration chain and assume it creates the database.

Run `verify-supabase-permissions.sql` as a database administrator after restoring or intentionally changing schema permissions. Zero rows means that both granted and denied privileges match the captured contract and RLS remains enabled. A missing object is an error, not a pass.

## Every future schema change

Include explicit GRANT statements in the same migration that creates a new public table. Grant only the operations needed by each actual client role and by service_role; include sequence privileges when needed. Enable RLS and the correct policies before giving client roles access. Include explicit EXECUTE/revoke decisions for new RPC functions. Test permitted operations and denied access with automatic grants disabled in an isolated test database. Do not restore broad default privileges to make a failing test pass.

The captured legacy anon privileges remain subject to RLS. They are not a template for new tables. Private/backend-only data must not be exposed to anon or authenticated just to match an example.

## Verification performed

The migration was validated inside a rolled-back transaction, then recorded by Supabase. All effective permissions for anon, authenticated and service_role and all public-table RLS policy fingerprints were identical before and after. Read-only service-role query probes passed for all eight tables. This was permission and SQL validation, not an end-to-end booking test or an empty-database rebuild.

Reference: https://github.com/orgs/supabase/discussions/45329

