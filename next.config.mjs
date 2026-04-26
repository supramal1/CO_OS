/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workforce-substrate package is sibling-pathed (no npm workspaces).
  // Next 14 needs explicit transpile because the source uses .js extension
  // imports against .ts files; the alias is declared in tsconfig.json.
  transpilePackages: ["@workforce/substrate"],
  webpack: (config) => {
    // Substrate source uses NodeNext-style ".js" specifiers that resolve
    // against ".ts" siblings. Tell webpack to treat the suffix as such.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
