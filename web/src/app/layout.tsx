import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { APP_NAME, LOGO } from "@/lib/config";
import SessionExpiryGuard from "@/components/auth/SessionExpiryGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${APP_NAME} — Examination Platform`,
  description: "The modern examination platform for SMEC",
  icons: {
    icon: LOGO,
    shortcut: LOGO,
    apple: LOGO,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SessionExpiryGuard />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
