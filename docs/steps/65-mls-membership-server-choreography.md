# Step 65 — MLS-first group membership server choreography

## Goal
Make direct server-side member add/remove impossible for an active E2EE group and provide a crash-recoverable two-phase membership transition around MLS Commit/Welcome delivery.

## Membership states
`conversation_members.e2ee_state`:
- `active`
- `pending_add`
- `pending_remove`

Legacy and initial bootstrap members are active by default.

A pending-add user is not returned in normal group member responses, cannot pass normal membership authorization and does not receive application history through the unified feed.

## One transition at a time
`conversation_membership_changes` records an explicit transition id, target user, requester, kind and status.

Only one pending change is allowed by the application logic per encrypted group. Repeating prepare for the same target/kind is idempotent; another transition receives 409.

## Add
Prepare-add:
- owner-only;
- target must be active user with at least one active secure device;
- inserts a `pending_add` membership and pending change.

Finalize-add requires control events tagged with the same `membership_change_id`:
- Welcome coverage for every active target device;
- Commit coverage for every existing active remote device (creator current device merges locally).

Only then does the target become active and `conversation.members_added` emit.

## Remove
Prepare-remove:
- owner may remove another member;
- a member may prepare self-leave;
- last owner cannot be removed;
- target becomes `pending_remove` but remains present so its removal Commit can still be routed.

Finalize-remove requires Commit coverage for every active remote device including the target's devices. Only then is the server membership deleted and `conversation.member_removed` emitted.

## Application freeze
While any membership row is not active, E2EE application-message creation returns 409. This prevents application traffic from crossing a partially delivered rekey.

## Control batches
Membership-related atomic control batches carry `membership_change_id`. When a pending transition exists, untagged/wrong-tag batches are rejected. Events persist the change id for exact finalize verification.

## Legacy endpoints
Normal group add/remove endpoints return 409 for E2EE groups. They remain unchanged for plaintext legacy groups.

## Next
Step 66: wire GroupSettings/adapter to prepare transition → device-level MLS add/remove → finalize; then handle device/session revocation through the same rekey mechanism.
