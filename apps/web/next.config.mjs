/**
 * `__MOCK_BACKEND__` est une constante de build : à false, webpack élimine la branche mock
 * et `lib/backend/mock*` ne part pas dans le bundle (vérifié : aucune clé de démo en prod).
 */
const mockBackend = process.env.NEXT_PUBLIC_BACKEND_MODE === "mock";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dossier de build. `NEXT_PUBLIC_BACKEND_MODE` est inliné DANS les chunks compilés : deux
  // serveurs Next sur la même app (dev en `http` + serveur e2e en `mock`) qui partagent `.next`
  // s'écrasent l'un l'autre, et le dev server se met à servir le faux backend. Les tests e2e
  // passent donc `NEXT_DIST_DIR` pour avoir leur propre dossier.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  // Le lint est exécuté par la config ESLint plate racine (`pnpm lint`), pas par `next lint`.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@solocast/shared"],
  poweredByHeader: false,
  // `NEXT_EXPORT=1` : site 100 % statique (dossier `out/`), servi par le backend dans l'app
  // installée. Sans cette variable, `next dev` / `next start` restent inchangés.
  ...(process.env.NEXT_EXPORT === "1"
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {}),
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.DefinePlugin({ __MOCK_BACKEND__: JSON.stringify(mockBackend) }),
    );
    return config;
  },
};

export default nextConfig;
