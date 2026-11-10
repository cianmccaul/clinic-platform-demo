/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // The waitlist is switched on in the demo, as it is in production.
    NEXT_PUBLIC_WAITLIST: "on",
  },
};

export default nextConfig;
