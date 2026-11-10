import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // só a página da Ludmilla (spec 2026-11-08 §3); carregada por useFonteDaLudmilla
        lm: ['"Public Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        kanban: {
          pending: "hsl(var(--kanban-pending))",
          analysis: "hsl(var(--kanban-analysis))",
          progress: "hsl(var(--kanban-progress))",
          approved: "hsl(var(--kanban-approved))",
          completed: "hsl(var(--kanban-completed))",
        },
        // O mundo "Conta de luz", SÓ da página /ludmilla (spec 2026-11-08 §3). Os mesmos hex de
        // src/components/ludmilla/mundo/cores.ts. Nenhum token do GD muda.
        lm: {
          papel: "#FFFFFF",
          petroleo: "#0F3D4C",
          sol: "#F2B705",
          "sol-forte": "#E0A800",
          "sol-fundo": "#FDF1C7",
          "sol-texto": "#5E4500",
          caixa: "#E7EEF0",
          "caixa-forte": "#D9E4E8",
          alerta: "#C2410C",
          // texto em alerta sobre a caixa: #C2410C dá 4,41:1 sobre #E7EEF0 (plano, decisão 1)
          "alerta-texto": "#8F2F09",
          "alerta-fundo": "#FBE6DC",
          barra: "#9FB8C0",
          suave: "#3E5F6A",
          borda: "#C9D6DA",
          linha: "#E1E9EC",
          "ok-fundo": "#E2F1E6",
          "ok-texto": "#1D5E34",
          "azul-fundo": "#DDEBF2",
          "azul-texto": "#0B4F6C",
          "faixa-borda": "#4F7C8A",
          "faixa-suave": "#CFE0E5",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px -5px hsl(var(--primary) / 0.4)" },
          "50%": { boxShadow: "0 0 30px -5px hsl(var(--primary) / 0.6)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
