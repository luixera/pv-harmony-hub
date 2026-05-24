import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Bloqueia tradução automática do navegador — evita que Chrome/Firefox/Edge
// modifiquem o DOM diretamente, o que quebra o React.
const html = document.documentElement;
html.setAttribute('translate', 'no');
html.setAttribute('lang', 'pt-BR');
html.classList.add('notranslate');

createRoot(document.getElementById("root")!).render(<App />);
