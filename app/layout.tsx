import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TruthGuard | AI Fact Checker on GenLayer",
  description: "Verify claims with decentralized AI consensus powered by GenLayer intelligent contracts on Bradbury Testnet.",
  icons: { icon: "/icon.svg" },
  openGraph: { title: "TruthGuard", description: "Verify Any Claim with Decentralized AI Consensus.", type: "website" },
  twitter: { card: "summary_large_image", title: "TruthGuard", description: "Verify Any Claim with Decentralized AI Consensus." }
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark light" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
