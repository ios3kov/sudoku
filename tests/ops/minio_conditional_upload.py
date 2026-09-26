"""Exercise real SigV4 HTTP uploads against an isolated CI MinIO container."""
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
import httpx
from botocore.config import Config


def put_with_connect_retry(url, content, headers, attempts=5):
    """Retry only transient connection/protocol startup failures, never HTTP contract failures."""
    last_error = None
    for attempt in range(attempts):
        try:
            return httpx.put(url, content=content, headers=headers, timeout=10)
        except (httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
            time.sleep(0.25 * (attempt + 1))
    raise last_error  # pragma: no cover


def main():
    endpoint = "http://127.0.0.1:19000"
    client = boto3.client(
        "s3", endpoint_url=endpoint, region_name="us-east-1",
        aws_access_key_id="audit-local", aws_secret_access_key="audit-local-secret",
        config=Config(signature_version="s3v4"),
    )
    for attempt in range(60):
        try:
            client.list_buckets()
            break
        except Exception:
            if attempt == 59:
                raise
            time.sleep(1)
    bucket = "conditional-upload-audit"
    client.create_bucket(Bucket=bucket)
    data = b"original encrypted test bytes"
    for mime in ("text/plain", "application/octet-stream"):
        key = mime.replace("/", "-")
        digest = hashlib.sha256(data).hexdigest()
        params = {
            "Bucket": bucket, "Key": key, "ContentType": mime,
            "IfNoneMatch": "*", "Metadata": {"sha256": digest},
        }
        url = client.generate_presigned_url("put_object", Params=params, ExpiresIn=60)
        headers = {"Content-Type": mime, "If-None-Match": "*", "x-amz-meta-sha256": digest}
        assert put_with_connect_retry(url, data, headers).status_code == 200
        assert put_with_connect_retry(url, b"replacement", headers).status_code == 412
        unsigned = {k: v for k, v in headers.items() if k != "If-None-Match"}
        denied = put_with_connect_retry(url, b"replacement", unsigned)
        # Pinned MinIO maps missing signed headers to HTTP 400 AccessDenied.
        assert denied.status_code == 400, denied.text
        assert "<Code>AccessDenied</Code>" in denied.text, denied.text
        body = client.get_object(Bucket=bucket, Key=key)["Body"]
        try:
            assert body.read() == data
        finally:
            body.close()
        # Exactly one concurrent creator must win on a fresh key.
        params["Key"] = key + "-race"
        race_url = client.generate_presigned_url("put_object", Params=params, ExpiresIn=60)

        def upload(_, url=race_url, signed=headers):
            return put_with_connect_retry(url, data, signed).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = sorted(pool.map(upload, range(2)))
        assert codes[0] == 200 and codes[1] in (409, 412), codes
    print("Real MinIO: initial upload, overwrite rejection, signed-header enforcement and concurrent creation passed")


if __name__ == "__main__":
    main()
