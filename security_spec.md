# Firestore Security Rules TDD Specification

## 1. Data Invariants
1. Default-deny catch-all at `/databases/{database}/documents/{document=**}` blocks all unspecified paths.
2. Every single-document target (`get`, `create`, `update`, `delete`) validates document IDs via `isValidId(id)` (`^[a-zA-Z0-9_\\-]+$`, length `<= 128`).
3. Every write operation and every non-allowlist read requires an authenticated, email-verified, active Admin-allowlisted Firebase user (`isActiveAllowlisted()`). Any uninvited or deactivated Google account is rejected at both application login and Firestore rules level.
4. Identity integrity: `uid` / `ownerUid` on `/users`, `/gate_tickets`, `/gate_tickets/{ticketId}/private/driver`, `/materials`, `/audit_logs`, and `/plant_settings` must match `request.auth.uid` on creation and remain immutable on update.
5. Plant-Level Authorization Isolation: `/gate_tickets/{ticketId}` documents carry `plantId` (e.g., `RIYADH`, `JEDDAH`). Single-document reads and writes verify `canAccessPlant(plantId)` against `/authorized_emails/{callerEmailKey}.allowedPlants` (`['ALL']` or explicit plant IDs), and non-admin operators cannot reassign an existing ticket to another plant.
6. Self-assigned privilege escalation blocked: Non-admin users cannot mutate `roleName`, `isActive`, `permissions`, or `allowedPlants`, and cannot write `/authorized_users`, `/authorized_emails`, `/plant_settings`, or `/admins/{userId}` unless bootstrapped verified admin (`newshuntexpress@gmail.com`) or listed as an active `admin`.
7. PII Isolation: `email`/`photoURL` live in `/users/{userId}/private/info`; driver phone and Iqama live in `/gate_tickets/{ticketId}/private/driver` (gated by `exists` / `existsAfter` on parent ticket and restricted to ticket owner or verified admin).
8. Temporal Integrity & Immortality: `createdAt == request.time` on create, `updatedAt == request.time` on create/update, and `id`, `ownerUid`, and `createdAt` remain immutable on update.
9. Terminal State Locking: Once a `/gate_tickets/{ticketId}` reaches `'completed'` or `'cancelled'`, non-admin updates are rejected (verified admins have explicit override capability).
10. Secure List Queries: Every `allow list` rule evaluates `request.auth` and `resource.data` directly (zero `get()`/`exists()` inside `allow list`).

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read of `/users/uid1`, `/authorized_emails/user_at_test_dot_com`, `/gate_tickets/tk1`, or `/materials/mat1`.
2. Verified Google user NOT present in `/authorized_emails` (or with `isActive: false`) attempting to read `/gate_tickets/tk1` or create `/materials/mat1`.
3. Cross-plant access bypass: User authorized only for `RIYADH` attempting `get`, `create`, or `update` on `/gate_tickets/tk_jed` with `plantId: 'JEDDAH'`, or attempting to change `plantId` on an existing ticket from `RIYADH` to `JEDDAH`.
4. Cross-user PII read of `/users/uid1/private/info` or `/gate_tickets/tk1/private/driver`.
5. Authenticated user `uid1` with `email_verified: false` creating `/gate_tickets/tk1` or `/materials/mat1`.
6. User `uid1` creating `/users/uid1` with `roleName: 'admin'` or creating `/authorized_emails/evil_at_test_dot_com` without Admin role.
7. User `uid1` updating `/gate_tickets/tk1` once `existing().status == 'completed'` (terminal state bypass).
8. User `uid1` sending a Shadow Update with extra ghost field `isVerified: true` on `/gate_tickets/tk1`, `/materials/mat1`, or `/authorized_users/u1`.
9. User `uid1` creating `/gate_tickets/tk1` with forged `ownerUid: 'uid2'` or forged past `createdAt` timestamp instead of server `request.time`.
10. User `uid1` updating `/audit_logs/log1` or writing `/plant_settings/active` without Admin privileges.
11. Resource poisoning with oversized `truckNumber` (> 40 chars), invalid `plantId`, invalid document ID `invalid/id$`, or `palletRatio <= 0`.
12. Creating `/gate_tickets/orphan1/private/driver` without an existing parent `/gate_tickets/orphan1` (`existsAfter` atomicity violation).
