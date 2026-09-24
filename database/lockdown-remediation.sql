-- Apply ONLY after deploying and verifying the guarded server actions.
begin;
-- Every application database operation now happens in guarded server-only code.
revoke all on public.tours,public.tour_dates,public.reservations,public.app_users,
  public.user_permissions,public.email_logs,public.minimum_participant_alerts,public.audit_logs from anon,authenticated;
revoke all on function public.current_app_user_id() from public,anon,authenticated;
revoke all on function public.current_app_user_has_permission(text) from public,anon,authenticated;
revoke all on function public.get_reservation_status_counts() from public,anon,authenticated;
grant execute on function public.get_reservation_status_counts() to service_role;
-- RLS stays enabled. Legacy policies cannot bypass the explicit denied table grants.
commit;
