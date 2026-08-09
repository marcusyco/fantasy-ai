/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Webhook + cron routes stream/read raw bodies and should never
    // be statically optimized.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
