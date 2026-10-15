import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=()',
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // PWA: o app fica instalável e o *shell* (JS/CSS/HTML/ícones) é guardado
    // para abrir rápido. DADOS nunca entram em cache — não há runtimeCaching
    // nem fila de escrita offline; tudo que é de negócio vem da rede.
    VitePWA({
      // 'prompt' é deliberado: com 'autoUpdate' o usuário pode ficar preso
      // numa versão velha sem saber. O aviso de nova versão fica em main.tsx.
      registerType: "prompt",
      includeAssets: ["favicon.ico", "icone-192.png", "icone-512.png"],
      manifest: {
        name: "GD Manager Energy",
        short_name: "GD Manager",
        description: "Homologação de projetos fotovoltaicos",
        lang: "pt-BR",
        theme_color: "#F5A800",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // só o shell: dados continuam vindo da rede (sem fila de escrita offline)
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // O chunk principal tem ~3,6 MB; o limite padrão do workbox é 2 MiB e
        // deixaria o arquivo mais importante FORA do precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // As bibliotecas de PDF/documento só carregam quando alguém gera um
        // documento (e aí há rede). Precachear tudo seriam ~6 MB na 1ª visita,
        // num celular com plano de dados.
        globIgnores: [
          "**/html2pdf-*.js",
          "**/pdf-*.js",
          "**/jspdf*.js",
          "**/html2canvas*.js",
          "**/purify*.js",
        ],
        runtimeCaching: [],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
  },
}));
