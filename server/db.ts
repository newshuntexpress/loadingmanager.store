import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_TICKET_RECORDS,
  DEFAULT_DRIVER_RECORDS,
} from './defaultRecords.ts';

export const DEFAULT_ADMIN_EMAIL = 'newshuntexpress@gmail.com';

export interface DbRole {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  created_at: number;
}

export interface DbPermission {
  id: string;
  key: string;
  name: string;
  category: string;
}

export interface SafeUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  permissions: string[];
  activeSessionCount?: number;
  signatureDataUrl?: string;
}

const dataDir = process.env.DB_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    full_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    last_login_at INTEGER,
    signature_data_url TEXT DEFAULT '',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    granted INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, permission_key)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT,
    actor_username TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    ticket_number TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    data_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_date ON tickets(date);

  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    truck_number TEXT UNIQUE NOT NULL COLLATE NOCASE,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS material_master (
    id TEXT PRIMARY KEY,
    material_name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pack_type TEXT NOT NULL,
    pallet_ratio INTEGER NOT NULL DEFAULT 23,
    remarks TEXT DEFAULT '',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_material_master_name ON material_master(material_name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loading_alerts (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    ticket_number TEXT NOT NULL,
    del_note_number TEXT NOT NULL,
    truck_number TEXT NOT NULL,
    gate_number TEXT NOT NULL,
    completed_by TEXT NOT NULL,
    completed_time TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dismissed_by_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_loading_alerts_created_at ON loading_alerts(created_at DESC);

  CREATE TABLE IF NOT EXISTS liquid_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS liquid_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    code TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS liquid_tanks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    total_capacity_kg REAL NOT NULL,
    depth_meters REAL NOT NULL,
    location TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS liquid_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    tx_date TEXT NOT NULL,
    tank_id INTEGER NOT NULL REFERENCES liquid_tanks(id),
    material_name TEXT NOT NULL,
    quantity_kg REAL NOT NULL,
    quantity_mt REAL NOT NULL,
    reference_number TEXT NOT NULL,
    document_number TEXT DEFAULT '',
    party_name TEXT NOT NULL,
    vehicle_number TEXT DEFAULT '',
    driver_name TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    created_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_liquid_tx_tank_id ON liquid_transactions(tank_id);
  CREATE INDEX IF NOT EXISTS idx_liquid_tx_date ON liquid_transactions(tx_date);

  CREATE TABLE IF NOT EXISTS liquid_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ex_factory_entries (
    id TEXT PRIMARY KEY,
    entry_date TEXT NOT NULL,
    del_note_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    loading_type TEXT DEFAULT 'local',
    truck_number TEXT NOT NULL,
    driver_name TEXT DEFAULT '',
    mobile_number TEXT DEFAULT '',
    iqama_number TEXT DEFAULT '',
    loading_slip_json TEXT DEFAULT '',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ex_factory_date ON ex_factory_entries(entry_date DESC, created_at DESC);

  CREATE TABLE IF NOT EXISTS driver_slip_tokens (
    token TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_driver_slip_tokens_ticket_id ON driver_slip_tokens(ticket_id);

  CREATE TABLE IF NOT EXISTS whatsapp_notification_logs (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    ticket_number TEXT NOT NULL,
    driver_name TEXT DEFAULT '',
    driver_mobile TEXT DEFAULT '',
    del_note_number TEXT DEFAULT '',
    truck_number TEXT DEFAULT '',
    gate_number TEXT DEFAULT '',
    queue_number INTEGER DEFAULT 0,
    message_type TEXT NOT NULL,
    delivery_status TEXT NOT NULL,
    whatsapp_message_id TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    driver_status_token TEXT DEFAULT '',
    message_body TEXT DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_wa_logs_ticket_type ON whatsapp_notification_logs(ticket_id, message_type);
  CREATE INDEX IF NOT EXISTS idx_wa_logs_created_at ON whatsapp_notification_logs(created_at DESC);
`);

// Safe additive schema migrations for existing databases
{
  const cols = db.prepare(`PRAGMA table_info(liquid_transactions)`).all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('document_number')) {
    db.exec(`ALTER TABLE liquid_transactions ADD COLUMN document_number TEXT DEFAULT ''`);
  }
  if (!colNames.has('driver_name')) {
    db.exec(`ALTER TABLE liquid_transactions ADD COLUMN driver_name TEXT DEFAULT ''`);
  }
}

{
  const exCols = db.prepare(`PRAGMA table_info(ex_factory_entries)`).all() as Array<{ name: string }>;
  const exColNames = new Set(exCols.map((c) => c.name));
  if (!exColNames.has('driver_name')) {
    db.exec(`ALTER TABLE ex_factory_entries ADD COLUMN driver_name TEXT DEFAULT ''`);
  }
  if (!exColNames.has('loading_slip_json')) {
    db.exec(`ALTER TABLE ex_factory_entries ADD COLUMN loading_slip_json TEXT DEFAULT ''`);
  }
  if (!exColNames.has('loading_type')) {
    db.exec(`ALTER TABLE ex_factory_entries ADD COLUMN loading_type TEXT DEFAULT 'local'`);
  }
}

{
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has('signature_data_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN signature_data_url TEXT DEFAULT ''`);
  }
}

const SEED_PERMISSIONS: Array<{ id: string; key: string; name: string; category: string }> = [
  { id: 'perm_tickets_view', key: 'tickets.view', name: 'View Tickets & Live Gate Monitor', category: 'Operations' },
  { id: 'perm_tickets_create', key: 'tickets.create', name: 'Create New Gate Tickets', category: 'Operations' },
  { id: 'perm_tickets_update', key: 'tickets.update', name: 'Update Gate Status & Loading Slips', category: 'Operations' },
  { id: 'perm_forklift_operate', key: 'forklift.operate', name: 'Forklift Operator Loading Checklist & Completion', category: 'Operations' },
  { id: 'perm_tickets_delete', key: 'tickets.delete', name: 'Delete Ticket Records', category: 'Operations' },
  { id: 'perm_guard_view', key: 'guard.view', name: 'View Security Guard Gate Truck Allotment Screen', category: 'Operations' },
  { id: 'perm_slips_print', key: 'slips.print', name: 'Print & Export Loading Slips / Tokens', category: 'Documents' },
  { id: 'perm_drivers_manage', key: 'drivers.manage', name: 'Manage Driver & Vehicle Master Directory', category: 'Operations' },
  { id: 'perm_materials_view', key: 'materials.view', name: 'View Material Master Catalog', category: 'Operations' },
  { id: 'perm_materials_manage', key: 'materials.manage', name: 'Manage Material Master (Add / Edit / Delete / Excel Import)', category: 'Operations' },
  { id: 'perm_reports_view', key: 'reports.view', name: 'View Daily Reports & Export CSV', category: 'Reporting' },
  { id: 'perm_dispatch_view', key: 'dispatch.view', name: 'View Dispatch Details (Material-Wise Summary & Export)', category: 'Reporting' },
  { id: 'perm_material_register_view', key: 'material_register.view', name: 'View Material Register (Loading Slip Line Items)', category: 'Reporting' },
  { id: 'perm_liquid_view', key: 'liquid.view', name: 'View Liquid Material Camp Store (Read-Only)', category: 'Operations' },
  { id: 'perm_liquid_store', key: 'liquid.store', name: 'Manage Liquid Material Camp Store (Inward/Outward & Tanks)', category: 'Operations' },
  { id: 'perm_liquid_materials', key: 'liquid.materials', name: 'Manage Material Master Data (Create / Edit / Delete)', category: 'Operations' },
  { id: 'perm_ex_factory_view', key: 'ex_factory.view', name: 'View Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_create', key: 'ex_factory.create', name: 'Create Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_update', key: 'ex_factory.update', name: 'Update Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_delete', key: 'ex_factory.delete', name: 'Delete Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_settings_manage', key: 'settings.manage', name: 'Manage Plant & System Settings', category: 'Administration' },
  { id: 'perm_users_manage', key: 'users.manage', name: 'Manage Users, Roles & Permissions', category: 'Administration' },
  { id: 'perm_audit_view', key: 'audit.view', name: 'View Security Audit Logs', category: 'Administration' },
];

const USER_DEFAULT_PERMISSION_KEYS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'forklift.operate',
  'guard.view',
  'slips.print',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'reports.view',
  'dispatch.view',
  'material_register.view',
  'liquid.view',
  'liquid.store',
  'liquid.materials',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
];

export const MMD_MANAGER_DEFAULT_PERMISSION_KEYS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'forklift.operate',
  'guard.view',
  'slips.print',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'reports.view',
  'dispatch.view',
  'material_register.view',
  'liquid.view',
  'liquid.store',
  'liquid.materials',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
];

export const VIEW_ONLY_ALLOWED_PERMISSION_KEYS = [
  'tickets.view',
  'guard.view',
  'materials.view',
  'dispatch.view',
  'material_register.view',
  'reports.view',
  'liquid.view',
  'ex_factory.view',
];

export const USER_ASSIGNABLE_PERMISSION_KEYS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'forklift.operate',
  'guard.view',
  'tickets.delete',
  'slips.print',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'reports.view',
  'dispatch.view',
  'material_register.view',
  'liquid.view',
  'liquid.store',
  'liquid.materials',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
  'ex_factory.delete',
];

export const FORKLIFT_ALLOWED_PERMISSION_KEYS = [
  'tickets.view',
  'forklift.operate',
];

export const LIQUID_STORE_ALLOWED_PERMISSION_KEYS = [
  'liquid.view',
  'liquid.store',
  'liquid.materials',
];

export const EX_FACTORY_ALLOWED_PERMISSION_KEYS = [
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
  'ex_factory.delete',
];

export const EX_FACTORY_DEFAULT_PERMISSION_KEYS = [
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
];

export const SECURITY_GUARD_ALLOWED_PERMISSION_KEYS = [
  'guard.view',
];

export const SECURITY_GUARD_DEFAULT_PERMISSION_KEYS = [
  'guard.view',
];

function seedDatabase(): void {
  const now = Date.now();
  const insertRole = db.prepare(
    `INSERT OR IGNORE INTO roles (id, name, display_name, description, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  insertRole.run('role_admin', 'admin', 'Administrator', 'Full system authorization, user management, settings, and audit control.', now);
  insertRole.run('role_user', 'user', 'User / Operator', 'Authorized gate queue, loading slip, and operational access.', now);
  insertRole.run(
    'role_mmd_manager',
    'mmd_manager',
    'MMD Manager',
    'Material Management & Dispatch Manager across Gate Queue, Dispatch Details, Material Register, Material Master, Liquid Store, and Ex-Factory.',
    now
  );
  insertRole.run(
    'role_view_only',
    'view_only',
    'View Only',
    'Read-only monitoring and reporting access across permitted sections without create, edit, or delete rights.',
    now
  );
  insertRole.run(
    'role_forklift_operator',
    'forklift_operator',
    'Forklift Operator',
    'Restricted access exclusively to the Forklift Operator Loading section.',
    now
  );
  insertRole.run(
    'role_liquid_store_operator',
    'liquid_store_operator',
    'Liquid Store Operator',
    'Restricted access exclusively to the Liquid Material Camp Store section.',
    now
  );
  insertRole.run(
    'role_ex_factory_operator',
    'ex_factory_operator',
    'Ex-Factory Operator',
    'Restricted access exclusively to the Ex-Factory Dispatch section.',
    now
  );
  insertRole.run(
    'role_security_guard',
    'security_guard',
    'Security Guard (View Only)',
    'Restricted View Only access exclusively to the Security Guard Gate Truck Allotment screen.',
    now
  );
  db.prepare(
    `UPDATE roles
     SET display_name = 'Security Guard (View Only)',
         description = 'Restricted View Only access exclusively to the Security Guard Gate Truck Allotment screen.'
     WHERE id = 'role_security_guard'`
  ).run();

  const insertPerm = db.prepare(
    `INSERT OR IGNORE INTO permissions (id, key, name, category) VALUES (?, ?, ?, ?)`
  );
  const insertRolePerm = db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`
  );

  for (const perm of SEED_PERMISSIONS) {
    insertPerm.run(perm.id, perm.key, perm.name, perm.category);
    insertRolePerm.run('role_admin', perm.id);
    if (USER_DEFAULT_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_user', perm.id);
    }
    if (MMD_MANAGER_DEFAULT_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_mmd_manager', perm.id);
    }
    if (VIEW_ONLY_ALLOWED_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_view_only', perm.id);
    }
    if (FORKLIFT_ALLOWED_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_forklift_operator', perm.id);
    }
    if (LIQUID_STORE_ALLOWED_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_liquid_store_operator', perm.id);
    }
    if (EX_FACTORY_DEFAULT_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_ex_factory_operator', perm.id);
    }
    if (SECURITY_GUARD_DEFAULT_PERMISSION_KEYS.includes(perm.key)) {
      insertRolePerm.run('role_security_guard', perm.id);
    }
  }

  // One-time migration: grant dispatch.view, material_register.view, liquid.view & liquid.materials
  // to existing non-admin users who already held tickets.view/reports.view/liquid.store overrides
  const rbacDispatchMaterialSynced = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'rbac_dispatch_material_mmd_v1'`)
    .get() as { key: string } | undefined;
  if (!rbacDispatchMaterialSynced) {
    db.transaction(() => {
      const existingUsers = db
        .prepare(
          `SELECT u.id, r.name as role_name FROM users u INNER JOIN roles r ON r.id = u.role_id`
        )
        .all() as Array<{ id: string; role_name: string }>;
      const insertUserPerm = db.prepare(
        `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      for (const u of existingUsers) {
        if (u.role_name === 'admin' || u.role_name === 'forklift_operator' || u.role_name === 'ex_factory_operator') {
          continue;
        }
        const overrides = db
          .prepare(`SELECT permission_key, granted FROM user_permissions WHERE user_id = ?`)
          .all(u.id) as Array<{ permission_key: string; granted: number }>;
        if (overrides.length === 0) continue;
        const grantedSet = new Set(overrides.filter((o) => o.granted === 1).map((o) => o.permission_key));
        if (u.role_name === 'user') {
          if (grantedSet.has('tickets.view') || grantedSet.has('reports.view')) {
            insertUserPerm.run(u.id, 'dispatch.view');
            insertUserPerm.run(u.id, 'material_register.view');
          }
          if (grantedSet.has('liquid.store')) {
            insertUserPerm.run(u.id, 'liquid.view');
            insertUserPerm.run(u.id, 'liquid.materials');
          }
        } else if (u.role_name === 'liquid_store_operator' && grantedSet.has('liquid.store')) {
          insertUserPerm.run(u.id, 'liquid.view');
          insertUserPerm.run(u.id, 'liquid.materials');
        }
      }
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('rbac_dispatch_material_mmd_v1', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  // One-time sync: grant materials.view & materials.manage to existing non-restricted user overrides
  const rbacMaterialMasterSynced = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'rbac_material_master_v1'`)
    .get() as { key: string } | undefined;
  if (!rbacMaterialMasterSynced) {
    db.transaction(() => {
      const existingUsers = db
        .prepare(
          `SELECT u.id, r.name as role_name FROM users u INNER JOIN roles r ON r.id = u.role_id`
        )
        .all() as Array<{ id: string; role_name: string }>;
      const insertUserPerm = db.prepare(
        `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      for (const u of existingUsers) {
        if (
          u.role_name === 'admin' ||
          u.role_name === 'forklift_operator' ||
          u.role_name === 'liquid_store_operator' ||
          u.role_name === 'ex_factory_operator'
        ) {
          continue;
        }
        const overrides = db
          .prepare(`SELECT permission_key, granted FROM user_permissions WHERE user_id = ?`)
          .all(u.id) as Array<{ permission_key: string; granted: number }>;
        if (overrides.length === 0) continue;
        const grantedSet = new Set(overrides.filter((o) => o.granted === 1).map((o) => o.permission_key));
        if (u.role_name === 'view_only') {
          if (grantedSet.has('tickets.view') || grantedSet.has('dispatch.view')) {
            insertUserPerm.run(u.id, 'materials.view');
          }
        } else if (u.role_name === 'user' || u.role_name === 'mmd_manager') {
          if (grantedSet.has('tickets.view') || grantedSet.has('tickets.update')) {
            insertUserPerm.run(u.id, 'materials.view');
            insertUserPerm.run(u.id, 'materials.manage');
          }
        }
      }
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('rbac_material_master_v1', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  // One-time sync: grant guard.view to existing non-restricted user overrides that hold tickets.view
  const rbacGuardSynced = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'rbac_security_guard_v1'`)
    .get() as { key: string } | undefined;
  if (!rbacGuardSynced) {
    db.transaction(() => {
      const existingUsers = db
        .prepare(
          `SELECT u.id, r.name as role_name FROM users u INNER JOIN roles r ON r.id = u.role_id`
        )
        .all() as Array<{ id: string; role_name: string }>;
      const insertUserPerm = db.prepare(
        `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      for (const u of existingUsers) {
        if (
          u.role_name === 'admin' ||
          u.role_name === 'forklift_operator' ||
          u.role_name === 'liquid_store_operator' ||
          u.role_name === 'ex_factory_operator' ||
          u.role_name === 'security_guard'
        ) {
          continue;
        }
        const overrides = db
          .prepare(`SELECT permission_key, granted FROM user_permissions WHERE user_id = ?`)
          .all(u.id) as Array<{ permission_key: string; granted: number }>;
        if (overrides.length === 0) continue;
        const grantedSet = new Set(overrides.filter((o) => o.granted === 1).map((o) => o.permission_key));
        if (grantedSet.has('tickets.view')) {
          insertUserPerm.run(u.id, 'guard.view');
        }
      }
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('rbac_security_guard_v1', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  const insertSettings = db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)`
  );
  insertSettings.run('active', JSON.stringify(DEFAULT_APP_SETTINGS), 'system', now);
  insertSettings.run('default', JSON.stringify(DEFAULT_APP_SETTINGS), 'system', now);

  // Sync system-default settings row if it still holds the legacy placeholder
  const defaultSettingsRow = db
    .prepare(`SELECT value_json, updated_by FROM app_settings WHERE key = 'default'`)
    .get() as { value_json: string; updated_by: string | null } | undefined;
  if (defaultSettingsRow && defaultSettingsRow.updated_by === 'system') {
    try {
      const parsedDef = JSON.parse(defaultSettingsRow.value_json);
      if (parsedDef?.companyName === 'SHREE BALAJI LOGISTICS & INDUSTRIAL PLANT') {
        db.prepare(`UPDATE app_settings SET value_json = ?, updated_at = ? WHERE key = 'default'`).run(
          JSON.stringify(DEFAULT_APP_SETTINGS),
          now
        );
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // One-time sync: update legacy phone 0550170374 -> 4981604 and promote all current app settings to default
  const phoneAndDefaultSynced = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'settings_default_sync_4981604'`)
    .get() as { key: string } | undefined;
  if (!phoneAndDefaultSynced) {
    db.transaction(() => {
      const activeRow = db
        .prepare(`SELECT value_json, updated_by FROM app_settings WHERE key = 'active'`)
        .get() as { value_json: string; updated_by: string | null } | undefined;
      let mergedSettings: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
      if (activeRow) {
        try {
          const parsedActive = JSON.parse(activeRow.value_json);
          if (parsedActive && typeof parsedActive === 'object') {
            mergedSettings = { ...DEFAULT_APP_SETTINGS, ...parsedActive };
          }
        } catch {
          // Fallback to DEFAULT_APP_SETTINGS
        }
      }
      if (!mergedSettings.phone || String(mergedSettings.phone).trim() === '0550170374') {
        mergedSettings.phone = '4981604';
      }
      const actor = activeRow?.updated_by || 'system';
      const serialized = JSON.stringify(mergedSettings);
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`
      ).run(serialized, actor, now);
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default', ?, ?, ?)`
      ).run(serialized, actor, now);
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('settings_default_sync_4981604', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  // Seed default tickets & drivers once on fresh databases
  const seededMarker = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'default_records_seeded'`)
    .get() as { key: string } | undefined;
  if (!seededMarker) {
    db.transaction(() => {
      const ticketCnt = (db.prepare(`SELECT COUNT(*) as cnt FROM tickets`).get() as { cnt: number }).cnt;
      if (ticketCnt === 0) {
        const insertTicket = db.prepare(
          `INSERT OR IGNORE INTO tickets (id, ticket_number, sequence_number, date, data_json, version, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const t of DEFAULT_TICKET_RECORDS) {
          insertTicket.run(
            t.id,
            t.ticketNumber,
            t.sequenceNumber,
            t.date,
            JSON.stringify(t.data),
            t.version,
            t.createdBy,
            t.updatedBy,
            t.createdAt,
            t.updatedAt
          );
        }
      }

      const driverCnt = (db.prepare(`SELECT COUNT(*) as cnt FROM drivers`).get() as { cnt: number }).cnt;
      if (driverCnt === 0) {
        const insertDriver = db.prepare(
          `INSERT OR IGNORE INTO drivers (id, truck_number, data_json, updated_at) VALUES (?, ?, ?, ?)`
        );
        for (const d of DEFAULT_DRIVER_RECORDS) {
          insertDriver.run(d.id, d.truckNumber.toUpperCase(), JSON.stringify(d.data), d.updatedAt);
        }
      }

      db.prepare(
        `INSERT OR IGNORE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default_records_seeded', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  // Auto-seed default administrator when database has no users (supports env override)
  const defaultAdminUsername = (process.env.ADMIN_INITIAL_USERNAME || 'munnayadav').trim() || 'munnayadav';
  const defaultAdminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Yadav@1977';
  const userCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    const hash = bcrypt.hashSync(defaultAdminPassword, 12);
    const adminId = `usr_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'system', ?, ?)`
    ).run(adminId, defaultAdminUsername, 'System Administrator', '', hash, 'role_admin', now, now);
  }

  // One-time sync: ensure default admin credentials (munnayadav / Yadav@1977) exist on existing DBs
  const defaultAdminSynced = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'default_admin_munnayadav_v1'`)
    .get() as { key: string } | undefined;
  if (!defaultAdminSynced) {
    db.transaction(() => {
      const hash = bcrypt.hashSync(defaultAdminPassword, 12);
      const existingTarget = db
        .prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`)
        .get(defaultAdminUsername) as { id: string } | undefined;

      if (existingTarget) {
        db.prepare(
          `UPDATE users
           SET username = ?, password_hash = ?, role_id = 'role_admin', is_active = 1,
               must_change_password = 0, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
           WHERE id = ?`
        ).run(defaultAdminUsername, hash, now, existingTarget.id);
      } else {
        const seededAdmin = db
          .prepare(`SELECT id FROM users WHERE username = 'admin' AND created_by = 'system'`)
          .get() as { id: string } | undefined;
        if (seededAdmin) {
          db.prepare(
            `UPDATE users
             SET username = ?, password_hash = ?, role_id = 'role_admin', is_active = 1,
                 must_change_password = 0, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
             WHERE id = ?`
          ).run(defaultAdminUsername, hash, now, seededAdmin.id);
        } else {
          const adminId = `usr_${crypto.randomUUID()}`;
          db.prepare(
            `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'system', ?, ?)`
          ).run(adminId, defaultAdminUsername, 'System Administrator', '', hash, 'role_admin', now, now);
        }
      }

      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default_admin_munnayadav_v1', ?, 'system', ?)`
      ).run(JSON.stringify({ version: 1 }), now);
    })();
  }

  // Ensure default Admin email (newshuntexpress@gmail.com) always exists as an active Administrator
  const existingDefaultEmailAdmin = db
    .prepare(`SELECT id, role_id, is_active FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(DEFAULT_ADMIN_EMAIL) as { id: string; role_id: string; is_active: number } | undefined;

  if (!existingDefaultEmailAdmin) {
    let defaultUsername = 'newshuntexpress';
    let suffix = 1;
    while (db.prepare(`SELECT 1 FROM users WHERE username = ? COLLATE NOCASE`).get(defaultUsername)) {
      suffix += 1;
      defaultUsername = `newshuntexpress_${suffix}`;
    }
    const defaultPassHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
    const defaultAdminId = `usr_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, failed_login_attempts, locked_until, created_by, created_at, updated_at)
       VALUES (?, ?, 'Default Administrator', ?, ?, 'role_admin', 1, 0, 0, NULL, 'system', ?, ?)`
    ).run(defaultAdminId, defaultUsername, DEFAULT_ADMIN_EMAIL, defaultPassHash, now, now);
  } else if (existingDefaultEmailAdmin.role_id !== 'role_admin' || existingDefaultEmailAdmin.is_active !== 1) {
    db.prepare(
      `UPDATE users
       SET role_id = 'role_admin', is_active = 1, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now, existingDefaultEmailAdmin.id);
  }

  seedLiquidStoreIfEmpty();
  seedMaterialMasterIfEmpty();
}

function seedMaterialMasterIfEmpty(): void {
  const seeded = db
    .prepare(`SELECT key FROM app_settings WHERE key = 'material_master_seeded_v1'`)
    .get() as { key: string } | undefined;
  if (seeded) return;

  const now = Date.now();
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM material_master`).get() as { cnt: number };
  if (countRow.cnt === 0) {
    const insertMat = db.prepare(
      `INSERT OR IGNORE INTO material_master (
        id, material_name, pack_type, pallet_ratio, remarks, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'system', 'system', ?, ?)`
    );
    const starterMaterials = [
      { id: 'mat_seed_ds40200', name: 'DS40200', pack: 'Rolls', ratio: 23, remarks: '' },
      { id: 'mat_seed_ds40250', name: 'DS40250', pack: 'Rolls', ratio: 20, remarks: '' },
      { id: 'mat_seed_ms60', name: 'MS60', pack: 'Rolls', ratio: 25, remarks: '' },
      { id: 'mat_seed_primer', name: 'PRIMER-AWAZEL', pack: 'Drum', ratio: 4, remarks: '' },
    ];
    for (const m of starterMaterials) {
      insertMat.run(m.id, m.name, m.pack, m.ratio, m.remarks, now, now);
    }
  }

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('material_master_seeded_v1', ?, 'system', ?)`
  ).run(JSON.stringify({ version: 1 }), now);
}

function nowLocalDateTimeString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function resetLiquidStoreToDefault(performedBy = 'System Seed'): void {
  const now = Date.now();
  const txDate = nowLocalDateTimeString();
  const dateCompact = txDate.slice(0, 10).replaceAll('-', '');

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM liquid_transactions`).run();
    db.prepare(`DELETE FROM liquid_tanks`).run();
    db.prepare(`DELETE FROM liquid_materials`).run();
    db.prepare(`DELETE FROM liquid_audit_logs`).run();
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('liquid_tanks','liquid_materials','liquid_transactions','liquid_audit_logs')`).run();

    db.prepare(
      `INSERT OR REPLACE INTO liquid_settings (id, data_json, updated_at) VALUES (1, ?, ?)`
    ).run(
      JSON.stringify({
        facilityName: 'Liquid Material Camp Store — Sector 4',
        theme: 'light',
      }),
      now
    );

    const insertMat = db.prepare(
      `INSERT INTO liquid_materials (name, code, description, created_at) VALUES (?, ?, ?, ?)`
    );
    insertMat.run(
      'ASPHALT 60/70',
      'ASP-6070',
      'Penetration grade bitumen 60/70 for paving and industrial applications',
      now
    );
    insertMat.run(
      'USED OIL',
      'USE-OIL',
      'Recovered industrial lubricating and furnace fuel oil',
      now
    );

    const insertTank = db.prepare(
      `INSERT INTO liquid_tanks (name, total_capacity_kg, depth_meters, location, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    let tank1Id: number | bigint = 1;
    for (let i = 1; i <= 14; i++) {
      const info = insertTank.run(
        `Tank ${String(i).padStart(2, '0')}`,
        2000000,
        7,
        i <= 7 ? 'Main Storage Bay A' : 'Main Storage Bay B',
        'Vertical cylindrical bulk storage tank (2,000 MT / 7m)',
        now
      );
      if (i === 1) tank1Id = info.lastInsertRowid;
    }

    db.prepare(
      `INSERT INTO liquid_transactions (
        tx_code, type, tx_date, tank_id, material_name, quantity_kg, quantity_mt,
        reference_number, document_number, party_name, vehicle_number, driver_name, remarks, created_by, created_at
      ) VALUES (?, 'INWARD', ?, ?, 'ASPHALT 60/70', 500000, 500, 'OPN-2026-001', 'DOC-2026-001', 'National Bitumen Refinery', 'MH-12-TK-4401', '', 'Opening baseline inventory stock', ?, ?)`
    ).run(`INW-${dateCompact}-0001`, txDate, tank1Id, performedBy, now);

    db.prepare(
      `INSERT INTO liquid_audit_logs (action, entity_type, summary, performed_by, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(
      'CREATE',
      'TRANSACTION',
      'Initialized Tank 01 to Tank 14 (2,000 MT / 7m each) with 500,000 KG ASPHALT 60/70 in Tank 01',
      performedBy,
      now
    );
  });

  tx();
}

export function seedLiquidStoreIfEmpty(): void {
  const tankCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM liquid_tanks`).get() as { cnt: number };
  if (tankCountRow.cnt === 0) {
    resetLiquidStoreToDefault('System Seed');
  }
}

seedDatabase();

export function computeEffectivePermissions(userId: string, roleId: string, roleName: string): string[] {
  if (roleName === 'admin') {
    return SEED_PERMISSIONS.map((p) => p.key);
  }

  const rolePerms = db
    .prepare(
      `SELECT p.key FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`
    )
    .all(roleId) as Array<{ key: string }>;

  const overrides = db
    .prepare(`SELECT permission_key, granted FROM user_permissions WHERE user_id = ?`)
    .all(userId) as Array<{ permission_key: string; granted: number }>;

  if (roleName === 'forklift_operator') {
    const forkliftAllowed = new Set(FORKLIFT_ALLOWED_PERMISSION_KEYS);
    if (overrides.length > 0) {
      return overrides
        .filter((o) => o.granted === 1 && forkliftAllowed.has(o.permission_key))
        .map((o) => o.permission_key);
    }
    return rolePerms.map((r) => r.key).filter((k) => forkliftAllowed.has(k));
  }

  if (roleName === 'liquid_store_operator') {
    const liquidAllowed = new Set(LIQUID_STORE_ALLOWED_PERMISSION_KEYS);
    if (overrides.length > 0) {
      return overrides
        .filter((o) => o.granted === 1 && liquidAllowed.has(o.permission_key))
        .map((o) => o.permission_key);
    }
    return rolePerms.map((r) => r.key).filter((k) => liquidAllowed.has(k));
  }

  if (roleName === 'ex_factory_operator') {
    const exFactoryAllowed = new Set(EX_FACTORY_ALLOWED_PERMISSION_KEYS);
    if (overrides.length > 0) {
      return overrides
        .filter((o) => o.granted === 1 && exFactoryAllowed.has(o.permission_key))
        .map((o) => o.permission_key);
    }
    return rolePerms.map((r) => r.key).filter((k) => exFactoryAllowed.has(k));
  }

  if (roleName === 'security_guard') {
    const guardAllowed = new Set(SECURITY_GUARD_ALLOWED_PERMISSION_KEYS);
    if (overrides.length > 0) {
      return overrides
        .filter((o) => o.granted === 1 && guardAllowed.has(o.permission_key))
        .map((o) => o.permission_key);
    }
    return rolePerms.map((r) => r.key).filter((k) => guardAllowed.has(k));
  }

  if (roleName === 'view_only') {
    const viewOnlyAllowed = new Set(VIEW_ONLY_ALLOWED_PERMISSION_KEYS);
    if (overrides.length > 0) {
      return overrides
        .filter((o) => o.granted === 1 && viewOnlyAllowed.has(o.permission_key))
        .map((o) => o.permission_key);
    }
    return rolePerms.map((r) => r.key).filter((k) => viewOnlyAllowed.has(k));
  }

  if (overrides.length > 0) {
    // Explicit per-user permission matrix set by Admin (filter out admin-only keys for non-admin role)
    const adminOnly = new Set(['users.manage', 'audit.view', 'settings.manage']);
    return overrides
      .filter((o) => o.granted === 1 && !adminOnly.has(o.permission_key))
      .map((o) => o.permission_key);
  }

  return rolePerms.map((r) => r.key);
}

export function getSafeUserById(userId: string): SafeUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role_id, u.is_active,
              u.must_change_password, u.last_login_at, u.signature_data_url, u.created_by, u.created_at, u.updated_at,
              r.name as role_name, r.display_name as role_display_name
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: string;
        username: string;
        full_name: string;
        email: string;
        role_id: string;
        is_active: number;
        must_change_password: number;
        last_login_at: number | null;
        signature_data_url: string | null;
        created_by: string | null;
        created_at: number;
        updated_at: number;
        role_name: string;
        role_display_name: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    roleId: row.role_id,
    roleName: row.role_name,
    roleDisplayName: row.role_display_name,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at,
    signatureDataUrl: row.signature_data_url || '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: computeEffectivePermissions(row.id, row.role_id, row.role_name),
  };
}

export function logAudit(entry: {
  actorUserId?: string | null;
  actorUsername?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  ipAddress?: string;
}): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, actor_username, action, target_type, target_id, details, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.actorUserId || null,
      entry.actorUsername || null,
      entry.action,
      entry.targetType || null,
      entry.targetId || null,
      entry.details || null,
      entry.ipAddress || null,
      Date.now()
    );
  } catch (err) {
    console.error('Audit logging error:', err);
  }
}

export function revokeAllUserSessions(userId: string): void {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(Date.now(), userId);
}

export function cleanExpiredSessions(): void {
  const now = Date.now();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`).run(
    now,
    now - 86400000
  );
}
