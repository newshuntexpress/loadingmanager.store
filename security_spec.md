# Firestore Security Rules TDD Specification

## 1. Data Invariants
1. Default-deny catch-all at `/databases/{database}/documents/{document=**}` blocks all unspecified paths.
2. Every single-document target (`get`, `create`, `update`, `delete`) validates document IDs via `isValidId(id)` (`^[a-zA-Z0-9_\\-]+$`, length `<= 128`).
3. Every write operation requires an authenticated, email-verified Firebase user (`request.auth != null && request.auth.token.email_verified == true`).
4. Identity integrity: `uid` / `ownerUid` on `/users`, `/gate_tickets`, `/gate_tickets/{ticketId}/private/driver`, and `/materials` must match `request.auth.uid` on creation and remain immutable on update.
5. Self-assigned privilege escalation blocked: Non-admin users cannot mutate `roleName` or `isActive` on `/users/{userId}` and cannot create `/admins/{userId}` unless bootstrapped verified admin.
6. PII Isolation: `email`/`photoURL` live in `/users/{userId}/private/info`; driver phone and Iqama live in `/gate_tickets/{ticketId}/private/driver` (gated by `exists` / `existsAfter` on parent ticket and restricted to ticket owner or verified admin).
7. Temporal Integrity & Immortality: `createdAt == request.time` on create, `updatedAt == request.time` on create/update, and `id`, `ownerUid`, and `createdAt` remain immutable on update.
8. Terminal State Locking: Once a `/gate_tickets/{ticketId}` reaches `'completed'` or `'cancelled'`, non-admin updates are rejected (verified admins have explicit override capability).
9. Secure List Queries: Every `allow list` rule evaluates `resource.data` directly (zero `get()`/`exists()` inside `allow list`).

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read of `/users/uid1`, `/gate_tickets/tk1`, or `/materials/mat1`.
2. Authenticated user `uid2` reading `/users/uid1/private/info` or `/gate_tickets/tk1/private/driver` (PII leak attempt).
3. Authenticated user `uid1` with `email_verified: false` creating `/gate_tickets/tk1` or `/materials/mat1`.
4. User `uid1` creating `/users/uid1` with `roleName: 'admin'` (self-privilege escalation).
5. User `uid1` updating `/gate_tickets/tk1` once `existing().status == 'completed'` (terminal state bypass).
6. User `uid1` sending a Shadow Update with extra ghost field `isVerified: true` on `/gate_tickets/tk1` or `/materials/mat1`.
7. User `uid1` creating `/gate_tickets/tk1` with forged `ownerUid: 'uid2'` (identity spoofing).
8. User `uid1` creating `/gate_tickets/tk1` with forged past `createdAt` timestamp instead of server `request.time`.
9. User `uid1` updating `/materials/mat1` and attempting to overwrite immutable `createdAt` or `ownerUid`.
10. User `uid1` writing `/admins/uid1` or `/authorized_users/u2` without admin privileges.
11. Resource poisoning with oversized `truckNumber` (> 40 chars) or invalid document ID `invalid/id$`, or `palletRatio <= 0`.
12. Creating `/gate_tickets/orphan1/private/driver` without an existing parent `/gate_tickets/orphan1` (`existsAfter` atomicity violation).
