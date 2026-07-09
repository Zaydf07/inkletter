<?php
/**
 * Plugin Name: Inkletter Bridge
 * Description: Receives newsletters designed in Inkletter and creates them in WordPress — as a MailPoet newsletter (if MailPoet is active) or a draft post.
 * Version: 1.0.0
 * Author: Inkletter
 *
 * ── SETUP ──────────────────────────────────────────────
 * 1. Upload this file to wp-content/plugins/inkletter-bridge/inkletter-bridge.php
 *    (or zip it and install via Plugins → Add New → Upload).
 * 2. Activate "Inkletter Bridge".
 * 3. Go to Settings → Inkletter Bridge and copy your API key.
 * 4. Paste the API key + your site URL into Inkletter's WordPress export dialog.
 * ───────────────────────────────────────────────────────
 */

if (!defined('ABSPATH')) exit;

/* Generate + store an API key on activation */
register_activation_hook(__FILE__, function () {
    if (!get_option('inkletter_bridge_key')) {
        update_option('inkletter_bridge_key', wp_generate_password(32, false, false));
    }
});

/* Settings page so the user can see/regenerate the key */
add_action('admin_menu', function () {
    add_options_page('Inkletter Bridge', 'Inkletter Bridge', 'manage_options', 'inkletter-bridge', function () {
        if (isset($_POST['inkletter_regen']) && check_admin_referer('inkletter_regen')) {
            update_option('inkletter_bridge_key', wp_generate_password(32, false, false));
            echo '<div class="notice notice-success"><p>New key generated.</p></div>';
        }
        $key = esc_attr(get_option('inkletter_bridge_key'));
        $url = esc_url(get_site_url());
        echo '<div class="wrap"><h1>Inkletter Bridge</h1>';
        echo '<p>Paste these into Inkletter → Export → Send to WordPress.</p>';
        echo '<table class="form-table">';
        echo '<tr><th>Site URL</th><td><code>' . $url . '</code></td></tr>';
        echo '<tr><th>API Key</th><td><input type="text" readonly value="' . $key . '" style="width:340px" onclick="this.select()"></td></tr>';
        echo '</table>';
        echo '<form method="post">';
        wp_nonce_field('inkletter_regen');
        echo '<p><button class="button" name="inkletter_regen" value="1">Regenerate key</button></p>';
        echo '</form></div>';
    });
});

/* REST endpoint that receives the newsletter */
add_action('rest_api_init', function () {
    register_rest_route('inkletter/v1', '/newsletter', [
        'methods'  => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'inkletter_bridge_receive',
    ]);
});

function inkletter_bridge_receive(WP_REST_Request $req) {
    // auth
    $provided = $req->get_header('x-inkletter-key');
    $expected = get_option('inkletter_bridge_key');
    if (!$expected || !hash_equals((string)$expected, (string)$provided)) {
        return new WP_REST_Response(['error' => 'Invalid API key'], 403);
    }

    $subject = sanitize_text_field($req->get_param('subject') ?: 'Newsletter');
    $html    = $req->get_param('html');
    $mode    = sanitize_text_field($req->get_param('mode') ?: 'auto');
    if (empty($html)) {
        return new WP_REST_Response(['error' => 'html is required'], 400);
    }

    $mailpoetActive = class_exists(\MailPoet\API\API::class);

    // Try MailPoet when available (auto or explicit)
    if (($mode === 'mailpoet' || $mode === 'auto') && $mailpoetActive) {
        try {
            $mp = \MailPoet\API\API::MP('v1');
            // MailPoet's public API is limited; create a draft newsletter record
            // via its models so the user can review + send from MailPoet.
            $newsletter = \MailPoet\Models\Newsletter::createOrUpdate([
                'type'    => \MailPoet\Models\Newsletter::TYPE_STANDARD,
                'subject' => $subject,
                'body'    => wp_json_encode([
                    'content' => [
                        'type' => 'container', 'orientation' => 'vertical',
                        'blocks' => [[
                            'type' => 'html',
                            'text' => $html,
                        ]],
                    ],
                ]),
                'status'  => 'draft',
            ]);
            return new WP_REST_Response([
                'ok' => true, 'target' => 'mailpoet',
                'message' => 'Draft newsletter created in MailPoet — review and send it there.',
                'id' => $newsletter->id ?? null,
            ], 200);
        } catch (\Throwable $e) {
            // fall through to draft post
        }
    }

    // Fallback: create a draft post/page holding the newsletter HTML
    $post_id = wp_insert_post([
        'post_title'   => $subject,
        'post_content' => $html,
        'post_status'  => 'draft',
        'post_type'    => 'post',
    ]);
    if (is_wp_error($post_id)) {
        return new WP_REST_Response(['error' => $post_id->get_error_message()], 500);
    }
    return new WP_REST_Response([
        'ok' => true, 'target' => 'post',
        'message' => $mailpoetActive
            ? 'Saved as a draft post (MailPoet import failed).'
            : 'Saved as a draft post. Install MailPoet to create newsletters directly.',
        'edit_link' => get_edit_post_link($post_id, 'raw'),
        'id' => $post_id,
    ], 200);
}
