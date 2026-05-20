/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        soft: "#475569",
        mute: "#94A3B8",
        line: "#E2E8F0",
        bg: "#F8FAFC",
        surface: "#FFFFFF",
        // Orka brand: vibrant blue family (matches OrkaOS suite identity)
        primary: {
          DEFAULT: "#2563EB", dark: "#1D4ED8", light: "#93C5FD",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "#0EA5E9", dark: "#0284C7", light: "#7DD3FC",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        // Bright semantic
        success: { DEFAULT: "#22C55E", dark: "#16A34A", light: "#86EFAC" },
        warning: { DEFAULT: "#F59E0B", dark: "#D97706", light: "#FCD34D" },
        danger:  { DEFAULT: "#EF4444", dark: "#DC2626", light: "#FCA5A5" },
        info:    { DEFAULT: "#06B6D4", dark: "#0891B2", light: "#67E8F9" },
        // shadcn-style design tokens (driven by CSS variables in globals.css).
        // Coexist with the Orka palette above; shadcn components reference these.
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        // Use the next/font CSS variables so Tailwind utilities resolve to the
        // self-hosted, preloaded font files instead of the old Google Fonts @import.
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
        card: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        md: "0 4px 6px -1px rgba(15,23,42,0.07), 0 2px 4px -2px rgba(15,23,42,0.05)",
        glow: "0 0 0 4px rgba(37,99,235,0.18)",
        pop:  "0 8px 24px -8px rgba(37,99,235,0.25), 0 2px 6px rgba(15,23,42,0.06)",
        neon: "0 0 20px rgba(14,165,233,0.35), 0 4px 12px rgba(37,99,235,0.25)",
        float: "0 20px 48px -12px rgba(15,23,42,0.12), 0 8px 16px -8px rgba(15,23,42,0.08)",
        subtle: "0 0 0 1px rgba(15,23,42,0.04), 0 1px 2px rgba(15,23,42,0.06)",
      },
      backgroundImage: {
        // Orka blue gradient — deep blue → sky blue
        "brand-grad":  "linear-gradient(135deg, #1D4ED8 0%, #2563EB 50%, #0EA5E9 100%)",
        "brand-soft":  "linear-gradient(135deg, #EFF6FF 0%, #E0F2FE 100%)",
        "sidebar-grad": "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
        "header-grad": "linear-gradient(90deg, rgba(37,99,235,0.06) 0%, rgba(14,165,233,0.06) 100%)",
        "page-grad": "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
        "card-hover": "linear-gradient(135deg, rgba(37,99,235,0.02) 0%, rgba(14,165,233,0.02) 100%)",
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      keyframes: {
        bounceIn: {
          "0%":   { transform: "scale(0.6)", opacity: 0 },
          "60%":  { transform: "scale(1.08)", opacity: 1 },
          "100%": { transform: "scale(1)" },
        },
        pulseRing: {
          "0%":   { boxShadow: "0 0 0 0 rgba(34,197,94,0.55)" },
          "70%":  { boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0)" },
        },
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 12px rgba(14,165,233,0.4)" },
          "50%":      { boxShadow: "0 0 24px rgba(14,165,233,0.7)" },
        },
      },
      animation: {
        bounceIn: "bounceIn 0.32s cubic-bezier(.4,.0,.2,1) forwards",
        pulseRing: "pulseRing 2s ease-out infinite",
        glowPulse: "glowPulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
