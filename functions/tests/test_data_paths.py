"""Checks that the data files are where the code expects them."""
import unittest

from skillpath.catalog import load_catalog
from skillpath.onet_job_profiler import CSV_PATH, JobEngine


class DataPathTests(unittest.TestCase):
    """Verify packaged catalog and occupation data paths."""

    def test_real_catalog_loads(self):
        """Load the catalog from its packaged data files."""
        catalog = load_catalog()
        self.assertIn("software-developer", catalog.roles)

    def test_role_onet_codes_exist_in_occupation_csv(self):
        """Ensure every catalog O*NET code has a matching CSV title."""
        self.assertTrue(CSV_PATH.exists(), CSV_PATH)
        engine = JobEngine()
        for role in load_catalog().roles.values():
            if role.onet_code:
                # pylint: disable=protected-access
                occupation_title = engine._get_occupation_title(role.onet_code)
                # pylint: enable=protected-access
                self.assertIsNotNone(occupation_title, role.id)


if __name__ == "__main__":
    unittest.main()
