/** @type {import('next').NextConfig} */
const nextConfig = {
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
