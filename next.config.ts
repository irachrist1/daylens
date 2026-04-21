import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/daylens",
  async redirects() {
    return [
      {
        source: "/Daylens",
        destination: "/daylens",
        permanent: true,
        basePath: false,
      },
      {
        source: "/Daylens/:path*",
        destination: "/daylens/:path*",
        permanent: true,
        basePath: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://www.google.com https://t2.gstatic.com",
              "font-src 'self'",
              "connect-src 'self' https://*.convex.cloud https://*.convex.site",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
