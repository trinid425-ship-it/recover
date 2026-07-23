/** @type {import('next').NextConfig} */
const nextConfig = {
  // Our TS source uses explicit ".js" extensions in relative imports (correct
  // for TS "Bundler" resolution). Tell webpack to resolve those to .ts/.tsx so
  // `next build` can find the modules.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  // Whop apps render inside an iframe on whop.com — allow embedding.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors https://whop.com https://*.whop.com;" },
        ],
      },
    ];
  },
};
export default nextConfig;
