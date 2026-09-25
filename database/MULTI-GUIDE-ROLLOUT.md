# Multi-guide release

This change adds guide profiles, tour assignments and a guide selector on booking and availability screens. Each guide sees and acts on their own departures, bookings, counts and minimum-participant issues. Staff retain their existing individual permissions. Notification recipients come from the departure's guide.

## Onboarding

1. In Guides, create a profile with the guide's notification email. Only the five guide permissions are enabled by default.
2. Configure sign-in through the existing Users screen. Profile creation itself sends no invitation and does not change passwords.
3. In Tours, create/edit a tour, assign its guides and choose its default guide, capacity and minimum.
4. The guide opens dates in Supplier Availability. Staff can use Availability Calendar. Booking staff choose tour, guide and date.

A departure belongs to one guide. The same tour and date can exist for multiple guides, each with its own inventory. Editing tour capacity/minimum affects new departures only. Existing departure ownership is not reassigned by catalogue edits. Closing a date stops new bookings; cancellation explicitly cancels its active reservations. Guides with future open departures or active bookings cannot be removed or deactivated until that work is handled.

## Data and permissions

The migration adds guide assignments and departure settings; it does not delete existing bookings or replace their IDs. Legacy mapping requires exactly one supplier profile, otherwise the entire migration fails before committing. Existing tours/dates/reservations are attributed to that guide. Previously queued notification payloads retain their saved recipients.

All tables remain inaccessible to direct anon/authenticated queries. The new guide_tours table has RLS enabled and explicit service_role select/insert/update grants. Every new RPC explicitly revokes PUBLIC/anon/authenticated execution. Server actions authenticate first; SQL also checks guide ownership before mutations. A mistaken staff permission on a supplier profile cannot grant staff access.

## Verification and release gates

- Run application typecheck and all Node tests. The multi-guide suite covers legacy preservation, independent inventory, ownership denials, dynamic recipients, alert separation, scoped counts, onboarding permissions and safe deactivation.
- Run the PostgreSQL concurrency job both before and after the multi-guide migration. Test bookings against capacity, cancellation versus booking, confirmations, outbox claims, separate guides and deactivation versus opening.
- Generate the release migration with the official Supabase CLI in the migration-package CI job. Keep its generated filename and verify the bytes match database/multi-guide.sql.
- Use only the separate booking test project and branch-specific Preview environment. Email delivery must remain disabled and staging scheduled jobs inactive.
- Verify signed-in administrator, booking staff and two guides end to end in the hosted preview. Confirm a denied direct attempt against the other guide's booking/alert, not just hidden UI.
- Run the Supabase security advisors and database/verify-remediation.sql plus the multi-guide permission audit before approving a release.

## Production cutover (pending approval)

Do not merge or apply this migration to production until the preview checks pass and the user approves the release. Take a fresh encrypted backup and verify the current supplier mapping and deployed revision first. Apply the verified migration once, deploy the tested application, then validate sign-in, existing bookings, guide scope and notification routing. Do not create additional production guides until the new application is active.

Do not blindly run db push: hosted migration versions differ from repository filenames and the original bootstrap history is incomplete. Record the actual hosted version and file hash. If rollout fails before new-guide data is written, keep writes paused while assessing rollback. Once multiple guides have data, an old application is not a safe rollback; fix forward or use a specifically reviewed rollback. Never drop guide columns or erase bookings as a recovery shortcut.
