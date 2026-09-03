'use client';

import Image from 'next/image';
import { motion, type Variants } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight, Play } from 'lucide-react';
import { StayWellNav } from '@/features/staywell/staywell-nav';

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const STAYS = '/stays' as Route;
const RESERVATIONS = '/reservations' as Route;

/**
 * The tour video on YouTube. Set the id when it goes live; until then
 * the frame shows a poster.
 */
const VIDEO_ID = '';

/**
 * The hero: full-bleed and a full viewport tall, the headline earns the click
 * and the tour video beside it carries the story in three minutes. The live
 * chat is never far — one "Ask Proof" click away on every page.
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: 'easeOut' }}
            className="min-w-0"
          >
            <p className="mb-3 text-right text-[11px] font-medium tracking-[0.2em] text-white/60 uppercase">
              The whole loop — three minutes
            </p>
            <div className="relative aspect-video w-full overflow-hidden rounded-[2rem] border border-white/15 shadow-2xl">
              {VIDEO_ID ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`}
                  title="StayWell, with Proof — the three-minute tour"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 size-full"
                />
              ) : (
                <>
                  <Image
                    src="/images/photo-1521587760476-6c12a4b040da.jpg"
                    alt="The StayWell reading room, a quiet pause on the tour"
                    fill
                    sizes="(min-width: 1024px) 850px, 100vw"
                    className="object-cover brightness-[0.6]"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center">
                    <span className="flex size-16 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md">
                      <Play size={20} aria-hidden className="translate-x-0.5" />
                    </span>
                    <p className="text-xs font-medium tracking-[0.22em] text-white/75 uppercase">
                      The StayWell tour
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
