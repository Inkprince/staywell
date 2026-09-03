'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { motion, type Variants } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { StayWellNav } from '@/features/staywell/staywell-nav';
import { ProofConsole } from '@/features/proof/proof-console';

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const STAYS = '/stays' as Route;
const RESERVATIONS = '/reservations' as Route;

const DEMO_GOAL = 'Move my stay to Friday for two nights, under $300.';

const ASSURANCES = ['Live rooms, live prices', 'Demo checkout — nothing real is charged', 'Every change checked, every time'];

/**
 * The hero: the product, running. Full-bleed and a full viewport tall, the
 * headline earns the click and the chat beside it is a real task on a real
 * reservation — one sentence from a visitor to a prepared change they get to
 * approve. The floating glass chips are the loop, spelled in ornaments.
 */
export function Hero() {
  return (
    <section className="relative flex min-h-svh w-full flex-col overflow-hidden lg:h-svh lg:min-h-[800px]">
      <Image
        src="/images/photo-1564501049412-61c2a3083791.jpg"
        alt="StayWell hotel exterior at dusk, surrounded by lush landscaping"
        fill
        priority
        sizes="100vw"
        className="scale-105 object-cover brightness-[0.42]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,29,26,0.45),rgba(12,29,26,0.72)_60%,rgba(12,29,26,0.9))]" />

      <StayWellNav inverse />

      <div className="relative z-10 mx-auto flex w-full max-w-[1800px] flex-1 items-center px-6 pb-14 pt-32 md:px-12 md:pt-36 lg:px-20 lg:pb-16">
        <div className="grid w-full items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 xl:gap-20">
          <motion.div variants={stagger} initial="hidden" animate="visible" className="min-w-0">
            <motion.p
              variants={fadeInUp}
              className="mb-5 text-xs font-medium tracking-[0.22em] text-white/70 uppercase"
            >
              StayWell · East River · with Proof
            </motion.p>
            <motion.h1
              variants={fadeInUp}
              className="max-w-3xl font-display text-5xl font-medium leading-[0.95] tracking-tighter text-white drop-shadow-2xl sm:text-7xl xl:text-[5.5rem]"
            >
              Book beautifully.
              <br />
              Change confidently.
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="mt-6 max-w-lg text-lg leading-relaxed text-white/80"
            >
              A quiet 25-room retreat — and when plans change, Proof&apos;s agent does the
              running around. It prepares the change; you approve it; the site checks the
              result before anyone calls it done.
            </motion.p>
            <motion.p variants={fadeInUp} className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              This page is a WebMCP server: open it in ChatGPT&apos;s browser and your own
              agent can drive the same tools Proof uses — and nothing more.{' '}
              <Link href="/agent-check" className="underline decoration-white/30 underline-offset-2 transition-colors hover:text-white">
                See it work
              </Link>
            </motion.p>
            <motion.div variants={fadeInUp} className="mt-9 flex flex-wrap gap-4">
              <Link
                href={STAYS}
                className="group relative inline-flex items-center overflow-hidden rounded-full bg-white py-2.5 pl-7 pr-2.5 text-sm font-semibold text-[#17352f] transition-transform duration-300 hover:scale-[1.03]"
              >
                <span className="relative z-10">Find your room</span>
                <span className="relative z-10 ml-3 rounded-full bg-[#17352f] p-2 text-white transition-colors duration-300 group-hover:bg-cobalt">
                  <ArrowUpRight
                    size={15}
                    aria-hidden
                    className="transition-transform duration-300 group-hover:rotate-45"
                  />
                </span>
              </Link>
              <Link
                href={RESERVATIONS}
                className="rounded-full border border-white/35 px-7 py-3.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15"
              >
                See your stay
              </Link>
            </motion.div>

            <motion.ul variants={fadeInUp} className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/75">
              {ASSURANCES.map((line) => (
                <li key={line} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-white shadow-[0_0_10px_white]"
                  />
                  {line}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: 'easeOut' }}
            className="min-w-0"
          >
            <p className="mb-3 text-right text-[11px] font-medium tracking-[0.2em] text-white/60 uppercase">
              Live — not a video. Try it →
            </p>
            <div className="group relative">
              <div className="h-[600px] max-h-[calc(100svh-13rem)]">
                <ProofConsole defaultGoal={DEMO_GOAL} />
              </div>

              {/* The loop, spelled in glass — pure ornament, Glamour-style */}
              <OrnamentChip className="top-16 -left-4" delay={1}>
                Live prices
              </OrnamentChip>
              <OrnamentChip className="top-1/2 -left-12" delay={1.2}>
                You approve
              </OrnamentChip>
              <OrnamentChip className="bottom-20 -left-6" delay={1.4}>
                Checked, always
              </OrnamentChip>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/** A floating glass label with a glowing dot, drifting outward on hover. */
function OrnamentChip({
  children,
  className,
  delay,
}: {
  children: ReactNode;
  className: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className={`pointer-events-none absolute z-10 hidden items-center gap-2.5 transition-transform duration-500 group-hover:-translate-x-3 xl:flex ${className}`}
      aria-hidden
    >
      <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs font-medium tracking-wide text-white backdrop-blur-md">
        {children}
      </span>
      <span className="size-2 shrink-0 rounded-full bg-white shadow-[0_0_10px_white]" />
      <span className="h-px w-10 bg-gradient-to-r from-white/80 to-transparent" />
    </motion.div>
  );
}
