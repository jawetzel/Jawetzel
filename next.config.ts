import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "mongodb", "openai", "playwright"],
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.ngrok-free.dev",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Route renamed security-audit → security-review. `:path*` matches the bare
      // path too, so this covers both the page and the /public PDF asset.
      {
        source: "/security-audit/:path*",
        destination: "/security-review/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
