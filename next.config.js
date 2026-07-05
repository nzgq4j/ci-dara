/** @type {import('next').NextConfig} */

// Content-Security-Policy. App Router injects inline bootstrap scripts and the
// app uses inline styles (style={{}}) + Tailwind, so 'unsafe-inline' is required
// for script/style until a nonce-based setup is added. connect-src allows the
// Supabase project (auth/storage/realtime) and Stripe.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
  "frame-src 'self' https://*.stripe.com",
  "form-action 'self'"
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' }
];

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['mammoth', '@react-pdf/renderer'],
    // Solicitation/proposal documents are uploaded through server actions (the workspace
    // uploader and the Upload & Instant Review screen); real RFP PDFs exceed the 1MB
    // default. Raise the server-action body limit to accommodate document uploads.
    serverActions: { bodySizeLimit: '25mb' }
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

module.exports = nextConfig;
