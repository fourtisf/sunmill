/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The game is one canvas; there is nothing to statically optimise.
  poweredByHeader: false,
};

export default nextConfig;
