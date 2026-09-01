import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Used sparingly, for major statements only.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Proof — your agent can act. Proof makes sure it happened.',
    template: '%s · Proof',
  },
  description:
    'Give an agent a goal. Watch it work. Step in when it matters. And when it says done, know that the result has actually been checked.',
  applicationName: 'Proof',
  openGraph: {
    title: 'Proof — your agent can act. Proof makes sure it happened.',
    description:
      'A workspace where people and AI agents get things done together, and nothing is called complete until the result has been checked.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
