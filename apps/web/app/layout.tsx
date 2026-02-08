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
  icons: {
    icon: {
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f172a'/%3E%3Ctext x='16' y='22' font-size='18' font-weight='bold' fill='white' text-anchor='middle' font-family='system-ui,sans-serif'%3EN%3C/text%3E%3C/svg%3E",
      type: "image/svg+xml",
    },
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
