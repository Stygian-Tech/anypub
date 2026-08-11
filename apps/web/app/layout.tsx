import type { Metadata } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { EnvironmentBanner } from "@/components/environment-banner";
import { Toaster } from "@/components/ui/sonner";
import { environmentBannerHeight, getAppEnv } from "@/lib/app-env";
import { getWebPublicURL } from "@/lib/public-url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseMetadata: Metadata = {
  title: {
    default: "AnyPub",
    template: "%s | AnyPub",
  },
  description: "A standard.site CMS for ATProto publications.",
  applicationName: "AnyPub",
  openGraph: {
    title: "AnyPub",
    description: "A standard.site CMS for ATProto publications.",
    siteName: "AnyPub",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AnyPub",
    description: "A standard.site CMS for ATProto publications.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: getWebPublicURL(process.env, await headers()),
    ...baseMetadata,
  };
}

// Resolve APP_ENV from the running Railway environment instead of baking a
// development label into an image that could later be promoted.
export const dynamic = "force-dynamic";

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
  const appEnv = getAppEnv();

  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <Script id="anypub-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className="flex min-h-dvh flex-col"
        style={{ "--environment-banner-height": environmentBannerHeight(appEnv) } as CSSProperties}
      >
        <EnvironmentBanner appEnv={appEnv} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
