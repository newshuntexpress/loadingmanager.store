<?php
/**
 * Native WordPress PHP + MySQL ($wpdb) REST Backend for GatePass & Loading Slip Manager.
 * Runs 100% inside WordPress without requiring an external Node.js server, while preserving
 * all WordPress & GatePass tables across future plugin updates.
 */

if (!defined('ABSPATH')) {
  exit;
}

class GatePass_WP_API {

  const VERSION = '1.2.5';
  const SESSION_COOKIE = 'gp_wp_session';
  const DEFAULT_ADMIN_EMAIL = 'newshuntexpress@gmail.com';

  public static function init() {
    add_action('rest_api_init', array(__CLASS__, 'register_routes'));
    add_action('wp_ajax_gatepass_api', array(__CLASS__, 'handle_ajax'));
    add_action('wp_ajax_nopriv_gatepass_api', array(__CLASS__, 'handle_ajax'));
    // Prevent security/force-login plugins from blocking custom GatePass token auth on /gatepass/v1/* REST routes
    add_filter('rest_authentication_errors', array(__CLASS__, 'allow_gatepass_rest_namespace'), 9999);
  }

  public static function is_gatepass_rest_request() {
    if (!empty($_GET['rest_route'])) {
      $rr = '/' . ltrim((string) wp_unslash($_GET['rest_route']), '/');
      if (strpos($rr, '/gatepass/v1') === 0) {
        return true;
      }
    }
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
    if ($uri !== '' && (strpos($uri, '/gatepass/v1/') !== false || preg_match('#/gatepass/v1(?:$|\?)#', $uri))) {
      return true;
    }
    return false;
  }

  public static function allow_gatepass_rest_namespace($result) {
    if (is_wp_error($result) && self::is_gatepass_rest_request()) {
      // Clear external WP-cookie-only REST blockers; GatePass enforces its own cryptographic session auth in route_request().
      self::log_auth_debug('rest_filter_bypass', 'cleared_external_rest_auth_blocker', array(
        'blockedCode' => (string) $result->get_error_code(),
      ));
      return true;
    }
    return $result;
  }

  public static function table($name) {
    global $wpdb;
    return $wpdb->prefix . 'gatepass_' . $name;
  }

  public static function now_ms() {
    $ms = round(microtime(true) * 1000);
    return PHP_INT_SIZE >= 8 ? (int) $ms : $ms;
  }

  public static function uuid() {
    if (function_exists('wp_generate_uuid4')) {
      return wp_generate_uuid4();
    }
    return bin2hex(random_bytes(16));
  }

  public static function random_hex($bytes = 32) {
    return bin2hex(random_bytes($bytes));
  }

  public static function upper_str($val) {
    $s = trim((string) $val);
    return function_exists('mb_strtoupper') ? mb_strtoupper($s, 'UTF-8') : strtoupper($s);
  }

  public static function register_routes() {
    register_rest_route('gatepass/v1', '/(?P<endpoint>.+)', array(
      'methods'             => WP_REST_Server::ALLMETHODS,
      'callback'            => array(__CLASS__, 'dispatch'),
      'permission_callback' => '__return_true',
    ));
  }

  // =========================================================
  // DATABASE SCHEMA & NON-DESTRUCTIVE INITIAL SEEDING
  // =========================================================

  public static function ensure_schema($force = false) {
    global $wpdb;
    static $done = false;
    if ($done && !$force) {
      return;
    }
    $done = true;

    $charset_collate = $wpdb->get_charset_collate();

    $sqls = array(
      "CREATE TABLE IF NOT EXISTS " . self::table('users') . " (
        id VARCHAR(80) NOT NULL,
        username VARCHAR(64) NOT NULL,
        full_name VARCHAR(160) NOT NULL,
        email VARCHAR(160) DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        role_name VARCHAR(64) NOT NULL DEFAULT 'user',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        must_change_password TINYINT(1) NOT NULL DEFAULT 0,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        locked_until BIGINT NULL,
        last_login_at BIGINT NULL,
        signature_data_url LONGTEXT NULL,
        permissions_json LONGTEXT NULL,
        created_by VARCHAR(64) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_username (username)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('sessions') . " (
        id CHAR(64) NOT NULL,
        user_id VARCHAR(80) NOT NULL,
        csrf_token VARCHAR(64) NOT NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        last_activity_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        revoked_at BIGINT NULL,
        PRIMARY KEY (id),
        KEY idx_user_id (user_id),
        KEY idx_expires (expires_at)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('tickets') . " (
        id VARCHAR(80) NOT NULL,
        ticket_number VARCHAR(64) NOT NULL,
        sequence_number INT NOT NULL DEFAULT 1,
        date_str VARCHAR(20) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'waiting',
        data_json LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        KEY idx_date (date_str)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('drivers') . " (
        id VARCHAR(80) NOT NULL,
        truck_number VARCHAR(64) NOT NULL,
        driver_name VARCHAR(160) NOT NULL,
        driver_phone VARCHAR(64) DEFAULT '',
        data_json LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_truck (truck_number)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('materials') . " (
        id VARCHAR(80) NOT NULL,
        material_name VARCHAR(200) NOT NULL,
        normalized_name VARCHAR(200) NOT NULL,
        pack_type VARCHAR(80) NOT NULL DEFAULT 'BAG',
        pallet_ratio DOUBLE NOT NULL DEFAULT 1,
        remarks TEXT NULL,
        created_by VARCHAR(64) NULL,
        updated_by VARCHAR(64) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_norm_name (normalized_name)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('settings') . " (
        key_name VARCHAR(80) NOT NULL,
        value_json LONGTEXT NOT NULL,
        updated_by VARCHAR(64) NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (key_name)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('alerts') . " (
        id VARCHAR(80) NOT NULL,
        ticket_id VARCHAR(80) NOT NULL,
        data_json LONGTEXT NOT NULL,
        dismissed_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('ex_factory') . " (
        id VARCHAR(80) NOT NULL,
        entry_date VARCHAR(20) NOT NULL,
        del_note_number VARCHAR(64) NOT NULL,
        data_json LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        KEY idx_entry_date (entry_date)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('audit_logs') . " (
        id BIGINT NOT NULL AUTO_INCREMENT,
        actor_user_id VARCHAR(80) NULL,
        actor_username VARCHAR(64) NOT NULL,
        action VARCHAR(64) NOT NULL,
        target_type VARCHAR(64) NOT NULL,
        target_id VARCHAR(80) NULL,
        details TEXT NULL,
        ip_address VARCHAR(64) NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        KEY idx_created_at (created_at)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('driver_tokens') . " (
        token VARCHAR(128) NOT NULL,
        ticket_id VARCHAR(80) NOT NULL,
        created_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (token),
        UNIQUE KEY uniq_ticket (ticket_id)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('whatsapp_logs') . " (
        id VARCHAR(80) NOT NULL,
        ticket_id VARCHAR(80) NOT NULL,
        data_json LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id)
      ) $charset_collate;",

      "CREATE TABLE IF NOT EXISTS " . self::table('liquid_store') . " (
        key_name VARCHAR(64) NOT NULL,
        data_json LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (key_name)
      ) $charset_collate;",
    );

    foreach ($sqls as $sql) {
      $wpdb->query($sql);
    }

    // Non-destructive column upgrades for sites updating from earlier plugin versions
    $users_table = self::table('users');
    $user_cols = $wpdb->get_col("SHOW COLUMNS FROM {$users_table}", 0);
    if (is_array($user_cols)) {
      if (!in_array('email', $user_cols, true)) {
        $wpdb->query("ALTER TABLE {$users_table} ADD COLUMN email VARCHAR(160) DEFAULT '' AFTER full_name");
      }
      if (!in_array('locked_until', $user_cols, true)) {
        $wpdb->query("ALTER TABLE {$users_table} ADD COLUMN locked_until BIGINT NULL AFTER failed_login_attempts");
      }
      if (!in_array('signature_data_url', $user_cols, true)) {
        $wpdb->query("ALTER TABLE {$users_table} ADD COLUMN signature_data_url LONGTEXT NULL AFTER last_login_at");
      }
      if (!in_array('permissions_json', $user_cols, true)) {
        $wpdb->query("ALTER TABLE {$users_table} ADD COLUMN permissions_json LONGTEXT NULL AFTER signature_data_url");
      }
    }

    // Seed default Admin munnayadav / Yadav@1977 ONLY when no users exist yet
    $users_table = self::table('users');
    $user_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$users_table}");
    if ($user_count === 0) {
      $now = self::now_ms();
      $wpdb->insert($users_table, array(
        'id'                    => 'usr_' . self::uuid(),
        'username'              => 'munnayadav',
        'full_name'             => 'Munna Yadav',
        'email'                 => '',
        'password_hash'         => password_hash('Yadav@1977', PASSWORD_BCRYPT),
        'role_name'             => 'admin',
        'is_active'             => 1,
        'must_change_password'  => 0,
        'failed_login_attempts' => 0,
        'signature_data_url'    => '',
        'permissions_json'      => wp_json_encode(self::all_permission_keys()),
        'created_by'            => 'system',
        'created_at'            => (string) $now,
        'updated_at'            => (string) $now,
      ));
    }

    // Ensure default Admin email (newshuntexpress@gmail.com) always exists as an active Administrator
    $default_admin_row = $wpdb->get_row(
      $wpdb->prepare("SELECT id, role_name, is_active FROM {$users_table} WHERE LOWER(email) = LOWER(%s) LIMIT 1", self::DEFAULT_ADMIN_EMAIL),
      ARRAY_A
    );
    if (!$default_admin_row) {
      $now = self::now_ms();
      $candidate = 'newshuntexpress';
      $suffix = 1;
      while ($wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$users_table} WHERE LOWER(username) = LOWER(%s) LIMIT 1", $candidate))) {
        $suffix++;
        $candidate = 'newshuntexpress_' . $suffix;
      }
      $wpdb->insert($users_table, array(
        'id'                    => 'usr_' . self::uuid(),
        'username'              => $candidate,
        'full_name'             => 'Default Administrator',
        'email'                 => self::DEFAULT_ADMIN_EMAIL,
        'password_hash'         => password_hash(self::random_hex(24), PASSWORD_BCRYPT),
        'role_name'             => 'admin',
        'is_active'             => 1,
        'must_change_password'  => 0,
        'failed_login_attempts' => 0,
        'signature_data_url'    => '',
        'permissions_json'      => wp_json_encode(self::all_permission_keys()),
        'created_by'            => 'system',
        'created_at'            => (string) $now,
        'updated_at'            => (string) $now,
      ));
    } elseif (($default_admin_row['role_name'] ?? '') !== 'admin' || ((int) ($default_admin_row['is_active'] ?? 0)) !== 1) {
      $wpdb->update($users_table, array(
        'role_name'             => 'admin',
        'is_active'             => 1,
        'failed_login_attempts' => 0,
        'locked_until'          => null,
        'updated_at'            => (string) self::now_ms(),
      ), array('id' => $default_admin_row['id']));
    }

    // Seed default company settings ONLY if not yet present
    $settings_table = self::table('settings');
    $active_row = $wpdb->get_var($wpdb->prepare("SELECT key_name FROM {$settings_table} WHERE key_name = %s", 'active'));
    if (!$active_row) {
      $now = self::now_ms();
      $default_settings = self::default_company_settings();
      $wpdb->insert($settings_table, array(
        'key_name'   => 'active',
        'value_json' => wp_json_encode($default_settings),
        'updated_by' => 'system',
        'updated_at' => $now,
      ));
      $wpdb->replace($settings_table, array(
        'key_name'   => 'default',
        'value_json' => wp_json_encode($default_settings),
        'updated_by' => 'system',
        'updated_at' => $now,
      ));
    }
  }

  // =========================================================
  // ROLES, PERMISSIONS & DEFAULTS
  // =========================================================

  public static function role_catalog() {
    return array(
      array('id' => 'role_admin', 'name' => 'admin', 'displayName' => 'Administrator', 'description' => 'Full system control, user administration & audit trail.'),
      array('id' => 'role_user', 'name' => 'user', 'displayName' => 'Standard User', 'description' => 'Customizable operational permissions across dispatch & slips.'),
      array('id' => 'role_mmd_manager', 'name' => 'mmd_manager', 'displayName' => 'MMD Manager', 'description' => 'Materials, dispatch, ex-factory & liquid store oversight.'),
      array('id' => 'role_view_only', 'name' => 'view_only', 'displayName' => 'View Only', 'description' => 'Read-only monitoring across permitted modules.'),
      array('id' => 'role_forklift_operator', 'name' => 'forklift_operator', 'displayName' => 'Forklift Operator', 'description' => 'Forklift loading verification & item completion.'),
      array('id' => 'role_liquid_store_operator', 'name' => 'liquid_store_operator', 'displayName' => 'Liquid Store Operator', 'description' => 'Liquid tank inward/outward & stock control.'),
      array('id' => 'role_ex_factory_operator', 'name' => 'ex_factory_operator', 'displayName' => 'Ex-Factory Operator', 'description' => 'Ex-Factory entries & loading slips.'),
      array('id' => 'role_security_guard', 'name' => 'security_guard', 'displayName' => 'Security Guard (View Only)', 'description' => 'Read-only checkpost monitor showing gate-wise allotted trucks.'),
    );
  }

  public static function permission_catalog() {
    return array(
      array('id' => 'perm_tickets_view', 'key' => 'tickets.view', 'name' => 'View Tickets & Live Gate Monitor', 'category' => 'Operations'),
      array('id' => 'perm_tickets_create', 'key' => 'tickets.create', 'name' => 'Create New Gate Tickets', 'category' => 'Operations'),
      array('id' => 'perm_tickets_update', 'key' => 'tickets.update', 'name' => 'Update Gate Status & Loading Slips', 'category' => 'Operations'),
      array('id' => 'perm_forklift_operate', 'key' => 'forklift.operate', 'name' => 'Forklift Operator Loading Checklist & Completion', 'category' => 'Operations'),
      array('id' => 'perm_tickets_delete', 'key' => 'tickets.delete', 'name' => 'Delete Ticket Records', 'category' => 'Operations'),
      array('id' => 'perm_guard_view', 'key' => 'guard.view', 'name' => 'View Security Guard Gate Truck Allotment Screen', 'category' => 'Operations'),
      array('id' => 'perm_slips_print', 'key' => 'slips.print', 'name' => 'Print & Export Loading Slips / Tokens', 'category' => 'Documents'),
      array('id' => 'perm_drivers_manage', 'key' => 'drivers.manage', 'name' => 'Manage Driver & Vehicle Master Directory', 'category' => 'Operations'),
      array('id' => 'perm_materials_view', 'key' => 'materials.view', 'name' => 'View Material Master Catalog', 'category' => 'Operations'),
      array('id' => 'perm_materials_manage', 'key' => 'materials.manage', 'name' => 'Manage Material Master (Add / Edit / Delete / Excel Import)', 'category' => 'Operations'),
      array('id' => 'perm_reports_view', 'key' => 'reports.view', 'name' => 'View Daily Reports & Export CSV', 'category' => 'Reporting'),
      array('id' => 'perm_dispatch_view', 'key' => 'dispatch.view', 'name' => 'View Dispatch Details (Material-Wise Summary & Export)', 'category' => 'Reporting'),
      array('id' => 'perm_material_register_view', 'key' => 'material_register.view', 'name' => 'View Material Register (Loading Slip Line Items)', 'category' => 'Reporting'),
      array('id' => 'perm_liquid_view', 'key' => 'liquid.view', 'name' => 'View Liquid Material Camp Store (Read-Only)', 'category' => 'Operations'),
      array('id' => 'perm_liquid_store', 'key' => 'liquid.store', 'name' => 'Manage Liquid Material Camp Store (Inward/Outward & Tanks)', 'category' => 'Operations'),
      array('id' => 'perm_liquid_materials', 'key' => 'liquid.materials', 'name' => 'Manage Material Master Data (Create / Edit / Delete)', 'category' => 'Operations'),
      array('id' => 'perm_ex_factory_view', 'key' => 'ex_factory.view', 'name' => 'View Ex-Factory Dispatch Entries', 'category' => 'Operations'),
      array('id' => 'perm_ex_factory_create', 'key' => 'ex_factory.create', 'name' => 'Create Ex-Factory Dispatch Entries', 'category' => 'Operations'),
      array('id' => 'perm_ex_factory_update', 'key' => 'ex_factory.update', 'name' => 'Update Ex-Factory Dispatch Entries', 'category' => 'Operations'),
      array('id' => 'perm_ex_factory_delete', 'key' => 'ex_factory.delete', 'name' => 'Delete Ex-Factory Dispatch Entries', 'category' => 'Operations'),
      array('id' => 'perm_settings_manage', 'key' => 'settings.manage', 'name' => 'Manage Plant & System Settings', 'category' => 'Administration'),
      array('id' => 'perm_users_manage', 'key' => 'users.manage', 'name' => 'Manage Users, Roles & Permissions', 'category' => 'Administration'),
      array('id' => 'perm_audit_view', 'key' => 'audit.view', 'name' => 'View Security Audit Logs', 'category' => 'Administration'),
    );
  }

  public static function all_permission_keys() {
    $keys = array();
    foreach (self::permission_catalog() as $p) {
      $keys[] = $p['key'];
    }
    return $keys;
  }

  public static function compute_effective_permissions($role_name, $stored_perms) {
    $all = self::all_permission_keys();
    if ($role_name === 'admin') {
      return $all;
    }

    $allowed_map = array(
      'user' => array(
        'tickets.view', 'tickets.create', 'tickets.update', 'forklift.operate', 'guard.view',
        'tickets.delete', 'slips.print', 'drivers.manage', 'materials.view', 'materials.manage',
        'reports.view', 'dispatch.view', 'material_register.view',
        'liquid.view', 'liquid.store', 'liquid.materials',
        'ex_factory.view', 'ex_factory.create', 'ex_factory.update', 'ex_factory.delete',
      ),
      'mmd_manager' => array(
        'tickets.view', 'tickets.create', 'tickets.update', 'forklift.operate', 'guard.view',
        'tickets.delete', 'slips.print', 'drivers.manage', 'materials.view', 'materials.manage',
        'reports.view', 'dispatch.view', 'material_register.view',
        'liquid.view', 'liquid.store', 'liquid.materials',
        'ex_factory.view', 'ex_factory.create', 'ex_factory.update', 'ex_factory.delete',
        'settings.manage',
      ),
      'view_only' => array(
        'tickets.view', 'guard.view', 'materials.view', 'dispatch.view',
        'material_register.view', 'reports.view', 'liquid.view', 'ex_factory.view',
      ),
      'forklift_operator' => array('tickets.view', 'forklift.operate'),
      'liquid_store_operator' => array('liquid.view', 'liquid.store', 'liquid.materials'),
      'ex_factory_operator' => array('ex_factory.view', 'ex_factory.create', 'ex_factory.update', 'ex_factory.delete'),
      'security_guard' => array('guard.view'),
    );

    $defaults_map = array(
      'user' => array(
        'tickets.view', 'tickets.create', 'tickets.update', 'forklift.operate', 'guard.view',
        'slips.print', 'drivers.manage', 'materials.view', 'materials.manage',
        'reports.view', 'dispatch.view', 'material_register.view',
        'liquid.view', 'liquid.store', 'liquid.materials',
        'ex_factory.view', 'ex_factory.create', 'ex_factory.update',
      ),
      'mmd_manager' => array(
        'tickets.view', 'tickets.create', 'tickets.update', 'forklift.operate', 'guard.view',
        'slips.print', 'drivers.manage', 'materials.view', 'materials.manage',
        'reports.view', 'dispatch.view', 'material_register.view',
        'liquid.view', 'liquid.store', 'liquid.materials',
        'ex_factory.view', 'ex_factory.create', 'ex_factory.update',
      ),
      'view_only' => array(
        'tickets.view', 'guard.view', 'materials.view', 'dispatch.view',
        'material_register.view', 'reports.view', 'liquid.view', 'ex_factory.view',
      ),
      'forklift_operator' => array('tickets.view', 'forklift.operate'),
      'liquid_store_operator' => array('liquid.view', 'liquid.store', 'liquid.materials'),
      'ex_factory_operator' => array('ex_factory.view', 'ex_factory.create', 'ex_factory.update'),
      'security_guard' => array('guard.view'),
    );

    $allowed = isset($allowed_map[$role_name]) ? $allowed_map[$role_name] : $allowed_map['user'];
    if (is_array($stored_perms)) {
      if (in_array('__none__', $stored_perms, true)) {
        return array();
      }
      $filtered = array_values(array_intersect($stored_perms, $allowed));
      if (!empty($filtered)) {
        return $filtered;
      }
    }
    return isset($defaults_map[$role_name]) ? $defaults_map[$role_name] : array('tickets.view');
  }

  public static function role_display_name($role_name) {
    foreach (self::role_catalog() as $r) {
      if ($r['name'] === $role_name) {
        return $r['displayName'];
      }
    }
    return 'Standard User';
  }

  public static function default_company_settings() {
    $site_name = function_exists('get_bloginfo') ? trim((string) get_bloginfo('name')) : '';
    return array(
      'companyName' => $site_name !== '' ? $site_name : 'MATERIAL LOADING & GATEPASS',
      'companySubtitle' => 'Dispatch, Loading Slip & Gate Queue Management',
      'documentTitle' => 'MATERIAL LOADING SLIP / GATEPASS',
      'documentCode' => 'FM-LOG-01',
      'logoDataUrl' => '',
      'gates' => array('GATE 1', 'GATE 2', 'GATE 3', 'GATE 4', 'GATE 5'),
      'whatsappTemplates' => array(
        'ticketCreated' => 'Hello {{driverName}}, your truck {{truckNumber}} is registered at {{gateNumber}} (Queue #{{queueNumber}}, Ticket {{ticketNumber}}). Status: {{driverStatusUrl}}',
        'calledToGate'  => 'Attention {{driverName}}, Truck {{truckNumber}} is CALLED to {{gateNumber}}. Please proceed immediately.',
        'underLoading'  => 'Truck {{truckNumber}} loading has started at {{gateNumber}}.',
        'completed'     => 'Truck {{truckNumber}} loading is COMPLETED. Collect loading slip {{delNoteNumber}}.',
      ),
      'sessionIdleMinutes' => 30,
      'autoMoveWaitToLoadingMinutes' => 30,
    );
  }

  public static function default_liquid_state() {
    $now = self::now_ms();
    return array(
      'settings' => array(
        'facilityName' => 'Liquid Material Camp Store — Sector 4',
        'theme'        => 'light',
      ),
      'tanks' => array(
        array('id' => 1, 'name' => 'TANK A1', 'totalCapacityKg' => 25000, 'depthMeters' => 4.5, 'location' => 'Liquid Bay 1', 'notes' => '', 'createdAt' => $now),
        array('id' => 2, 'name' => 'TANK B1', 'totalCapacityKg' => 25000, 'depthMeters' => 4.5, 'location' => 'Liquid Bay 2', 'notes' => '', 'createdAt' => $now),
      ),
      'materials' => array(
        array('id' => 1, 'name' => 'BASE OIL', 'code' => 'LIQ-001', 'description' => 'Standard Base Oil', 'createdAt' => $now),
      ),
      'transactions' => array(),
      'auditLogs' => array(),
      'nextTxSeq' => 1,
      'nextTankId' => 3,
      'nextMatId' => 2,
      'nextTxId' => 1,
      'nextAuditId' => 1,
    );
  }

  // =========================================================
  // HELPERS: AUTH, HEADERS, AUDIT, USER MAPPING
  // =========================================================

  public static function format_user($row) {
    if (!$row) {
      return null;
    }
    $stored_perms = json_decode((string) ($row['permissions_json'] ?? 'null'), true);
    $effective = self::compute_effective_permissions($row['role_name'], is_array($stored_perms) ? $stored_perms : null);

    return array(
      'id'                 => $row['id'],
      'username'           => $row['username'],
      'fullName'           => $row['full_name'],
      'email'              => (string) ($row['email'] ?? ''),
      'roleId'             => 'role_' . $row['role_name'],
      'roleName'           => $row['role_name'],
      'roleDisplayName'    => self::role_display_name($row['role_name']),
      'isActive'           => ((int) $row['is_active']) === 1,
      'mustChangePassword' => ((int) $row['must_change_password']) === 1,
      'lastLoginAt'        => $row['last_login_at'] ? (int) $row['last_login_at'] : null,
      'signatureDataUrl'   => (string) ($row['signature_data_url'] ?? ''),
      'createdBy'          => $row['created_by'],
      'createdAt'          => (int) $row['created_at'],
      'updatedAt'          => (int) $row['updated_at'],
      'permissions'        => $effective,
    );
  }

  public static function open_access_auth_context() {
    $now = self::now_ms();
    return array(
      'sessionId' => 'open_access',
      'csrfToken' => 'open_access',
      'user'      => array(
        'id'                 => 'open_workspace',
        'username'           => 'gatepass',
        'fullName'           => 'GatePass Dispatch Desk',
        'email'              => '',
        'roleId'             => 'role_admin',
        'roleName'           => 'admin',
        'roleDisplayName'    => 'Open Access',
        'isActive'           => true,
        'mustChangePassword' => false,
        'lastLoginAt'        => $now,
        'signatureDataUrl'   => '',
        'createdBy'          => null,
        'createdAt'          => $now,
        'updatedAt'          => $now,
        'permissions'        => self::all_permission_keys(),
      ),
    );
  }

  public static function get_user_row_by_id($user_id) {
    global $wpdb;
    $t = self::table('users');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $user_id), ARRAY_A);
  }

  public static function get_client_ip() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
      $parts = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
      return trim($parts[0]);
    }
    return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
  }

  public static function is_https_request() {
    if (is_ssl()) {
      return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
      $parts = explode(',', strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']));
      if (trim($parts[0]) === 'https') {
        return true;
      }
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') {
      return true;
    }
    if (!empty($_SERVER['HTTP_CF_VISITOR']) && stripos((string) $_SERVER['HTTP_CF_VISITOR'], '"https"') !== false) {
      return true;
    }
    if (isset($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443) {
      return true;
    }
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? strtolower((string) $_SERVER['HTTP_ORIGIN']) : '';
    if (strpos($origin, 'https://') === 0) {
      return true;
    }
    $referer = isset($_SERVER['HTTP_REFERER']) ? strtolower((string) $_SERVER['HTTP_REFERER']) : '';
    if (strpos($referer, 'https://') === 0) {
      return true;
    }
    return false;
  }

  public static function log_auth_debug($event, $reason, $extra = array()) {
    if (!defined('WP_DEBUG') || !WP_DEBUG) {
      return;
    }
    $safe = array_merge(array(
      'event'   => (string) $event,
      'reason'  => (string) $reason,
      'https'   => self::is_https_request(),
      'ajax'    => function_exists('wp_doing_ajax') ? wp_doing_ajax() : false,
      'rest'    => defined('REST_REQUEST') && REST_REQUEST,
    ), is_array($extra) ? $extra : array());
    @error_log('[GatePass Auth] ' . wp_json_encode($safe));
  }

  public static function get_request_header_ci($target_name) {
    $lower_target = strtolower($target_name);
    $server_key = 'HTTP_' . strtoupper(str_replace('-', '_', $target_name));
    if (!empty($_SERVER[$server_key])) {
      return trim((string) $_SERVER[$server_key]);
    }
    if (!empty($_SERVER['REDIRECT_' . $server_key])) {
      return trim((string) $_SERVER['REDIRECT_' . $server_key]);
    }
    if (!empty($_SERVER['REDIRECT_REDIRECT_' . $server_key])) {
      return trim((string) $_SERVER['REDIRECT_REDIRECT_' . $server_key]);
    }
    if (function_exists('getallheaders')) {
      $all = getallheaders();
      if (is_array($all)) {
        foreach ($all as $k => $v) {
          if (strtolower((string) $k) === $lower_target && trim((string) $v) !== '') {
            return trim((string) $v);
          }
        }
      }
    }
    if (function_exists('apache_request_headers')) {
      $all = apache_request_headers();
      if (is_array($all)) {
        foreach ($all as $k => $v) {
          if (strtolower((string) $k) === $lower_target && trim((string) $v) !== '') {
            return trim((string) $v);
          }
        }
      }
    }
    return '';
  }

  public static function extract_session_token_sources() {
    $candidates = array();
    $sources = array(
      'headerToken' => false,
      'bearer'      => false,
      'postToken'   => false,
      'queryToken'  => false,
      'cookieToken' => false,
    );

    $push = function ($raw_val, $source_key) use (&$candidates, &$sources) {
      if (!is_string($raw_val)) {
        return;
      }
      $tok = trim($raw_val);
      if (preg_match('/^[a-f0-9]{64}$/i', $tok)) {
        $sources[$source_key] = true;
        if (!in_array($tok, $candidates, true)) {
          $candidates[] = $tok;
        }
      }
    };

    $gp_hdr = self::get_request_header_ci('X-GatePass-Token');
    if ($gp_hdr !== '') {
      $push($gp_hdr, 'headerToken');
    }

    $auth_header = self::get_request_header_ci('Authorization');
    if (stripos($auth_header, 'Bearer ') === 0) {
      $push(substr($auth_header, 7), 'bearer');
    }

    if (!empty($_POST['gp_token'])) {
      $push((string) wp_unslash($_POST['gp_token']), 'postToken');
    }
    if (!empty($_REQUEST['gp_token'])) {
      $push((string) wp_unslash($_REQUEST['gp_token']), 'postToken');
    }
    if (!empty($_GET['_gp_tok'])) {
      $push((string) wp_unslash($_GET['_gp_tok']), 'queryToken');
    }
    if (!empty($_COOKIE[self::SESSION_COOKIE])) {
      $push((string) wp_unslash($_COOKIE[self::SESSION_COOKIE]), 'cookieToken');
    }

    return array('tokens' => $candidates, 'sources' => $sources);
  }

  public static function extract_session_token() {
    $extracted = self::extract_session_token_sources();
    return !empty($extracted['tokens']) ? $extracted['tokens'][0] : null;
  }

  public static function set_session_cookie($raw_token, $ttl_sec) {
    if (headers_sent()) {
      return;
    }
    $secure = self::is_https_request();
    $expires = time() + max(3600, (int) $ttl_sec);

    if ($secure) {
      $expires_str = gmdate('D, d M Y H:i:s \G\M\T', $expires);
      $cookie_header = self::SESSION_COOKIE . '=' . rawurlencode($raw_token)
        . '; Expires=' . $expires_str
        . '; Max-Age=' . max(3600, (int) $ttl_sec)
        . '; Path=/; HttpOnly; Secure; SameSite=None; Partitioned';
      header('Set-Cookie: ' . $cookie_header, false);
      return;
    }

    if (PHP_VERSION_ID >= 70300) {
      setcookie(self::SESSION_COOKIE, $raw_token, array(
        'expires'  => $expires,
        'path'     => '/',
        'secure'   => false,
        'httponly' => true,
        'samesite' => 'Lax',
      ));
    } else {
      setcookie(self::SESSION_COOKIE, $raw_token, $expires, '/', '', false, true);
    }
  }

  public static function clear_session_cookie() {
    if (headers_sent()) {
      return;
    }
    $secure = self::is_https_request();
    if ($secure) {
      header('Set-Cookie: ' . self::SESSION_COOKIE . '=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None; Partitioned', false);
      header('Set-Cookie: ' . self::SESSION_COOKIE . '=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None', false);
    }
    if (PHP_VERSION_ID >= 70300) {
      setcookie(self::SESSION_COOKIE, '', array(
        'expires'  => time() - 3600,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
      ));
    } else {
      setcookie(self::SESSION_COOKIE, '', time() - 3600, '/', '', $secure, true);
    }
  }

  public static function create_session($user_id, $is_admin = false) {
    global $wpdb;
    $raw_token = self::random_hex(32);
    $session_id = hash('sha256', $raw_token);
    $csrf_token = self::random_hex(24);
    $now = self::now_ms();
    $ttl = $is_admin ? (30 * 24 * 3600 * 1000) : (12 * 3600 * 1000);
    $expires_at = $now + $ttl;
    $ttl_sec = max(3600, (int) ($ttl / 1000));

    $session_row = array(
      'id'               => $session_id,
      'user_id'          => $user_id,
      'csrf_token'       => $csrf_token,
      'ip_address'       => substr(self::get_client_ip(), 0, 64),
      'user_agent'       => substr(preg_replace('/[\xF0-\xF7].../', '', (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 240),
      'created_at'       => (string) $now,
      'last_activity_at' => (string) $now,
      'expires_at'       => (string) $expires_at,
    );

    // Omit revoked_at so MySQL stores true SQL NULL (never WP $wpdb->insert null->0 coercion)
    $inserted = $wpdb->insert(self::table('sessions'), $session_row);
    if ($inserted === false) {
      self::ensure_schema(true);
      $wpdb->insert(self::table('sessions'), $session_row);
    }

    // Store redundant transient fallback in wp_options so host DB restrictions never invalidate a fresh login
    set_transient('gp_wp_sess_' . $session_id, array(
      'id'               => $session_id,
      'user_id'          => $user_id,
      'csrf_token'       => $csrf_token,
      'created_at'       => $now,
      'last_activity_at' => $now,
      'expires_at'       => $expires_at,
      'revoked_at'       => 0,
      'is_admin'         => $is_admin ? 1 : 0,
    ), $ttl_sec);

    self::set_session_cookie($raw_token, $ttl_sec);

    return array('rawToken' => $raw_token, 'csrfToken' => $csrf_token);
  }

  public static function authenticate_request(&$failure_reason = null) {
    global $wpdb;
    $extracted = self::extract_session_token_sources();
    $candidates = $extracted['tokens'];
    $sources = $extracted['sources'];

    if (empty($candidates)) {
      $failure_reason = 'no_token';
      return null;
    }

    $sessions_t = self::table('sessions');
    $now = self::now_ms();
    $last_reason = 'session_not_found';

    foreach ($candidates as $raw) {
      $session_id = hash('sha256', $raw);
      $session = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$sessions_t} WHERE id = %s", $session_id), ARRAY_A);
      $from_transient = false;

      if (!$session) {
        $cached = get_transient('gp_wp_sess_' . $session_id);
        if (is_array($cached)) {
          $session = $cached;
          $from_transient = true;
        }
      }

      if (!$session) {
        $last_reason = 'session_not_found';
        continue;
      }

      $revoked_val = isset($session['revoked_at']) ? (float) $session['revoked_at'] : 0.0;
      if ($revoked_val > 0) {
        $last_reason = 'session_revoked';
        continue;
      }

      if (((float) $now) > ((float) $session['expires_at'])) {
        $last_reason = 'session_expired';
        continue;
      }

      $user_row = self::get_user_row_by_id($session['user_id']);
      $user = self::format_user($user_row);
      if (!$user || !$user['isActive']) {
        $last_reason = 'user_inactive';
        continue;
      }

      // Sliding session renewal on active non-poll requests
      if (self::get_request_header_ci('X-Background-Poll') === '') {
        $is_admin = ($user['roleName'] === 'admin');
        $ttl = $is_admin ? (30 * 24 * 3600 * 1000) : (12 * 3600 * 1000);
        $next_expires = $now + $ttl;
        $ttl_sec = (int) ($ttl / 1000);
        if (!$from_transient) {
          $wpdb->update($sessions_t, array(
            'last_activity_at' => (string) $now,
            'expires_at'       => (string) $next_expires,
          ), array('id' => $session_id));
        } else {
          $session['last_activity_at'] = $now;
          $session['expires_at'] = $next_expires;
          set_transient('gp_wp_sess_' . $session_id, $session, $ttl_sec);
        }
      }

      $failure_reason = null;
      return array('user' => $user, 'csrfToken' => $session['csrf_token'], 'sessionId' => $session_id);
    }

    $failure_reason = $last_reason;
    self::log_auth_debug('authenticate_failed', $last_reason, $sources);
    return null;
  }

  public static function log_audit($actor_id, $actor_username, $action, $target_type, $target_id = null, $details = '') {
    global $wpdb;
    $wpdb->insert(self::table('audit_logs'), array(
      'actor_user_id'  => $actor_id,
      'actor_username' => $actor_username,
      'action'         => $action,
      'target_type'    => $target_type,
      'target_id'      => $target_id,
      'details'        => $details,
      'ip_address'     => self::get_client_ip(),
      'created_at'     => (string) self::now_ms(),
    ));
  }

  public static function with_nocache_headers(WP_REST_Response $res) {
    $res->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    $res->header('Pragma', 'no-cache');
    $res->header('Expires', '0');
    $res->header('X-LiteSpeed-Cache-Control', 'no-cache');
    return $res;
  }

  public static function json_response($data, $status = 200) {
    return self::with_nocache_headers(new WP_REST_Response($data, $status));
  }

  public static function error_response($message, $status = 400, $code = null) {
    $payload = array('error' => $message);
    if ($code !== null) {
      $payload['code'] = $code;
    }
    return self::with_nocache_headers(new WP_REST_Response($payload, $status));
  }

  public static function has_permission($user, $perm) {
    if (!$user) {
      return false;
    }
    if ($user['roleName'] === 'admin') {
      return true;
    }
    return in_array($perm, $user['permissions'], true);
  }

  public static function has_any_permission($user, $perms) {
    foreach ($perms as $p) {
      if (self::has_permission($user, $p)) {
        return true;
      }
    }
    return false;
  }

  // =========================================================
  // MAIN ROUTER DISPATCHER
  // =========================================================

  public static function send_raw_nocache_headers() {
    if (!defined('DONOTCACHEPAGE')) {
      define('DONOTCACHEPAGE', true);
    }
    if (!defined('LSCACHE_NO_CACHE')) {
      define('LSCACHE_NO_CACHE', true);
    }
    if (!headers_sent()) {
      nocache_headers();
      header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
      header('Pragma: no-cache');
      header('Expires: 0');
      header('X-LiteSpeed-Cache-Control: no-cache');
    }
  }

  public static function handle_ajax() {
    @ini_set('display_errors', '0');
    if (ob_get_level() > 0) {
      @ob_clean();
    }
    self::send_raw_nocache_headers();

    self::ensure_schema();

    $endpoint = trim((string) wp_unslash($_REQUEST['gp_endpoint'] ?? ''), '/');
    $method = strtoupper(trim((string) wp_unslash($_REQUEST['gp_method'] ?? ($_SERVER['REQUEST_METHOD'] ?? 'GET'))));
    if (!in_array($method, array('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'), true)) {
      $method = 'GET';
    }

    $query_params = array();
    if (!empty($_REQUEST['gp_query'])) {
      parse_str((string) wp_unslash($_REQUEST['gp_query']), $query_params);
    }
    foreach ($_GET as $gk => $gv) {
      if (!array_key_exists($gk, $query_params)) {
        $query_params[$gk] = wp_unslash($gv);
      }
    }

    $raw_body = '';
    if (isset($_POST['gp_body'])) {
      $raw_body = (string) wp_unslash($_POST['gp_body']);
    } else {
      $raw_body = (string) file_get_contents('php://input');
    }
    $body = json_decode($raw_body, true);
    if (!is_array($body)) {
      $body = array();
    }

    $response = self::route_request($endpoint, $method, $query_params, $body);
    $status = $response instanceof WP_REST_Response ? $response->get_status() : 200;
    $data = $response instanceof WP_REST_Response ? $response->get_data() : $response;
    if (!headers_sent() && $response instanceof WP_REST_Response) {
      foreach ($response->get_headers() as $h_name => $h_val) {
        header($h_name . ': ' . $h_val);
      }
    }

    wp_send_json($data, $status);
  }

  public static function dispatch(WP_REST_Request $request) {
    @ini_set('display_errors', '0');
    if (ob_get_level() > 0) {
      @ob_clean();
    }
    self::send_raw_nocache_headers();
    self::ensure_schema();

    $endpoint = trim((string) $request->get_param('endpoint'), '/');
    $method = strtoupper($request->get_method());
    $override = $request->get_header('X-HTTP-Method-Override');
    if ($method === 'POST' && is_string($override) && $override !== '') {
      $method = strtoupper(trim($override));
    }

    $raw_body = $request->get_body();
    $body = json_decode((string) $raw_body, true);
    if (!is_array($body)) {
      $body = array();
    }

    $query_params = $request->get_query_params();
    if (!is_array($query_params)) {
      $query_params = array();
    }

    return self::route_request($endpoint, $method, $query_params, $body);
  }

  public static function route_request($endpoint, $method, $query_params, $body) {

    // 1. Health & Version
    if ($endpoint === 'health' && $method === 'GET') {
      return self::json_response(array('ok' => true, 'status' => 'healthy', 'backend' => 'wordpress', 'version' => self::VERSION, 'timestamp' => gmdate('c')));
    }
    if ($endpoint === 'app-version' && $method === 'GET') {
      return self::json_response(array('ok' => true, 'buildId' => 'wp-' . self::VERSION, 'version' => self::VERSION, 'serverBootAt' => self::now_ms()));
    }

    // 2. Public Auth Status / Setup / Login / Logout
    if ($endpoint === 'auth/status' && $method === 'GET') {
      return self::handle_auth_status();
    }
    if ($endpoint === 'auth/setup' && $method === 'POST') {
      return self::handle_auth_setup($body);
    }
    if ($endpoint === 'auth/login' && $method === 'POST') {
      return self::handle_auth_login($body);
    }
    if ($endpoint === 'auth/firebase-login' && $method === 'POST') {
      return self::handle_auth_firebase_login($body);
    }
    if ($endpoint === 'auth/logout' && $method === 'POST') {
      return self::handle_auth_logout();
    }

    // 3. Public Driver Status Endpoints
    if ($endpoint === 'public/driver-status' && $method === 'POST') {
      return self::handle_public_driver_status($body);
    }
    if (preg_match('#^public/driver-loading-status/([^/]+)$#', $endpoint, $m)) {
      return self::handle_public_driver_token(urldecode($m[1]));
    }

    // All remaining routes require authenticated session
    $auth_reason = null;
    $auth = self::authenticate_request($auth_reason);
    if (!$auth) {
      self::log_auth_debug('route_unauthorized', (string) ($auth_reason ?: 'unknown'), array(
        'endpoint' => substr($endpoint, 0, 64),
        'method'   => $method,
      ));
      $code_map = array(
        'no_token'          => 'NO_TOKEN',
        'session_revoked'   => 'SESSION_REVOKED',
        'session_expired'   => 'SESSION_EXPIRED',
        'user_inactive'     => 'ACCOUNT_INACTIVE',
        'session_not_found' => 'SESSION_INVALID',
      );
      $err_code = isset($code_map[$auth_reason]) ? $code_map[$auth_reason] : 'SESSION_INVALID';
      $res = self::error_response('Session expired or invalid. Please log in again.', 401, $err_code);
      $res->header('X-GatePass-Auth-Reason', (string) ($auth_reason ?: 'invalid'));
      return $res;
    }
    $user = $auth['user'];

    if ($endpoint === 'auth/me' && $method === 'GET') {
      return self::json_response(array('user' => $user, 'csrfToken' => $auth['csrfToken']));
    }
    if ($endpoint === 'auth/change-password' && $method === 'POST') {
      return self::handle_change_password($auth, $body);
    }

    if (!empty($user['mustChangePassword'])) {
      return self::error_response('You must change your temporary password before continuing.', 403, 'PASSWORD_CHANGE_REQUIRED');
    }

    // Admin Routes
    if ($endpoint === 'admin/roles' && $method === 'GET') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::json_response(array('roles' => self::role_catalog(), 'permissions' => self::permission_catalog()));
    }
    if ($endpoint === 'admin/users' && $method === 'GET') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_list_users();
    }
    if ($endpoint === 'admin/users' && $method === 'POST') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_create_user($user, $body);
    }
    if (preg_match('#^admin/users/([^/]+)/signature$#', $endpoint, $m)) {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_user_signature($user, urldecode($m[1]), $method, $body);
    }
    if (preg_match('#^admin/users/([^/]+)/permissions$#', $endpoint, $m) && $method === 'PUT') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_user_permissions($user, urldecode($m[1]), $body);
    }
    if (preg_match('#^admin/users/([^/]+)/reset-password$#', $endpoint, $m) && $method === 'POST') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_reset_password($user, urldecode($m[1]), $body);
    }
    if (preg_match('#^admin/users/([^/]+)/revoke-sessions$#', $endpoint, $m) && $method === 'POST') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_revoke_sessions($user, urldecode($m[1]));
    }
    if (preg_match('#^admin/users/([^/]+)$#', $endpoint, $m)) {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_user_detail($user, urldecode($m[1]), $method, $body);
    }
    if ($endpoint === 'admin/audit-logs' && $method === 'GET') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_audit_logs($query_params);
    }
    if ($endpoint === 'admin/sessions' && $method === 'GET') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_sessions();
    }
    if ($endpoint === 'admin/whatsapp-templates' && $method === 'PUT') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_admin_whatsapp_templates($user, $body);
    }

    // Settings
    if ($endpoint === 'settings' && $method === 'GET') {
      return self::handle_get_settings();
    }
    if ($endpoint === 'settings' && $method === 'PUT') {
      if (!self::has_permission($user, 'settings.manage')) return self::error_response('Permission denied.', 403);
      return self::handle_save_settings($user, 'active', $body);
    }
    if ($endpoint === 'settings/default' && $method === 'PUT') {
      if (!self::has_permission($user, 'settings.manage')) return self::error_response('Permission denied.', 403);
      return self::handle_save_settings($user, 'default', $body);
    }

    // Tickets & Forklift
    if ($endpoint === 'tickets' && $method === 'GET') {
      if (!self::has_any_permission($user, array('tickets.view', 'forklift.operate', 'dispatch.view', 'material_register.view', 'guard.view'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_get_tickets();
    }
    if ($endpoint === 'tickets' && $method === 'POST') {
      if (!self::has_permission($user, 'tickets.create')) return self::error_response('Permission denied.', 403);
      return self::handle_create_ticket($user, $body);
    }
    if ($endpoint === 'tickets/restore' && $method === 'POST') {
      if (!self::has_permission($user, 'tickets.delete')) return self::error_response('Permission denied.', 403);
      return self::handle_restore_ticket($user, $body);
    }
    if (preg_match('#^tickets/([^/]+)/forklift/(open|checklist|complete)$#', $endpoint, $m)) {
      if (!self::has_any_permission($user, array('forklift.operate', 'tickets.update'))) return self::error_response('Permission denied.', 403);
      return self::handle_forklift_action($user, urldecode($m[1]), $m[2], $body);
    }
    if (preg_match('#^tickets/([^/]+)$#', $endpoint, $m)) {
      return self::handle_ticket_detail($user, urldecode($m[1]), $method, $body);
    }

    // Loading Alerts
    if ($endpoint === 'loading-alerts' && $method === 'GET') {
      if (!self::has_any_permission($user, array('tickets.view', 'tickets.create', 'tickets.update'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_get_alerts();
    }
    if (preg_match('#^loading-alerts/([^/]+)/dismiss$#', $endpoint, $m) && $method === 'POST') {
      if (!self::has_any_permission($user, array('tickets.view', 'tickets.create', 'tickets.update'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_dismiss_alert(urldecode($m[1]));
    }

    // Drivers
    if ($endpoint === 'drivers' && $method === 'GET') {
      if (!self::has_any_permission($user, array('tickets.view', 'tickets.create', 'drivers.manage', 'ex_factory.view', 'ex_factory.create'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_get_drivers();
    }
    if ($endpoint === 'drivers' && $method === 'POST') {
      if (!self::has_any_permission($user, array('drivers.manage', 'tickets.create', 'tickets.update'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_save_driver($user, null, $body);
    }
    if (preg_match('#^drivers/([^/]+)$#', $endpoint, $m)) {
      if ($method === 'PUT') {
        if (!self::has_any_permission($user, array('drivers.manage', 'tickets.create', 'tickets.update'))) {
          return self::error_response('Permission denied.', 403);
        }
        return self::handle_save_driver($user, urldecode($m[1]), $body);
      }
      if ($method === 'DELETE') {
        if (!self::has_permission($user, 'drivers.manage')) return self::error_response('Permission denied.', 403);
        return self::handle_delete_driver($user, urldecode($m[1]));
      }
    }

    // Materials
    if ($endpoint === 'materials' && $method === 'GET') {
      if (!self::has_any_permission($user, array('materials.view', 'materials.manage', 'tickets.view', 'tickets.create', 'tickets.update', 'dispatch.view', 'material_register.view', 'ex_factory.view', 'ex_factory.create', 'ex_factory.update', 'forklift.operate'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_get_materials();
    }
    if ($endpoint === 'materials' && $method === 'POST') {
      if (!self::has_permission($user, 'materials.manage')) return self::error_response('Permission denied.', 403);
      return self::handle_create_material($user, $body);
    }
    if ($endpoint === 'materials/import' && $method === 'POST') {
      if (!self::has_permission($user, 'materials.manage')) return self::error_response('Permission denied.', 403);
      return self::handle_import_materials($user, $body);
    }
    if (preg_match('#^materials/([^/]+)$#', $endpoint, $m)) {
      if (!self::has_permission($user, 'materials.manage')) return self::error_response('Permission denied.', 403);
      return self::handle_material_detail($user, urldecode($m[1]), $method, $body);
    }

    // WhatsApp Logs
    if ($endpoint === 'whatsapp/logs' && $method === 'GET') {
      if (!self::has_any_permission($user, array('tickets.view', 'tickets.update', 'settings.manage'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_whatsapp_logs($query_params);
    }
    if (preg_match('#^whatsapp/retry/([^/]+)$#', $endpoint, $m) && $method === 'POST') {
      if (!self::has_any_permission($user, array('tickets.update', 'settings.manage'))) {
        return self::error_response('Permission denied.', 403);
      }
      return self::handle_whatsapp_retry(urldecode($m[1]));
    }

    // Backup & Migrate
    if ($endpoint === 'backup/export' && $method === 'GET') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_backup_export();
    }
    if ($endpoint === 'backup/restore' && $method === 'POST') {
      if ($user['roleName'] !== 'admin') return self::error_response('Administrator privileges required.', 403);
      return self::handle_backup_restore($user, $body);
    }
    if ($endpoint === 'bootstrap/migrate' && $method === 'POST') {
      return self::json_response(array('ok' => true));
    }

    // Liquid Store
    if (substr($endpoint, 0, 7) === 'liquid/') {
      return self::handle_liquid($user, substr($endpoint, 7), $method, $body);
    }

    // Ex-Factory
    if ($endpoint === 'ex-factory' || substr($endpoint, 0, 11) === 'ex-factory/') {
      return self::handle_ex_factory($user, $endpoint, $method, $body);
    }

    return self::error_response('API endpoint not found.', 404);
  }

  // =========================================================
  // AUTH HANDLERS
  // =========================================================

  private static function handle_auth_status() {
    global $wpdb;
    $users_t = self::table('users');
    $cnt = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$users_t}");
    $needs_setup = $cnt === 0;

    $settings = self::read_settings_key('active');
    $branding = array(
      'companyName'     => isset($settings['companyName']) ? $settings['companyName'] : 'MATERIAL LOADING & GATEPASS',
      'companySubtitle' => isset($settings['companySubtitle']) ? $settings['companySubtitle'] : '',
      'logoDataUrl'     => isset($settings['logoDataUrl']) ? $settings['logoDataUrl'] : '',
    );

    if ($needs_setup) {
      return self::json_response(array(
        'authenticated' => false,
        'needsSetup'    => true,
        'reason'        => 'needs_setup',
        'branding'      => $branding,
      ));
    }

    $auth_reason = null;
    $auth = self::authenticate_request($auth_reason);
    if (!$auth) {
      if ($auth_reason && $auth_reason !== 'no_token') {
        self::clear_session_cookie();
      }
      return self::json_response(array(
        'authenticated' => false,
        'needsSetup'    => false,
        'reason'        => $auth_reason ?: 'no_token',
        'branding'      => $branding,
      ));
    }

    return self::json_response(array(
      'authenticated' => true,
      'needsSetup'    => false,
      'user'          => $auth['user'],
      'csrfToken'     => $auth['csrfToken'],
      'branding'      => $branding,
    ));
  }

  private static function handle_auth_setup($body) {
    global $wpdb;
    $users_t = self::table('users');
    $cnt = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$users_t}");
    if ($cnt > 0) {
      return self::error_response('Initial setup is already completed. Please log in with an Admin account.', 403);
    }

    $username = trim((string) ($body['username'] ?? ''));
    $full_name = trim((string) ($body['fullName'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if (strlen($username) < 3) {
      return self::error_response('Username must be at least 3 characters.', 400);
    }
    if (strlen($full_name) < 2) {
      return self::error_response('Full Name is required.', 400);
    }
    if (strlen($password) < 8) {
      return self::error_response('Password must be at least 8 characters.', 400);
    }

    $now = self::now_ms();
    $user_id = 'usr_' . self::uuid();
    $wpdb->insert($users_t, array(
      'id'                    => $user_id,
      'username'              => $username,
      'full_name'             => $full_name,
      'email'                 => $email,
      'password_hash'         => password_hash($password, PASSWORD_BCRYPT),
      'role_name'             => 'admin',
      'is_active'             => 1,
      'must_change_password'  => 0,
      'failed_login_attempts' => 0,
      'last_login_at'         => $now,
      'signature_data_url'    => '',
      'permissions_json'      => wp_json_encode(self::all_permission_keys()),
      'created_by'            => 'initial_setup',
      'created_at'            => $now,
      'updated_at'            => $now,
    ));

    $sess = self::create_session($user_id, true);
    $user = self::format_user(self::get_user_row_by_id($user_id));
    self::log_audit($user_id, $username, 'USER_CREATED', 'user', $user_id, 'Initial Admin account created');

    return self::json_response(array(
      'user'         => $user,
      'csrfToken'    => $sess['csrfToken'],
      'sessionToken' => $sess['rawToken'],
    ), 201);
  }

  private static function handle_auth_login($body) {
    global $wpdb;
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
      return self::error_response('Username and password are required.', 400);
    }

    $users_t = self::table('users');
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_t} WHERE LOWER(username) = LOWER(%s)", $username), ARRAY_A);
    if (!$row) {
      self::log_audit(null, substr($username, 0, 32), 'LOGIN_FAILED', 'session', null, 'Invalid username');
      return self::error_response('Invalid username or password.', 401);
    }

    $now = self::now_ms();
    if (!empty($row['locked_until']) && ((float) $row['locked_until']) > 0 && ((float) $now) < ((float) $row['locked_until'])) {
      return self::error_response('Account temporarily locked due to failed attempts. Please try again later.', 401);
    }

    $matches = password_verify($password, (string) $row['password_hash']);
    if (((int) $row['is_active']) !== 1 || !$matches) {
      $attempts = ((int) $row['failed_login_attempts']) + 1;
      if ($attempts >= 5) {
        $lock_until = $now + 15 * 60 * 1000;
        $wpdb->update($users_t, array(
          'failed_login_attempts' => 0,
          'locked_until'          => (string) $lock_until,
        ), array('id' => $row['id']));
      } else {
        $wpdb->query($wpdb->prepare(
          "UPDATE {$users_t} SET failed_login_attempts = %d, locked_until = NULL WHERE id = %s",
          $attempts,
          $row['id']
        ));
      }
      self::log_audit($row['id'], $row['username'], 'LOGIN_FAILED', 'session', null, 'Incorrect password');
      return self::error_response('Invalid username or password.', 401);
    }

    $wpdb->query($wpdb->prepare(
      "UPDATE {$users_t} SET failed_login_attempts = 0, locked_until = NULL, last_login_at = %s WHERE id = %s",
      (string) $now,
      $row['id']
    ));

    $sess = self::create_session($row['id'], $row['role_name'] === 'admin');
    $user = self::format_user(self::get_user_row_by_id($row['id']));
    self::log_audit($row['id'], $row['username'], 'LOGIN_SUCCESS', 'session', $row['id'], 'User logged in (WordPress Portal)');

    return self::json_response(array(
      'user'         => $user,
      'csrfToken'    => $sess['csrfToken'],
      'sessionToken' => $sess['rawToken'],
    ));
  }

  private static function base64url_decode($data) {
    $b64 = strtr((string) $data, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad > 0) {
      $b64 .= str_repeat('=', 4 - $pad);
    }
    return base64_decode($b64, true);
  }

  private static function verify_firebase_id_token($id_token) {
    $project_id = 'storied-continuity-q5v9p';
    $parts = explode('.', trim((string) $id_token));
    if (count($parts) !== 3) {
      return null;
    }

    $header_raw = self::base64url_decode($parts[0]);
    $payload_raw = self::base64url_decode($parts[1]);
    $sig_raw = self::base64url_decode($parts[2]);
    if ($header_raw === false || $payload_raw === false || $sig_raw === false) {
      return null;
    }

    $header = json_decode($header_raw, true);
    $payload = json_decode($payload_raw, true);
    if (!is_array($header) || !is_array($payload)) {
      return null;
    }
    if (($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
      return null;
    }

    $certs = get_transient('gp_firebase_x509_certs');
    if (!is_array($certs) || empty($certs[$header['kid']])) {
      $resp = wp_remote_get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', array('timeout' => 10));
      if (is_wp_error($resp) || wp_remote_retrieve_response_code($resp) !== 200) {
        return null;
      }
      $decoded_certs = json_decode((string) wp_remote_retrieve_body($resp), true);
      if (!is_array($decoded_certs) || empty($decoded_certs)) {
        return null;
      }
      $certs = $decoded_certs;
      set_transient('gp_firebase_x509_certs', $certs, 3600);
    }

    $kid = (string) $header['kid'];
    if (empty($certs[$kid])) {
      return null;
    }

    $pub_key = openssl_pkey_get_public($certs[$kid]);
    if (!$pub_key) {
      return null;
    }

    $verified = openssl_verify($parts[0] . '.' . $parts[1], $sig_raw, $pub_key, OPENSSL_ALGO_SHA256);
    if ($verified !== 1) {
      return null;
    }

    $now = time();
    $aud = (string) ($payload['aud'] ?? '');
    $iss = (string) ($payload['iss'] ?? '');
    $sub = (string) ($payload['sub'] ?? '');
    $exp = (int) ($payload['exp'] ?? 0);
    $iat = (int) ($payload['iat'] ?? 0);

    if ($aud !== $project_id || $iss !== ('https://securetoken.google.com/' . $project_id) || $sub === '') {
      return null;
    }
    if ($exp <= $now || $iat > ($now + 300)) {
      return null;
    }
    if (empty($payload['email']) || empty($payload['email_verified'])) {
      return null;
    }

    return $payload;
  }

  private static function handle_auth_firebase_login($body) {
    global $wpdb;
    $id_token = trim((string) ($body['idToken'] ?? ''));
    if ($id_token === '') {
      return self::error_response('Firebase ID token is required.', 400);
    }

    $claims = self::verify_firebase_id_token($id_token);
    if (!is_array($claims)) {
      self::log_audit(null, 'firebase_unknown', 'LOGIN_FAILED', 'session', null, 'Invalid or expired Firebase ID token (WordPress Portal)');
      return self::error_response('Firebase session verification failed. Please sign in again.', 401);
    }

    $email = strtolower(trim((string) $claims['email']));
    $now = self::now_ms();
    $users_t = self::table('users');
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_t} WHERE LOWER(email) = LOWER(%s) LIMIT 1", $email), ARRAY_A);

    if (!$row) {
      if ($email !== self::DEFAULT_ADMIN_EMAIL) {
        self::log_audit(null, substr($email, 0, 64), 'LOGIN_FAILED', 'session', null, "Unauthorized Firebase Google login rejected for {$email} (WordPress Portal)");
        return self::error_response(
          'Access denied. Only Administrator-authorized accounts can access this application. Contact the Administrator (' . self::DEFAULT_ADMIN_EMAIL . ').',
          403
        );
      }

      $candidate = 'newshuntexpress';
      $suffix = 1;
      while ($wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$users_t} WHERE LOWER(username) = LOWER(%s) LIMIT 1", $candidate))) {
        $suffix++;
        $candidate = 'newshuntexpress_' . $suffix;
      }

      $full_name = trim((string) ($claims['name'] ?? ''));
      if (strlen($full_name) < 2) {
        $full_name = 'Default Administrator';
      }
      $full_name = substr($full_name, 0, 80);

      $user_id = 'usr_' . self::uuid();
      $wpdb->insert($users_t, array(
        'id'                    => $user_id,
        'username'              => $candidate,
        'full_name'             => $full_name,
        'email'                 => $email,
        'password_hash'         => password_hash(self::random_hex(24), PASSWORD_BCRYPT),
        'role_name'             => 'admin',
        'is_active'             => 1,
        'must_change_password'  => 0,
        'failed_login_attempts' => 0,
        'last_login_at'         => (string) $now,
        'signature_data_url'    => '',
        'permissions_json'      => wp_json_encode(self::all_permission_keys()),
        'created_by'            => 'system',
        'created_at'            => (string) $now,
        'updated_at'            => (string) $now,
      ));

      self::log_audit($user_id, $candidate, 'USER_CREATED', 'user', $user_id, 'Bootstrapped default Admin via Firebase Google Sign-In (WordPress Portal)');
      $row = self::get_user_row_by_id($user_id);
    } else {
      if (((int) $row['is_active']) !== 1) {
        self::log_audit($row['id'], $row['username'], 'LOGIN_FAILED', 'session', null, 'Firebase login attempt on deactivated account');
        return self::error_response('This account has been deactivated by the Administrator.', 403);
      }

      $wpdb->query($wpdb->prepare(
        "UPDATE {$users_t} SET failed_login_attempts = 0, locked_until = NULL, last_login_at = %s WHERE id = %s",
        (string) $now,
        $row['id']
      ));
    }

    $sess = self::create_session($row['id'], ($row['role_name'] ?? '') === 'admin');
    $user = self::format_user(self::get_user_row_by_id($row['id']));
    self::log_audit($row['id'], $row['username'], 'LOGIN_SUCCESS', 'session', $row['id'], 'User signed in via Firebase Google Authentication (WordPress Portal)');

    return self::json_response(array(
      'user'         => $user,
      'csrfToken'    => $sess['csrfToken'],
      'sessionToken' => $sess['rawToken'],
    ));
  }

  private static function handle_auth_logout() {
    global $wpdb;
    $extracted = self::extract_session_token_sources();
    $now = (string) self::now_ms();
    $audited = false;
    foreach ($extracted['tokens'] as $raw) {
      $session_id = hash('sha256', $raw);
      delete_transient('gp_wp_sess_' . $session_id);
      if (!$audited) {
        $sess_row = $wpdb->get_row($wpdb->prepare("SELECT user_id FROM " . self::table('sessions') . " WHERE id = %s", $session_id), ARRAY_A);
        if ($sess_row && !empty($sess_row['user_id'])) {
          $audited = true;
          $u_row = self::get_user_row_by_id($sess_row['user_id']);
          self::log_audit($sess_row['user_id'], $u_row['username'] ?? 'unknown', 'LOGOUT', 'session', substr($session_id, 0, 12), 'User logged out securely (WordPress Portal)');
        }
      }
      $wpdb->update(self::table('sessions'), array('revoked_at' => $now), array('id' => $session_id));
    }
    self::clear_session_cookie();
    return self::json_response(array('ok' => true));
  }

  private static function handle_change_password($auth, $body) {
    global $wpdb;
    $current = (string) ($body['currentPassword'] ?? '');
    $next = (string) ($body['newPassword'] ?? '');
    if ($current === '' || $next === '') {
      return self::error_response('Current password and new password are required.', 400);
    }
    if (strlen($next) < 8) {
      return self::error_response('New password must be at least 8 characters.', 400);
    }

    $row = self::get_user_row_by_id($auth['user']['id']);
    if (!$row || !password_verify($current, (string) $row['password_hash'])) {
      return self::error_response('Current password is incorrect.', 400);
    }

    $now = self::now_ms();
    $wpdb->update(self::table('users'), array(
      'password_hash'        => password_hash($next, PASSWORD_BCRYPT),
      'must_change_password' => 0,
      'updated_at'           => $now,
    ), array('id' => $row['id']));

    $sess = self::create_session($row['id'], $row['role_name'] === 'admin');
    $updated = self::format_user(self::get_user_row_by_id($row['id']));
    self::log_audit($row['id'], $row['username'], 'PASSWORD_CHANGED', 'user', $row['id'], 'Password changed');

    return self::json_response(array(
      'user'         => $updated,
      'csrfToken'    => $sess['csrfToken'],
      'sessionToken' => $sess['rawToken'],
      'message'      => 'Password updated successfully.',
    ));
  }

  // =========================================================
  // ADMIN USER MANAGEMENT
  // =========================================================

  private static function handle_admin_list_users() {
    global $wpdb;
    $users_t = self::table('users');
    $sess_t = self::table('sessions');
    $now = self::now_ms();

    $rows = $wpdb->get_results("SELECT * FROM {$users_t} ORDER BY created_at ASC", ARRAY_A);
    $users = array();
    foreach ($rows as $row) {
      $u = self::format_user($row);
      $active_cnt = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$sess_t} WHERE user_id = %s AND (revoked_at IS NULL OR revoked_at = 0) AND expires_at > %s",
        $row['id'],
        (string) $now
      ));
      $u['activeSessionCount'] = $active_cnt;
      $users[] = $u;
    }
    return self::json_response(array('users' => $users));
  }

  private static function handle_admin_create_user($actor, $body) {
    global $wpdb;
    $username = trim((string) ($body['username'] ?? ''));
    $full_name = trim((string) ($body['fullName'] ?? ''));
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $temp_pass = (string) ($body['temporaryPassword'] ?? '');
    $role_name = trim((string) ($body['roleName'] ?? 'user'));
    $is_active = isset($body['isActive']) && $body['isActive'] === false ? 0 : 1;
    $perms = isset($body['permissions']) && is_array($body['permissions']) ? $body['permissions'] : null;
    $sig = (string) ($body['signatureDataUrl'] ?? '');

    if (strlen($username) < 3) return self::error_response('Username must be at least 3 characters.', 400);
    if (strlen($full_name) < 2) return self::error_response('Full Name is required.', 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
      return self::error_response('Please provide a valid email address.', 400);
    }

    $has_password = strlen($temp_pass) > 0;
    if (!$has_password && $email === '') {
      return self::error_response('Provide either a Temporary Password or an authorized Google/Firebase Email address.', 400);
    }
    if ($has_password && strlen($temp_pass) < 8) {
      return self::error_response('Temporary Password must be at least 8 characters.', 400);
    }

    $users_t = self::table('users');
    $dup = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$users_t} WHERE LOWER(username) = LOWER(%s)", $username));
    if ($dup) {
      return self::error_response('Username already exists.', 409);
    }
    if ($email !== '') {
      $dup_email = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$users_t} WHERE LOWER(email) = LOWER(%s) LIMIT 1", $email));
      if ($dup_email) {
        return self::error_response('Another user already uses this authorized email address.', 409);
      }
    }

    $valid_roles = array('admin', 'user', 'mmd_manager', 'view_only', 'forklift_operator', 'liquid_store_operator', 'ex_factory_operator', 'security_guard');
    if (!in_array($role_name, $valid_roles, true)) {
      $role_name = 'user';
    }

    $effective_password = $has_password ? $temp_pass : self::random_hex(24);
    $req_pw_change = array_key_exists('requirePasswordChange', $body) ? (bool) $body['requirePasswordChange'] : true;
    $must_change_pw = ($has_password && $req_pw_change) ? 1 : 0;

    $user_id = 'usr_' . self::uuid();
    $now = self::now_ms();
    $wpdb->insert($users_t, array(
      'id'                   => $user_id,
      'username'             => $username,
      'full_name'            => $full_name,
      'email'                => $email,
      'password_hash'        => password_hash($effective_password, PASSWORD_BCRYPT),
      'role_name'            => $role_name,
      'is_active'            => $is_active,
      'must_change_password' => $must_change_pw,
      'signature_data_url'   => $sig,
      'permissions_json'     => wp_json_encode($perms !== null ? (empty($perms) ? array('__none__') : $perms) : null),
      'created_by'           => $actor['username'],
      'created_at'           => $now,
      'updated_at'           => $now,
    ));

    self::log_audit($actor['id'], $actor['username'], 'USER_CREATED', 'user', $user_id, "Created user @{$username} ({$role_name})");
    return self::json_response(array('user' => self::format_user(self::get_user_row_by_id($user_id))), 201);
  }

  private static function handle_admin_user_detail($actor, $target_id, $method, $body) {
    global $wpdb;
    $users_t = self::table('users');
    $row = self::get_user_row_by_id($target_id);
    if (!$row) {
      return self::error_response('User not found.', 404);
    }

    $is_default_admin = strtolower(trim((string) ($row['email'] ?? ''))) === self::DEFAULT_ADMIN_EMAIL;

    if ($method === 'DELETE') {
      if ($target_id === $actor['id']) {
        return self::error_response('You cannot delete your own currently signed-in Admin account.', 400);
      }
      if ($is_default_admin) {
        return self::error_response('Cannot delete the default Administrator account (' . self::DEFAULT_ADMIN_EMAIL . ').', 400);
      }
      $wpdb->delete(self::table('sessions'), array('user_id' => $target_id));
      $wpdb->delete($users_t, array('id' => $target_id));
      self::log_audit($actor['id'], $actor['username'], 'USER_DELETED', 'user', $target_id, 'Deleted user @' . $row['username']);
      return self::json_response(array('ok' => true));
    }

    if ($method === 'PATCH') {
      $full_name = isset($body['fullName']) ? trim((string) $body['fullName']) : $row['full_name'];
      $email = isset($body['email']) ? strtolower(trim((string) $body['email'])) : strtolower(trim((string) ($row['email'] ?? '')));
      $role_name = isset($body['roleName']) ? trim((string) $body['roleName']) : $row['role_name'];
      $is_active = array_key_exists('isActive', $body) ? ($body['isActive'] ? 1 : 0) : (int) $row['is_active'];
      $sig = array_key_exists('signatureDataUrl', $body) ? (string) $body['signatureDataUrl'] : (string) $row['signature_data_url'];

      if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return self::error_response('Please provide a valid email address.', 400);
      }
      if ($email !== '') {
        $dup_email = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$users_t} WHERE LOWER(email) = LOWER(%s) AND id != %s LIMIT 1", $email, $target_id));
        if ($dup_email) {
          return self::error_response('Another user already uses this authorized email address.', 409);
        }
      }

      if ($target_id === $actor['id'] && ($is_active === 0 || $role_name !== 'admin')) {
        return self::error_response('Cannot deactivate or demote your own Admin account.', 400);
      }
      if ($is_default_admin && ($is_active === 0 || $role_name !== 'admin' || $email !== self::DEFAULT_ADMIN_EMAIL)) {
        return self::error_response('Cannot deactivate, demote, or remove the default Administrator email (' . self::DEFAULT_ADMIN_EMAIL . ').', 400);
      }

      $update_data = array(
        'full_name'          => $full_name,
        'email'              => $email,
        'role_name'          => $role_name,
        'is_active'          => $is_active,
        'signature_data_url' => $sig,
        'updated_at'         => self::now_ms(),
      );
      if ($role_name !== $row['role_name']) {
        $update_data['permissions_json'] = null;
      }

      $wpdb->update($users_t, $update_data, array('id' => $target_id));

      return self::json_response(array('user' => self::format_user(self::get_user_row_by_id($target_id))));
    }

    return self::error_response('Method not allowed.', 405);
  }

  private static function handle_admin_user_signature($actor, $target_id, $method, $body) {
    global $wpdb;
    $row = self::get_user_row_by_id($target_id);
    if (!$row) return self::error_response('User not found.', 404);
    $sig = $method === 'DELETE' ? '' : (string) ($body['signatureDataUrl'] ?? '');
    $wpdb->update(self::table('users'), array('signature_data_url' => $sig, 'updated_at' => self::now_ms()), array('id' => $target_id));
    self::log_audit($actor['id'], $actor['username'], 'USER_UPDATED', 'user', $target_id, 'Updated user signature');
    return self::json_response(array('user' => self::format_user(self::get_user_row_by_id($target_id))));
  }

  private static function handle_admin_user_permissions($actor, $target_id, $body) {
    global $wpdb;
    $row = self::get_user_row_by_id($target_id);
    if (!$row) return self::error_response('User not found.', 404);
    $perms = isset($body['permissions']) && is_array($body['permissions']) ? $body['permissions'] : array();
    $store = empty($perms) ? array('__none__') : array_values($perms);
    $wpdb->update(self::table('users'), array('permissions_json' => wp_json_encode($store), 'updated_at' => self::now_ms()), array('id' => $target_id));
    self::log_audit($actor['id'], $actor['username'], 'PERMISSIONS_UPDATED', 'user', $target_id, 'Updated permissions for @' . $row['username']);
    return self::json_response(array('user' => self::format_user(self::get_user_row_by_id($target_id))));
  }

  private static function handle_admin_reset_password($actor, $target_id, $body) {
    global $wpdb;
    $row = self::get_user_row_by_id($target_id);
    if (!$row) return self::error_response('User not found.', 404);
    $pass = (string) ($body['temporaryPassword'] ?? '');
    if (strlen($pass) < 8) return self::error_response('Temporary Password must be at least 8 characters.', 400);

    $now = self::now_ms();
    $users_t = self::table('users');
    $wpdb->query($wpdb->prepare(
      "UPDATE {$users_t} SET password_hash = %s, must_change_password = 1, failed_login_attempts = 0, locked_until = NULL, updated_at = %s WHERE id = %s",
      password_hash($pass, PASSWORD_BCRYPT),
      (string) $now,
      $target_id
    ));
    $wpdb->update(self::table('sessions'), array('revoked_at' => (string) $now), array('user_id' => $target_id));
    self::log_audit($actor['id'], $actor['username'], 'PASSWORD_RESET', 'user', $target_id, 'Reset password for @' . $row['username']);
    return self::json_response(array('ok' => true, 'user' => self::format_user(self::get_user_row_by_id($target_id))));
  }

  private static function handle_admin_revoke_sessions($actor, $target_id) {
    global $wpdb;
    $wpdb->update(self::table('sessions'), array('revoked_at' => (string) self::now_ms()), array('user_id' => $target_id));
    self::log_audit($actor['id'], $actor['username'], 'SESSION_REVOKED', 'user', $target_id, 'Revoked active sessions');
    return self::json_response(array('ok' => true));
  }

  private static function handle_admin_audit_logs($query_params = array()) {
    global $wpdb;
    $t = self::table('audit_logs');
    $limit_raw = isset($query_params['limit']) ? $query_params['limit'] : 200;
    $limit = max(1, min(500, (int) ($limit_raw ?: 200)));
    $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t} ORDER BY created_at DESC LIMIT %d", $limit), ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $logs = array();
    foreach ($rows as $r) {
      $logs[] = array(
        'id'            => (int) $r['id'],
        'actorUserId'   => $r['actor_user_id'],
        'actorUsername' => $r['actor_username'],
        'action'        => $r['action'],
        'targetType'    => $r['target_type'],
        'targetId'      => $r['target_id'],
        'details'       => $r['details'],
        'ipAddress'     => $r['ip_address'],
        'createdAt'     => (int) $r['created_at'],
      );
    }
    return self::json_response(array('logs' => $logs));
  }

  private static function handle_admin_sessions() {
    global $wpdb;
    $sess_t = self::table('sessions');
    $users_t = self::table('users');
    $now = self::now_ms();
    $rows = $wpdb->get_results($wpdb->prepare(
      "SELECT s.*, u.username, u.full_name, u.role_name
       FROM {$sess_t} s
       INNER JOIN {$users_t} u ON u.id = s.user_id
       WHERE (s.revoked_at IS NULL OR s.revoked_at = 0) AND s.expires_at > %s
       ORDER BY s.last_activity_at DESC",
      (string) $now
    ), ARRAY_A);

    $sessions = array();
    foreach ($rows as $r) {
      $sessions[] = array(
        'sessionRef'      => substr($r['id'], 0, 12),
        'userId'          => $r['user_id'],
        'username'        => $r['username'],
        'fullName'        => $r['full_name'],
        'roleName'        => $r['role_name'],
        'roleDisplayName' => self::role_display_name($r['role_name']),
        'ipAddress'       => $r['ip_address'],
        'userAgent'       => $r['user_agent'],
        'createdAt'       => (int) $r['created_at'],
        'lastActivityAt'  => (int) $r['last_activity_at'],
        'expiresAt'       => (int) $r['expires_at'],
      );
    }
    return self::json_response(array('sessions' => $sessions));
  }

  private static function handle_admin_whatsapp_templates($actor, $body) {
    $current = self::read_settings_key('active');
    $templates = isset($body['templates']) && is_array($body['templates']) ? $body['templates'] : array();
    $current['whatsappTemplates'] = $templates;
    self::write_settings_key('active', $current, $actor['username']);
    return self::json_response(array('settings' => $current, 'whatsappTemplates' => $templates));
  }

  // =========================================================
  // SETTINGS
  // =========================================================

  private static function read_settings_key($key) {
    global $wpdb;
    $t = self::table('settings');
    $raw = $wpdb->get_var($wpdb->prepare("SELECT value_json FROM {$t} WHERE key_name = %s", $key));
    if (!$raw) {
      return self::default_company_settings();
    }
    $decoded = json_decode((string) $raw, true);
    return is_array($decoded) ? $decoded : self::default_company_settings();
  }

  private static function write_settings_key($key, $settings, $actor_name) {
    global $wpdb;
    $wpdb->replace(self::table('settings'), array(
      'key_name'   => $key,
      'value_json' => wp_json_encode($settings),
      'updated_by' => $actor_name,
      'updated_at' => self::now_ms(),
    ));
  }

  private static function handle_get_settings() {
    return self::json_response(array(
      'settings'        => self::read_settings_key('active'),
      'defaultSettings' => self::read_settings_key('default'),
    ));
  }

  private static function handle_save_settings($user, $key, $body) {
    $existing = self::read_settings_key($key);
    $merged = array_merge($existing, $body);
    self::write_settings_key($key, $merged, $user['username']);
    self::log_audit($user['id'], $user['username'], 'SETTINGS_UPDATED', 'settings', $key, "Updated {$key} settings");
    return self::json_response(array('settings' => $merged));
  }

  // =========================================================
  // TICKETS, FORKLIFT, ALERTS & AUTO-SYNC MATERIAL MASTER
  // =========================================================

  private static function normalize_ticket($ticket) {
    $upper_fields = array('ticketNumber', 'truckNumber', 'driverName', 'destinationPlace', 'transporterName', 'delNoteNumber');
    foreach ($upper_fields as $f) {
      if (isset($ticket[$f]) && is_string($ticket[$f])) {
        $ticket[$f] = self::upper_str($ticket[$f]);
      }
    }
    return $ticket;
  }

  private static function sync_materials_from_slip($slip, $actor_name) {
    global $wpdb;
    if (!is_array($slip) || empty($slip['items']) || !is_array($slip['items'])) {
      return array();
    }
    $t = self::table('materials');
    $now = self::now_ms();
    $saved = array();
    foreach ($slip['items'] as $item) {
      $desc = self::upper_str($item['description'] ?? '');
      if ($desc === '') continue;
      $norm = preg_replace('/\s+/', ' ', $desc);
      $existing = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE normalized_name = %s", $norm));
      if ($existing) continue;

      $pack = self::upper_str($item['pack'] ?? 'BAG');
      if ($pack === '') $pack = 'BAG';
      $ratio = isset($item['palletQty']) && is_numeric($item['palletQty']) && (float) $item['palletQty'] > 0 ? (float) $item['palletQty'] : 1;
      $mat_id = 'mat_' . self::uuid();
      $wpdb->insert($t, array(
        'id'              => $mat_id,
        'material_name'   => $desc,
        'normalized_name' => $norm,
        'pack_type'       => $pack,
        'pallet_ratio'    => $ratio,
        'remarks'         => '',
        'created_by'      => $actor_name,
        'updated_by'      => $actor_name,
        'created_at'      => $now,
        'updated_at'      => $now,
      ));
      $saved[] = array(
        'id'             => $mat_id,
        'materialName'   => $desc,
        'normalizedName' => $norm,
        'packType'       => $pack,
        'palletRatio'    => $ratio,
        'remarks'        => '',
        'createdBy'      => $actor_name,
        'updatedBy'      => $actor_name,
        'createdAt'      => $now,
        'updatedAt'      => $now,
      );
    }
    return $saved;
  }

  private static function handle_get_tickets() {
    global $wpdb;
    $t = self::table('tickets');
    $rows = $wpdb->get_results("SELECT data_json FROM {$t} ORDER BY date_str DESC, sequence_number ASC", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $tickets = array();
    foreach ($rows as $r) {
      $decoded = json_decode((string) $r['data_json'], true);
      if (is_array($decoded)) {
        $tickets[] = $decoded;
      }
    }
    return self::json_response(array('tickets' => $tickets));
  }

  private static function handle_create_ticket($user, $body) {
    global $wpdb;
    $now = self::now_ms();
    $id = 'tkt_' . self::uuid();
    $date_str = (string) ($body['date'] ?? wp_date('Y-m-d'));

    $ticket = self::normalize_ticket(array_merge($body, array(
      'id'        => $id,
      'date'      => $date_str,
      'status'    => (string) ($body['status'] ?? 'waiting'),
      'createdBy' => $user['username'],
      'updatedBy' => $user['username'],
      'createdAt' => $now,
      'updatedAt' => $now,
      'version'   => 1,
    )));

    $wpdb->insert(self::table('tickets'), array(
      'id'              => $id,
      'ticket_number'   => (string) ($ticket['ticketNumber'] ?? $id),
      'sequence_number' => (int) ($ticket['sequenceNumber'] ?? 1),
      'date_str'        => $date_str,
      'status'          => (string) $ticket['status'],
      'data_json'       => wp_json_encode($ticket),
      'created_at'      => $now,
      'updated_at'      => $now,
    ));

    // Create driver live token
    $token = self::random_hex(16);
    $wpdb->replace(self::table('driver_tokens'), array(
      'token'      => $token,
      'ticket_id'  => $id,
      'created_at' => $now,
      'expires_at' => $now + (7 * 24 * 3600 * 1000),
    ));

    if (!empty($ticket['loadingSlip'])) {
      self::sync_materials_from_slip($ticket['loadingSlip'], $user['username']);
    }

    self::log_audit($user['id'], $user['username'], 'TICKET_CREATED', 'ticket', $id, 'Created ticket ' . ($ticket['ticketNumber'] ?? $id));
    return self::json_response(array('ticket' => $ticket), 201);
  }

  private static function handle_restore_ticket($user, $body) {
    global $wpdb;
    $now = self::now_ms();
    $id = !empty($body['id']) ? (string) $body['id'] : ('tkt_' . self::uuid());
    $ticket = self::normalize_ticket(array_merge($body, array('id' => $id, 'updatedBy' => $user['username'], 'updatedAt' => $now)));
    $wpdb->replace(self::table('tickets'), array(
      'id'              => $id,
      'ticket_number'   => (string) ($ticket['ticketNumber'] ?? $id),
      'sequence_number' => (int) ($ticket['sequenceNumber'] ?? 1),
      'date_str'        => (string) ($ticket['date'] ?? wp_date('Y-m-d')),
      'status'          => (string) ($ticket['status'] ?? 'waiting'),
      'data_json'       => wp_json_encode($ticket),
      'created_at'      => (int) ($ticket['createdAt'] ?? $now),
      'updated_at'      => $now,
    ));
    return self::json_response(array('ticket' => $ticket));
  }

  private static function handle_ticket_detail($user, $id, $method, $body) {
    global $wpdb;
    $t = self::table('tickets');
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
    if (!$row) {
      return self::error_response('Ticket not found.', 404);
    }

    if ($method === 'DELETE') {
      if (!self::has_permission($user, 'tickets.delete')) return self::error_response('Permission denied.', 403);
      $wpdb->delete($t, array('id' => $id));
      self::log_audit($user['id'], $user['username'], 'TICKET_DELETED', 'ticket', $id, 'Deleted ticket ' . $row['ticket_number']);
      return self::json_response(array('ok' => true));
    }

    if ($method === 'PATCH') {
      if (!self::has_permission($user, 'tickets.update')) return self::error_response('Permission denied.', 403);
      $existing = json_decode((string) $row['data_json'], true);
      if (!is_array($existing)) $existing = array();
      $now = self::now_ms();
      $merged = self::normalize_ticket(array_merge($existing, $body, array(
        'id'        => $id,
        'updatedBy' => $user['username'],
        'updatedAt' => $now,
        'version'   => ((int) ($existing['version'] ?? 1)) + 1,
      )));

      $wpdb->update($t, array(
        'ticket_number'   => (string) ($merged['ticketNumber'] ?? $row['ticket_number']),
        'sequence_number' => (int) ($merged['sequenceNumber'] ?? $row['sequence_number']),
        'date_str'        => (string) ($merged['date'] ?? $row['date_str']),
        'status'          => (string) ($merged['status'] ?? $row['status']),
        'data_json'       => wp_json_encode($merged),
        'updated_at'      => $now,
      ), array('id' => $id));

      $auto_mats = array();
      if (!empty($body['loadingSlip'])) {
        $auto_mats = self::sync_materials_from_slip($merged['loadingSlip'], $user['username']);
      }

      return self::json_response(array('ticket' => $merged, 'autoSavedMaterials' => $auto_mats));
    }

    return self::error_response('Method not allowed.', 405);
  }

  private static function handle_forklift_action($user, $id, $action, $body) {
    global $wpdb;
    $t = self::table('tickets');
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
    if (!$row) return self::error_response('Ticket not found.', 404);

    $ticket = json_decode((string) $row['data_json'], true);
    $now = self::now_ms();
    $slip = isset($ticket['loadingSlip']) && is_array($ticket['loadingSlip']) ? $ticket['loadingSlip'] : array();
    $items = isset($slip['items']) && is_array($slip['items']) ? $slip['items'] : array();

    if ($action === 'open') {
      if (empty($ticket['forkliftOpenedAt'])) {
        $ticket['forkliftOpenedAt'] = $now;
        $ticket['forkliftOpenedBy'] = $user['username'];
      }
      if (($ticket['status'] ?? '') === 'called' || ($ticket['status'] ?? '') === 'waiting') {
        $ticket['status'] = 'under_loading';
        if (empty($ticket['timeLoadingStarted'])) {
          $ticket['timeLoadingStarted'] = wp_date('H:i:s');
        }
      }
    } elseif ($action === 'checklist') {
      $updates = isset($body['itemUpdates']) && is_array($body['itemUpdates']) ? $body['itemUpdates'] : array();
      foreach ($updates as $upd) {
        $idx = isset($upd['index']) ? (int) $upd['index'] : -1;
        if ($idx >= 0 && isset($items[$idx])) {
          if (array_key_exists('isLoaded', $upd)) $items[$idx]['isLoaded'] = (bool) $upd['isLoaded'];
          if (array_key_exists('loadedQty', $upd)) $items[$idx]['loadedQty'] = (string) $upd['loadedQty'];
          if (array_key_exists('remarks', $upd)) $items[$idx]['remarks'] = (string) $upd['remarks'];
        }
      }
      $slip['items'] = $items;
      $ticket['loadingSlip'] = $slip;
    } elseif ($action === 'complete') {
      $ticket['status'] = 'completed';
      $ticket['timeCompleted'] = wp_date('H:i:s');
      $ticket['forkliftCompletedAt'] = $now;
      $ticket['forkliftCompletedBy'] = $user['username'];
      $slip['isLocked'] = true;
      $ticket['loadingSlip'] = $slip;

      $alert_id = 'alt_' . self::uuid();
      $alert = array(
        'id'              => $alert_id,
        'ticketId'        => $id,
        'ticketNumber'    => $ticket['ticketNumber'] ?? '',
        'truckNumber'     => $ticket['truckNumber'] ?? '',
        'gateNumber'      => $ticket['gateNumber'] ?? '',
        'completedByName' => $user['fullName'],
        'completedAt'     => $now,
        'message'         => 'Loading completed for ' . ($ticket['truckNumber'] ?? '') . ' at ' . ($ticket['gateNumber'] ?? ''),
      );
      $wpdb->insert(self::table('alerts'), array(
        'id'         => $alert_id,
        'ticket_id'  => $id,
        'data_json'  => wp_json_encode($alert),
        'created_at' => $now,
      ));
    }

    $ticket['updatedAt'] = $now;
    $ticket['updatedBy'] = $user['username'];
    $ticket['version'] = ((int) ($ticket['version'] ?? 1)) + 1;

    $wpdb->update($t, array(
      'status'     => (string) ($ticket['status'] ?? $row['status']),
      'data_json'  => wp_json_encode($ticket),
      'updated_at' => $now,
    ), array('id' => $id));

    if ($action === 'complete') {
      return self::json_response(array('ticket' => $ticket, 'alert' => $alert));
    }
    return self::json_response(array('ticket' => $ticket));
  }

  private static function handle_get_alerts() {
    global $wpdb;
    $t = self::table('alerts');
    $rows = $wpdb->get_results("SELECT data_json FROM {$t} WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT 50", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $alerts = array();
    foreach ($rows as $r) {
      $d = json_decode((string) $r['data_json'], true);
      if (is_array($d)) $alerts[] = $d;
    }
    return self::json_response(array('alerts' => $alerts));
  }

  private static function handle_dismiss_alert($id) {
    global $wpdb;
    $wpdb->update(self::table('alerts'), array('dismissed_at' => (string) self::now_ms()), array('id' => $id));
    return self::json_response(array('ok' => true));
  }

  // =========================================================
  // DRIVERS MASTER
  // =========================================================

  private static function handle_get_drivers() {
    global $wpdb;
    $t = self::table('drivers');
    $rows = $wpdb->get_results("SELECT data_json FROM {$t} ORDER BY updated_at DESC", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $drivers = array();
    foreach ($rows as $r) {
      $d = json_decode((string) $r['data_json'], true);
      if (is_array($d)) $drivers[] = $d;
    }
    return self::json_response(array('drivers' => $drivers));
  }

  private static function handle_save_driver($user, $id, $body) {
    global $wpdb;
    $t = self::table('drivers');
    $truck = self::upper_str($body['truckNumber'] ?? '');
    if ($truck === '') return self::error_response('Truck number is required.', 400);

    $now = self::now_ms();
    $driver_id = $id ?: ('drv_' . self::uuid());
    $record = array(
      'id'              => $driver_id,
      'truckNumber'     => $truck,
      'driverName'      => self::upper_str($body['driverName'] ?? ''),
      'driverPhone'     => trim((string) ($body['driverPhone'] ?? '')),
      'transporterName' => self::upper_str($body['transporterName'] ?? ''),
      'updatedAt'       => $now,
    );
    $wpdb->replace($t, array(
      'id'           => $driver_id,
      'truck_number' => $truck,
      'driver_name'  => $record['driverName'],
      'driver_phone' => $record['driverPhone'],
      'data_json'    => wp_json_encode($record),
      'updated_at'   => $now,
    ));
    return self::json_response(array('driver' => $record), $id ? 200 : 201);
  }

  private static function handle_delete_driver($user, $id) {
    global $wpdb;
    $wpdb->delete(self::table('drivers'), array('id' => $id));
    return self::json_response(array('ok' => true));
  }

  // =========================================================
  // MATERIAL MASTER
  // =========================================================

  private static function map_material($row) {
    return array(
      'id'             => $row['id'],
      'materialName'   => $row['material_name'],
      'normalizedName' => $row['normalized_name'],
      'packType'       => $row['pack_type'],
      'palletRatio'    => (float) $row['pallet_ratio'],
      'remarks'        => (string) ($row['remarks'] ?? ''),
      'createdBy'      => $row['created_by'],
      'updatedBy'      => $row['updated_by'],
      'createdAt'      => (int) $row['created_at'],
      'updatedAt'      => (int) $row['updated_at'],
    );
  }

  private static function handle_get_materials() {
    global $wpdb;
    $t = self::table('materials');
    $rows = $wpdb->get_results("SELECT * FROM {$t} ORDER BY material_name ASC", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $list = array();
    foreach ($rows as $r) {
      $list[] = self::map_material($r);
    }
    return self::json_response(array('materials' => $list));
  }

  private static function handle_create_material($user, $body) {
    global $wpdb;
    $t = self::table('materials');
    $name = self::upper_str($body['materialName'] ?? '');
    if ($name === '') return self::error_response('Material Name is required.', 400);
    $norm = preg_replace('/\s+/', ' ', $name);

    $dup = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE normalized_name = %s", $norm));
    if ($dup) return self::error_response('Material already exists.', 409);

    $now = self::now_ms();
    $id = 'mat_' . self::uuid();
    $pack = self::upper_str($body['packType'] ?? 'BAG') ?: 'BAG';
    $ratio = isset($body['palletRatio']) && is_numeric($body['palletRatio']) && (float) $body['palletRatio'] > 0 ? (float) $body['palletRatio'] : 1;
    $remarks = trim((string) ($body['remarks'] ?? ''));

    $wpdb->insert($t, array(
      'id'              => $id,
      'material_name'   => $name,
      'normalized_name' => $norm,
      'pack_type'       => $pack,
      'pallet_ratio'    => $ratio,
      'remarks'         => $remarks,
      'created_by'      => $user['username'],
      'updated_by'      => $user['username'],
      'created_at'      => $now,
      'updated_at'      => $now,
    ));
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
    return self::json_response(array('material' => self::map_material($row)), 201);
  }

  private static function handle_material_detail($user, $id, $method, $body) {
    global $wpdb;
    $t = self::table('materials');
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
    if (!$row) return self::error_response('Material not found.', 404);

    if ($method === 'DELETE') {
      $wpdb->delete($t, array('id' => $id));
      return self::json_response(array('ok' => true));
    }

    if ($method === 'PUT') {
      $name = self::upper_str($body['materialName'] ?? $row['material_name']);
      $norm = preg_replace('/\s+/', ' ', $name);
      $pack = self::upper_str($body['packType'] ?? $row['pack_type']) ?: 'BAG';
      $ratio = isset($body['palletRatio']) && is_numeric($body['palletRatio']) && (float) $body['palletRatio'] > 0 ? (float) $body['palletRatio'] : 1;
      $remarks = trim((string) ($body['remarks'] ?? ''));

      $wpdb->update($t, array(
        'material_name'   => $name,
        'normalized_name' => $norm,
        'pack_type'       => $pack,
        'pallet_ratio'    => $ratio,
        'remarks'         => $remarks,
        'updated_by'      => $user['username'],
        'updated_at'      => self::now_ms(),
      ), array('id' => $id));

      $updated = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
      return self::json_response(array('material' => self::map_material($updated)));
    }

    return self::error_response('Method not allowed.', 405);
  }

  private static function handle_import_materials($user, $body) {
    global $wpdb;
    $t = self::table('materials');
    $mode = ($body['mode'] ?? 'skip_existing') === 'upsert' ? 'upsert' : 'skip_existing';
    $items = isset($body['items']) && is_array($body['items']) ? $body['items'] : array();
    $now = self::now_ms();

    $created = 0;
    $updated = 0;
    $skipped = 0;
    $dups = array();
    $errors = array();

    foreach ($items as $idx => $item) {
      $name = self::upper_str($item['materialName'] ?? '');
      if ($name === '') {
        $errors[] = 'Row ' . ($idx + 1) . ': Material Name is empty.';
        continue;
      }
      $norm = preg_replace('/\s+/', ' ', $name);
      $pack = self::upper_str($item['packType'] ?? 'BAG') ?: 'BAG';
      $ratio = isset($item['palletRatio']) && is_numeric($item['palletRatio']) && (float) $item['palletRatio'] > 0 ? (float) $item['palletRatio'] : 1;
      $remarks = trim((string) ($item['remarks'] ?? ''));

      $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE normalized_name = %s", $norm), ARRAY_A);
      if ($existing) {
        if ($mode === 'upsert') {
          $wpdb->update($t, array(
            'pack_type'    => $pack,
            'pallet_ratio' => $ratio,
            'remarks'      => $remarks,
            'updated_by'   => $user['username'],
            'updated_at'   => $now,
          ), array('id' => $existing['id']));
          $updated++;
        } else {
          $skipped++;
          $dups[] = $name;
        }
      } else {
        $wpdb->insert($t, array(
          'id'              => 'mat_' . self::uuid(),
          'material_name'   => $name,
          'normalized_name' => $norm,
          'pack_type'       => $pack,
          'pallet_ratio'    => $ratio,
          'remarks'         => $remarks,
          'created_by'      => $user['username'],
          'updated_by'      => $user['username'],
          'created_at'      => $now,
          'updated_at'      => $now,
        ));
        $created++;
      }
    }

    $rows = $wpdb->get_results("SELECT * FROM {$t} ORDER BY material_name ASC", ARRAY_A);
    $all = array();
    foreach ($rows as $r) $all[] = self::map_material($r);

    return self::json_response(array(
      'createdCount'   => $created,
      'updatedCount'   => $updated,
      'skippedCount'   => $skipped,
      'duplicateNames' => $dups,
      'errors'         => $errors,
      'materials'      => $all,
    ));
  }

  // =========================================================
  // PUBLIC DRIVER LOOKUP & TOKEN STATUS
  // =========================================================

  private static function handle_public_driver_status($body) {
    global $wpdb;
    $raw_truck = self::upper_str($body['truckNumber'] ?? '');
    $clean_key = preg_replace('/[^A-Z0-9]/', '', $raw_truck);
    $settings = self::read_settings_key('active');
    $branding = array(
      'companyName'     => $settings['companyName'] ?? 'MATERIAL LOADING & GATEPASS',
      'companySubtitle' => $settings['companySubtitle'] ?? '',
      'logoDataUrl'     => $settings['logoDataUrl'] ?? '',
    );

    if (strlen($clean_key) < 3) {
      return self::error_response('Please enter a valid Vehicle / Truck Number.', 400);
    }

    $t = self::table('tickets');
    $rows = $wpdb->get_results("SELECT data_json, created_at FROM {$t} ORDER BY created_at DESC LIMIT 300", ARRAY_A);
    $matched = null;
    foreach ($rows as $r) {
      $d = json_decode((string) $r['data_json'], true);
      if (is_array($d)) {
        $key = preg_replace('/[^A-Z0-9]/', '', self::upper_str($d['truckNumber'] ?? ''));
        if ($key === $clean_key) {
          $matched = $d;
          break;
        }
      }
    }

    $now = self::now_ms();
    if (!$matched) {
      return self::json_response(array(
        'found'        => false,
        'expired'      => false,
        'serverTimeMs' => $now,
        'branding'     => $branding,
        'message'      => 'No loading ticket or slip found for this Vehicle / Truck Number.',
      ));
    }

    return self::json_response(array(
      'found'        => true,
      'expired'      => false,
      'serverTimeMs' => $now,
      'expiresAt'    => $now + (12 * 3600 * 1000),
      'remainingMs'  => 12 * 3600 * 1000,
      'branding'     => $branding,
      'ticket'       => $matched,
      'queue'        => array(
        'gateNumber'        => $matched['gateNumber'] ?? 'GATE 1',
        'queueNumber'       => $matched['gateSequenceNumber'] ?? 1,
        'trucksAhead'       => 0,
        'queuePosition'     => 1,
        'totalActiveAtGate' => 1,
      ),
    ));
  }

  private static function handle_public_driver_token($token) {
    global $wpdb;
    $tok_t = self::table('driver_tokens');
    $tkt_t = self::table('tickets');
    $row = $wpdb->get_row($wpdb->prepare(
      "SELECT dt.expires_at, tk.data_json FROM {$tok_t} dt INNER JOIN {$tkt_t} tk ON tk.id = dt.ticket_id WHERE dt.token = %s",
      $token
    ), ARRAY_A);

    $now = self::now_ms();
    $settings = self::read_settings_key('active');
    $branding = array(
      'companyName'     => $settings['companyName'] ?? 'MATERIAL LOADING & GATEPASS',
      'companySubtitle' => $settings['companySubtitle'] ?? '',
      'logoDataUrl'     => $settings['logoDataUrl'] ?? '',
    );

    if (!$row) {
      return self::json_response(array('found' => false, 'expired' => false, 'serverTimeMs' => $now, 'branding' => $branding, 'message' => 'Invalid Driver Live Status link.'), 404);
    }
    $ticket = json_decode((string) $row['data_json'], true);
    $status = $ticket['status'] ?? 'waiting';
    $progress = $status === 'completed' ? 100 : ($status === 'under_loading' ? 70 : ($status === 'called' ? 45 : 25));

    return self::json_response(array(
      'found'        => true,
      'expired'      => false,
      'serverTimeMs' => $now,
      'expiresAt'    => (int) $row['expires_at'],
      'remainingMs'  => max(0, (int) $row['expires_at'] - $now),
      'branding'     => $branding,
      'slip'         => array(
        'delNoteNumber'     => $ticket['loadingSlip']['delNoteNumber'] ?? ($ticket['delNoteNumber'] ?? 'N/A'),
        'truckNumber'       => $ticket['truckNumber'] ?? 'N/A',
        'gateNumber'        => $ticket['gateNumber'] ?? 'GATE 1',
        'queueNumber'       => $ticket['gateSequenceNumber'] ?? 1,
        'queuePosition'     => 1,
        'trucksAhead'       => 0,
        'totalActiveAtGate' => 1,
        'destinationPlace'  => $ticket['destinationPlace'] ?? '',
        'status'            => $status,
        'statusLabel'       => strtoupper($status),
        'progressPercent'   => $progress,
        'stepIndex'         => $status === 'completed' ? 3 : ($status === 'under_loading' ? 2 : ($status === 'called' ? 1 : 0)),
        'totalItemsCount'   => count($ticket['loadingSlip']['items'] ?? array()),
        'loadedItemsCount'  => 0,
        'timeIn'            => $ticket['timeIn'] ?? null,
        'timeCalled'        => $ticket['timeCalled'] ?? null,
        'timeLoadingStarted'=> $ticket['timeLoadingStarted'] ?? null,
        'timeCompleted'     => $ticket['timeCompleted'] ?? null,
        'lastUpdatedAt'     => $ticket['updatedAt'] ?? $now,
      ),
    ));
  }

  // =========================================================
  // WHATSAPP & BACKUP
  // =========================================================

  private static function handle_whatsapp_logs($query_params = array()) {
    global $wpdb;
    $t = self::table('whatsapp_logs');
    $ticket_id = isset($query_params['ticketId']) ? $query_params['ticketId'] : '';
    $rows = $ticket_id
      ? $wpdb->get_results($wpdb->prepare("SELECT data_json FROM {$t} WHERE ticket_id = %s ORDER BY created_at DESC LIMIT 50", $ticket_id), ARRAY_A)
      : $wpdb->get_results("SELECT data_json FROM {$t} ORDER BY created_at DESC LIMIT 100", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $logs = array();
    foreach ($rows as $r) {
      $d = json_decode((string) $r['data_json'], true);
      if (is_array($d)) $logs[] = $d;
    }
    return self::json_response(array('logs' => $logs));
  }

  private static function handle_whatsapp_retry($ticket_id) {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare("SELECT data_json FROM " . self::table('tickets') . " WHERE id = %s", $ticket_id), ARRAY_A);
    if (!$row) return self::error_response('Ticket not found.', 404);
    $ticket = json_decode((string) $row['data_json'], true);
    return self::json_response(array(
      'outcome' => array('sent' => false, 'reason' => 'WhatsApp Cloud API credentials are configured on Node server.', 'manualWhatsAppUrl' => ''),
      'ticket'  => $ticket,
    ));
  }

  private static function handle_backup_export() {
    global $wpdb;
    $tickets = self::handle_get_tickets()->get_data()['tickets'];
    $drivers = self::handle_get_drivers()->get_data()['drivers'];
    $materials = self::handle_get_materials()->get_data()['materials'];
    $ex = self::read_all_ex_factory();
    $settings = self::read_settings_key('active');
    return self::json_response(array(
      'exportedAt'      => gmdate('c'),
      'source'          => 'wordpress-mysql',
      'tickets'         => $tickets,
      'drivers'         => $drivers,
      'materials'       => $materials,
      'exFactoryEntries'=> $ex,
      'settings'        => $settings,
    ));
  }

  private static function handle_backup_restore($user, $body) {
    global $wpdb;
    $now = self::now_ms();
    if (!empty($body['tickets']) && is_array($body['tickets'])) {
      foreach ($body['tickets'] as $tkt) {
        if (empty($tkt['id'])) continue;
        $wpdb->replace(self::table('tickets'), array(
          'id'              => (string) $tkt['id'],
          'ticket_number'   => (string) ($tkt['ticketNumber'] ?? $tkt['id']),
          'sequence_number' => (int) ($tkt['sequenceNumber'] ?? 1),
          'date_str'        => (string) ($tkt['date'] ?? wp_date('Y-m-d')),
          'status'          => (string) ($tkt['status'] ?? 'waiting'),
          'data_json'       => wp_json_encode($tkt),
          'created_at'      => (int) ($tkt['createdAt'] ?? $now),
          'updated_at'      => $now,
        ));
      }
    }
    if (!empty($body['settings']) && is_array($body['settings'])) {
      self::write_settings_key('active', $body['settings'], $user['username']);
    }
    return self::json_response(array('ok' => true));
  }

  // =========================================================
  // LIQUID STORE MODULE
  // =========================================================

  private static function get_liquid_store_raw() {
    global $wpdb;
    $t = self::table('liquid_store');
    $raw = $wpdb->get_var("SELECT data_json FROM {$t} WHERE key_name = 'state'");
    if (!$raw) {
      $def = self::default_liquid_state();
      $wpdb->replace($t, array('key_name' => 'state', 'data_json' => wp_json_encode($def), 'updated_at' => self::now_ms()));
      return $def;
    }
    $decoded = json_decode((string) $raw, true);
    return is_array($decoded) ? $decoded : self::default_liquid_state();
  }

  private static function append_liquid_audit(&$raw, $action, $entity_type, $summary, $performed_by) {
    if (!isset($raw['auditLogs']) || !is_array($raw['auditLogs'])) {
      $raw['auditLogs'] = array();
    }
    $aid = (int) ($raw['nextAuditId'] ?? (count($raw['auditLogs']) + 1));
    $raw['auditLogs'][] = array(
      'id'          => $aid,
      'action'      => $action,
      'entityType'  => $entity_type,
      'summary'     => $summary,
      'performedBy' => $performed_by,
      'createdAt'   => self::now_ms(),
    );
    $raw['nextAuditId'] = $aid + 1;
    if (count($raw['auditLogs']) > 300) {
      $raw['auditLogs'] = array_slice($raw['auditLogs'], -300);
    }
  }

  private static function compute_liquid_state_response($raw) {
    $tanks_out = array();
    $txs = isset($raw['transactions']) && is_array($raw['transactions']) ? $raw['transactions'] : array();
    $tanks = isset($raw['tanks']) && is_array($raw['tanks']) ? $raw['tanks'] : array();

    foreach ($tanks as $tank) {
      $inward_kg = 0.0;
      $outward_kg = 0.0;
      $last_tx = null;
      $mat_map = array();

      foreach ($txs as $tx) {
        if ((int) ($tx['tankId'] ?? 0) !== (int) $tank['id']) continue;
        $qty = (float) ($tx['quantityKg'] ?? 0);
        $mname = self::upper_str($tx['materialName'] ?? '');
        if (!isset($mat_map[$mname])) {
          $mat_map[$mname] = array('materialName' => $mname, 'inwardKg' => 0.0, 'outwardKg' => 0.0);
        }
        if (($tx['type'] ?? 'INWARD') === 'INWARD') {
          $inward_kg += $qty;
          $mat_map[$mname]['inwardKg'] += $qty;
        } else {
          $outward_kg += $qty;
          $mat_map[$mname]['outwardKg'] += $qty;
        }
        $tx_date = (string) ($tx['txDate'] ?? '');
        if ($tx_date !== '' && ($last_tx === null || $tx_date > $last_tx)) {
          $last_tx = $tx_date;
        }
      }

      $current_kg = max(0.0, $inward_kg - $outward_kg);
      $cap_kg = max(1.0, (float) ($tank['totalCapacityKg'] ?? 10000));
      $depth_m = (float) ($tank['depthMeters'] ?? 4.0);
      $empty_kg = max(0.0, $cap_kg - $current_kg);
      $filled_pct = min(100.0, max(0.0, ($current_kg / $cap_kg) * 100.0));
      $empty_pct = max(0.0, 100.0 - $filled_pct);
      $filled_m = $depth_m * ($filled_pct / 100.0);
      $empty_m = max(0.0, $depth_m - $filled_m);

      $materials_out = array();
      $active_prods = array();
      foreach ($mat_map as $m) {
        $bal_kg = $m['inwardKg'] - $m['outwardKg'];
        $materials_out[] = array(
          'materialName' => $m['materialName'],
          'inwardKg'     => $m['inwardKg'],
          'outwardKg'    => $m['outwardKg'],
          'balanceKg'    => $bal_kg,
          'balanceMt'    => $bal_kg / 1000.0,
        );
        if ($bal_kg > 0.0001) {
          $active_prods[] = $m['materialName'];
        }
      }

      $tanks_out[] = array(
        'id'                => (int) $tank['id'],
        'name'              => (string) $tank['name'],
        'totalCapacityKg'   => $cap_kg,
        'totalCapacityMt'   => $cap_kg / 1000.0,
        'depthMeters'       => $depth_m,
        'location'          => (string) ($tank['location'] ?? 'Main Storage Bay'),
        'notes'             => (string) ($tank['notes'] ?? ''),
        'totalInwardKg'     => $inward_kg,
        'totalOutwardKg'    => $outward_kg,
        'currentStockKg'    => $current_kg,
        'currentStockMt'    => $current_kg / 1000.0,
        'emptyCapacityKg'   => $empty_kg,
        'emptyCapacityMt'   => $empty_kg / 1000.0,
        'filledPercentage'  => $filled_pct,
        'emptyPercentage'   => $empty_pct,
        'filledMeters'      => $filled_m,
        'emptyMeters'       => $empty_m,
        'lastTransactionAt' => $last_tx,
        'materials'         => $materials_out,
        'productLabel'      => !empty($active_prods) ? implode(', ', $active_prods) : 'Empty',
        'createdAt'         => isset($tank['createdAt']) ? (int) $tank['createdAt'] : self::now_ms(),
      );
    }

    $txs_out = array();
    foreach (array_reverse($txs) as $tx) {
      $qty = (float) ($tx['quantityKg'] ?? 0);
      $txs_out[] = array_merge($tx, array(
        'quantityKg' => $qty,
        'quantityMt' => isset($tx['quantityMt']) ? (float) $tx['quantityMt'] : ($qty / 1000.0),
      ));
    }

    $raw_settings = isset($raw['settings']) && is_array($raw['settings']) ? $raw['settings'] : array();
    $settings_out = array(
      'facilityName' => !empty($raw_settings['facilityName']) ? (string) $raw_settings['facilityName'] : 'Liquid Material Camp Store — Sector 4',
      'theme'        => ($raw_settings['theme'] ?? 'light') === 'dark' ? 'dark' : 'light',
    );

    $audit_logs = isset($raw['auditLogs']) && is_array($raw['auditLogs']) ? array_reverse($raw['auditLogs']) : array();

    return array(
      'settings'     => $settings_out,
      'tanks'        => $tanks_out,
      'materials'    => isset($raw['materials']) && is_array($raw['materials']) ? $raw['materials'] : array(),
      'transactions' => $txs_out,
      'auditLogs'    => $audit_logs,
    );
  }

  private static function save_liquid_store_raw($raw) {
    global $wpdb;
    $wpdb->replace(self::table('liquid_store'), array(
      'key_name'   => 'state',
      'data_json'  => wp_json_encode($raw),
      'updated_at' => self::now_ms(),
    ));
    return self::compute_liquid_state_response($raw);
  }

  private static function handle_liquid($user, $subpath, $method, $body) {
    if (!self::has_any_permission($user, array('liquid.view', 'liquid.store', 'liquid.materials'))) {
      return self::error_response('Permission denied.', 403);
    }

    $raw = self::get_liquid_store_raw();
    $now = self::now_ms();
    $actor_name = !empty($user['fullName']) ? $user['fullName'] : $user['username'];

    if ($subpath === 'state' && $method === 'GET') {
      return self::json_response(self::compute_liquid_state_response($raw));
    }

    if ($subpath === 'transactions' && $method === 'POST') {
      if (!self::has_permission($user, 'liquid.store')) return self::error_response('Permission denied.', 403);
      $id = (int) ($raw['nextTxId'] ?? 1);
      $seq = (int) ($raw['nextTxSeq'] ?? 1);
      $code = 'LIQ-' . str_pad((string) $seq, 4, '0', STR_PAD_LEFT);
      $qty_kg = (float) ($body['quantityKg'] ?? 0);
      if ($qty_kg <= 0) {
        return self::error_response('Quantity (KG) must be greater than 0.', 400);
      }
      $tx = array(
        'id'              => $id,
        'txCode'          => $code,
        'type'            => ($body['type'] ?? 'INWARD') === 'OUTWARD' ? 'OUTWARD' : 'INWARD',
        'txDate'          => (string) ($body['txDate'] ?? wp_date('Y-m-d')),
        'tankId'          => (int) ($body['tankId'] ?? 1),
        'materialName'    => self::upper_str($body['materialName'] ?? ''),
        'quantityKg'      => $qty_kg,
        'quantityMt'      => $qty_kg / 1000.0,
        'referenceNumber' => self::upper_str($body['referenceNumber'] ?? ''),
        'documentNumber'  => self::upper_str($body['documentNumber'] ?? ''),
        'partyName'       => self::upper_str($body['partyName'] ?? ''),
        'vehicleNumber'   => self::upper_str($body['vehicleNumber'] ?? ''),
        'driverName'      => self::upper_str($body['driverName'] ?? ''),
        'remarks'         => self::upper_str($body['remarks'] ?? ''),
        'createdBy'       => $user['username'],
        'createdAt'       => $now,
      );
      $raw['transactions'][] = $tx;
      $raw['nextTxId'] = $id + 1;
      $raw['nextTxSeq'] = $seq + 1;
      self::append_liquid_audit($raw, 'CREATE', 'TRANSACTION', "{$tx['type']} {$code}: {$qty_kg} KG {$tx['materialName']}", $actor_name);
      return self::json_response(array('state' => self::save_liquid_store_raw($raw), 'txCode' => $code), 201);
    }

    if (preg_match('#^transactions/(\d+)$#', $subpath, $m)) {
      if (!self::has_permission($user, 'liquid.store')) return self::error_response('Permission denied.', 403);
      $tid = (int) $m[1];
      $found_code = '';
      if ($method === 'DELETE') {
        $next = array();
        foreach ($raw['transactions'] as $tx) {
          if ((int) $tx['id'] === $tid) $found_code = (string) $tx['txCode'];
          else $next[] = $tx;
        }
        $raw['transactions'] = $next;
        if ($found_code !== '') {
          self::append_liquid_audit($raw, 'DELETE', 'TRANSACTION', "Deleted {$found_code}", $actor_name);
        }
      } elseif ($method === 'PUT') {
        foreach ($raw['transactions'] as $i => $tx) {
          if ((int) $tx['id'] === $tid) {
            $found_code = (string) $tx['txCode'];
            $qty_kg = isset($body['quantityKg']) ? (float) $body['quantityKg'] : (float) $tx['quantityKg'];
            $raw['transactions'][$i] = array_merge($tx, $body, array(
              'id'         => $tid,
              'quantityKg' => $qty_kg,
              'quantityMt' => $qty_kg / 1000.0,
              'updatedAt'  => $now,
            ));
          }
        }
        if ($found_code !== '') {
          self::append_liquid_audit($raw, 'UPDATE', 'TRANSACTION', "Updated {$found_code}", $actor_name);
        }
      }
      return self::json_response(array('state' => self::save_liquid_store_raw($raw), 'txCode' => $found_code));
    }

    if ($subpath === 'tanks' && $method === 'POST') {
      if (!self::has_any_permission($user, array('liquid.store', 'liquid.materials'))) return self::error_response('Permission denied.', 403);
      $tid = (int) ($raw['nextTankId'] ?? (count($raw['tanks']) + 1));
      $tank_name = self::upper_str($body['name'] ?? ('TANK ' . $tid));
      $raw['tanks'][] = array(
        'id'              => $tid,
        'name'            => $tank_name,
        'totalCapacityKg' => (float) ($body['totalCapacityKg'] ?? 10000),
        'depthMeters'     => (float) ($body['depthMeters'] ?? 4),
        'location'        => self::upper_str($body['location'] ?? 'Main Storage Bay'),
        'notes'           => self::upper_str($body['notes'] ?? ''),
        'createdAt'       => $now,
      );
      $raw['nextTankId'] = $tid + 1;
      self::append_liquid_audit($raw, 'TANK_CREATE', 'TANK', "Created {$tank_name}", $actor_name);
      return self::json_response(array('state' => self::save_liquid_store_raw($raw)), 201);
    }

    if (preg_match('#^tanks/(\d+)$#', $subpath, $m)) {
      if (!self::has_any_permission($user, array('liquid.store', 'liquid.materials'))) return self::error_response('Permission denied.', 403);
      $tid = (int) $m[1];
      if ($method === 'DELETE') {
        $raw['tanks'] = array_values(array_filter($raw['tanks'], function ($tk) use ($tid) { return (int) $tk['id'] !== $tid; }));
        self::append_liquid_audit($raw, 'TANK_DELETE', 'TANK', "Deleted Tank #{$tid}", $actor_name);
      } elseif ($method === 'PUT') {
        foreach ($raw['tanks'] as $i => $tk) {
          if ((int) $tk['id'] === $tid) {
            $raw['tanks'][$i] = array_merge($tk, $body, array('id' => $tid));
          }
        }
        self::append_liquid_audit($raw, 'TANK_UPDATE', 'TANK', "Updated Tank #{$tid}", $actor_name);
      }
      return self::json_response(array('state' => self::save_liquid_store_raw($raw)));
    }

    if ($subpath === 'materials' && $method === 'POST') {
      if (!self::has_any_permission($user, array('liquid.store', 'liquid.materials'))) return self::error_response('Permission denied.', 403);
      $mid = (int) ($raw['nextMatId'] ?? (count($raw['materials']) + 1));
      $mat_name = self::upper_str($body['name'] ?? '');
      $raw['materials'][] = array(
        'id'          => $mid,
        'name'        => $mat_name,
        'code'        => self::upper_str($body['code'] ?? '') ?: substr($mat_name, 0, 8),
        'description' => self::upper_str($body['description'] ?? ''),
        'createdAt'   => $now,
      );
      $raw['nextMatId'] = $mid + 1;
      self::append_liquid_audit($raw, 'CREATE', 'MATERIAL', "Added material {$mat_name}", $actor_name);
      return self::json_response(array('state' => self::save_liquid_store_raw($raw)), 201);
    }

    if (preg_match('#^materials/(\d+)$#', $subpath, $m)) {
      if (!self::has_any_permission($user, array('liquid.store', 'liquid.materials'))) return self::error_response('Permission denied.', 403);
      $mid = (int) $m[1];
      if ($method === 'DELETE') {
        $raw['materials'] = array_values(array_filter($raw['materials'], function ($mt) use ($mid) { return (int) $mt['id'] !== $mid; }));
        self::append_liquid_audit($raw, 'DELETE', 'MATERIAL', "Deleted material #{$mid}", $actor_name);
      } elseif ($method === 'PUT') {
        foreach ($raw['materials'] as $i => $mt) {
          if ((int) $mt['id'] === $mid) {
            $raw['materials'][$i] = array_merge($mt, $body, array('id' => $mid));
          }
        }
        self::append_liquid_audit($raw, 'UPDATE', 'MATERIAL', "Updated material #{$mid}", $actor_name);
      }
      return self::json_response(array('state' => self::save_liquid_store_raw($raw)));
    }

    if ($subpath === 'settings' && $method === 'PUT') {
      if (!self::has_any_permission($user, array('liquid.store', 'liquid.materials'))) return self::error_response('Permission denied.', 403);
      $raw['settings'] = array(
        'facilityName' => !empty($body['facilityName']) ? trim((string) $body['facilityName']) : 'Liquid Material Camp Store — Sector 4',
        'theme'        => ($body['theme'] ?? 'light') === 'dark' ? 'dark' : 'light',
      );
      return self::json_response(array('state' => self::save_liquid_store_raw($raw)));
    }

    if ($subpath === 'reset' && $method === 'POST') {
      if (!self::has_permission($user, 'liquid.store') && $user['roleName'] !== 'admin') {
        return self::error_response('Permission denied.', 403);
      }
      $def = self::default_liquid_state();
      self::append_liquid_audit($def, 'RESET', 'SYSTEM', 'Reset Liquid Material Camp Store to baseline defaults', $actor_name);
      return self::json_response(array('state' => self::save_liquid_store_raw($def)));
    }

    return self::error_response('Liquid endpoint not found.', 404);
  }

  // =========================================================
  // EX-FACTORY MODULE
  // =========================================================

  private static function read_all_ex_factory() {
    global $wpdb;
    $t = self::table('ex_factory');
    $rows = $wpdb->get_results("SELECT data_json FROM {$t} ORDER BY entry_date DESC, created_at DESC", ARRAY_A);
    if (!is_array($rows)) $rows = array();
    $list = array();
    foreach ($rows as $r) {
      $d = json_decode((string) $r['data_json'], true);
      if (is_array($d)) $list[] = $d;
    }
    return $list;
  }

  private static function handle_ex_factory($user, $endpoint, $method, $body) {
    global $wpdb;
    $t = self::table('ex_factory');
    $now = self::now_ms();

    if ($endpoint === 'ex-factory' && $method === 'GET') {
      if (!self::has_permission($user, 'ex_factory.view')) return self::error_response('Permission denied.', 403);
      return self::json_response(array('entries' => self::read_all_ex_factory()));
    }

    if ($endpoint === 'ex-factory' && $method === 'POST') {
      if (!self::has_permission($user, 'ex_factory.create')) return self::error_response('Permission denied.', 403);
      $id = 'exf_' . self::uuid();
      $entry_date = (string) ($body['entryDate'] ?? wp_date('Y-m-d'));
      $entry = array(
        'id'           => $id,
        'entryDate'    => $entry_date,
        'delNoteNumber'=> self::upper_str($body['delNoteNumber'] ?? ''),
        'customerName' => self::upper_str($body['customerName'] ?? ''),
        'loadingType'  => ($body['loadingType'] ?? 'local') === 'export' ? 'export' : 'local',
        'truckNumber'  => self::upper_str($body['truckNumber'] ?? ''),
        'driverName'   => self::upper_str($body['driverName'] ?? ''),
        'mobileNumber' => trim((string) ($body['mobileNumber'] ?? '')),
        'iqamaNumber'  => trim((string) ($body['iqamaNumber'] ?? '')),
        'createdBy'    => $user['username'],
        'updatedBy'    => $user['username'],
        'createdAt'    => $now,
        'updatedAt'    => $now,
      );
      $wpdb->insert($t, array(
        'id'              => $id,
        'entry_date'      => $entry_date,
        'del_note_number' => $entry['delNoteNumber'],
        'data_json'       => wp_json_encode($entry),
        'created_at'      => $now,
        'updated_at'      => $now,
      ));
      return self::json_response(array('entry' => $entry), 201);
    }

    if (preg_match('#^ex-factory/([^/]+)/loading-slip$#', $endpoint, $m) && $method === 'PUT') {
      if (!self::has_any_permission($user, array('ex_factory.create', 'ex_factory.update'))) {
        return self::error_response('Permission denied.', 403);
      }
      $id = urldecode($m[1]);
      $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
      if (!$row) return self::error_response('Entry not found.', 404);
      $entry = json_decode((string) $row['data_json'], true);
      if (!empty($body['truckNumber'])) $entry['truckNumber'] = self::upper_str($body['truckNumber']);
      if (isset($body['driverName'])) $entry['driverName'] = self::upper_str($body['driverName']);
      if (isset($body['mobileNumber'])) $entry['mobileNumber'] = trim((string) $body['mobileNumber']);
      $entry['loadingSlip'] = $body['loadingSlip'] ?? array();
      $entry['updatedBy'] = $user['username'];
      $entry['updatedAt'] = $now;

      $wpdb->update($t, array('data_json' => wp_json_encode($entry), 'updated_at' => $now), array('id' => $id));
      $auto_mats = self::sync_materials_from_slip($entry['loadingSlip'], $user['username']);
      return self::json_response(array('entry' => $entry, 'autoSavedMaterials' => $auto_mats));
    }

    if (preg_match('#^ex-factory/([^/]+)$#', $endpoint, $m)) {
      $id = urldecode($m[1]);
      $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %s", $id), ARRAY_A);
      if (!$row) return self::error_response('Entry not found.', 404);

      if ($method === 'DELETE') {
        if (!self::has_permission($user, 'ex_factory.delete')) return self::error_response('Permission denied.', 403);
        $wpdb->delete($t, array('id' => $id));
        return self::json_response(array('ok' => true));
      }

      if ($method === 'PUT') {
        if (!self::has_permission($user, 'ex_factory.update')) return self::error_response('Permission denied.', 403);
        $entry = json_decode((string) $row['data_json'], true);
        $entry['entryDate'] = (string) ($body['entryDate'] ?? $entry['entryDate']);
        $entry['delNoteNumber'] = self::upper_str($body['delNoteNumber'] ?? $entry['delNoteNumber']);
        $entry['customerName'] = self::upper_str($body['customerName'] ?? $entry['customerName']);
        $entry['loadingType'] = ($body['loadingType'] ?? $entry['loadingType']) === 'export' ? 'export' : 'local';
        $entry['truckNumber'] = self::upper_str($body['truckNumber'] ?? $entry['truckNumber']);
        $entry['driverName'] = self::upper_str($body['driverName'] ?? $entry['driverName']);
        $entry['mobileNumber'] = trim((string) ($body['mobileNumber'] ?? $entry['mobileNumber']));
        $entry['iqamaNumber'] = trim((string) ($body['iqamaNumber'] ?? $entry['iqamaNumber']));
        $entry['updatedBy'] = $user['username'];
        $entry['updatedAt'] = $now;

        $wpdb->update($t, array(
          'entry_date'      => $entry['entryDate'],
          'del_note_number' => $entry['delNoteNumber'],
          'data_json'       => wp_json_encode($entry),
          'updated_at'      => $now,
        ), array('id' => $id));
        return self::json_response(array('entry' => $entry));
      }
    }

    return self::error_response('Ex-Factory endpoint not found.', 404);
  }
}

GatePass_WP_API::init();
