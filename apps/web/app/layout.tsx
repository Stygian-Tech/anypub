import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AnyPub",
  description: "A standard.site CMS for ATProto publications.",
};

const themeScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("anypub:theme");
    const storedFont = window.localStorage.getItem("anypub:font");
    const storedBoldText = window.localStorage.getItem("anypub:bold-text");
    const theme = storedTheme || "light";
    const font = storedFont === "serif" || storedFont === "mono" ? storedFont : "sans";
    const boldText = storedBoldText === "1";
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDarkTheme = theme === "dark" || (theme === "system" && systemPrefersDark);
    const root = document.documentElement;
    root.classList.toggle("dark", shouldUseDarkTheme);
    root.dataset.theme = shouldUseDarkTheme ? "dark" : "light";
    root.dataset.font = font;
    root.dataset.boldText = boldText ? "true" : "false";
    root.style.colorScheme = shouldUseDarkTheme ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.font = "sans";
    document.documentElement.dataset.boldText = "false";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <Script id="anypub-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
