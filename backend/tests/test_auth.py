import logging
import unittest

from app.auth.service import hash_password, verify_password


class PasswordTests(unittest.TestCase):
    def test_hash_round_trip_without_bcrypt_version_warning(self):
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        logger = logging.getLogger("passlib.handlers.bcrypt")
        handler = Capture()
        logger.addHandler(handler)
        try:
            hashed = hash_password("Новый пароль 42")
            self.assertTrue(verify_password("Новый пароль 42", hashed))
            self.assertFalse(verify_password("другой", hashed))
        finally:
            logger.removeHandler(handler)
        self.assertFalse(any("error reading bcrypt version" in message for message in records))

    def test_hash_from_bcrypt_4_2_remains_valid(self):
        old_hash = "$2b$12$1pZ5EMedMpIHoeNIDpxX7.STC/wNS4rBL4KlnRxpxoSMHSWRmjZFa"
        self.assertTrue(verify_password("Совместимый пароль 42", old_hash))


if __name__ == "__main__":
    unittest.main()
