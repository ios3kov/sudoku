"""Bounded hashing of untrusted object-store responses."""
import hashlib


def read_asset_digest(body, expected_size: int) -> tuple[bytes, bytes]:
    """Close the stream on every path; read at most the expected size plus one."""
    digest = hashlib.sha256()
    prefix = bytearray()
    total = 0
    try:
        while True:
            chunk = body.read(min(1024 * 1024, expected_size - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > expected_size:
                raise ValueError("size")
            digest.update(chunk)
            if len(prefix) < 4096:
                prefix.extend(chunk[:4096 - len(prefix)])
        if total != expected_size:
            raise ValueError("size")
        return digest.digest(), bytes(prefix)
    finally:
        body.close()
