import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): installable, explorador icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "explorador-advance",
    name: "explorador advance",
    short_name: "advance",
    description: "Commission advances for explorador agents, funded by an investor pool on Stellar (testnet demo).",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    lang: "en",
    categories: ["finance", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
