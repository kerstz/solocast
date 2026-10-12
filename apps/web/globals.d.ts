/**
 * Constante injectée au build (next.config.mjs / vitest.config.ts).
 * true seulement quand NEXT_PUBLIC_BACKEND_MODE=mock : sinon la branche mock est éliminée
 * par le bundler et le faux backend ne part pas en production.
 */
declare const __MOCK_BACKEND__: boolean;
