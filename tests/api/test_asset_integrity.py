import hashlib
import io
import unittest

from app.asset_integrity import read_asset_digest


class AssetIntegrityTests(unittest.TestCase):
    def test_valid_stream_and_bounded_prefix(self):
        data = b"a" * (1024 * 1024 + 5)
        body = io.BytesIO(data)
        digest, prefix = read_asset_digest(body, len(data))
        self.assertEqual(digest, hashlib.sha256(data).digest())
        self.assertEqual(prefix, data[:4096])
        self.assertTrue(body.closed)

    def test_short_stream_is_rejected_and_closed(self):
        body = io.BytesIO(b"abc")
        with self.assertRaisesRegex(ValueError, "size"):
            read_asset_digest(body, 4)
        self.assertTrue(body.closed)

    def test_unbounded_source_stops_after_one_extra_byte(self):
        class EndlessStream:
            total = 0
            closed = False

            def read(self, size):
                self.total += size
                return b"x" * size

            def close(self):
                self.closed = True

        body = EndlessStream()
        with self.assertRaisesRegex(ValueError, "size"):
            read_asset_digest(body, 23)
        self.assertEqual(body.total, 24)
        self.assertTrue(body.closed)

    def test_read_error_still_closes_stream(self):
        class BrokenStream(io.BytesIO):
            def read(self, size):
                raise OSError("network")

        body = BrokenStream()
        with self.assertRaises(OSError):
            read_asset_digest(body, 5)
        self.assertTrue(body.closed)
