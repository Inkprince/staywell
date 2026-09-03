'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { Route } from 'next';
import { motion, MotionConfig, type Variants } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { Hero } from '@/features/staywell/hero';
import { RoomCard } from '@/features/staywell/room-card';
import { AvailabilityCalendar } from '@/features/staywell/availability-calendar';
import { Testimonials } from '@/features/staywell/testimonials';
import { ROOM_COLLECTIONS } from '@/lib/staywell/catalog';

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const STAYS = '/stays' as Route;
const RESERVATIONS = '/reservations' as Route;
const AGENT_CHECK = '/agent-check' as Route;

const FACILITIES = [
  {
    name: 'Garden breakfast',
    img: '/images/photo-1551882547-ff40c63fe5fa.jpg',
    alt: 'Relaxed hotel lounge with warm lighting and contemporary furniture',
  },
  {
    name: 'Reading room',
    img: '/images/photo-1521587760476-6c12a4b040da.jpg',
    alt: 'Quiet library-style reading room with shelves and soft seating',
  },
  {
    name: 'Soaking bathrooms',
    img: '/images/photo-1584622650111-993a426fbf0a.jpg',
    alt: 'Hotel bathroom with a deep soaking tub and warm finishes',
  },
  {
    name: 'River terrace',
    img: '/images/photo-1517248135467-4c7edcad34c4.jpg',
    alt: 'Hotel terrace lounge overlooking the water',
  },
  {
    name: 'Espresso bar',
    img: '/images/photo-1495474472287-4d71bcdd2085.jpg',
    alt: 'Coffee bar with fresh espresso being poured',
  },
];

export default function HomePage() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="w-full overflow-x-clip bg-canvas">
        <Hero />

        {/* Rooms + availability */}
        <section className="mx-auto w-full max-w-[1800px] px-4 py-24 md:px-12 md:py-32 lg:px-20">
          <div className="grid grid-cols-1 gap-16 xl:grid-cols-12 xl:gap-20">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={stagger}
              className="flex flex-col xl:col-span-7"
            >
              <div className="mb-16 grid grid-cols-1 gap-6 md:grid-cols-3">
                {ROOM_COLLECTIONS.slice(0, 3).map((room) => (
                  <motion.div key={room.id} variants={fadeInUp}>
                    <RoomCard room={room} />
                  </motion.div>
                ))}
              </div>

              <motion.div
                variants={fadeInUp}
                className="flex flex-col justify-between gap-10 rounded-[2.5rem] border border-line bg-surface p-8 shadow-xl md:flex-row md:items-end md:p-10"
              >
                <div>
                  <h2 className="max-w-xl font-display text-4xl leading-[1.05] tracking-tight text-ink md:text-5xl">
                    Choose the right room for your stay
                  </h2>
                  <p className="mt-5 max-w-md leading-relaxed text-ink-muted">
                    Every stay is priced from live availability — the room you see is the room you
                    can actually book.
                  </p>
                  <Link
                    href={STAYS}
                    className="group mt-8 inline-flex items-center gap-3 rounded-full border-2 border-ink py-2 pl-8 pr-2 text-sm font-semibold tracking-wider uppercase transition-all duration-300 hover:bg-ink hover:text-white"
                  >
                    Booking
                    <span className="rounded-full bg-ink p-2 text-white transition-colors group-hover:bg-white group-hover:text-ink">
                      <ArrowUpRight size={18} aria-hidden />
                    </span>
                  </Link>
                </div>
                <p className="text-sm text-ink-subtle md:text-right">
                  {ROOM_COLLECTIONS.length} room collections
                  <br />
                  25 rooms · 4 floors
                </p>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
              className="flex flex-col items-center xl:col-span-5 xl:items-end"
            >
              <div className="w-full xl:mt-4">
                <AvailabilityCalendar />
              </div>
            </motion.div>
          </div>
        </section>

        {/* Proof — the product story */}
        <section className="relative mx-auto w-full max-w-[1800px] px-4 py-12 md:px-12 lg:px-20">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[#18342f] text-white">
            <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-2 lg:items-center lg:gap-16 lg:p-16">
              <div className="relative h-[340px] w-full overflow-hidden rounded-[2rem] sm:h-[440px]">
                <Image
                  src="/images/photo-1551882547-ff40c63fe5fa.jpg"
                  alt="Relaxed hotel lounge with warm lighting and contemporary furniture"
                  fill
                  sizes="(min-width: 1024px) 700px, 100vw"
                  className="object-cover"
                />
              </div>
              <div>
                <p className="text-xs font-medium tracking-[0.18em] text-[#b9d1c4] uppercase">
                  A little help, when it matters
                </p>
                <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight md:text-5xl">
                  Meet Proof.
                </h2>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
                  Travel plans change. Proof lets you work with an agent on a reservation without
                  losing control of the details. It can compare rooms and prepare an option. You
                  approve it. Then StayWell checks what really happened.
                </p>
                <ul className="mt-7 space-y-3 text-sm text-white/85">
                  <li>✓ Your conditions stay visible</li>
                  <li>✓ You approve every important change</li>
                  <li>✓ StayWell checks the final room, date, and price</li>
                  <li>✓ Your own agent can use the same tools over WebMCP — and only those tools</li>
                </ul>
                <Link
                  href={RESERVATIONS}
                  className="mt-9 inline-block rounded-full bg-white px-7 py-3.5 text-sm font-medium text-[#18342f] transition hover:scale-[1.03]"
                >
                  See Proof in your stay
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Facilities */}
        <section className="mx-auto w-full max-w-[1800px] px-4 py-24 md:px-12 md:py-32 lg:px-20">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="mb-20 flex flex-col justify-between gap-8 md:flex-row md:items-end"
          >
            <motion.p variants={fadeInUp} className="max-w-sm text-lg leading-relaxed text-ink-muted">
              Unhurried mornings, honest pricing, and a stay you can change without a phone call.
            </motion.p>
            <motion.h2
              variants={fadeInUp}
              className="max-w-2xl font-display text-4xl leading-[1.05] tracking-tight text-ink md:text-right md:text-6xl"
            >
              Premier facilities and guest services
            </motion.h2>
          </motion.div>

          <div className="snap-x snap-mandatory gap-6 overflow-x-auto pb-2 [scrollbar-width:thin] md:flex md:flex-nowrap md:pb-4 xl:snap-none xl:gap-8 xl:overflow-visible xl:pb-0">
            {FACILITIES.map((facility, index) => (
              <FacilityCard key={facility.name} facility={facility} index={index} />
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="mt-16 flex justify-center md:mt-24"
          >
            <Link
              href={STAYS}
              className="rounded-full border-2 border-line-strong px-10 py-4 text-sm font-bold tracking-widest text-ink uppercase transition-all duration-300 hover:border-ink hover:bg-ink hover:text-white"
            >
              See it on your stay
            </Link>
          </motion.div>
        </section>

        {/* The neighbourhood */}
        <section className="mx-auto w-full max-w-[1800px] px-4 pb-24 md:px-12 md:pb-32 lg:px-20">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="mb-14 flex flex-col justify-between gap-10 md:flex-row md:items-end"
          >
            <motion.h2
              variants={fadeInUp}
              className="max-w-2xl font-display text-4xl leading-[1.05] tracking-tight text-ink md:text-6xl"
            >
              Experience the neighbourhood and the river
            </motion.h2>
            <motion.div
              variants={fadeInUp}
              className="max-w-md rounded-[2rem] border border-line bg-surface p-8 shadow-xl"
            >
              <p className="leading-relaxed text-ink-muted">
                The East River esplanade, two bridges, and a pocket park on every block — the room
                shapes the trip, and so does the walk out the door.
              </p>
              <Link
                href={AGENT_CHECK}
                className="group mt-8 inline-flex items-center gap-3 rounded-full border-2 border-ink py-2 pl-8 pr-2 text-sm font-bold tracking-wider uppercase transition-all duration-300 hover:bg-ink hover:text-white"
              >
                More info
                <span className="rounded-full bg-ink p-2 text-white transition-colors group-hover:bg-white group-hover:text-ink">
                  <ArrowUpRight size={18} aria-hidden />
                </span>
              </Link>
            </motion.div>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            <NeighbourhoodImage
              img="/images/photo-1552465011-b4e21bf6e79a.jpg"
              alt="Green terraces and hills outside the city"
              className="h-[340px] lg:h-[560px]"
            />
            <div className="flex flex-col gap-6 sm:col-span-2 lg:col-span-1 lg:gap-8">
              <NeighbourhoodImage
                img="/images/photo-1518548419970-58e3b4079ab2.jpg"
                alt="Riverside walk with the skyline behind it"
                className="h-[240px] lg:h-[260px]"
              />
              <NeighbourhoodImage
                img="/images/photo-1433086966358-54859d0ed716.jpg"
                alt="Water feature in the pocket garden"
                className="h-[240px] lg:h-[260px]"
              />
            </div>
            <NeighbourhoodImage
              img="/images/photo-1537996194471-e657df975ab4.jpg"
              alt="Sculpture garden a short walk from the hotel"
              className="h-[340px] sm:col-span-2 lg:col-span-1 lg:h-[560px]"
            />
          </div>
        </section>

        <Testimonials />

        <Footer />
      </main>
    </MotionConfig>
  );
}

function FacilityCard({
  facility,
  index,
}: {
  facility: (typeof FACILITIES)[number];
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, delay: index * 0.12, ease: 'easeOut' }}
      className="group relative w-full shrink-0 snap-center overflow-hidden rounded-[2.5rem] shadow-2xl md:w-[260px] xl:w-auto xl:flex-1"
    >
      <div className="relative h-[340px] xl:h-[440px] xl:transition-all xl:duration-500 xl:group-hover:h-[480px]">
        <Image
          src={facility.img}
          alt={facility.alt}
          fill
          sizes="(min-width: 1280px) 30vw, 260px"
          className="object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-8 text-center font-display text-2xl tracking-tight text-white transition-transform duration-500 group-hover:translate-y-0">
          {facility.name}
        </div>
      </div>
    </motion.div>
  );
}

function NeighbourhoodImage({
  img,
  alt,
  className,
}: {
  img: string;
  alt: string;
  className: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className={`group relative overflow-hidden rounded-[2.5rem] shadow-2xl ${className}`}
    >
      <Image src={img} alt={alt} fill sizes="(min-width: 1024px) 600px, 100vw" className="object-cover transition-transform duration-[2000ms] ease-out group-hover:scale-110" />
      <div className="absolute inset-0 bg-black/10 transition-colors duration-700 group-hover:bg-transparent" />
    </motion.div>
  );
}

function Footer() {
  return (
    <footer className="mx-auto w-full max-w-[1800px] border-t border-line bg-canvas px-4 py-20 md:px-12 md:py-24 lg:px-20">
      <div className="mb-20 grid grid-cols-1 gap-14 md:grid-cols-12">
        <div className="flex flex-col items-start md:col-span-5">
          <div className="text-2xl font-medium tracking-tighter text-ink md:text-3xl">
            STAYWELL
            <span className="mt-1 block text-base font-light tracking-normal text-ink-muted">
              City Retreat · East River
            </span>
          </div>
          <p className="mt-8 max-w-md leading-loose text-ink-muted">
            StayWell is a 25-room retreat on the East River in New York. Quiet rooms, generous
            mornings, and reservations you can change with confidence — with Proof looking after
            the details.
          </p>
          <Link
            href={STAYS}
            className="mt-8 border-b-2 border-ink pb-2 text-sm font-bold tracking-wider uppercase transition-colors hover:text-ink-muted hover:border-ink-muted"
          >
            Book a room
          </Link>
        </div>

        <div className="md:col-span-2">
          <h4 className="mb-7 text-sm font-bold tracking-widest text-ink uppercase">Stay</h4>
          <ul className="space-y-4 font-medium text-ink-muted">
            <li><Link href={STAYS} className="transition-colors hover:text-ink">Find a room</Link></li>
            <li><Link href={RESERVATIONS} className="transition-colors hover:text-ink">My stays</Link></li>
            <li><Link href={AGENT_CHECK} className="transition-colors hover:text-ink">Agent-ready</Link></li>
          </ul>
        </div>

        <div className="md:col-span-2">
          <h4 className="mb-7 text-sm font-bold tracking-widest text-ink uppercase">Proof</h4>
          <ul className="space-y-4 font-medium text-ink-muted">
            <li><Link href={RESERVATIONS} className="transition-colors hover:text-ink">How Proof works</Link></li>
            <li><Link href={AGENT_CHECK} className="transition-colors hover:text-ink">Run an agent check</Link></li>
            <li><Link href="/" className="transition-colors hover:text-ink">The guarantee</Link></li>
          </ul>
        </div>

        <div className="md:col-span-3">
          <h4 className="mb-7 text-sm font-bold tracking-widest text-ink uppercase">Visit</h4>
          <ul className="space-y-4 font-medium text-ink-muted">
            <li>East River, New York</li>
            <li>Check-in from 3 pm</li>
            <li>Checkout at 12 pm, unhurried</li>
          </ul>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 border-t border-line/70 pt-8 text-sm font-medium text-ink-subtle md:flex-row">
        <p>© {new Date().getFullYear()} StayWell. Hotel stays, with Proof.</p>
        <p className="tracking-wide">The best companion for your rest.</p>
      </div>
    </footer>
  );
}
