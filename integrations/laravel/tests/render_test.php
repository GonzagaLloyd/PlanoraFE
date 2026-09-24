<?php

// Framework-free tests for WidgetRenderer: `php tests/render_test.php`.

require __DIR__.'/../src/WidgetRenderer.php';

use Planora\LaravelWidget\WidgetRenderer;

$failures = 0;
function check(string $name, bool $ok): void
{
    global $failures;
    echo ($ok ? "  ok   " : "  FAIL ").$name.PHP_EOL;
    if (! $ok) {
        $failures++;
    }
}

$config = [
    'enabled' => true,
    'site_key' => 'pk_test_secure',
    'secret' => 'sk_test_secure',
    'api_base' => 'http://localhost:8787',
    'cdn_url' => 'http://localhost:8787/cdn/',
];

$renderer = new WidgetRenderer($config);

$html = $renderer->render(null);
check('renders the loader tag', str_contains($html, 'src="http://localhost:8787/cdn/loader.js"'));
check('includes the site key', str_contains($html, 'data-site-key="pk_test_secure"'));
check('no identify call when logged out', ! str_contains($html, 'identify'));

$html = $renderer->render(['id' => 42, 'name' => 'Ana </script><script>alert(1)</script>', 'email' => 'ana@example.com']);
$expectedHash = hash_hmac('sha256', '42', 'sk_test_secure');
check('identifies the user with a server-side hash', str_contains($html, '"userHash":"'.$expectedHash.'"'));
check('never prints the secret', ! str_contains($html, 'sk_test_secure'));
check('escapes </script> in user data', substr_count($html, '</script>') === 2);

$html = $renderer->render(['id' => 1], 'abc123');
check('adds the CSP nonce to both tags', substr_count($html, 'nonce="abc123"') === 2);

check('renders nothing without a site key', (new WidgetRenderer(['site_key' => '']))->render(null) === '');
check('renders nothing when disabled', (new WidgetRenderer(array_merge($config, ['enabled' => false])))->render(null) === '');
check('omits the hash when no secret is set', ! str_contains((new WidgetRenderer(array_merge($config, ['secret' => ''])))->render(['id' => 1]), 'userHash'));

echo $failures === 0 ? PHP_EOL."All passed".PHP_EOL : PHP_EOL."$failures failed".PHP_EOL;
exit($failures === 0 ? 0 : 1);
