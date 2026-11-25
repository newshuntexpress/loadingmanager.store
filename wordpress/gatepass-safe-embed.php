<?php
/**
 * Plugin Name: GatePass & Loading Slip Safe Embed
 * Description: Embeds GatePass & Loading Slip Manager inside WordPress via [gatepass_manager] shortcode without touching main website tables or data during future updates.
 * Version: 1.0.0
 * Author: GatePass Manager
 */

if (!defined('ABSPATH')) {
  exit;
}

/**
 * NOTE ON ZERO-DATA-LOSS UPDATES:
 * - This plugin creates NO custom WordPress tables and runs NO destructive uninstall/deactivation hooks.
 * - Updating the plugin or updating features on your GatePass backend never deletes WordPress posts,
 *   users, theme settings, or GatePass SQLite records.
 */
function gatepass_manager_shortcode($atts) {
  $atts = shortcode_atts(
    array(
      'url'    => 'https://loadingmanager.store/',
      'height' => '84vh',
      'title'  => 'GatePass & Loading Slip Manager',
    ),
    $atts,
    'gatepass_manager'
  );

  $app_url = esc_url($atts['url']);
  $height  = preg_match('/^[0-9]+(px|vh|%)$/', trim($atts['height'])) ? trim($atts['height']) : '84vh';
  $title   = esc_html($atts['title']);

  if (isset($_GET['driverStatus']) && is_string($_GET['driverStatus'])) {
    $token = sanitize_text_field(wp_unslash($_GET['driverStatus']));
    if ($token !== '') {
      $app_url = esc_url(add_query_arg('driverStatus', $token, $app_url));
    }
  }

  ob_start();
  ?>
  <div id="gp-wp-shortcode-shell" style="width:100%;max-width:100%;margin:12px auto;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;background:#eef3f8;box-shadow:0 6px 24px rgba(15,23,42,0.08);">
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:linear-gradient(90deg,#1e2e3e 0%,#263748 60%,#1a4369 100%);color:#fff;font-family:sans-serif;">
      <strong style="font-size:14px;color:#fff;"><?php echo $title; ?></strong>
      <div style="display:flex;gap:6px;align-items:center;">
        <button type="button" onclick="(function(){var el=document.getElementById('gp-wp-shortcode-shell');if(!el)return;if(el.dataset.fs==='1'){el.style.position='';el.style.inset='';el.style.zIndex='';el.style.height='';el.style.margin='12px auto';el.dataset.fs='0';}else{el.style.position='fixed';el.style.inset='0';el.style.zIndex='999999';el.style.height='100vh';el.style.margin='0';el.dataset.fs='1';}})();" style="border:1px solid rgba(255,255,255,0.28);background:#0a6ed1;color:#fff;font-size:12px;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;">
          Fullscreen
        </button>
        <a href="<?php echo $app_url; ?>" target="_blank" rel="noopener noreferrer" style="border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:600;padding:5px 10px;border-radius:6px;text-decoration:none;">
          Open Full Tab
        </a>
      </div>
    </div>
    <iframe
      src="<?php echo $app_url; ?>"
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
add_shortcode('gatepass_manager', 'gatepass_manager_shortcode');
