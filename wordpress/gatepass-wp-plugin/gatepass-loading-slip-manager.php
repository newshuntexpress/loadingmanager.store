<?php
/**
 * Plugin Name: GatePass & Loading Slip Manager
 * Description: Complete WordPress Application & Shortcode for GatePass & Loading Slip Manager with built-in WordPress MySQL database, Firebase Google Sign-In & password authentication, role-based section allotment (Liquid Store, Forklift Loading, Security Guard, Ex-Factory), and zero-data-loss updates.
 * Version: 1.2.5
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Author: GatePass Manager
 */

if (!defined('ABSPATH')) {
  exit;
}

define('GATEPASS_WP_OPTION_KEY', 'gatepass_wp_options');

require_once plugin_dir_path(__FILE__) . 'includes/class-gatepass-wp-api.php';

function gatepass_wp_default_options() {
  return array(
    'connection_mode' => 'wordpress_local', // 'wordpress_local' | 'external_node'
    'api_base_url'    => 'https://loadingmanager.store',
    'full_site_mode'  => 'custom_slug', // 'custom_slug' | 'homepage' | 'shortcode_only'
    'portal_slug'     => 'gatepass',
  );
}

function gatepass_wp_get_options() {
  $saved = get_option(GATEPASS_WP_OPTION_KEY, array());
  if (!is_array($saved)) {
    $saved = array();
  }
  return wp_parse_args($saved, gatepass_wp_default_options());
}

/**
 * Activation: create GatePass tables & seed default admin (munnayadav / Yadav@1977) if empty.
 * Never overwrites existing settings or records.
 */
function gatepass_wp_activate() {
  if (get_option(GATEPASS_WP_OPTION_KEY, null) === null) {
    add_option(GATEPASS_WP_OPTION_KEY, gatepass_wp_default_options());
  }
  GatePass_WP_API::ensure_schema();
  flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'gatepass_wp_activate');

/**
 * Deactivation: ONLY flush rewrite rules. Zero data/options deletion.
 */
function gatepass_wp_deactivate() {
  flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'gatepass_wp_deactivate');

function gatepass_wp_relative_url_path($full_url) {
  $path = function_exists('wp_parse_url') ? wp_parse_url($full_url, PHP_URL_PATH) : parse_url($full_url, PHP_URL_PATH);
  $query = function_exists('wp_parse_url') ? wp_parse_url($full_url, PHP_URL_QUERY) : parse_url($full_url, PHP_URL_QUERY);
  if (!is_string($path) || $path === '') {
    $path = '/';
  }
  return ($query !== null && $query !== '') ? ($path . '?' . $query) : $path;
}

function gatepass_wp_normalize_scheme($url) {
  $target_scheme = GatePass_WP_API::is_https_request() ? 'https' : 'http';
  if (function_exists('set_url_scheme')) {
    return set_url_scheme($url, $target_scheme);
  }
  return preg_replace('#^https?://#i', $target_scheme . '://', (string) $url);
}

function gatepass_wp_render_full_html_app() {
  $app_html_file = plugin_dir_path(__FILE__) . 'app/gatepass-full-app.html';
  if (!file_exists($app_html_file)) {
    status_header(503);
    wp_die('GatePass app bundle is missing from the plugin folder. Please re-upload the plugin ZIP.');
  }

  $html = file_get_contents($app_html_file);
  if ($html === false) {
    status_header(500);
    wp_die('Unable to read GatePass application bundle.');
  }

  $opts = gatepass_wp_get_options();
  $conn_mode = isset($opts['connection_mode']) ? (string) $opts['connection_mode'] : 'wordpress_local';

  if ($conn_mode === 'external_node') {
    $wp_rest_base = '';
    $wp_ajax_base = '';
    $api_base = rtrim((string) $opts['api_base_url'], '/');
  } else {
    GatePass_WP_API::ensure_schema();
    // Use same-origin relative paths so HTTP/HTTPS reverse proxies and www/non-www aliases never cause CORS or mixed-content auth failures
    $ajax_full = gatepass_wp_normalize_scheme(admin_url('admin-ajax.php'));
    $wp_ajax_base = gatepass_wp_relative_url_path($ajax_full);
    $rest_full = gatepass_wp_normalize_scheme(add_query_arg('rest_route', '/gatepass/v1', home_url('/')));
    $wp_rest_base = rtrim(gatepass_wp_relative_url_path($rest_full), '/');
    $api_base = '';
  }

  $encoded_api_base = wp_json_encode($api_base);
  $encoded_wp_rest  = wp_json_encode($wp_rest_base);
  $encoded_wp_ajax  = wp_json_encode($wp_ajax_base);

  $html = preg_replace_callback(
    '/window\.__GATEPASS_API_BASE__\s*=\s*window\.__GATEPASS_API_BASE__\s*\|\|\s*"[^"]*";/',
    function () use ($encoded_api_base) {
      return 'window.__GATEPASS_API_BASE__ = ' . $encoded_api_base . ';';
    },
    $html,
    1
  );

  if (preg_match('/window\.__GATEPASS_WP_AJAX_BASE__/', $html)) {
    $html = preg_replace_callback(
      '/window\.__GATEPASS_WP_AJAX_BASE__\s*=\s*window\.__GATEPASS_WP_AJAX_BASE__\s*\|\|\s*"[^"]*";/',
      function () use ($encoded_wp_ajax) {
        return 'window.__GATEPASS_WP_AJAX_BASE__ = ' . $encoded_wp_ajax . ';';
      },
      $html,
      1
    );
  } else {
    $html = str_replace(
      '</head>',
      '<script>window.__GATEPASS_WP_AJAX_BASE__ = ' . $encoded_wp_ajax . ';</script></head>',
      $html
    );
  }

  if (preg_match('/window\.__GATEPASS_WP_REST_BASE__/', $html)) {
    $html = preg_replace_callback(
      '/window\.__GATEPASS_WP_REST_BASE__\s*=\s*window\.__GATEPASS_WP_REST_BASE__\s*\|\|\s*"[^"]*";/',
      function () use ($encoded_wp_rest) {
        return 'window.__GATEPASS_WP_REST_BASE__ = ' . $encoded_wp_rest . ';';
      },
      $html,
      1
    );
  } else {
    $html = str_replace(
      '</head>',
      '<script>window.__GATEPASS_WP_REST_BASE__ = ' . $encoded_wp_rest . ';</script></head>',
      $html
    );
  }

  if (ob_get_level() > 0) {
    @ob_clean();
  }
  status_header(200);
  GatePass_WP_API::send_raw_nocache_headers();
  header('Content-Type: text/html; charset=utf-8');
  echo $html;
  exit;
}

/**
 * Serve full website natively on configured WordPress route without affecting WP REST, login, cron, admin, or posts.
 */
function gatepass_wp_maybe_serve_portal() {
  global $pagenow;
  if (
    is_admin() ||
    wp_doing_ajax() ||
    (function_exists('wp_doing_cron') && wp_doing_cron()) ||
    (defined('DOING_CRON') && DOING_CRON) ||
    (defined('REST_REQUEST') && REST_REQUEST) ||
    isset($_GET['rest_route']) ||
    (isset($pagenow) && $pagenow === 'wp-login.php') ||
    (isset($_SERVER['PHP_SELF']) && strpos((string) $_SERVER['PHP_SELF'], 'wp-login.php') !== false)
  ) {
    return;
  }

  if (isset($_GET['gatepass_portal']) && $_GET['gatepass_portal'] === '1') {
    gatepass_wp_render_full_html_app();
  }

  if (isset($_GET['driverStatus']) && is_string($_GET['driverStatus']) && trim($_GET['driverStatus']) !== '') {
    gatepass_wp_render_full_html_app();
  }

  $opts = gatepass_wp_get_options();
  $mode = isset($opts['full_site_mode']) ? (string) $opts['full_site_mode'] : 'custom_slug';

  if ($mode === 'homepage' && (is_front_page() || is_home())) {
    $request_path = trim((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
    $home_path = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
    if ($request_path === $home_path) {
      gatepass_wp_render_full_html_app();
    }
  }

  if ($mode === 'custom_slug') {
    $slug = trim(sanitize_title((string) $opts['portal_slug']), '/');
    if ($slug !== '') {
      $request_path = trim((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
      $home_path = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
      $expected_path = $home_path !== '' ? $home_path . '/' . $slug : $slug;
      if (strcasecmp($request_path, $expected_path) === 0) {
        gatepass_wp_render_full_html_app();
      }
    }
  }
}
add_action('template_redirect', 'gatepass_wp_maybe_serve_portal', 1);

/**
 * Shortcode: [gatepass_manager] or [gatepass_manager height="85vh"]
 */
function gatepass_wp_shortcode($atts) {
  $atts = shortcode_atts(
    array(
      'height' => '84vh',
      'title'  => 'GatePass & Loading Slip Manager',
    ),
    $atts,
    'gatepass_manager'
  );

  $height = preg_match('/^[0-9]+(px|vh|%)$/', trim($atts['height'])) ? trim($atts['height']) : '84vh';
  $title  = esc_html($atts['title']);
  $portal_url = gatepass_wp_normalize_scheme(add_query_arg('gatepass_portal', '1', home_url('/')));

  if (isset($_GET['driverStatus']) && is_string($_GET['driverStatus'])) {
    $token = sanitize_text_field(wp_unslash($_GET['driverStatus']));
    if ($token !== '') {
      $portal_url = add_query_arg('driverStatus', $token, $portal_url);
    }
  }

  ob_start();
  ?>
  <div id="gp-wp-plugin-wrap" style="width:100%;max-width:100%;margin:12px auto;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;background:#eef3f8;box-shadow:0 6px 24px rgba(15,23,42,0.08);">
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:linear-gradient(90deg,#1e2e3e 0%,#263748 60%,#1a4369 100%);color:#fff;font-family:sans-serif;">
      <strong style="font-size:14px;color:#fff;"><?php echo $title; ?></strong>
      <div style="display:flex;gap:6px;align-items:center;">
        <button type="button" onclick="(function(){var el=document.getElementById('gp-wp-plugin-wrap');if(!el)return;if(el.dataset.fs==='1'){el.style.position='';el.style.inset='';el.style.zIndex='';el.style.height='';el.style.margin='12px auto';el.dataset.fs='0';}else{el.style.position='fixed';el.style.inset='0';el.style.zIndex='999999';el.style.height='100vh';el.style.margin='0';el.dataset.fs='1';}})();" style="border:1px solid rgba(255,255,255,0.28);background:#0a6ed1;color:#fff;font-size:12px;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;">
          Fullscreen
        </button>
        <a href="<?php echo esc_url($portal_url); ?>" target="_blank" rel="noopener noreferrer" style="border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:600;padding:5px 10px;border-radius:6px;text-decoration:none;">
          Open Full Tab
        </a>
      </div>
    </div>
    <iframe
      src="<?php echo esc_url($portal_url); ?>"
      title="<?php echo $title; ?>"
      loading="eager"
      allow="clipboard-read; clipboard-write; fullscreen"
      referrerpolicy="strict-origin-when-cross-origin"
      style="width:100%;height:<?php echo esc_attr($height); ?>;min-height:720px;border:0;display:block;background:#eef3f8;"
    ></iframe>
  </div>
  <?php
  return ob_get_clean();
}
add_shortcode('gatepass_manager', 'gatepass_wp_shortcode');

/**
 * WordPress Admin Settings Page
 */
function gatepass_wp_register_admin_menu() {
  add_menu_page(
    'GatePass Manager',
    'GatePass Manager',
    'manage_options',
    'gatepass-manager-settings',
    'gatepass_wp_render_admin_page',
    'dashicons-clipboard',
    30
  );
}
add_action('admin_menu', 'gatepass_wp_register_admin_menu');

function gatepass_wp_render_admin_page() {
  if (!current_user_can('manage_options')) {
    return;
  }

  GatePass_WP_API::ensure_schema();
  $saved_notice = false;

  if (isset($_POST['gatepass_wp_save_nonce']) && wp_verify_nonce($_POST['gatepass_wp_save_nonce'], 'gatepass_wp_save_settings')) {
    $raw_conn = isset($_POST['connection_mode']) ? sanitize_key($_POST['connection_mode']) : 'wordpress_local';
    $raw_api  = isset($_POST['api_base_url']) ? trim(wp_unslash($_POST['api_base_url'])) : 'https://loadingmanager.store';
    $raw_mode = isset($_POST['full_site_mode']) ? sanitize_key($_POST['full_site_mode']) : 'custom_slug';
    $raw_slug = isset($_POST['portal_slug']) ? sanitize_title(wp_unslash($_POST['portal_slug'])) : 'gatepass';

    if (!in_array($raw_conn, array('wordpress_local', 'external_node'), true)) {
      $raw_conn = 'wordpress_local';
    }
    if (!in_array($raw_mode, array('custom_slug', 'homepage', 'shortcode_only'), true)) {
      $raw_mode = 'custom_slug';
    }
    if ($raw_slug === '') {
      $raw_slug = 'gatepass';
    }

    update_option(
      GATEPASS_WP_OPTION_KEY,
      array(
        'connection_mode' => $raw_conn,
        'api_base_url'    => esc_url_raw(rtrim($raw_api, '/')),
        'full_site_mode'  => $raw_mode,
        'portal_slug'     => $raw_slug,
      )
    );
    $saved_notice = true;
  }

  $opts = gatepass_wp_get_options();
  $portal_preview_url = $opts['full_site_mode'] === 'homepage'
    ? home_url('/')
    : ($opts['full_site_mode'] === 'custom_slug' ? home_url('/' . $opts['portal_slug'] . '/') : add_query_arg('gatepass_portal', '1', home_url('/')));
  ?>
  <div class="wrap">
    <h1>GatePass &amp; Loading Slip Manager — WordPress Edition</h1>
    <p>Works 100% natively inside WordPress using your WordPress MySQL database with <strong>zero data loss</strong> on future plugin updates.</p>

    <?php if ($saved_notice) : ?>
      <div class="notice notice-success is-dismissible"><p>Settings saved safely.</p></div>
    <?php endif; ?>

    <div style="background:#fff;border:1px solid #ccd0d4;border-radius:8px;padding:18px;max-width:820px;margin-top:14px;">
      <form method="post">
        <?php wp_nonce_field('gatepass_wp_save_settings', 'gatepass_wp_save_nonce'); ?>

        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="gp_conn">Database &amp; Backend Mode</label></th>
            <td>
              <select id="gp_conn" name="connection_mode" class="regular-text" style="max-width:440px;">
                <option value="wordpress_local" <?php selected($opts['connection_mode'], 'wordpress_local'); ?>>Built-in WordPress MySQL Database (Recommended — No External Server)</option>
                <option value="external_node" <?php selected($opts['connection_mode'], 'external_node'); ?>>External Node.js Server URL (Sync to loadingmanager.store)</option>
              </select>
              <p class="description">
                <strong>Built-in WordPress MySQL:</strong> Runs directly on your WordPress server with Firebase Google Sign-In, Admin Panel user creation, and strict section-based operator access control.
              </p>
            </td>
          </tr>

          <tr>
            <th scope="row"><label for="gp_mode">Website Display Mode</label></th>
            <td>
              <select id="gp_mode" name="full_site_mode" class="regular-text" style="max-width:440px;">
                <option value="custom_slug" <?php selected($opts['full_site_mode'], 'custom_slug'); ?>>Dedicated Full Website URL (e.g. /gatepass/ — Main WP Site Safe)</option>
                <option value="homepage" <?php selected($opts['full_site_mode'], 'homepage'); ?>>Full Website on WordPress Homepage (/)</option>
                <option value="shortcode_only" <?php selected($opts['full_site_mode'], 'shortcode_only'); ?>>Shortcode Only ([gatepass_manager])</option>
              </select>
            </td>
          </tr>

          <tr>
            <th scope="row"><label for="gp_slug">Portal URL Slug</label></th>
            <td>
              <code><?php echo esc_html(home_url('/')); ?></code>
              <input id="gp_slug" name="portal_slug" type="text" value="<?php echo esc_attr($opts['portal_slug']); ?>" class="regular-text" style="width:160px;" />
              <code>/</code>
            </td>
          </tr>

          <tr>
            <th scope="row"><label for="gp_api">External Backend URL (Optional)</label></th>
            <td>
              <input id="gp_api" name="api_base_url" type="url" value="<?php echo esc_attr($opts['api_base_url']); ?>" class="regular-text" style="width:360px;" />
              <p class="description">Only used if Database Mode is set to "External Node.js Server URL".</p>
            </td>
          </tr>
        </table>

        <p class="submit" style="display:flex;gap:10px;align-items:center;">
          <button type="submit" class="button button-primary">Save Settings</button>
          <a href="<?php echo esc_url($portal_preview_url); ?>" target="_blank" rel="noopener noreferrer" class="button button-secondary">Open GatePass Portal</a>
        </p>
      </form>

      <hr />
      <h3>Shortcode &amp; Section Allotment Access</h3>
      <p>Use <code>[gatepass_manager]</code> inside any WordPress Page/Post. Admins (including Firebase Default Admin <code>newshuntexpress@gmail.com</code>) can create users and allot specific sections (Liquid Store, Forklift Loading, Security Guard, Ex-Factory) from the in-app Admin Panel.</p>
    </div>
  </div>
  <?php
}
