import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response. The per-page
 * Content-Security-Policy (with a per-request nonce for Next.js bootstrap
 * scripts) is set in src/middleware.ts.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle (`.next/standalone`) so the app runs as a
  // single stateless Node process in any container runtime; Vercel ignores
  // this and builds its own deployment artifact.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
