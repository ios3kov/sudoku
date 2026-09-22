"""Unit coverage for the Docker runtime test's production configuration guard."""

import copy
import unittest

from beat_runtime import SCHEDULE, STATE_DIR, validate_config


def configuration():
    return {
        "services": {"beat": {
            "command": ["celery", "-A", "app.worker:celery_app", "beat", "--loglevel=INFO", f"--schedule={SCHEDULE}"],
            "volumes": [{"target": STATE_DIR, "source": "beat-data", "type": "volume"}],
            "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
        }},
        "volumes": {"beat-data": {}},
    }


class BeatRuntimeContractTests(unittest.TestCase):
    def test_valid_persistent_non_root_configuration(self):
        config = configuration()
        original = copy.deepcopy(config)
        self.assertEqual(validate_config(config), original["services"]["beat"]["command"])
        self.assertEqual(config, original)

    def test_old_relative_schedule_is_rejected(self):
        config = configuration()
        config["services"]["beat"]["command"].pop()
        with self.assertRaises(AssertionError):
            validate_config(config)

    def test_root_override_is_rejected(self):
        for user in ("root", "0", "0:0"):
            with self.subTest(user=user):
                config = configuration()
                config["services"]["beat"]["user"] = user
                with self.assertRaises(AssertionError):
                    validate_config(config)

    def test_nonpersistent_readonly_or_uninitialized_volume_is_rejected(self):
        for change in ({"type": "bind"}, {"read_only": True}, {"volume": {"nocopy": True}}):
            with self.subTest(change=change):
                config = configuration()
                config["services"]["beat"]["volumes"][0].update(change)
                with self.assertRaises(AssertionError):
                    validate_config(config)

    def test_missing_security_boundary_is_rejected(self):
        for key in ("cap_drop", "security_opt"):
            with self.subTest(key=key):
                config = configuration()
                config["services"]["beat"][key] = []
                with self.assertRaises(AssertionError):
                    validate_config(config)


if __name__ == "__main__":
    unittest.main()
