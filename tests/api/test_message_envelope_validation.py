import base64
import uuid

import pytest
from pydantic import ValidationError

from app.schemas import CreateMessageRequest, MAX_E2EE_MESSAGE_BYTES


def message(envelope):
    return CreateMessageRequest(
        client_id=uuid.uuid4(),
        type="text",
        body=None,
        asset_ids=[],
        envelope=envelope,
    )


def test_accepts_bounded_application_envelope() -> None:
    parsed = message(
        {
            "version": 1,
            "protocol": "mls-rfc9420",
            "kind": "application",
            "ciphertext": base64.b64encode(b"ok").decode(),
        }
    )
    assert parsed.envelope is not None
    assert parsed.envelope.kind == "application"


def test_rejects_oversized_e2ee_message_ciphertext() -> None:
    oversized = base64.b64encode(b"x" * (MAX_E2EE_MESSAGE_BYTES + 1)).decode()
    with pytest.raises(ValidationError):
        message(
            {
                "version": 1,
                "protocol": "mls-rfc9420",
                "kind": "application",
                "ciphertext": oversized,
            }
        )


@pytest.mark.parametrize(
    "envelope",
    [
        {"version": 1, "protocol": "mls-rfc9420", "kind": "application", "ciphertext": "not base64"},
        {"version": 1, "protocol": "wrong", "kind": "application", "ciphertext": "QUE="},
        {"version": 1, "protocol": "mls-rfc9420", "kind": "commit", "ciphertext": "QUE="},
        {"version": 1, "protocol": "mls-rfc9420", "kind": "application", "ciphertext": "QUE=", "extra": "no"},
    ],
)
def test_rejects_malformed_e2ee_message_envelope(envelope) -> None:
    with pytest.raises(ValidationError):
        message(envelope)
