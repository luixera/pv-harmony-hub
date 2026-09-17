import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Testes do FRONT (vitest, `npm test`): só `src/**\/*.test.ts`. Os testes do
 * robô da Ludmilla (`worker/ludmilla/test`) são `node:test` e rodam com o
 * `npm test` de lá — o vitest não os entende.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'worker/**', 'supabase/**'],
    environment: 'node',
  },
});
