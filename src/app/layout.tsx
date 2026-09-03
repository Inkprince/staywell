import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans } from 'next/font/google';
import { ProofLauncher } from '@/features/proof/proof-launcher';
import './globals.css';

/*
 * Typography. Plus Jakarta Sans is the display voice — the editorial, slightly
 * geometric headline face the marketing site leans on. DM Sans is the body
 * face: the closest openly-licensed match to Google Sans (Google Sans itself
 * is proprietary and cannot be served here; swap the import if you license it).
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'StayWell — hotel stays, with Proof.', template: '%s · StayWell' },
  description: 'A beautiful hotel stay with Proof: the trusted way to work with an agent on important reservation changes.',
  applicationName: 'StayWell',
  openGraph: { title: 'StayWell — hotel stays, with Proof.', description: 'Book beautifully. Change confidently. Proof checks every important result.', type: 'website' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${jakarta.variable} ${body.variable}`}><body className="min-h-dvh antialiased">{children}<ProofLauncher /></body></html>;
}
