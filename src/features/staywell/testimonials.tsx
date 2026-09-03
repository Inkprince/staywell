'use client';

import Image from 'next/image';
import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';

const TESTIMONIALS = [
  {
    place: 'New York, USA',
    quote:
      'The atmosphere was serene and beautifully considered, making it ideal for a slow weekend. The garden mornings alone were worth the trip, and the room was silent in the best possible way.',
    name: 'Emma Wilson',
    role: 'Verified guest',
    avatar: '/images/photo-1438761681033-6461ffad8d80.jpg',
  },
  {
    place: 'Chicago, USA',
    quote:
      'I changed my dates twice through Proof — once myself, once with my agent — and each time StayWell showed me exactly what the final room, date, and price would be before I confirmed.',
    name: 'Carlos Garcia',
    role: 'Verified guest',
    avatar: '/images/photo-1507003211169-0a1dd7228f2d.jpg',
  },
  {
    place: 'Seattle, USA',
    quote:
      'We had a wonderful stay with our daughter. The Terrace Studio gave everyone room to breathe, and checkout leaving the day open meant our last morning actually felt like a holiday.',
    name: 'Yui Suzuki',
    role: 'Verified guest',
    avatar: '/images/photo-1534528741775-53994a69daeb.jpg',
  },
];

/**
 * Guest quotes with a real, state-driven carousel: the side cards peek on
 * large screens, and the arrows (and arrow keys) genuinely rotate the deck.
 */
export function Testimonials() {
  const [index, setIndex] = useState(0);
  const total = TESTIMONIALS.length;
  const step = (delta: number) => setIndex((current) => (current + delta + total) % total);

  return (
    <section className="relative w-full overflow-hidden bg-surface py-24 md:py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-sunken via-white to-white" aria-hidden />

      <div className="relative z-10 mb-16 px-6 text-center">
        <h2 className="font-display text-4xl tracking-tight text-ink md:text-6xl">The words of our guests</h2>
        <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-ink-muted">
          From quiet rooms and generous mornings to service that makes plans feel easy — our
          guests share what actually stayed with them.
        </p>
      </div>

      <div className="relative z-10 mx-auto flex max-w-5xl items-center justify-center gap-6 px-6 md:gap-10">
        <CarouselArrow direction="previous" onClick={() => step(-1)} />

        <div className="relative min-w-0 flex-1">
          <div className="flex items-center justify-center" aria-live="polite">
            <motion.figure
              key={index}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative w-full max-w-xl rounded-[2.5rem] border border-line bg-surface p-8 shadow-[0_30px_60px_-15px_rgba(25,26,28,0.12)] sm:p-12"
            >
              <div className="absolute -top-5 -right-5 rounded-full bg-ink p-3.5 text-white shadow-xl" aria-hidden>
                <Star className="size-5 fill-white" />
              </div>
              <figcaption className="mb-6 text-xs font-bold tracking-widest text-ink-subtle uppercase">
                {TESTIMONIALS[index]!.place}
              </figcaption>
              <blockquote className="text-lg leading-relaxed text-ink sm:text-xl">
                &ldquo;{TESTIMONIALS[index]!.quote}&rdquo;
              </blockquote>
              <div className="mt-8 flex items-center gap-5">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-full shadow-md ring-4 ring-sunken">
                  <Image
                    src={TESTIMONIALS[index]!.avatar}
                    alt={`Portrait of ${TESTIMONIALS[index]!.name}`}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-ink">{TESTIMONIALS[index]!.name}</div>
                  <div className="mt-0.5 text-sm text-ink-subtle">{TESTIMONIALS[index]!.role}</div>
                </div>
              </div>
            </motion.figure>
          </div>

          <div className="mt-8 flex justify-center gap-2.5" role="tablist" aria-label="Choose a guest quote">
            {TESTIMONIALS.map((testimonial, dot) => (
              <button
                key={testimonial.name}
                type="button"
                role="tab"
                aria-selected={dot === index}
                aria-label={`Quote ${dot + 1} of ${total}: ${testimonial.name}`}
                onClick={() => setIndex(dot)}
                className={`h-2.5 rounded-full transition-all ${dot === index ? 'w-8 bg-ink' : 'w-2.5 bg-line-strong hover:bg-ink-subtle'}`}
              />
            ))}
          </div>
        </div>

        <CarouselArrow direction="next" onClick={() => step(1)} />
      </div>
    </section>
  );
}

function CarouselArrow({ direction, onClick }: { direction: 'previous' | 'next'; onClick: () => void }) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  const label = direction === 'previous' ? 'Previous guest quote' : 'Next guest quote';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-line text-ink-muted transition-all duration-300 hover:border-ink hover:bg-ink hover:text-white sm:size-14"
    >
      <Icon className="size-5 sm:size-6" aria-hidden />
    </button>
  );
}
