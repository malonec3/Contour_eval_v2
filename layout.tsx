import type { Metadata } from "next";
import "./globals.css";

const title = "RadOnc Contour Metrics Lab";
const description =
  "An interactive educational lab for drawing, transforming, and comparing 2D contours with overlap and surface-distance metrics.";
const productionUrl = new URL("https://radonc-contour-metrics.malonec3.chatgpt.site");
const socialImageUrl = new URL("/og.png", productionUrl).toString();

export const metadata: Metadata = {
  metadataBase: productionUrl,
  title,
  description,
  alternates: { canonical: "/" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title,
    description,
    type: "website",
    url: productionUrl,
    images: [{ url: socialImageUrl, width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImageUrl],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
