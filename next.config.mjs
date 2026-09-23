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

  /*
   * ⚠️ THE .docx TEMPLATES HAVE TO BE TRACED IN BY HAND.
   *
   * /api/docgen reads them with `readFile(path.join(process.cwd(), 'lib',
   * 'templates', ...))`. Next traces what a route IMPORTS; a path assembled at
   * runtime is invisible to it, so the file is left out of the serverless
   * bundle -- and the route then works perfectly in `next dev` and answers
   * ENOENT in production. That is the worst shape of bug available here, so it
   * is declared rather than discovered.
   *
   * Anything added to lib/templates is covered automatically.
   */
  outputFileTracingIncludes: {
    '/api/docgen': ['./lib/templates/**/*'],
  },
};

export default nextConfig;
