import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

// Self-hosted via next/font — replaces the render-blocking @import in globals.css.
// Subsetting + variable injection so Tailwind's font-sans / font-mono resolve to these.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orka Project",
  description: "Orka Project — project & program management for modern teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.variable, jetbrainsMono.variable, "font-sans")}>
      <body>{children}</body>
    </html>
  );
}
