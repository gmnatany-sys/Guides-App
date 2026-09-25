-- Read-only. Zero findings means the additional permission/data contract holds.
select 'guide_tours RLS disabled' as finding
where not (select relrowsecurity from pg_class where oid='public.guide_tours'::regclass)
union all
select 'Direct client access to guide_tours: ' || role_name
from unnest(array['anon','authenticated']) role_name
where has_table_privilege(role_name,'public.guide_tours','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
union all
select 'Missing guide_tours service privilege: ' || privilege_name
from unnest(array['SELECT','INSERT','UPDATE']) privilege_name
where not has_table_privilege('service_role','public.guide_tours',privilege_name)
union all
select 'Departure has no guide or invalid settings'
where exists(select 1 from public.tour_dates where guide_user_id is null or capacity<1 or minimum_participants<1 or minimum_participants>capacity)
union all
select 'Reservation guide attribution does not match its departure'
where exists(select 1 from public.reservations r join public.tour_dates d on d.id=r.tour_date_id where r.booked_guide_user_id is distinct from d.guide_user_id)
union all
select 'Direct client can execute ' || p.oid::regprocedure::text || ': ' || role_name
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join unnest(array['anon','authenticated']) role_name
where n.nspname='public' and p.proname like 'booking_%'
and has_function_privilege(role_name,p.oid,'EXECUTE');
