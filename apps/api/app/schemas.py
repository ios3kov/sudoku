import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)
    device_name: str = Field(min_length=1, max_length=160)


class InviteAcceptRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=1024)
    device_name: str = Field(min_length=1, max_length=160)


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    is_admin: bool


class InviteCreateRequest(BaseModel):
    email: EmailStr | None = None
    expires_hours: int = Field(default=168, ge=1, le=720)
    max_uses: int = Field(default=1, ge=1, le=10)


class InviteCreateResponse(BaseModel):
    id: uuid.UUID
    token: str
    email: str | None
    expires_at: datetime
    max_uses: int


class SessionResponse(BaseModel):
    id: uuid.UUID
    device_name: str
    created_at: datetime
    expires_at: datetime
    current: bool


class HealthResponse(BaseModel):
    status: str


class ReadinessResponse(BaseModel):
    status: str
    postgres: bool
    redis: bool
    object_storage: bool


class UserDirectoryItem(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str


class CreateConversationRequest(BaseModel):
    type: str = Field(pattern="^(direct|group)$")
    title: str | None = Field(default=None, max_length=160)
    member_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    encryption_required: bool = False


class ConversationMemberResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str
    role: str
    last_read_sequence: int


class ConversationResponse(BaseModel):
    id: uuid.UUID
    type: str
    title: str | None
    created_by: uuid.UUID
    created_at: datetime
    last_read_sequence: int
    latest_sequence: int
    is_pinned: bool
    notifications_muted: bool
    encryption_required: bool
    e2ee_ready: bool
    members: list[ConversationMemberResponse]


class ConversationPreferencesRequest(BaseModel):
    is_pinned: bool | None = None
    notifications_muted: bool | None = None


class UpdateConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class ConversationMembersRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=99)


class ConversationMemberRoleRequest(BaseModel):
    role: str = Field(pattern="^(owner|member)$")


class AssetSummary(BaseModel):
    id: uuid.UUID
    mime_type: str
    size_bytes: int
    filename: str
    e2ee_ciphertext: bool
    status: str
    content_url: str


class ReactionSummary(BaseModel):
    emoji: str
    user_ids: list[uuid.UUID]


class CreateMessageRequest(BaseModel):
    client_id: uuid.UUID
    type: str = Field(default="text", pattern="^(text|image|file|voice)$")
    body: str | None = Field(default=None, max_length=20000)
    reply_to: uuid.UUID | None = None
    asset_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    envelope: dict | None = None


class EditMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


class MessageResponse(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID
    client_id: uuid.UUID
    sequence: int
    type: str
    body: str | None
    envelope: dict | None = None
    reply_to: uuid.UUID | None
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None
    assets: list[AssetSummary] = Field(default_factory=list)
    reactions: list[ReactionSummary] = Field(default_factory=list)


class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class ReadRequest(BaseModel):
    sequence: int = Field(ge=0)


class UploadIntentRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=160)
    size_bytes: int = Field(gt=0, le=25 * 1024 * 1024)
    sha256_hex: str = Field(pattern="^[0-9a-fA-F]{64}$")


class E2eeUploadIntentRequest(BaseModel):
    size_bytes: int = Field(gt=16, le=25 * 1024 * 1024 + 16)
    sha256_hex: str = Field(pattern="^[0-9a-fA-F]{64}$")


class UploadIntentResponse(BaseModel):
    asset_id: uuid.UUID
    upload_url: str
    headers: dict[str, str]
    expires_in: int


class AssetResponse(AssetSummary):
    sha256_hex: str
    created_at: datetime


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=512)


class PushSubscriptionRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    keys: PushKeys
    device_name: str = Field(default="Sudoku web app", min_length=1, max_length=160)


class PushPublicKeyResponse(BaseModel):
    public_key: str
