// Configuration ESLint partagée (flat config). Ne pas la redéfinir par package.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Sorties de build. `.next-e2e` est le distDir du serveur Playwright (cf. next.config.mjs) :
    // sans lui ici, `pnpm lint` échoue sur des bundles générés dès qu'on a lancé `test:e2e`.
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      // Export statique du front (build:static) et téléchargements d'empaquetage.
      "apps/web/out/**",
      ".cache/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      // `typeof import("...")` reste autorisé : il sert aux imports différés (bundle, mock).
      "@typescript-eslint/consistent-type-imports": ["error", { disallowTypeAnnotations: false }],
      // Un paramètre préfixé `_` est volontairement ignoré (signature imposée par une interface).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Une variable lue avant son affectation (capture par closure) doit rester `let`.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
);
