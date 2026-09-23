-- Exported compatibility baseline for this project's existing schema.
-- Preserve existing effective permissions; do not use this as a template for new tables.
-- Requires the matching table definitions, RLS policies, and functions to exist first.
DO $rls_guard$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.app_users') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.audit_logs') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.email_logs') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.minimum_participant_alerts') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.reservations') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.tour_dates') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.tours') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.user_permissions') AND relrowsecurity)) THEN
    RAISE EXCEPTION 'Expected tables and enabled RLS must exist before restoring API grants';
  END IF;
END
$rls_guard$;
-- Compatibility baseline: explicit Data API privileges, captured 2026-09-23.
-- No data, RLS policy, keys or automatic defaults are changed.
-- Replay after all existing schema migrations, before serving application traffic.
GRANT USAGE ON SCHEMA public TO "anon";
GRANT USAGE ON SCHEMA public TO "authenticated";
GRANT USAGE ON SCHEMA public TO "service_role";
GRANT EXECUTE ON FUNCTION public.current_app_user_has_permission(text) TO "anon";
GRANT EXECUTE ON FUNCTION public.current_app_user_has_permission(text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.current_app_user_has_permission(text) TO "service_role";
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO "anon";
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO "service_role";
GRANT EXECUTE ON FUNCTION public.get_reservation_status_counts() TO "anon";
GRANT EXECUTE ON FUNCTION public.get_reservation_status_counts() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_reservation_status_counts() TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_logs TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_logs TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_logs TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.minimum_participant_alerts TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.minimum_participant_alerts TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.minimum_participant_alerts TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservations TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservations TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservations TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tour_dates TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tour_dates TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tour_dates TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tours TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tours TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tours TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permissions TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permissions TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permissions TO "service_role";

