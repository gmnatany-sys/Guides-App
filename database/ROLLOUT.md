# Booking remediation — release gates

Prepared against upstream `197030a1a9d5404740a0a52c378f83dd5da8f900` on 2026-09-23. These changes have **not been deployed**. The SQL files here are reviewed drafts, not entries in hosted migration history. No production data was modified for implementation tests and no real emails were sent.

## What changes

- Every protected server action verifies an active account and its individual permission before using the backend client. The final database stage denies direct anonymous/authenticated table and RPC access. Existing menu permissions remain the source of access decisions.
- Booking creation, status changes and date cancellation run in database transactions with a shared date lock. Confirmation numbers use a unique sequence. Cancellation is terminal for a reservation. Historical rows and existing confirmation numbers remain intact.
- Email events are created with the transaction, preserving recipient and reservation details. Sending uses a lease, frozen payload and provider idempotency key. A receipt failure is recoverable; uncertain attempts older than 23 hours require manual provider reconciliation. Legacy messages are not blindly retried.
- Users are linked to their stable Auth identity. Deactivation preserves history. The interface handles missing permissions, stale calendar responses and paginated reservation/email lists. Type errors now fail the build.

## Local evidence and limits

`pnpm test`: 18 passing tests, including denial before database access for all protected server actions, role checks, capacity, rollback on an injected outbox failure, consistent date cancellation, confirmation uniqueness, immutable event cycles, exclusive email leases, mocked provider receipt failure, HTML escaping, and authenticated cron execution. `pnpm build`: all 20 routes compiled with TypeScript checking enabled.

The encrypted application backup was restored to a disposable local PostgreSQL-compatible database, then both SQL stages were applied. Every original value and record remained unchanged: 2 tours, 9 users, 114 dates, 11 reservations, 28 emails, 84 permissions, 2 minimum-participant alerts, 0 audit entries. The backup covers these application tables and their schema/permissions. It is **not** a full Supabase project backup and does not include Auth passwords. It and its recovery key are stored privately outside this repository.

Local PGlite tests use one database connection and **do not establish concurrent-session safety or production load performance**. `tests/postgres_concurrency.py` and the Database safety workflow prepare four real-connection tests; they must pass on PostgreSQL before release. They accept only an empty loopback database named `guides_remediation_test`. This workflow has not yet run. The local build is not a browser or hosted Auth integration test.

## Before any production change

1. Upload to a separate branch and review the diff against the current remote head. Do not overwrite intervening changes. A GitHub editor sign-in permission is currently pending; no implementation branch or PR has been published.
2. Run the PostgreSQL concurrency workflow. Create a preview linked to a separate test Supabase project with synthetic users and reservations. Never attach this preview to the production database or give it a real `RESEND_API_KEY`.
3. Generate two migrations with the Supabase CLI (`supabase migration new booking_prepare` and `supabase migration new booking_lockdown`), using the generated filenames. Copy the corresponding SQL drafts into them. The local CLI was blocked by filesystem access during this task, so migration generation/registration is still pending. Apply each stage separately; do not run a push that applies both stages before the app is ready.
4. In the test project, exercise admin, operation, agent, supplier, disabled user, user without page permissions, and signed-out sessions. Verify booking, confirmation, rejection, cancellation through all four interfaces, history, pagination, rapid tour/month changes, email text and retries using an isolated email sink. Validate the same flows after lockdown, including direct Data API denial.
5. Recheck current production constraints with read-only queries: duplicate lowercased emails or confirmation numbers, Auth links for the users who must log in, invalid participant counts, overcapacity, and active bookings on cancelled dates. Stop for investigation instead of rewriting records automatically. Compare permissions to the approved access model.
6. Take a fresh recoverable backup immediately before cutover. Confirm access to managed Auth/project recovery separately. Do not rely on this task's earlier snapshot for activity that occurred afterward.

## Controlled cutover

1. Choose a controlled period for switching writes. Keep old and new booking writers from running concurrently: the old application does not participate in the new database locks. Let outstanding old requests finish. Do not advertise uninterrupted operation without this coordination.
2. Apply only the additive prepare migration. No table resets, row deletion, confirmation renumbering or replacement of business data is involved. Check lock duration and migration success; verify every existing user who needs access has the expected Auth mapping. Do not run live booking RPCs as probes.
3. Deploy the tested server-guarded application. Verify `APP_SUPABASE_URL`, `JWT_8`, `APP_SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `CRON_SECRET` in the correct environment without exposing their values. Confirm production login/read flows and server permissions before revoking old grants. Reload old browser tabs onto the new application.
4. Apply the lockdown migration. Run `database/verify-remediation.sql`; it must return zero findings. Verify signed-out and direct client access are denied and authorized pages still work. Enable normal writes through the verified new version.
5. Verify the scheduler exists and calls `/api/cron/check-minimum-participants` using the secret. The repository currently has no verified scheduler configuration. The route is repaired, but automatic execution must not be claimed until a hosted schedule and successful run are observed. Select a frequency within the Vercel plan, and a retry interval shorter than 23 hours for uncertain email attempts. Inspect queued mail because processing is bounded to 20 per invocation. Immediate cancellation delivery is also queued after the response.
6. Review the two historical alert emails older than 24 hours against provider delivery records before deciding whether either should be sent. There is intentionally no blanket resend or status reset.

## Stop and recovery

Stop promotion if the concurrency, preview, Auth, permission or scheduler gates fail. Keep the prior deployment available until the new application passes. After lockdown, the old application is not a compatible rollback: it uses revoked client grants. Roll back only to a tested server-guarded version compatible with the additive schema, or forward-fix the new version while writes are controlled. Do not restore broad public access as a rollback and never replace the live database with an older snapshot that would erase new orders. Additive columns and functions can remain in place.

The historical root-level permission export documents the pre-security state only. Do not replay it after lockdown. Minimum participants remains 4; the existing 7/5/3-day stages and server UTC date behavior are retained. Changing past-date rules, tour thresholds or viewing scope requires a separate business decision.

References: [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html), [Supabase permissions](https://supabase.com/docs/guides/database/postgres/row-level-security), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [GitHub PostgreSQL test services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
