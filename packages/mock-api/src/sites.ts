import type { WidgetConfig } from '@planora/widget-contract';

/**
 * A widget site. In Planora this is a `widget_sites` row that also points at
 * the organization, the project the tickets land in, and its intake column.
 */
export interface Site {
  key: string;
  /** Server-side secret used to verify user hashes. Never sent to the browser. */
  secret: string;
  requireUserHash: boolean;
  /** Origins allowed to use this key. '*' = any (dev only). */
  allowedOrigins: string[];
  /** Prefix of the human-facing ticket key, e.g. SHOP → SHOP-12. */
  ticketPrefix: string;
  config: WidgetConfig;
}

const baseConfig: WidgetConfig = {
  enabled: true,
  site_name: 'Demo Shop',
  mode: 'team',
  branding: { primary_color: '#C94A16', launcher_label: 'Report an issue', position: 'bottom-right' },
  features: { screenshot: true, attachments: true, replies: true },
  limits: { max_attachments: 5, max_attachment_bytes: 10 * 1024 * 1024 },
};

/** Demo sites. The real Planora API loads these from its database. */
export const SITES: Record<string, Site> = {
  // Team mode, no hash required: the default for local development.
  pk_test_demo: {
    key: 'pk_test_demo',
    secret: 'sk_test_demo',
    requireUserHash: false,
    allowedOrigins: ['*'],
    ticketPrefix: 'SHOP',
    config: baseConfig,
  },
  // Team mode with identity verification (what production should use).
  pk_test_secure: {
    key: 'pk_test_secure',
    secret: 'sk_test_secure',
    requireUserHash: true,
    allowedOrigins: ['*'],
    ticketPrefix: 'SEC',
    config: { ...baseConfig, site_name: 'Secure Demo' },
  },
  // Public mode: anonymous visitors can report.
  pk_test_public: {
    key: 'pk_test_public',
    secret: 'sk_test_public',
    requireUserHash: false,
    allowedOrigins: ['*'],
    ticketPrefix: 'PUB',
    config: {
      ...baseConfig,
      site_name: 'Public Demo',
      mode: 'public',
      branding: { primary_color: '#0F766E', launcher_label: 'Send feedback', position: 'bottom-left' },
    },
  },
  // Disabled site: the widget must stay hidden.
  pk_test_disabled: {
    key: 'pk_test_disabled',
    secret: 'sk_test_disabled',
    requireUserHash: false,
    allowedOrigins: ['*'],
    ticketPrefix: 'OFF',
    config: { ...baseConfig, enabled: false },
  },
};
