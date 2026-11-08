import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Spoken",
  description: "Du skriver, vi snakker. An AI that makes the phone call for you, says it's an AI, and asks you before it agrees to anything.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06070A" },
    { media: "(prefers-color-scheme: light)", color: "#EEF0F5" },
  ],
  colorScheme: "dark light",
};

// Set the saved theme (and Profile's higher contrast) before first paint so a light-theme user
// never sees a dark flash. Same key and shape as PREFS_KEY in lib/store.ts.
const THEME_BOOT = `try{var p=JSON.parse(localStorage.getItem("spoken-prefs")||"null"),d=document.documentElement.dataset;d.theme=(p&&p.themePref)||"system";if(p&&p.highContrast===true)d.contrast="more"}catch(e){document.documentElement.dataset.theme="system"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
