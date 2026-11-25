<?php
/**
 * Template Name: GatePass Full Website
 * Description: Full-screen, zero-data-loss WordPress page template that renders GatePass & Loading Slip Manager as a complete website without theme clutter.
 */

if (!defined('ABSPATH')) {
  exit;
}

$gp_app_url = 'https://loadingmanager.store/';
if (isset($_GET['driverStatus']) && is_string($_GET['driverStatus'])) {
  $gp_token = sanitize_text_field(wp_unslash($_GET['driverStatus']));
  if ($gp_token !== '') {
    $gp_app_url = add_query_arg('driverStatus', $gp_token, $gp_app_url);
  }
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title><?php wp_title('|', true, 'right'); ?><?php bloginfo('name'); ?></title>
  <?php wp_head(); ?>
  <style>
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #eef3f8;
    }
    #gp-full-website {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      z-index: 99990;
      background: #eef3f8;
      overflow: hidden;
    }
    body.admin-bar #gp-full-website {
      top: 32px;
      height: calc(100vh - 32px);
      height: calc(100dvh - 32px);
    }
    @media screen and (max-width: 782px) {
      body.admin-bar #gp-full-website {
        top: 46px;
        height: calc(100vh - 46px);
        height: calc(100dvh - 46px);
      }
    }
    #gp-full-website iframe.gp-full-frame {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #eef3f8;
    }
  </style>
</head>
<body <?php body_class(); ?>>
  <div id="gp-full-website">
    <iframe
      class="gp-full-frame"
      title="<?php echo esc_attr(get_bloginfo('name')); ?>"
      src="<?php echo esc_url($gp_app_url); ?>"
      loading="eager"
      allow="clipboard-read; clipboard-write; fullscreen"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  </div>
  <?php wp_footer(); ?>
</body>
</html>
