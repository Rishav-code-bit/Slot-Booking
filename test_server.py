import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server import SubmissionError, cancel_response_by_id, initialize_database, is_admin_session, list_options, list_responses, open_database, submit_response


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.sqlite3"
        with closing(open_database(self.database_path)) as connection:
            initialize_database(connection, [("only_option", "Only option", 2)])

    def tearDown(self):
        self.temp_dir.cleanup()

    def submit(self, number):
        with closing(open_database(self.database_path)) as connection:
            return submit_response(
                connection,
                f"Person {number}",
                f"person{number}@example.com",
                "only_option",
            )

    def test_option_closes_when_capacity_is_reached(self):
        self.submit(1)
        self.submit(2)

        with self.assertRaises(SubmissionError) as error:
            self.submit(3)

        self.assertEqual(error.exception.status, 409)
        with closing(open_database(self.database_path)) as connection:
            self.assertEqual(list_options(connection)[0]["remaining"], 0)

    def test_simultaneous_submissions_cannot_exceed_capacity(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(self.try_submit, range(8)))

        self.assertEqual(results.count("accepted"), 2)
        self.assertEqual(results.count("full"), 6)
        with closing(open_database(self.database_path)) as connection:
            self.assertEqual(list_options(connection)[0]["taken"], 2)

    def try_submit(self, number):
        try:
            self.submit(number)
            return "accepted"
        except SubmissionError as error:
            if error.status == 409:
                return "full"
            raise

    def test_email_can_only_submit_once(self):
        self.submit(1)
        with closing(open_database(self.database_path)) as connection:
            with self.assertRaises(SubmissionError) as error:
                submit_response(connection, "Person again", "PERSON1@example.com", "only_option")

        self.assertEqual(error.exception.status, 409)

    def test_admin_cancellation_releases_capacity(self):
        with closing(open_database(self.database_path)) as connection:
            submit_response(
                connection, "Person 1", "person1@example.com", "only_option"
            )
        with closing(open_database(self.database_path)) as connection:
            cancel_response_by_id(connection, 1)
            self.assertEqual(list_options(connection)[0]["remaining"], 2)

    def test_admin_session_is_required_for_roster_access(self):
        self.assertFalse(is_admin_session(""))
        self.assertFalse(is_admin_session("admin_session=not-a-session"))

    def test_cancel_rejects_unknown_signup(self):
        with closing(open_database(self.database_path)) as connection:
            with self.assertRaises(SubmissionError) as error:
                cancel_response_by_id(connection, 999)
        self.assertEqual(error.exception.status, 404)

    def test_results_include_names_but_not_email_addresses(self):
        with closing(open_database(self.database_path)) as connection:
            submit_response(connection, "Person 1", "person1@example.com", "only_option")
            result = list_responses(connection)

        self.assertEqual(result[0]["people"], [{"id": 1, "name": "Person 1"}])
        self.assertNotIn("email", result[0])


if __name__ == "__main__":
    unittest.main()