import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // There is a stray package.json in the home directory above this project.
  // Without this, Turbopack walks up and adopts it as the workspace root.
  //
  // NOTE: fileURLToPath, not new URL(...).pathname -- this directory name has a
  // space in it, and .pathname leaves it percent-encoded ("Case%20Managment"),
  // which Turbopack then fails to canonicalize.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
