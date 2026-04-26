/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workforce-substrate package is sibling-pathed (no npm workspaces).
  // Next 14 needs explicit transpile because the source uses .js extension
  // imports against .ts files; the alias is declared in tsconfig.json.
  transpilePackages: ["@workforce/substrate"],
};

export default nextConfig;
