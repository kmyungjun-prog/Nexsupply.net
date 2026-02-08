import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NexSupply", template: "%s · NexSupply" },
  description: "Find 1688 factories with one photo. AI analyzes your product and recommends factory candidates.",
  openGraph: {
    title: "NexSupply — Find 1688 factories with one photo",
    description: "Upload a product photo and get AI analysis plus 1688 factory recommendations.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
