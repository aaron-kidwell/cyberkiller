/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const isProd = process.env.NODE_ENV === 'production'

const apiOrigin = (() => {
  try { return new URL(apiUrl).origin } catch { return apiUrl }
})()
const wsOrigin = apiOrigin.replace(/^http/, 'ws')

// Connect-src: the hub calls the API at whatever host it's served from
// (resolveRuntimeAPI), since an operator may reach a self-hosted range by LAN
// IP, hostname, or localhost. That host isn't known at build time, so allow the
// http/https/ws/wss schemes rather than pinning one origin. This is a
// self-hosted lab tool on an isolated network, so the broader connect-src is an
// acceptable tradeoff (the targets, not the hub, are the intentionally exposed
// surface). 'self' + the build-time origin stay for clarity.
const connectSrc = ["'self'", apiOrigin, wsOrigin, 'http:', 'https:', 'ws:', 'wss:']

// Production strips 'unsafe-eval' (Next.js only needs it in dev for fast refresh).
// 'unsafe-inline' stays because Next.js injects inline bootstrap scripts and
// inline styles are used liberally - moving to nonces is a much bigger refactor.
const scriptSrc = isProd
  ? ["'self'", "'unsafe-inline'"]
  : ["'self'", "'unsafe-inline'", "'unsafe-eval'"]

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            `script-src ${scriptSrc.join(' ')}`,
            // img-src deliberately narrow - drop blanket "https:" so a stored
            // <img src=evil.attacker.com> can't beacon out. Allow specific hosts
            // we actually use (the API origin for uploads, YouTube for music thumbs).
            `img-src 'self' data: ${apiOrigin} https://i.ytimg.com https://cdn.7tv.app`,
            "media-src 'self' https://stream.nightride.fm https://radio.plaza.one https://ice6.somafm.com",
            `connect-src ${connectSrc.join(' ')}`,
            "frame-src https://www.youtube-nocookie.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
            // No upgrade-insecure-requests: the default self-host runs over plain
            // HTTP on a LAN. If you front it with TLS, your reverse proxy adds HSTS.
          ].join('; '),
        },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
        },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    },
  ],
}
module.exports = nextConfig
