=== GatePass & Loading Slip Manager ===
Contributors: gatepassmanager
Tags: gatepass, loading slip, logistics, truck queue, security guard
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.2.5

Full WordPress portal & shortcode for GatePass & Loading Slip Manager with zero-data-loss feature upgrades.

== Installation ==
1. In WordPress Admin, go to Plugins -> Add New -> Upload Plugin.
2. Select `gatepass-loading-slip-manager.zip` and click Install Now -> Activate.
3. Open `GatePass Manager` in the left WordPress Admin menu to choose Full Website URL (`/gatepass/`), Homepage mode, or `[gatepass_manager]` shortcode, and confirm your Backend Server URL.

== Upgrade Safety ==
All future plugin ZIP updates update only UI features and API routes. Neither WordPress posts/pages/options nor your GatePass database records are deleted or overwritten.

== Changelog ==
= 1.2.5 =
* Restored Login, Forced Password Change, Firebase Google Sign-In (Default Admin: newshuntexpress@gmail.com), and Admin Panel user & section allotment system.
* Preserved persistent reverse-proxy HTTPS cookies, AJAX-to-REST fallback, and zero-data-loss database migrations.

= 1.2.4 =
* Converted the GatePass portal and WordPress plugin to a fully open-access website by removing all Login, Password, Session Gate, and Administrator Security & User Management UI/restrictions.
* Preserved all existing database tables and operational records with zero data loss.

= 1.2.3 =
* Fixed post-login session persistence behind HTTPS reverse proxies (Cloudflare/Nginx/Hostinger) with SameSite/Partitioned cookies and sliding expiration.
* Added automatic WordPress AJAX-to-REST fallback, multi-source token extraction, and REST plugin-conflict guards while maintaining strict authentication.
* Fixed frontend boot auth race conditions and premature unauthorized redirects during async hydration.

= 1.2.2 =
* Restored strict session authentication & Admin Panel user creation with 1-click Section Allotment (Liquid Store, Forklift Loading, Security Guard, Ex-Factory, Dispatch Details, Material Register).
* Synced WordPress MySQL permission catalog, active session fields, and Liquid Material Camp Store metrics with the web app.
