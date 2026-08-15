import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TruthGuard — Decentralized AI Fact-Checking on GenLayer",
  description: "Submit a claim, attach evidence, and let independent AI validators on GenLayer Bradbury Testnet reach consensus before a verdict is recorded on-chain.",
  icons: { icon: "/icon.svg" },
  openGraph: { title: "TruthGuard — Verify any claim with decentralized AI consensus", description: "Independent AI validators fetch the evidence, analyze the claim, and must agree before a verdict is stored on-chain.", type: "website" },
  twitter: { card: "summary_large_image", title: "TruthGuard — Decentralized AI Fact-Checking", description: "Verify any claim with decentralized AI consensus on GenLayer Bradbury." }
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark light" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
