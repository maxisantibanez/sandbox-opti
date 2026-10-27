import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The demo model lives at the repository root so the solver tests and the
  // frontend consume the same fixture. Turbopack needs the monorepo root to
  // resolve imports outside the web/ application directory.
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
};

export default nextConfig;
