-- Sanitized schema fixture captured before remediation; no customer data.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text);
create function auth.email() returns text language sql stable as $$select current_setting('test.email',true)$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public."minimum_participant_alerts"("id" uuid default gen_random_uuid() not null,"tour_date_id" uuid not null,"alert_stage" text not null,"active_participants" integer not null,"minimum_required" integer default 4 not null,"days_before_tour" integer not null,"status" text default 'OPEN'::text not null,"supplier_decision" text,"supplier_decision_at" timestamp with time zone,"notes" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public."audit_logs"("id" uuid default gen_random_uuid() not null,"user_email" text,"action" text not null,"entity_type" text not null,"entity_id" uuid,"before_data" jsonb,"after_data" jsonb,"created_at" timestamp with time zone default now() not null);
create table public."email_logs"("id" uuid default gen_random_uuid() not null,"reservation_id" uuid,"email_type" text not null,"from_email" text,"to_email" text,"cc" text,"subject" text,"status" text default 'PENDING'::text not null,"error_message" text,"sent_at" timestamp with time zone,"created_at" timestamp with time zone default now() not null);
create table public."reservations"("id" uuid default gen_random_uuid() not null,"reservation_number" text not null,"voucher_number" text not null,"lead_passenger_name" text not null,"whatsapp_number" text,"participants" integer not null,"tour_id" uuid not null,"tour_date_id" uuid not null,"status" text default 'WAITING FOR CONFIRMATION'::text not null,"confirmation_number" text,"internal_notes" text,"supplier_email_sent_at" timestamp with time zone,"confirmation_email_sent_at" timestamp with time zone,"cancellation_email_sent_at" timestamp with time zone,"supplier_response_at" timestamp with time zone,"cancelled_at" timestamp with time zone,"created_at" timestamp with time zone default now() not null,"agent_user_id" uuid,"agent_name" text,"agent_email" text);
create table public."app_users"("id" uuid default gen_random_uuid() not null,"full_name" text not null,"email" text not null,"role" text not null,"active" boolean default true not null,"created_at" timestamp with time zone default now());
create table public."tour_dates"("id" uuid default gen_random_uuid() not null,"tour_id" uuid not null,"tour_date" date not null,"is_open" boolean default false not null,"supplier_status" text default 'NO'::text not null,"notes" text,"updated_by" text,"updated_at" timestamp with time zone default now() not null,"created_at" timestamp with time zone default now() not null);
create table public."tours"("id" uuid default gen_random_uuid() not null,"name" text not null,"max_capacity" integer default 8 not null,"min_participants" integer default 4 not null,"active" boolean default true not null,"created_at" timestamp with time zone default now() not null);
create table public."user_permissions"("id" uuid default gen_random_uuid() not null,"user_id" uuid not null,"permission_key" text not null,"enabled" boolean default false not null,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
alter table public."tours" add constraint "tours_pkey" PRIMARY KEY (id);
alter table public."tours" add constraint "tours_name_key" UNIQUE (name);
alter table public."tour_dates" add constraint "tour_dates_pkey" PRIMARY KEY (id);
alter table public."tour_dates" add constraint "tour_dates_tour_id_tour_date_key" UNIQUE (tour_id, tour_date);
alter table public."reservations" add constraint "reservations_pkey" PRIMARY KEY (id);
alter table public."reservations" add constraint "reservations_voucher_number_key" UNIQUE (voucher_number);
alter table public."email_logs" add constraint "email_logs_pkey" PRIMARY KEY (id);
alter table public."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY (id);
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_supplier_decision_check" CHECK (((supplier_decision = ANY (ARRAY['KEEP_TOUR'::text, 'CANCEL_TOUR'::text])) OR (supplier_decision IS NULL)));
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_pkey" PRIMARY KEY (id);
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_tour_date_id_alert_stage_key" UNIQUE (tour_date_id, alert_stage);
alter table public."app_users" add constraint "app_users_pkey" PRIMARY KEY (id);
alter table public."app_users" add constraint "app_users_email_key" UNIQUE (email);
alter table public."user_permissions" add constraint "user_permissions_pkey" PRIMARY KEY (id);
alter table public."user_permissions" add constraint "user_permissions_user_id_permission_key_key" UNIQUE (user_id, permission_key);
alter table public."app_users" add constraint "app_users_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'operation'::text, 'agent'::text, 'supplier'::text])));
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_alert_stage_check" CHECK ((alert_stage = ANY (ARRAY['LOW_PARTICIPANTS_7_DAYS'::text, 'LOW_PARTICIPANTS_5_DAYS'::text, 'SUPPLIER_DECISION_REQUIRED_3_DAYS'::text])));
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text, 'CANCELLED'::text, 'KEPT'::text])));
alter table public."tour_dates" add constraint "tour_dates_tour_id_fkey" FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE;
alter table public."reservations" add constraint "reservations_tour_id_fkey" FOREIGN KEY (tour_id) REFERENCES tours(id);
alter table public."reservations" add constraint "reservations_tour_date_id_fkey" FOREIGN KEY (tour_date_id) REFERENCES tour_dates(id);
alter table public."email_logs" add constraint "email_logs_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;
alter table public."minimum_participant_alerts" add constraint "minimum_participant_alerts_tour_date_id_fkey" FOREIGN KEY (tour_date_id) REFERENCES tour_dates(id) ON DELETE CASCADE;
alter table public."reservations" add constraint "reservations_agent_user_id_fkey" FOREIGN KEY (agent_user_id) REFERENCES app_users(id);
alter table public."user_permissions" add constraint "user_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.current_app_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id
  FROM public.app_users
  WHERE lower(email) = lower(auth.email())
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.current_app_user_has_permission(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT up.enabled
      FROM public.user_permissions up
      WHERE up.user_id = public.current_app_user_id()
        AND up.permission_key = p_key
    ),
    false
  )
$function$
;
CREATE OR REPLACE FUNCTION public.get_reservation_status_counts()
 RETURNS TABLE(status text, count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.status::text, COUNT(*)::bigint
  FROM public.reservations r
  GROUP BY r.status;
$function$
;
alter table public."minimum_participant_alerts" enable row level security;
grant all on public."minimum_participant_alerts" to anon,authenticated,service_role;
alter table public."audit_logs" enable row level security;
grant all on public."audit_logs" to anon,authenticated,service_role;
alter table public."email_logs" enable row level security;
grant all on public."email_logs" to anon,authenticated,service_role;
alter table public."reservations" enable row level security;
grant all on public."reservations" to anon,authenticated,service_role;
alter table public."app_users" enable row level security;
grant all on public."app_users" to anon,authenticated,service_role;
alter table public."tour_dates" enable row level security;
grant all on public."tour_dates" to anon,authenticated,service_role;
alter table public."tours" enable row level security;
grant all on public."tours" to anon,authenticated,service_role;
alter table public."user_permissions" enable row level security;
grant all on public."user_permissions" to anon,authenticated,service_role;
create policy "mp_action_can_insert" on public."minimum_participant_alerts" for INSERT to authenticated with check (current_app_user_has_permission('minimum_participants_action_access'::text));
create policy "mp_action_can_update" on public."minimum_participant_alerts" for UPDATE to authenticated using (current_app_user_has_permission('minimum_participants_action_access'::text)) with check (current_app_user_has_permission('minimum_participants_action_access'::text));
create policy "mp_view_can_select" on public."minimum_participant_alerts" for SELECT to authenticated using (current_app_user_has_permission('minimum_participants_view_access'::text));
create policy "Allow public insert on email_logs" on public."email_logs" for INSERT to public with check (true);
create policy "Allow public select on email_logs" on public."email_logs" for SELECT to public using (true);
create policy "Allow public update on email_logs" on public."email_logs" for UPDATE to public using (true) with check (true);
create policy "Allow public insert on reservations" on public."reservations" for INSERT to public with check (true);
create policy "Allow public read access on reservations" on public."reservations" for SELECT to public using (true);
create policy "Allow public update on reservations" on public."reservations" for UPDATE to public using (true) with check (true);
create policy "Allow public insert app_users" on public."app_users" for INSERT to public with check (true);
create policy "Allow public read app_users" on public."app_users" for SELECT to public using (true);
create policy "Allow public update app_users" on public."app_users" for UPDATE to public using (true) with check (true);
create policy "Allow public insert on tour_dates" on public."tour_dates" for INSERT to public with check (true);
create policy "Allow public read access on tour_dates" on public."tour_dates" for SELECT to public using (true);
create policy "Allow public update on tour_dates" on public."tour_dates" for UPDATE to public using (true) with check (true);
create policy "Allow public read access on tours" on public."tours" for SELECT to public using (true);
create policy "manage_users_can_insert" on public."user_permissions" for INSERT to authenticated with check (current_app_user_has_permission('users_manage_access'::text));
create policy "manage_users_can_select_all" on public."user_permissions" for SELECT to authenticated using (current_app_user_has_permission('users_manage_access'::text));
create policy "manage_users_can_update" on public."user_permissions" for UPDATE to authenticated using (current_app_user_has_permission('users_manage_access'::text)) with check (current_app_user_has_permission('users_manage_access'::text));
create policy "own_permissions_select" on public."user_permissions" for SELECT to authenticated using ((user_id = current_app_user_id()));