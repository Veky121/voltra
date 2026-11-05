import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("snapshot_remote", pathlib.Path(__file__).with_name("snapshot_remote.py"))
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotSafety(unittest.TestCase):
    def test_query_readonly_and_explicit_columns(self):
        query = snapshot.query_sql()
        self.assertIn("REPEATABLE READ READ ONLY", query)
        self.assertNotIn("SELECT *", query)
        for forbidden in ("password", "daemon_token", "startup", "script_install", "default_value", "variable_value", "download_headers", "configuration_overrides"):
            self.assertNotIn('"' + forbidden + '"', query)
        self.assertEqual(query.count("LIMIT 10001"), 4)

    def test_unknown_tables_and_fields_rejected(self):
        tables = {table: [] for table in snapshot.COLUMNS}
        snapshot.validate_tables(tables)
        tables["settings"] = []
        with self.assertRaises(ValueError):
            snapshot.validate_tables(tables)
        del tables["settings"]
        tables["nests"] = [{"id": 1, "name": "Minecraft", "password": "secret"}]
        with self.assertRaises(ValueError):
            snapshot.validate_tables(tables)

    def test_large_or_control_labels_rejected(self):
        for label in ("a" * 257, "hello\npassword=secret"):
            tables = {table: [] for table in snapshot.COLUMNS}
            tables["nests"] = [{"id": 1, "name": label}]
            with self.assertRaises(ValueError):
                snapshot.validate_tables(tables)


if __name__ == "__main__":
    unittest.main()
