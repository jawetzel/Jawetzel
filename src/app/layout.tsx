import type { Metadata } from "next";
import { headers } from "next/headers";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { Providers } from "./providers";
import {
  JsonLd,
  personSchema,
  professionalServiceSchema,
  websiteSchema,
} from "@/lib/jsonld";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display-var",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-sans-var",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-var",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://jawetzel.com"),
  title: {
    default:
      "Joshua Wetzel — Legacy Application Modernization & Software Consulting",
    template: "%s · Joshua Wetzel",
  },
  description:
    "Legacy application modernization and software consulting in Greater Baton Rouge, LA. Joshua Wetzel modernizes the mission-critical legacy systems a business runs on — .NET, Node, React — plus AI-native tooling and solo-shipped products. On-site across South Louisiana, remote nationwide.",
  openGraph: {
    type: "website",
    siteName: "Joshua Wetzel",
    title: "Joshua Wetzel — Legacy Application Modernization",
    description:
      "Legacy application modernization & software consulting. 6+ yrs modernizing mission-critical legacy systems, plus AI-native tooling and solo-shipped products.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Joshua Wetzel — Legacy Application Modernization",
    description:
      "Legacy application modernization & software consulting. 6+ yrs modernizing mission-critical legacy systems, plus AI-native tooling.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <JsonLd graph={[personSchema(), websiteSchema(), professionalServiceSchema()]} />
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <ChatLauncher />
        </Providers>
      </body>
      <GoogleAnalytics gaId="G-WMM5T0GG34" nonce={nonce} />
    </html>
  );
}
