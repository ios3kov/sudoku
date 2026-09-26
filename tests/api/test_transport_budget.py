"""Count real SQLAlchemy query construction against a controlled result set."""
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from app import e2ee
from app.models import (
    Conversation,
    ConversationMember,
    ConversationTransportEvent,
    Message,
    MlsControlEvent,
)


class Result:
    def __init__(self, values):
        self.values = values

    def scalar_one_or_none(self):
        return self.values[0] if self.values else None

    def scalars(self):
        return self

    def all(self):
        return self.values


class Database:
    def __init__(self, count):
        self.calls = []
        self.id = uuid.uuid4()
        self.messages = []
        self.controls = []
        self.rows = []
        for index in range(count):
            item_id = uuid.uuid4()
            is_control = index % 5 == 0
            item = SimpleNamespace(id=item_id, conversation_id=self.id, sequence=index+1, sender_id=uuid.uuid4(), created_at=datetime(2026, 9, 22, tzinfo=UTC), envelope={"ciphertext": str(index)})
            (self.controls if is_control else self.messages).append(item)
            self.rows.append(SimpleNamespace(sequence=index+1, kind="mls_control" if is_control else "message", message_id=None if is_control else item_id, control_event_id=item_id if is_control else None))

    async def scalar(self, _query):
        # The transport visibility preflight asks whether this fixture device
        # already owns an MLS epoch. This budget test is about payload lookup
        # count/order, so model an established device and keep all messages
        # visible without adding fake payload round trips.
        return True

    async def execute(self, query):
        entity = query.column_descriptions[0]["entity"]
        self.calls.append(entity)
        if entity is Conversation:
            return Result([SimpleNamespace(id=self.id, encryption_required=True)])
        if entity is ConversationMember:
            return Result([uuid.uuid4()])
        if entity is ConversationTransportEvent:
            return Result(self.rows)
        values = self.messages if entity is Message else self.controls
        params = query.compile().params
        ids = next((value for name, value in params.items() if name.startswith("id_")), [])
        ids = ids if isinstance(ids, list) else [ids]
        return Result([item for item in values if item.id in ids])


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 100, 200])
async def test_transport_payload_lookup_budget_and_order(monkeypatch, count):
    async def noop(*_args):
        pass

    monkeypatch.setattr(e2ee, "enforce_user_rate_limit", noop)
    monkeypatch.setattr(e2ee, "require_active_device", noop)
    monkeypatch.setattr(e2ee, "serialize_control_event", lambda value: {"id": str(value.id)})
    db = Database(count)
    device_id = uuid.uuid4()
    auth = SimpleNamespace(user=SimpleNamespace(id=uuid.uuid4()), session=SimpleNamespace(id=device_id))
    output = await e2ee.list_transport_events(db.id, device_id, after=0, limit=200, auth=auth, db=db)
    assert [item["transport_sequence"] for item in output] == list(range(1, count+1))
    assert len(output) == count
    assert all(item["envelope"]["ciphertext"] == str(item["transport_sequence"]-1) for item in output if item["kind"] == "message")
    lookups = sum(entity in (Message, MlsControlEvent) for entity in db.calls)
    assert lookups <= 2, f"{count} transport events used {lookups} payload queries"
