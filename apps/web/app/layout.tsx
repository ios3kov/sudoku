import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "../components/pwa-register";
import "./globals.css";
import "../features/messenger/messenger-redesign.css";

export const metadata: Metadata = {
  title: "Sudoku",
  applicationName: "Sudoku",
  description: "Sudoku puzzle",
  appleWebApp: {
    capable: true,
    title: "Sudoku",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f7f5ef",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
