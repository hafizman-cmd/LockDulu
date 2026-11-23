import type { Metadata, Viewport } from "next";
import { RegisterWorker } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LockDulu | Live vintage drops", template: "%s | LockDulu" },
  description: "Lock unique Malaysian vintage and bundle pieces straight from a live drop.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "LockDulu", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F2" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-MY" data-scroll-behavior="smooth"><body><RegisterWorker />{children}</body></html>;
}
