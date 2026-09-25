-- DRAFT for isolated verification. Generate a migration filename with the official CLI before release.
-- Requires the completed booking remediation. Never apply to production before the staged release review.
begin;
set local lock_timeout='5s';
create table public.guide_tours (
  guide_user_id uuid not null references public.app_users(id),
  tour_id uuid not null references public.tours(id),
  active boolean not null default true,
  primary key(guide_user_id,tour_id)
);
alter table public.guide_tours enable row level security;
revoke all on public.guide_tours from public,anon,authenticated;
grant select,insert,update on public.guide_tours to service_role;
create index guide_tours_tour_idx on public.guide_tours(tour_id,guide_user_id);
alter table public.tours add column if not exists description text;
alter table public.tours add column default_guide_user_id uuid references public.app_users(id);
alter table public.tour_dates add column guide_user_id uuid references public.app_users(id);
alter table public.tour_dates add column capacity integer;
alter table public.tour_dates add column minimum_participants integer;
alter table public.reservations add column booked_guide_user_id uuid references public.app_users(id);
-- Existing installations have one supplier. Refuse an ambiguous backfill.
do $$ declare v_guide uuid; begin
 if exists(select 1 from public.tours) then
  if (select count(*) from public.app_users where role='supplier')<>1 then
   raise exception 'Expected exactly one legacy supplier; review an explicit mapping before migration';
  end if;
  select id into strict v_guide from public.app_users where role='supplier';
  update public.tours set default_guide_user_id=v_guide;
  insert into public.guide_tours(guide_user_id,tour_id) select v_guide,id from public.tours;
 end if;
end $$;
update public.tour_dates d set guide_user_id=t.default_guide_user_id,capacity=t.max_capacity,minimum_participants=t.min_participants from public.tours t where t.id=d.tour_id;
update public.reservations r set booked_guide_user_id=d.guide_user_id from public.tour_dates d where d.id=r.tour_date_id;
alter table public.tour_dates alter column guide_user_id set not null;
alter table public.tour_dates alter column capacity set not null;
alter table public.tour_dates alter column minimum_participants set not null;
alter table public.tour_dates add constraint departure_capacity_check check(capacity>0 and minimum_participants>0 and minimum_participants<=capacity);
alter table public.tour_dates drop constraint tour_dates_tour_id_tour_date_key;
alter table public.tour_dates add constraint tour_dates_tour_date_guide_key unique(tour_id,tour_date,guide_user_id);
create index tours_default_guide_idx on public.tours(default_guide_user_id);
create index reservations_booked_guide_idx on public.reservations(booked_guide_user_id);
create index tour_dates_guide_date_idx on public.tour_dates(guide_user_id,tour_date);
grant insert,update on public.tours to service_role;

create or replace function public.booking_assert_guide_scope(p_actor uuid,p_date uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.app_users where id=p_actor and active) then raise exception 'Permission denied' using errcode='42501'; end if;
 if exists(select 1 from public.app_users where id=p_actor and role='supplier')
   and not exists(select 1 from public.tour_dates where id=p_date and guide_user_id=p_actor) then
  raise exception 'This departure belongs to another guide' using errcode='42501';
 end if;
end $$;

create or replace function public.booking_guide_email(p_date uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare v_email text;
begin
 select u.email into strict v_email from public.tour_dates d join public.app_users u on u.id=d.guide_user_id where d.id=p_date;
 if nullif(trim(v_email),'') is null then raise exception 'The departure guide has no notification email'; end if;
 return v_email;
end $$;


create or replace function public.booking_assert_actor(p_actor uuid, p_permissions text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.app_users a join public.user_permissions p on p.user_id = a.id
    where a.id = p_actor and a.active and p.enabled and (a.role<>'supplier' or p.permission_key in ('supplier_confirmation_view','supplier_confirmation_action','availability_view_access','minimum_participants_view_access','minimum_participants_action_access')) and p.permission_key = any(p_permissions)) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
end $$;

create or replace function public.booking_queue_email(p_reservation uuid, p_type text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare r public.reservations; v_id uuid; v_key text; v_to text; v_cc text; v_subject text; v_snapshot jsonb; v_guide_email text;
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
  v_guide_email := public.booking_guide_email(r.tour_date_id);
  v_to := case when p_type = 'NEW_BOOKING' then v_guide_email else 'reservation@yapantours.com' end;
  v_cc := 'gmnatany@yapantours.com' || case when p_type in ('CONFIRMED','CANCELLED') then ',' || v_guide_email else '' end;
  if p_type = 'CANCELLED' and nullif(r.agent_email,'') is not null then v_cc := v_cc || ',' || r.agent_email; end if;
  v_subject := case p_type when 'NEW_BOOKING' then 'New Tour Reservation - Voucher #'
    when 'CONFIRMED' then 'Tour Reservation Confirmed - Confirmation #'
    when 'NOT_CONFIRMED' then 'Tour Reservation Not Confirmed - Voucher #'
    else 'Tour Reservation Cancelled - Voucher #' end ||
    case when p_type = 'CONFIRMED' then coalesce(r.confirmation_number,'') else r.voucher_number end;
  select to_jsonb(r) || jsonb_build_object('tours',jsonb_build_object('name',t.name),
    'guide',jsonb_build_object('id',d.guide_user_id,'name',(select full_name from public.app_users where id=d.guide_user_id)), 'tour_dates',jsonb_build_object('tour_date',d.tour_date)) into v_snapshot
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
  perform public.booking_assert_guide_scope(p_actor,d.id);
  if nullif(p_input->>'guide_user_id','') is not null and (p_input->>'guide_user_id')::uuid<>d.guide_user_id then raise exception 'Selected guide does not match this departure'; end if;
  perform 1 from public.app_users where id=d.guide_user_id for share;
  select * into strict t from public.tours where id=d.tour_id for share;
  if d.tour_id is distinct from (p_input->>'tour_id')::uuid or
    (nullif(p_input->>'selected_tour_date','') is not null and d.tour_date::text <> p_input->>'selected_tour_date') then
    raise exception 'Selected tour/date mismatch. Please select the date again'; end if;
  if not d.is_open or d.supplier_status='CANCELLED' or not t.active or not exists(select 1 from public.app_users u join public.guide_tours g on g.guide_user_id=u.id where u.id=d.guide_user_id and u.active and u.role='supplier' and g.tour_id=d.tour_id and g.active) then raise exception 'This date is no longer available'; end if;
  select coalesce(sum(participants),0) into v_used from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
  if d.capacity is null or d.capacity < 1 or v_used + v_pax > d.capacity then raise exception 'Not enough seats available'; end if;
  select case when role='agent' then id else (p_input->>'agent_user_id')::uuid end into v_agent from public.app_users where id=p_actor;
  select * into strict a from public.app_users where id=v_agent and active and role='agent';
  insert into public.reservations(reservation_number,voucher_number,lead_passenger_name,whatsapp_number,participants,tour_id,tour_date_id,status,agent_user_id,agent_name,agent_email,booked_guide_user_id)
    values(trim(p_input->>'reservation_number'),trim(p_input->>'voucher_number'),trim(p_input->>'lead_passenger_name'),trim(p_input->>'whatsapp_number'),v_pax,t.id,d.id,'WAITING FOR CONFIRMATION',a.id,a.full_name,a.email,d.guide_user_id) returning * into r;
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
  perform public.booking_assert_guide_scope(p_actor,d.id);
  select * into strict r from public.reservations where id=p_id for update;
  v_before := to_jsonb(r);
  if r.status=p_status then return to_jsonb(r); end if;
  if r.status='CANCELLED' then raise exception 'A cancelled booking cannot be reactivated'; end if;
  if p_status='CONFIRMED' then
    if d.supplier_status='CANCELLED' then raise exception 'This tour date was cancelled'; end if;
    v_capacity:=d.capacity;
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

create or replace function public.booking_set_guide_dates(p_actor uuid,p_tour uuid,p_guide uuid,p_dates date[],p_open boolean,p_status text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_date date; d public.tour_dates; r public.reservations; v_before jsonb; v_ids uuid[] := '{}'; v_cancelled integer := 0; v_count integer := 0;
begin
  perform public.booking_assert_actor(p_actor,array['availability_calendar_manage_access','supplier_confirmation_action']);
  if p_status not in ('YES','NO','CANCELLED') or p_status is null or p_open is null or cardinality(p_dates) not between 1 and 366 then raise exception 'Invalid dates or status'; end if;
  if exists(select 1 from public.app_users where id=p_actor and role='supplier' and id is distinct from p_guide) then raise exception 'This guide is outside your access' using errcode='42501'; end if;
  perform 1 from public.tours where id=p_tour for share;
  if not found then raise exception 'Tour not found'; end if;
  perform 1 from public.app_users where id=p_guide for share;
  if ((p_open and p_status='YES') or exists(select 1 from unnest(p_dates) selected_date where not exists(select 1 from public.tour_dates where tour_id=p_tour and tour_date=selected_date and guide_user_id=p_guide))) and (not exists(select 1 from public.tours where id=p_tour and active) or not exists(select 1 from public.guide_tours g join public.app_users u on u.id=g.guide_user_id where g.guide_user_id=p_guide and g.tour_id=p_tour and g.active and u.active and u.role='supplier')) then raise exception 'Guide is not active or assigned to this tour'; end if;
  if p_status='CANCELLED' and exists(select 1 from unnest(p_dates) day where not exists(select 1 from public.tour_dates where tour_id=p_tour and tour_date=day and guide_user_id=p_guide)) then raise exception 'Cannot cancel a departure that does not exist'; end if;
  for v_date in select distinct x from unnest(p_dates) x order by x loop
    if v_date is null then raise exception 'Missing date'; end if;
    -- Insert first to serialize concurrent creation of the same date.
    insert into public.tour_dates(tour_id,tour_date,guide_user_id,capacity,minimum_participants,is_open,supplier_status) select p_tour,v_date,p_guide,max_capacity,min_participants,false,'NO' from public.tours where id=p_tour on conflict(tour_id,tour_date,guide_user_id) do nothing;
    select * into strict d from public.tour_dates where tour_id=p_tour and tour_date=v_date and guide_user_id=p_guide for update;
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

-- Old call sites resolve a single guide; never fan out a cancellation across guides.
create or replace function public.booking_set_dates(p_actor uuid,p_tour uuid,p_dates date[],p_open boolean,p_status text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_guide uuid;
begin
 select case when u.role='supplier' then u.id else t.default_guide_user_id end into v_guide from public.app_users u cross join public.tours t where u.id=p_actor and t.id=p_tour;
 if v_guide is null then raise exception 'Select a guide for this tour'; end if;
 return public.booking_set_guide_dates(p_actor,p_tour,v_guide,p_dates,p_open,p_status,p_note);
end $$;

create or replace function public.booking_resolve_alert(p_actor uuid,p_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.minimum_participant_alerts; d public.tour_dates; r public.reservations; v_count integer := 0;
begin
  perform public.booking_assert_actor(p_actor,array['minimum_participants_action_access']);
  if p_decision not in ('KEEP_TOUR','CANCEL_TOUR') or p_decision is null then raise exception 'Invalid decision'; end if;
  select * into strict d from public.tour_dates where id=(select tour_date_id from public.minimum_participant_alerts where id=p_id) for update;
  perform public.booking_assert_guide_scope(p_actor,d.id);
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

create or replace function public.booking_sync_minimum(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.tour_dates; v_name text; v_days integer; v_pax integer; v_stage text; a public.minimum_participant_alerts;
  v_new boolean; v_subject text; v_body text; v_recipient text; v_recipients text[]; v_cc text; v_key text; v_emails integer:=0; v_guide_email text;
begin
  select * into strict d from public.tour_dates where id=p_id for update;
  select name into strict v_name from public.tours where id=d.tour_id;
  v_days := d.tour_date - (now() at time zone 'UTC')::date;
  select coalesce(sum(participants),0) into v_pax from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
  if exists(select 1 from public.minimum_participant_alerts where tour_date_id=d.id and status in ('KEPT','CANCELLED')) then
    return jsonb_build_object('created',0,'skipped',1,'emailLogsCreated',0,'emailLogsSkipped',0,'details',jsonb_build_array('Supplier decision retained')); end if;
  if v_pax<1 or v_pax>=d.minimum_participants or not d.is_open or d.supplier_status='CANCELLED' or v_days<0 or v_days>7 then
    update public.minimum_participant_alerts set status='RESOLVED',active_participants=v_pax,days_before_tour=v_days,updated_at=now() where tour_date_id=d.id and status='OPEN';
    return jsonb_build_object('created',0,'skipped',1,'emailLogsCreated',0,'emailLogsSkipped',0,'details','[]'::jsonb); end if;
  v_stage := case when v_days<=3 then 'SUPPLIER_DECISION_REQUIRED_3_DAYS' when v_days<=5 then 'LOW_PARTICIPANTS_5_DAYS' else 'LOW_PARTICIPANTS_7_DAYS' end;
  select * into a from public.minimum_participant_alerts where tour_date_id=d.id and alert_stage=v_stage;
  v_new := a.id is null;
  -- Preserve each historical stage. Do not rename one row into an existing unique key.
  update public.minimum_participant_alerts set status='RESOLVED',updated_at=now() where tour_date_id=d.id and status='OPEN' and alert_stage<>v_stage;
  insert into public.minimum_participant_alerts(tour_date_id,alert_stage,status,active_participants,minimum_required,days_before_tour)
    values(d.id,v_stage,'OPEN',v_pax,d.minimum_participants,v_days) on conflict(tour_date_id,alert_stage) do update
    set status='OPEN',active_participants=excluded.active_participants,days_before_tour=excluded.days_before_tour,updated_at=now() returning * into a;
  if true then -- Ensure missing outbox entries; event keys make repeated sync idempotent.
    v_subject := case when v_days<=3 then 'Supplier Decision Required - Minimum Participants - ' else 'Low Participants Alert - ' end || v_name || ' - ' || d.tour_date;
    v_body := format('Tour: %s. Date: %s. Active participants: %s. Minimum required: %s. Days before tour: %s. Please review Minimum Participants in the application.',v_name,d.tour_date,v_pax,d.minimum_participants,v_days);
    v_guide_email:=public.booking_guide_email(d.id);
    v_body:=v_body || format(' Guide: %s.',(select full_name from public.app_users where id=d.guide_user_id));
    if v_days<=3 then v_recipients:=array[v_guide_email];
    else
      select array['gmnatany@yapantours.com'] || coalesce(array_agg(distinct agent_email) filter(where nullif(agent_email,'') is not null),'{}') into v_recipients
      from public.reservations where tour_date_id=d.id and status in ('WAITING FOR CONFIRMATION','CONFIRMED');
    end if;
    for v_recipient in select distinct unnest(v_recipients) loop
      v_key:='minimum/' || d.id || '/' || v_stage || '/' || lower(v_recipient);
      v_cc:=case when v_recipient='gmnatany@yapantours.com' then 'reservation@yapantours.com,' || v_guide_email else 'gmnatany@yapantours.com,reservation@yapantours.com' end;
      -- Legacy delivery evidence is sufficient; never send the same stage again.
      if not exists(select 1 from public.email_logs where email_type=v_stage and to_email=v_recipient and (event_key=v_key or (event_key is null and subject=v_subject and (reservation_id in (select id from public.reservations where tour_date_id=d.id) or v_guide_email=any(string_to_array(replace(coalesce(cc,''),' ',''),',')) or to_email=v_guide_email)))) then
        insert into public.email_logs(email_type,from_email,to_email,cc,subject,status,event_key,text_body)
          values(v_stage,'info@yapantours.com',v_recipient,v_cc,v_subject,'PENDING',v_key,v_body) on conflict(event_key) do nothing;
        if found then v_emails:=v_emails+1; end if;
      end if;
    end loop;
  end if;
  return jsonb_build_object('created',case when v_new then 1 else 0 end,'skipped',case when v_new then 0 else 1 end,
    'emailLogsCreated',v_emails,'emailLogsSkipped',0,'details','[]'::jsonb);
end $$;

create or replace function public.booking_check_guide_minimum(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d record; r jsonb; v_created integer:=0; v_skipped integer:=0; v_emails integer:=0;
begin
 perform public.booking_assert_actor(p_actor,array['minimum_participants_action_access']);
 for d in select td.id from public.tour_dates td where td.tour_date between (now() at time zone 'UTC')::date and (now() at time zone 'UTC')::date+7
 and (not exists(select 1 from public.app_users where id=p_actor and role='supplier') or td.guide_user_id=p_actor) order by td.id loop
  r:=public.booking_sync_minimum(d.id); v_created:=v_created+(r->>'created')::integer; v_skipped:=v_skipped+(r->>'skipped')::integer; v_emails:=v_emails+(r->>'emailLogsCreated')::integer;
 end loop;
 return jsonb_build_object('success',true,'alertsCreated',v_created,'alertsSkipped',v_skipped,'emailLogsCreated',v_emails,'emailLogsSkipped',0,'details','[]'::jsonb);
end $$;

create or replace function public.booking_save_tour(p_actor uuid,p_id uuid,p_input jsonb,p_guides uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.tours; v_before jsonb; v_guide uuid; v_default uuid;
begin
 perform public.booking_assert_actor(p_actor,array['tours_manage_access']);
 if p_id is not null then select * into strict t from public.tours where id=p_id for update; v_before:=to_jsonb(t); end if;
 if cardinality(p_guides) is null or cardinality(p_guides)<1 then raise exception 'Assign at least one guide'; end if;
 foreach v_guide in array p_guides loop
  perform 1 from public.app_users where id=v_guide and role='supplier' and active for share;
  if not found then raise exception 'Select an active guide'; end if;
 end loop;
 v_default:=(p_input->>'default_guide_user_id')::uuid;
 if v_default is null or not(v_default=any(p_guides)) then raise exception 'Default guide must be assigned to the tour'; end if;
 t.name:=trim(p_input->>'name'); t.description:=nullif(trim(p_input->>'description'),''); t.max_capacity:=(p_input->>'max_capacity')::integer; t.min_participants:=(p_input->>'min_participants')::integer; t.active:=(p_input->>'active')::boolean;
 if t.name is null or length(t.name) not between 1 and 200 or t.max_capacity is null or t.min_participants is null or t.max_capacity<1 or t.min_participants<1 or t.min_participants>t.max_capacity or t.active is null then raise exception 'Enter a name and valid minimum/capacity'; end if;
 if exists(select 1 from public.tour_dates d where d.tour_id=p_id and not(d.guide_user_id=any(p_guides)) and d.tour_date>=(now() at time zone 'UTC')::date and (d.is_open or exists(select 1 from public.reservations r where r.tour_date_id=d.id and r.status in ('WAITING FOR CONFIRMATION','CONFIRMED')))) then raise exception 'This guide still has future departures; close empty departures or cancel their bookings before removing the guide'; end if;
 if p_id is null then
  insert into public.tours(name,description,max_capacity,min_participants,active,default_guide_user_id) values(t.name,t.description,t.max_capacity,t.min_participants,t.active,v_default) returning * into t;
 else
  update public.tours set name=t.name,description=t.description,max_capacity=t.max_capacity,min_participants=t.min_participants,active=t.active,default_guide_user_id=v_default where id=p_id returning * into t;
 end if;
 update public.guide_tours set active=false where tour_id=t.id and not(guide_user_id=any(p_guides));
 foreach v_guide in array p_guides loop
  insert into public.guide_tours(guide_user_id,tour_id,active) values(v_guide,t.id,true) on conflict(guide_user_id,tour_id) do update set active=true;
 end loop;
 perform public.booking_audit(p_actor,'TOUR','tour',t.id,v_before,to_jsonb(t)||jsonb_build_object('guides',p_guides));
 return to_jsonb(t);
end $$;


create or replace function public.booking_supplier_counts(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_counts jsonb;
begin
 perform public.booking_assert_actor(p_actor,array['supplier_confirmation_view']);
 select jsonb_build_object('waiting',count(*) filter(where r.status='WAITING FOR CONFIRMATION'), 'confirmed',count(*) filter(where r.status='CONFIRMED'), 'notConfirmed',count(*) filter(where r.status='NOT CONFIRMED'), 'cancelled',count(*) filter(where r.status='CANCELLED')) into v_counts
 from public.reservations r join public.tour_dates d on d.id=r.tour_date_id
 where not exists(select 1 from public.app_users where id=p_actor and role='supplier') or d.guide_user_id=p_actor;
 return v_counts;
end $$;


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
  if p_id is not null and exists(select 1 from public.tour_dates where guide_user_id=p_id) and r.role<>'supplier' then raise exception 'A guide with departure history must retain the guide role'; end if;
  if p_id is not null and not r.active and exists(select 1 from public.tour_dates d where d.guide_user_id=p_id and d.tour_date>=(now() at time zone 'UTC')::date and (d.is_open or exists(select 1 from public.reservations x where x.tour_date_id=d.id and x.status in ('WAITING FOR CONFIRMATION','CONFIRMED')))) then raise exception 'This guide has future departures; close empty departures or cancel their bookings before deactivation'; end if;
  if p_id=p_actor and not r.active then raise exception 'You cannot deactivate your own account'; end if;
  if exists(select 1 from public.app_users where lower(email)=r.email and id is distinct from p_id) then raise exception 'A user with this email already exists'; end if;
  if p_id is null then
    insert into public.app_users(full_name,email,role,active,auth_user_id) values(r.full_name,r.email,r.role,r.active,r.auth_user_id) returning * into r;
  else
    update public.app_users set full_name=r.full_name,email=r.email,role=r.role,active=r.active,auth_user_id=r.auth_user_id where id=p_id returning * into r;
  end if;
  if p_id is null and r.role='supplier' then
   insert into public.user_permissions(user_id,permission_key,enabled)
   select r.id,k,true from unnest(array['supplier_confirmation_view','supplier_confirmation_action','availability_view_access','minimum_participants_view_access','minimum_participants_action_access']) k;
  end if;
  perform public.booking_audit(p_actor,'USER','app_user',r.id,v_before,to_jsonb(r));
  return to_jsonb(r);
end $$;

alter function public.get_reservation_status_counts() set search_path='';
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'booking_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
commit;
