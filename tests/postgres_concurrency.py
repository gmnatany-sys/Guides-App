"""Real independent PostgreSQL connections. Only an empty local test DB is accepted.

Requires psql on PATH and TEST_DATABASE_URL pointing to guides_remediation_test.
No real email provider or Supabase account is used.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import unittest
from urllib.parse import urlparse
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get('TEST_DATABASE_URL', '')
parsed = urlparse(URL)
if parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path != '/guides_remediation_test':
    raise SystemExit('Use a disposable local database named guides_remediation_test.')


def sql(query, allow_error=False):
    result = subprocess.run(['psql', URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=query, text=True, capture_output=True, timeout=30)
    if result.returncode and not allow_error:
        raise AssertionError(result.stderr)
    return result


def scalar(query):
    return sql(query).stdout.strip()


def pair(a, b):
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(sql, query, True) for query in (a, b)]
        return [future.result() for future in futures]


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


actor, tour = str(uuid4()), str(uuid4())
if scalar("select count(*) from pg_tables where schemaname in ('public','auth')") != '0':
    raise SystemExit('Refusing a nonempty test database; nothing was changed.')
for path in ('tests/schema-before.sql', 'database/prepare-remediation.sql', 'database/lockdown-remediation.sql'):
    sql((ROOT / path).read_text(encoding='utf-8'))
sql(f"""insert into app_users(id,full_name,email,role) values('{actor}','Test Agent','agent@example.test','agent');
insert into user_permissions(user_id,permission_key,enabled) select '{actor}',key,true from
unnest(array['booking_form_access','reservations_action_access','availability_calendar_manage_access']) key;
insert into tours(id,name,max_capacity) values('{tour}','Concurrent test',8);""")


def new_date(day):
    result = str(uuid4())
    sql(f"insert into tour_dates(id,tour_id,tour_date,is_open,supplier_status) values('{result}','{tour}','2030-02-{day:02}',true,'YES')")
    return result


def booking(date, participants):
    payload = json.dumps(dict(tour_id=tour, tour_date_id=date, participants=participants,
                             agent_user_id=actor, voucher_number=str(uuid4()), reservation_number='TEST',
                             lead_passenger_name='Test Passenger', whatsapp_number='+10000000000'))
    return f"select public.booking_create('{actor}',{literal(payload)}::jsonb)"


def transaction(statement):
    # Hold acquired locks long enough for the second independent connection to overlap.
    return f"begin;set local role service_role;{statement};select pg_sleep(0.3);commit;"


class ConcurrencyTests(unittest.TestCase):
    def test_capacity(self):
        date = new_date(1)
        results = pair(transaction(booking(date, 6)), transaction(booking(date, 6)))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(any('Not enough seats' in r.stderr for r in results))
        self.assertEqual(scalar(f"select sum(participants) from reservations where tour_date_id='{date}'"), '6')

    def test_confirmation_numbers(self):
        date = new_date(2)
        reservations = [json.loads(scalar(booking(date, 2)))['id'] for _ in range(2)]
        results = pair(*(transaction(f"select booking_transition('{actor}','{id}','CONFIRMED')") for id in reservations))
        self.assertTrue(all(r.returncode == 0 for r in results), [r.stderr for r in results])
        self.assertEqual(scalar(f"select count(distinct confirmation_number) from reservations where tour_date_id='{date}'"), '2')

    def test_cancellation_and_booking(self):
        date = new_date(3)
        sql(booking(date, 2))
        cancel = f"select booking_set_dates('{actor}','{tour}',array['2030-02-03'::date],false,'CANCELLED')"
        results = pair(transaction(cancel), transaction(booking(date, 2)))
        self.assertEqual(results[0].returncode, 0, results[0].stderr)
        if results[1].returncode:
            self.assertIn('no longer available', results[1].stderr)
        self.assertEqual(scalar(f"select count(*) from reservations where tour_date_id='{date}' and status in ('CONFIRMED','WAITING FOR CONFIRMATION')"), '0')

    def test_single_outbox_claim(self):
        date = new_date(4)
        reservation = json.loads(scalar(booking(date, 2)))['id']
        email = scalar(f"select id from email_logs where reservation_id='{reservation}'")
        sql(f"update email_logs set html_body='<p>Test</p>',text_body='Test' where id='{email}'")
        results = pair(*(f"set role service_role;select count(*) from booking_claim_email('{email}','{uuid4()}');" for _ in range(2)))
        self.assertTrue(all(r.returncode == 0 for r in results), [r.stderr for r in results])
        self.assertEqual(sorted(r.stdout.strip() for r in results), ['0', '1'])


if __name__ == '__main__':
    unittest.main()
