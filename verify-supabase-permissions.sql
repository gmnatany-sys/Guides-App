-- Read-only audit. Zero rows means the captured allowed/denied privileges and RLS match.
-- Review and update this contract alongside intentional permission changes.
WITH expected(kind, identity, role_name, privileges) AS (VALUES
('function', 'public.current_app_user_has_permission(text)', 'anon', ARRAY['EXECUTE']::text[]),
('function', 'public.current_app_user_has_permission(text)', 'authenticated', ARRAY['EXECUTE']::text[]),
('function', 'public.current_app_user_has_permission(text)', 'service_role', ARRAY['EXECUTE']::text[]),
('function', 'public.current_app_user_id()', 'anon', ARRAY['EXECUTE']::text[]),
('function', 'public.current_app_user_id()', 'authenticated', ARRAY['EXECUTE']::text[]),
('function', 'public.current_app_user_id()', 'service_role', ARRAY['EXECUTE']::text[]),
('function', 'public.get_reservation_status_counts()', 'anon', ARRAY['EXECUTE']::text[]),
('function', 'public.get_reservation_status_counts()', 'authenticated', ARRAY['EXECUTE']::text[]),
('function', 'public.get_reservation_status_counts()', 'service_role', ARRAY['EXECUTE']::text[]),
('table', 'public.app_users', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.app_users', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.app_users', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.audit_logs', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.audit_logs', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.audit_logs', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.email_logs', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.email_logs', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.email_logs', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.minimum_participant_alerts', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.minimum_participant_alerts', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.minimum_participant_alerts', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.reservations', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.reservations', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.reservations', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tour_dates', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tour_dates', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tour_dates', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tours', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tours', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.tours', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.user_permissions', 'anon', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.user_permissions', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]),
('table', 'public.user_permissions', 'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[])
), checked AS (
SELECT e.*, ARRAY(SELECT v FROM unnest(CASE kind WHEN 'table' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] WHEN 'sequence' THEN ARRAY['USAGE','SELECT','UPDATE'] ELSE ARRAY['EXECUTE'] END) v WHERE CASE kind WHEN 'table' THEN has_table_privilege(role_name, identity, v) WHEN 'sequence' THEN has_sequence_privilege(role_name, identity, v) ELSE has_function_privilege(role_name, identity, v) END) AS actual
FROM expected e
)
SELECT kind, identity, role_name, privileges AS expected, actual FROM checked WHERE privileges <> actual
UNION ALL
SELECT 'rls', identity, '', ARRAY['enabled'], ARRAY['disabled'] FROM expected WHERE kind='table' AND role_name='service_role' AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(identity));

