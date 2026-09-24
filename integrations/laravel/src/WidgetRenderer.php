<?php

namespace Planora\LaravelWidget;

/**
 * Builds the HTML for the widget. Framework-free on purpose, so the same logic
 * can be tested without booting Laravel (and ported to other PHP frameworks).
 */
final class WidgetRenderer
{
    /**
     * @param array<string, mixed> $config Values from config/planora.php
     */
    public function __construct(private readonly array $config)
    {
    }

    /**
     * HMAC-SHA256 of the user id with the site secret, hex encoded.
     * Planora verifies this before showing a user their tickets.
     */
    public function userHash(string $userId): ?string
    {
        $secret = (string) ($this->config['secret'] ?? '');

        return $secret === '' ? null : hash_hmac('sha256', $userId, $secret);
    }

    /**
     * @param array{id: string|int, name?: string|null, email?: string|null}|null $user
     */
    public function render(?array $user = null, ?string $nonce = null): string
    {
        if (! ($this->config['enabled'] ?? true) || empty($this->config['site_key'])) {
            return '';
        }

        $cdn = rtrim((string) ($this->config['cdn_url'] ?? ''), '/');
        $attributes = [
            'src' => $cdn.'/loader.js',
            'data-site-key' => (string) $this->config['site_key'],
            'data-api-base' => (string) ($this->config['api_base'] ?? ''),
            'data-position' => $this->config['position'] ?? null,
            'data-color' => $this->config['color'] ?? null,
            'data-label' => $this->config['label'] ?? null,
            'nonce' => $nonce,
        ];

        $html = '<script '.$this->attributes($attributes).' async></script>';

        if ($user !== null && isset($user['id']) && $user['id'] !== '') {
            $id = (string) $user['id'];
            $identify = array_filter([
                'id' => $id,
                'name' => $user['name'] ?? null,
                'email' => $user['email'] ?? null,
                'userHash' => $this->userHash($id),
            ], static fn ($value) => $value !== null && $value !== '');

            // JSON_HEX_* flags make the payload safe inside a <script> element.
            $json = json_encode($identify, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);

            $html .= '<script'.($nonce ? ' nonce="'.$this->escape($nonce).'"' : '').'>'
                .'window.Planora=window.Planora||function(){(window.Planora.q=window.Planora.q||[]).push(arguments)};'
                .'Planora("identify",'.$json.');'
                .'</script>';
        }

        return $html;
    }

    /**
     * @param array<string, string|null> $attributes
     */
    private function attributes(array $attributes): string
    {
        $parts = [];
        foreach ($attributes as $name => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $parts[] = $name.'="'.$this->escape((string) $value).'"';
        }

        return implode(' ', $parts);
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
