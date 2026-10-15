import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

// Bloqueia tradução automática do navegador — evita que Chrome/Firefox/Edge
// modifiquem o DOM diretamente, o que quebra o React.
const html = document.documentElement;
html.setAttribute('translate', 'no');
html.setAttribute('lang', 'pt-BR');
html.classList.add('notranslate');

createRoot(document.getElementById("root")!).render(<App />);

// PWA: registra o service worker e avisa quando há versão nova (o toast da casa
// é o `sonner`). Import estático de propósito: o sonner já está no pacote
// principal, então o import dinâmico não separaria nada e só geraria aviso no build.
const atualizar = registerSW({
  onNeedRefresh() {
    toast("Nova versão disponível", {
      action: { label: "Atualizar", onClick: () => atualizar(true) },
      duration: Infinity,
    });
  },
});
