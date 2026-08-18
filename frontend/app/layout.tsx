import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SITE_URL } from '../game/brand';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'SUNMIL — Farm & Craft Tycoon',
  description: 'A production-chain farm on Robinhood Chain. Grow crops, feed animals, run the machines, fill the truck.',
  applicationName: 'SUNMIL',
  manifest: '/manifest.webmanifest',
  // app/icon.png, app/apple-icon.png and app/opengraph-image.png are picked up
  // by the file convention; they are generated from public/brand by
  // scripts/build-brand-assets.mjs.
  appleWebApp: { capable: true, title: 'SUNMIL', statusBarStyle: 'black-translucent' },
  openGraph: {
    type: 'website',
    siteName: 'SUNMIL',
    url: SITE_URL,
    title: 'SUNMIL — Farm & Craft Tycoon',
    description: 'Grow crops, feed animals, run the machines, fill the truck.',
  },
  twitter: { card: 'summary_large_image', title: 'SUNMIL — Farm & Craft Tycoon' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#5AA8D8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
