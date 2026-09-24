-- TEST PROJECT ONLY: rktbdjhaqgzmvzsyracf. No production use.
-- Requires the existing pg_cron, pg_net and Vault extensions.
-- Provision a branch-only CRON_SECRET in Vercel and store the matching value
-- as booking_staging_cron_secret in this test project's Vault.
-- A temporary Vercel automation bypass requires explicit approval; store it
-- as booking_staging_vercel_bypass. Never add either secret to this file.
-- This creates an INACTIVE job. Enable only after environment redeployment.
-- Keep net, cron and vault outside the Data API exposed schemas. Hosted
-- pg_net is managed by supabase_admin: project-role REVOKE can be ineffective.
-- Check effective privileges and actual HTTP denial, not just SQL success.
-- The 2026-09-24 temporary bypass was revoked after successful acceptance;
-- an existing Vault row alone does not establish that its value is usable.
begin;
do $$
begin
  if not exists(select 1 from public.tours where name='TEST Booking Safety Tour')
     or exists(select 1 from public.app_users where email not like '%@example.invalid') then
    raise exception 'Refusing scheduler setup outside the isolated synthetic test project';
  end if;
  if (select count(*) from vault.secrets where name in
      ('booking_staging_cron_secret','booking_staging_vercel_bypass')) <> 2 then
    raise exception 'Provision both approved test secrets first';
  end if;
end $$;
select cron.schedule('booking-http-staging-smoke','*/5 * * * *',$job$
  select net.http_get(
    url := 'https://v0-admin-dashboard-for-japan-git-886e6c-omri-natany-s-projects.vercel.app/api/cron/check-minimum-participants',
    headers := jsonb_build_object(
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='booking_staging_cron_secret'),
      'x-vercel-protection-bypass',(select decrypted_secret from vault.decrypted_secrets where name='booking_staging_vercel_bypass')
    ),
    timeout_milliseconds := 60000
  );
$job$);
select cron.alter_job(job_id:=jobid,active:=false)
from cron.job where jobname='booking-http-staging-smoke';
commit;

-- Enable only for the supervised test, then deactivate using active:=false.
-- select cron.alter_job(job_id:=jobid,active:=true)
-- from cron.job where jobname='booking-http-staging-smoke';
-- Verify BOTH cron.job_run_details and net._http_response: a successfully
-- queued HTTP request alone is not a successful application run.
-- With the intentionally invalid RESEND_API_KEY, queued test emails produce
-- HTTP 500 and delivery.failed > 0. Never represent that as mail delivery.
-- Deactivate the job and revoke its temporary bypass after the test.
