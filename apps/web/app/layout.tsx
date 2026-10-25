import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";

import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { Providers } from "@/components/shell/providers";
import { ThemeScript } from "@/components/theme/theme-script";

// Sora, explorador's single typeface (variable, weights 100–800), self-hosted
// from app/fonts like explorador.pt (OFL licence alongside). Drives both
// --font-sans and --font-display (globals.css).
const sora = localFont({
  src: "./fonts/Sora.woff2",
  variable: "--font-sora",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "explorador advance",
    template: "%s · explorador advance",
  },
  description:
    "Commission advances for explorador agents, funded by an investor pool on Stellar. Every deal is proven on-chain with zero-knowledge proofs. Testnet demo.",
  applicationName: "explorador advance",
};

export const viewport: Viewport = {
  // Mobile browser chrome continues the header: brand blue in light, slate-900 in dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script sets `class="dark"` and color-scheme on <html> before
    // React hydrates; suppress that expected attribute mismatch.
    <html lang="en" className={`${sora.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Render-blocking on purpose: resolves Light/System/Dark from
            localStorage + OS before first paint, so there is no flash. */}
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col bg-bg font-sans text-fg" suppressHydrationWarning>
        <Providers>
          <a
            href="#main"
            className="sr-only z-50 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-primary-text shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
