import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, Sora } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-sora", display: "swap" });
const pixelify = Pixelify_Sans({ subsets: ["latin"], weight: ["400"], variable: "--font-pixelify", display: "swap" });

export const metadata: Metadata = {
  title: { default: "explorador advance", template: "%s · explorador advance" },
  description:
    "Close the deal, get paid today. explorador advance lets real-estate agents spend their future commission now, funded by investors on Stellar.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sora.variable} ${pixelify.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overflow-x-hidden bg-page font-sans text-ink">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
