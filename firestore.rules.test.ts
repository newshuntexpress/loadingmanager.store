/**
 * Verification matrix for the "Dirty Dozen" adversarial payloads documented in security_spec.md.
 * Run against Firebase Emulator Suite when testing locally with @firebase/rules-unit-testing.
 */
export const DIRTY_DOZEN_CASES = [
  { name: 'Unauthenticated read of /gate_tickets/tk1', path: '/gate_tickets/tk1', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Unlisted or deactivated Google user accessing /gate_tickets/tk1 or /materials/mat1', path: '/materials/mat1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Riyadh-only user accessing or mutating JEDDAH ticket /gate_tickets/tk_jed', path: '/gate_tickets/tk_jed', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user PII read of /gate_tickets/tk1/private/driver', path: '/gate_tickets/tk1/private/driver', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified email create /materials/mat1', path: '/materials/mat1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Self privilege escalation roleName=admin on /users/uid1 or /authorized_emails', path: '/users/uid1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin update on terminal status=completed ticket', path: '/gate_tickets/tk1', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow Update adding ghost field isVerified on /materials/mat1', path: '/materials/mat1', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Identity spoofing ownerUid mismatch or forged createdAt on /gate_tickets/tk1', path: '/gate_tickets/tk1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin modifying /audit_logs/log1 or /plant_settings/active', path: '/plant_settings/active', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Resource poisoning palletRatio <= 0, invalid plantId, or oversized truckNumber', path: '/materials/mat1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Orphaned write to /gate_tickets/orphan1/private/driver', path: '/gate_tickets/orphan1/private/driver', op: 'create', expected: 'PERMISSION_DENIED' },
] as const;
