-- Additive stage. Apply before the new application, then lockdown-remediation.sql.
-- No business rows are deleted or renumbered. Run the preflight and tests first.
begin;
alter table public.app_users add column if not exists auth_user_id uuid;
create unique index if not exists app_users_auth_user_id_unique on public.app_users(auth_user_id);
-- Refuse ambiguous legacy identities rather than attaching the wrong account.
do $$ begin
  if exists (select lower(email) from public.app_users group by lower(email) having count(*) > 1) then
    raise exception 'Duplicate case-insensitive application emails: resolve before migration';
  end if;
end $$;
update public.app_users a set auth_user_id = u.id from auth.users u
where a.auth_user_id is null and lower(a.email) = lower(u.email);

alter table public.email_logs add column if not exists event_key text;
alter table public.email_logs add column if not exists html_body text;
alter table public.email_logs add column if not exists text_body text;
alter table public.email_logs add column if not exists reservation_snapshot jsonb;
alter table public.email_logs add column if not exists lease_token uuid;
alter table public.email_logs add column if not exists lease_until timestamptz;
alter table public.email_logs add column if not exists first_attempt_at timestamptz;
alter table public.email_logs add column if not exists provider_id text;
alter table public.reservations add column if not exists transition_version bigint not null default 0;
create unique index if not exists email_logs_event_key_unique on public.email_logs(event_key);
create unique index if not exists reservations_confirmation_unique on public.reservations(confirmation_number);
create sequence if not exists public.booking_confirmation_seq start with 1001;
select setval('public.booking_confirmation_seq', greatest(1000,
  coalesce((select max(substring(confirmation_number from '^JT-([0-9]+)$')::bigint)
    from public.reservations where confirmation_number ~ '^JT-[0-9]+$'), 1000),
  (select last_value from public.booking_confirmation_seq)), true);
revoke all on sequence public.booking_confirmation_seq from public, anon, authenticated;
grant usage, select on sequence public.booking_confirmation_seq to service_role;

create or replace function public.booking_assert_actor(p_actor uuid, p_permissions text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.app_users a join public.user_permissions p on p.user_id = a.id
    where a.id = p_actor and a.active and p.enabled and p.permission_key = any(p_permissions)) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
end $$;

create or replace function public.booking_audit(p_actor uuid, p_action text, p_entity text, p_id uuid, p_before jsonb, p_after jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.audit_logs(user_email, action, entity_type, entity_id, before_data, after_data)
  values ((select email from public.app_users where id = p_actor), p_action, p_entity, p_id, p_before, p_after);
$$;

-- Insert an outbox event inside the same transaction as the business operation.
create or replace function public.booking_queue_email(p_reservation uuid, p_type text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare r public.reservations; v_id uuid; v_key text; v_to text; v_cc text; v_subject text; v_snapshot jsonb;
begin
  select * into strict r from public.reservations where id = p_reservation for update;
  if p_type not in ('NEW_BOOKING','CONFIRMED','NOT_CONFIRMED','CANCELLED') then raise exception 'Invalid email event'; end if;
  v_key := 'reservation/' || r.id || '/' || p_type || '/' || case when p_type in ('NEW_BOOKING','CANCELLED') then 0 else r.transition_version end;
  -- Adopt a legacy log, preferring delivery evidence. Preserve every historical row.
  select id into v_id from public.email_logs where reservation_id = r.id and email_type = p_type
    and (event_key=v_key or (event_key is null and (p_type in ('NEW_BOOKING','CANCELLED') or r.transition_version=0)))
    order by (status = 'SENT') desc, created_at, id limit 1 for update;
  if v_id is not null then
    update public.email_logs set
      first_attempt_at = case when event_key is null and status<>'SENT' then coalesce(first_attempt_at,now()-interval '25 hours') else first_attempt_at end,
      event_key = coalesce(event_key, v_key) where id = v_id;
    return v_id;
  end if;
  v_to := case when p_type = 'NEW_BOOKING' then 'itai@mitiya.co' else 'reservation@yapantours.com' end;
  v_cc := 'gmnatany@yapantours.com' || case when p_type in ('CONFIRMED','CANCELLED') then ',itai@mitiya.co' else '' end;
  if p_type = 'CANCELLED' and nullif(r.agent_email,'') is not null then v_cc := v_cc || ',' || r.agent_email; end if;
  v_subject := case p_type when 'NEW_BOOKING' then 'New Tour Reservation - Voucher #'
    when 'CONFIRMED' then 'Tour Reservation Confirmed - Confirmation #'
    when 'NOT_CONFIRMED' then 'Tour Reservation Not Confirmed - Voucher #'
    else 'Tour Reservation Cancelled - Voucher #' end ||
    case when p_type = 'CONFIRMED' then coalesce(r.confirmation_number,'') else r.voucher_number end;
  select to_jsonb(r) || jsonb_build_object('tours',jsonb_build_object('name',t.name),
    'tour_dates',jsonb_build_object('tour_date',d.tour_date)) into v_snapshot
    from public.tours t join public.tour_dates d on d.tour_id=t.id where d.id=r.tour_date_id;
  insert into public.email_logs(reservation_id,email_type,from_email,to_email,cc,subject,status,event_key,reservation_snapshot)
    values (r.id,p_type,case when p_type='NEW_BOOKING' then 'reservation@yapantours.com' else 'info@yapantours.com' end,
      v_to,v_cc,v_subject,'PENDING',v_key,v_snapshot)
    on conflict (event_key) do update set event_key=excluded.event_key returning id into v_id;
  return v_id;
end $$;

create or replace function public.booking_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.tour_dates; t public.tours; a public.app_users; r public.reservations; v_pax integer; v_used integer; v_agent uuid;
begin
  perform public.booking_assert_actor(p_actor,array['booking_form_access']);
  v_pax := (p_input->>'participants')::integer;
  if v_pax is null or v_pax < 1 then raise exception 'Participants must be a positive whole number'; end if;
  if exists(select 1 from jsonb_each_text(p_input) e where e.key in ('voucher_number','reservation_number','lead_passenger_name','whatsapp_number') and (e.value is null or length(trim(e.value))=0 or length(e.value)>500))
    or not (p_input ?& array['voucher_number','reservation_number','lead_passenger_name','whatsapp_number']) then raise exception 'Required booking details are missing or too long'; end if;
  select * into strict d from public.tour_dates where id=(p_input->>'tour_date_id')::uuid for update;
  select * into strict t from public.tours where id=d.tour_id;
  if d.tour_id is distinct from (p_input->>'tour_id')::uuid or
    (nullif(p_input->>'selected_tour_date','') is not null and d.tour_date::text <> p_input->>'selected_tour_date') then
    raise exception 'Selected tour/date mismatch. Please select the date again'; end if;
  if not d.is_open or d.supplier_status='CANCELLED' or not t.active then raise exception 'This date is no longer available'; end if;
  select coalesce(sum(participants),0) into v_used from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
  if t.max_capacity is null or t.max_capacity < 1 or v_used + v_pax > t.max_capacity then raise exception 'Not enough seats available'; end if;
  select case when role='agent' then id else (p_input->>'agent_user_id')::uuid end into v_agent from public.app_users where id=p_actor;
  select * into strict a from public.app_users where id=v_agent and active and role='agent';
  insert into public.reservations(reservation_number,voucher_number,lead_passenger_name,whatsapp_number,participants,tour_id,tour_date_id,status,agent_user_id,agent_name,agent_email)
    values(trim(p_input->>'reservation_number'),trim(p_input->>'voucher_number'),trim(p_input->>'lead_passenger_name'),trim(p_input->>'whatsapp_number'),v_pax,t.id,d.id,'WAITING FOR CONFIRMATION',a.id,a.full_name,a.email) returning * into r;
  perform public.booking_queue_email(r.id,'NEW_BOOKING');
  perform public.booking_audit(p_actor,'CREATE','reservation',r.id,null,to_jsonb(r));
  return to_jsonb(r);
end $$;

create or replace function public.booking_transition(p_actor uuid,p_id uuid,p_status text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.reservations; v_before jsonb; d public.tour_dates; v_used integer; v_capacity integer;
begin
  perform public.booking_assert_actor(p_actor,array['reservations_action_access','supplier_confirmation_action']);
  if p_status not in ('CONFIRMED','NOT CONFIRMED','CANCELLED') or p_status is null then raise exception 'Invalid status'; end if;
  select * into strict d from public.tour_dates where id=(select tour_date_id from public.reservations where id=p_id) for update;
  select * into strict r from public.reservations where id=p_id for update;
  v_before := to_jsonb(r);
  if r.status=p_status then return to_jsonb(r); end if;
  if r.status='CANCELLED' then raise exception 'A cancelled booking cannot be reactivated'; end if;
  if p_status='CONFIRMED' then
    if d.supplier_status='CANCELLED' then raise exception 'This tour date was cancelled'; end if;
    select max_capacity into strict v_capacity from public.tours where id=d.tour_id;
    select coalesce(sum(participants),0) into v_used from public.reservations
      where tour_date_id=d.id and id<>r.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
    if v_used+r.participants>v_capacity then raise exception 'Not enough seats available'; end if;
    r.confirmation_number := coalesce(r.confirmation_number,'JT-' || nextval('public.booking_confirmation_seq'));
  end if;
  update public.reservations set status=p_status,confirmation_number=r.confirmation_number,supplier_response_at=now(),transition_version=transition_version+1,
    cancelled_at=case when p_status='CANCELLED' then now() else cancelled_at end,
    internal_notes=case when nullif(trim(p_note),'') is null then internal_notes else concat_ws(E'\n',nullif(internal_notes,''),p_note) end
    where id=r.id returning * into r;
  perform public.booking_queue_email(r.id,replace(p_status,' ','_'));
  perform public.booking_audit(p_actor,'STATUS','reservation',r.id,v_before,to_jsonb(r));
  return to_jsonb(r);
end $$;

create or replace function public.booking_set_dates(p_actor uuid,p_tour uuid,p_dates date[],p_open boolean,p_status text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_date date; d public.tour_dates; r public.reservations; v_before jsonb; v_ids uuid[] := '{}'; v_cancelled integer := 0; v_count integer := 0;
begin
  perform public.booking_assert_actor(p_actor,array['availability_calendar_manage_access','supplier_confirmation_action']);
  if p_status not in ('YES','NO','CANCELLED') or p_status is null or p_open is null or cardinality(p_dates) not between 1 and 366 then raise exception 'Invalid dates or status'; end if;
  perform 1 from public.tours where id=p_tour;
  if not found then raise exception 'Tour not found'; end if;
  for v_date in select distinct x from unnest(p_dates) x order by x loop
    if v_date is null then raise exception 'Missing date'; end if;
    -- Insert first to serialize concurrent creation of the same date.
    insert into public.tour_dates(tour_id,tour_date,is_open,supplier_status) values(p_tour,v_date,false,'NO') on conflict(tour_id,tour_date) do nothing;
    select * into strict d from public.tour_dates where tour_id=p_tour and tour_date=v_date for update;
    v_before := to_jsonb(d);
    update public.tour_dates set is_open=case when p_status='CANCELLED' then false else p_open end,
      supplier_status=p_status,notes=case when nullif(trim(p_note),'') is null or notes like '%' || p_note || '%' then notes else concat_ws(E'\n',nullif(notes,''),p_note) end,
      updated_at=now() where id=d.id returning * into d;
    if p_status='CANCELLED' then
      for r in select * from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED') order by id for update loop
        perform public.booking_audit(p_actor,'CANCEL','reservation',r.id,to_jsonb(r),jsonb_build_object('status','CANCELLED'));
        update public.reservations set status='CANCELLED',cancelled_at=now(),internal_notes=concat_ws(E'\n',nullif(internal_notes,''),coalesce(nullif(p_note,''),'Tour date cancelled.')) where id=r.id;
        perform public.booking_queue_email(r.id,'CANCELLED');
        v_cancelled := v_cancelled+1;
      end loop;
    end if;
    perform public.booking_audit(p_actor,'DATE','tour_date',d.id,v_before,to_jsonb(d));
    v_ids := array_append(v_ids,d.id); v_count := v_count+1;
  end loop;
  return jsonb_build_object('dateIds',v_ids,'datesProcessed',v_count,'reservationsCancelled',v_cancelled,'emailLogsCreated',v_cancelled);
end $$;

-- Alert decisions and cancellation share the same date lock and transaction.
create or replace function public.booking_resolve_alert(p_actor uuid,p_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.minimum_participant_alerts; d public.tour_dates; r public.reservations; v_count integer := 0;
begin
  perform public.booking_assert_actor(p_actor,array['minimum_participants_action_access']);
  if p_decision not in ('KEEP_TOUR','CANCEL_TOUR') or p_decision is null then raise exception 'Invalid decision'; end if;
  select * into strict d from public.tour_dates where id=(select tour_date_id from public.minimum_participant_alerts where id=p_id) for update;
  select * into strict a from public.minimum_participant_alerts where id=p_id for update;
  if a.supplier_decision='CANCEL_TOUR' and p_decision<>'CANCEL_TOUR' then raise exception 'A cancellation decision has already been recorded'; end if;
  if p_decision='KEEP_TOUR' and d.supplier_status='CANCELLED' then raise exception 'A cancelled date cannot be kept'; end if;
  if p_decision='CANCEL_TOUR' then
    update public.tour_dates set is_open=false,supplier_status='CANCELLED',updated_at=now(),
      notes=concat_ws(E'\n',nullif(notes,''),'Cancelled due to minimum participants not reached.') where id=d.id and supplier_status is distinct from 'CANCELLED';
    for r in select * from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED') order by id for update loop
      update public.reservations set status='CANCELLED',cancelled_at=now(),internal_notes=concat_ws(E'\n',nullif(internal_notes,''),'Cancelled due to minimum participants not reached.') where id=r.id;
      perform public.booking_queue_email(r.id,'CANCELLED'); v_count:=v_count+1;
      perform public.booking_audit(p_actor,'CANCEL','reservation',r.id,to_jsonb(r),jsonb_build_object('status','CANCELLED'));
    end loop;
  end if;
  update public.minimum_participant_alerts set status=case when p_decision='KEEP_TOUR' then 'KEPT' else 'CANCELLED' end,
    supplier_decision=p_decision,supplier_decision_at=case when supplier_decision is distinct from p_decision then now() else coalesce(supplier_decision_at,now()) end,
    notes=coalesce(p_note,notes),updated_at=now() where tour_date_id=d.id;
  perform public.booking_audit(p_actor,p_decision,'minimum_participant_alert',a.id,to_jsonb(a),jsonb_build_object('decision',p_decision));
  return jsonb_build_object('reservationsCancelled',v_count,'emailLogsCreated',v_count,'dateIds',jsonb_build_array(d.id));
end $$;

create or replace function public.booking_participant_counts(p_ids uuid[])
returns table(tour_date_id uuid,participants bigint) language sql security invoker set search_path = '' as $$
  select r.tour_date_id,sum(r.participants) from public.reservations r
  where r.tour_date_id=any(p_ids) and r.status in ('WAITING FOR CONFIRMATION','CONFIRMED') group by r.tour_date_id;
$$;

create or replace function public.booking_participant_stats(p_ids uuid[])
returns table(tour_date_id uuid,participants bigint,created_at timestamptz) language sql security invoker set search_path = '' as $$
  select r.tour_date_id,sum(r.participants),max(r.created_at) from public.reservations r
  where r.tour_date_id=any(p_ids) and r.status in ('WAITING FOR CONFIRMATION','CONFIRMED') group by r.tour_date_id;
$$;

create or replace function public.booking_sync_minimum(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.tour_dates; v_name text; v_days integer; v_pax integer; v_stage text; a public.minimum_participant_alerts;
  v_new boolean; v_subject text; v_body text; v_recipient text; v_recipients text[]; v_cc text; v_key text; v_emails integer:=0;
begin
  select * into strict d from public.tour_dates where id=p_id for update;
  select name into strict v_name from public.tours where id=d.tour_id;
  v_days := d.tour_date - (now() at time zone 'UTC')::date;
  select coalesce(sum(participants),0) into v_pax from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
  if exists(select 1 from public.minimum_participant_alerts where tour_date_id=d.id and status in ('KEPT','CANCELLED')) then
    return jsonb_build_object('created',0,'skipped',1,'emailLogsCreated',0,'emailLogsSkipped',0,'details',jsonb_build_array('Supplier decision retained')); end if;
  if v_pax<1 or v_pax>=4 or not d.is_open or d.supplier_status='CANCELLED' or v_days<0 or v_days>7 then
    update public.minimum_participant_alerts set status='RESOLVED',active_participants=v_pax,days_before_tour=v_days,updated_at=now() where tour_date_id=d.id and status='OPEN';
    return jsonb_build_object('created',0,'skipped',1,'emailLogsCreated',0,'emailLogsSkipped',0,'details','[]'::jsonb); end if;
  v_stage := case when v_days<=3 then 'SUPPLIER_DECISION_REQUIRED_3_DAYS' when v_days<=5 then 'LOW_PARTICIPANTS_5_DAYS' else 'LOW_PARTICIPANTS_7_DAYS' end;
  select * into a from public.minimum_participant_alerts where tour_date_id=d.id and alert_stage=v_stage;
  v_new := a.id is null;
  -- Preserve each historical stage. Do not rename one row into an existing unique key.
  update public.minimum_participant_alerts set status='RESOLVED',updated_at=now() where tour_date_id=d.id and status='OPEN' and alert_stage<>v_stage;
  insert into public.minimum_participant_alerts(tour_date_id,alert_stage,status,active_participants,minimum_required,days_before_tour)
    values(d.id,v_stage,'OPEN',v_pax,4,v_days) on conflict(tour_date_id,alert_stage) do update
    set status='OPEN',active_participants=excluded.active_participants,days_before_tour=excluded.days_before_tour,updated_at=now() returning * into a;
  if v_new then
    v_subject := case when v_days<=3 then 'Supplier Decision Required - Minimum Participants - ' else 'Low Participants Alert - ' end || v_name || ' - ' || d.tour_date;
    v_body := format('Tour: %s. Date: %s. Active participants: %s. Minimum required: 4. Days before tour: %s. Please review Minimum Participants in the application.',v_name,d.tour_date,v_pax,v_days);
    if v_days<=3 then v_recipients:=array['itai@mitiya.co'];
    else
      select array['gmnatany@yapantours.com'] || coalesce(array_agg(distinct agent_email) filter(where nullif(agent_email,'') is not null),'{}') into v_recipients
      from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
    end if;
    for v_recipient in select distinct unnest(v_recipients) loop
      v_key:='minimum/' || d.id || '/' || v_stage || '/' || lower(v_recipient);
      v_cc:=case when v_recipient='gmnatany@yapantours.com' then 'reservation@yapantours.com,itai@mitiya.co' else 'gmnatany@yapantours.com,reservation@yapantours.com' end;
      -- Legacy delivery evidence is sufficient; never send the same stage again.
      if not exists(select 1 from public.email_logs where email_type=v_stage and subject=v_subject and to_email=v_recipient) then
        insert into public.email_logs(email_type,from_email,to_email,cc,subject,status,event_key,text_body)
          values(v_stage,'info@yapantours.com',v_recipient,v_cc,v_subject,'PENDING',v_key,v_body) on conflict(event_key) do nothing;
        if found then v_emails:=v_emails+1; end if;
      end if;
    end loop;
  end if;
  return jsonb_build_object('created',case when v_new then 1 else 0 end,'skipped',case when v_new then 0 else 1 end,
    'emailLogsCreated',v_emails,'emailLogsSkipped',0,'details','[]'::jsonb);
end $$;

create or replace function public.booking_check_minimum()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d record; r jsonb; v_created integer:=0;v_skipped integer:=0;v_emails integer:=0;
begin
  for d in select id from public.tour_dates where tour_date between (now() at time zone 'UTC')::date and (now() at time zone 'UTC')::date+7 order by id loop
    r:=public.booking_sync_minimum(d.id);
    v_created:=v_created+(r->>'created')::integer;v_skipped:=v_skipped+(r->>'skipped')::integer;v_emails:=v_emails+(r->>'emailLogsCreated')::integer;
  end loop;
  return jsonb_build_object('success',true,'alertsCreated',v_created,'alertsSkipped',v_skipped,'emailLogsCreated',v_emails,'emailLogsSkipped',0,'details','[]'::jsonb);
end $$;

create or replace function public.booking_claim_email(p_id uuid,p_token uuid)
returns setof public.email_logs language plpgsql security invoker set search_path = '' as $$
begin
  return query update public.email_logs set lease_token=p_token,lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now())
    where id=p_id and event_key is not null and status in ('PENDING','FAILED','ERROR')
    and html_body is not null and text_body is not null
    and (lease_until is null or lease_until<now())
    and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours') returning *;
end $$;

-- Explicit least-privilege access: these are backend-only RPCs, not user-callable.
create or replace function public.booking_save_user(p_actor uuid,p_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.app_users; v_before jsonb;
begin
  perform public.booking_assert_actor(p_actor,array['users_manage_access']);
  if p_id is not null then select * into strict r from public.app_users where id=p_id for update; v_before:=to_jsonb(r); end if;
  if p_input ? 'full_name' then r.full_name:=trim(p_input->>'full_name'); end if;
  if p_input ? 'email' then r.email:=lower(trim(p_input->>'email')); end if;
  if p_input ? 'role' then r.role:=p_input->>'role'; end if;
  if p_input ? 'active' then r.active:=(p_input->>'active')::boolean; end if;
  if p_input ? 'auth_user_id' then r.auth_user_id:=(p_input->>'auth_user_id')::uuid; end if;
  if r.full_name is null or length(r.full_name) not between 1 and 200 or r.email is null or r.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or r.role is null or r.role not in ('admin','operation','agent','supplier') or r.active is null then raise exception 'Invalid user details'; end if;
  if p_id=p_actor and not r.active then raise exception 'You cannot deactivate your own account'; end if;
  if exists(select 1 from public.app_users where lower(email)=r.email and id is distinct from p_id) then raise exception 'A user with this email already exists'; end if;
  if p_id is null then
    insert into public.app_users(full_name,email,role,active,auth_user_id) values(r.full_name,r.email,r.role,r.active,r.auth_user_id) returning * into r;
  else
    update public.app_users set full_name=r.full_name,email=r.email,role=r.role,active=r.active,auth_user_id=r.auth_user_id where id=p_id returning * into r;
  end if;
  perform public.booking_audit(p_actor,'USER','app_user',r.id,v_before,to_jsonb(r));
  return to_jsonb(r);
end $$;

create or replace function public.booking_save_permissions(p_actor uuid,p_id uuid,p_permissions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare p jsonb;
begin
  perform public.booking_assert_actor(p_actor,array['users_manage_access']);
  perform 1 from public.app_users where id=p_id for update;
  if not found then raise exception 'User not found'; end if;
  for p in select * from jsonb_array_elements(p_permissions) loop
    if (p->>'key') is null or (p->>'key') not in ('tours_manage_access','open_dates_view_access','availability_calendar_manage_access',
      'reservations_view_access','reservations_search_access','reservations_action_access','minimum_participants_view_access','minimum_participants_action_access',
      'email_logs_view_access','email_logs_manage_access','users_manage_access','availability_view_access','supplier_confirmation_view','supplier_confirmation_action','booking_form_access')
      or jsonb_typeof(p->'enabled') is distinct from 'boolean' then raise exception 'Invalid permission'; end if;
    if p_actor=p_id and p->>'key'='users_manage_access' and not (p->>'enabled')::boolean then raise exception 'You cannot remove your own user-management access'; end if;
    insert into public.user_permissions(user_id,permission_key,enabled) values(p_id,p->>'key',(p->>'enabled')::boolean)
      on conflict(user_id,permission_key) do update set enabled=excluded.enabled,updated_at=now();
  end loop;
  perform public.booking_audit(p_actor,'PERMISSIONS','app_user',p_id,null,p_permissions);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'booking_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
grant select,insert,update on public.reservations,public.tour_dates,public.app_users,public.user_permissions,public.email_logs,public.minimum_participant_alerts to service_role;
grant select on public.tours to service_role;
grant insert,select on public.audit_logs to service_role;
commit;
