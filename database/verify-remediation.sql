-- Read-only post-cutover audit. Expected result: zero rows. Run as an administrator.
with tables(name) as (values ('tours'),('tour_dates'),('reservations'),('app_users'),
  ('user_permissions'),('email_logs'),('minimum_participant_alerts'),('audit_logs')),
objects as (select name,to_regclass('public.'||name) as oid from tables),
client_roles(name) as (values ('anon'),('authenticated')),
privileges(name) as (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')),
findings as (
 select 'Missing table: '||name as issue from objects where oid is null
 union all
 select 'RLS disabled: '||o.name from objects o join pg_class c on c.oid=o.oid where not c.relrowsecurity
 union all
 select 'Client grant: '||r.name||' '||p.name||' on '||o.name from objects o cross join client_roles r cross join privileges p
 where o.oid is not null and has_table_privilege(r.name,o.oid,p.name)
 union all
 select 'Missing backend SELECT: '||name from objects where oid is not null and not has_table_privilege('service_role',oid,'SELECT')
 union all
 select 'Missing backend INSERT: '||name from objects where oid is not null and name<>'tours' and not has_table_privilege('service_role',oid,'INSERT')
 union all
 select 'Missing backend UPDATE: '||name from objects where oid is not null and name not in ('tours','audit_logs') and not has_table_privilege('service_role',oid,'UPDATE')
 union all
 select 'Client RPC access: '||r.name||' '||p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join client_roles r
 where n.nspname='public' and (p.proname like 'booking_%' or p.proname in ('current_app_user_id','current_app_user_has_permission','get_reservation_status_counts')) and has_function_privilege(r.name,p.oid,'EXECUTE')
 union all
 select 'Missing backend RPC access: '||p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'booking_%' or p.proname='get_reservation_status_counts') and not has_function_privilege('service_role',p.oid,'EXECUTE')
 union all
 select 'Missing booking confirmation sequence' where to_regclass('public.booking_confirmation_seq') is null
 union all
 select 'Client sequence access: '||r.name from client_roles r where to_regclass('public.booking_confirmation_seq') is not null
 and has_sequence_privilege(r.name,'public.booking_confirmation_seq','USAGE,SELECT,UPDATE')
 union all
 select 'Missing backend sequence access' where to_regclass('public.booking_confirmation_seq') is not null
 and not has_sequence_privilege('service_role','public.booking_confirmation_seq','USAGE')
)
select issue from findings order by issue;
