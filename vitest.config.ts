import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Testes do FRONT (vitest, `npm test`): `src/**\/*.test.ts` e os módulos
 * PUROS compartilhados pelas edge functions (`supabase/functions/_shared`) —
 * esses não tocam em `Deno.*` nem em `esm.sh`, então o vitest dá conta e a
 * lógica delicada (parse de payload, telefone/JID) fica coberta sem precisar
 * do Deno instalado. O resto de `supabase/**` continua de fora.
 *
 * Os testes do robô da Ludmilla (`worker/ludmilla/test`) são `node:test` e
 * rodam com o `npm test` de lá — o vitest não os entende.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'supabase/functions/_shared/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'worker/**'],
    environment: 'node',
  },
});
