import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Garmin connector imports garmin-connect-client, whose dependency
  // http-cookie-agent does a conditional `require('deasync')` (an optional
  // native dep we don't install). Keep the package external so Next's bundler
  // doesn't try to statically resolve that chain; at runtime the deasync branch
  // is never taken (the sync cookie path is used).
  serverExternalPackages: ["garmin-connect-client"],
};

export default nextConfig;
