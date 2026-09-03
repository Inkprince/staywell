'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const STAYS = '/stays' as Route;
const RESERVATIONS = '/reservations' as Route;
const AGENT_CHECK = '/agent-check' as Route;

const LINKS: { href: Route; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: STAYS, label: 'Rooms' },
  { href: RESERVATIONS, label: 'My stays' },
  { href: AGENT_CHECK, label: 'Agent-ready' },
];

/**
 * The demo guest chip: every session plays a named guest with a stay already
 * booked (the seeded reservation), so the demo starts one click sooner.
 */
function GuestChip({ inverse }: { inverse: boolean }) {
  const [guest, setGuest] = useState<{ name: string; demo: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/session')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { guest?: { name: string; demo: boolean } } | null) => {
        if (!cancelled && body?.guest) setGuest(body.guest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!guest) return null;
  const first = guest.name.split(' ')[0];

  return (
    <Link
      href={RESERVATIONS}
      title={`Signed in as ${guest.name} (demo)`}
      className={`hidden items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-sm transition-colors sm:flex ${
        inverse
          ? 'border-white/25 text-white/90 hover:bg-white/10'
          : 'border-line bg-surface text-ink-muted hover:text-ink'
      }`}
    >
      <span
        aria-hidden
        className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold ${
          inverse ? 'bg-white text-[#17352f]' : 'bg-cobalt-soft text-cobalt'
        }`}
      >
        {guest.name
          .split(' ')
          .map((part) => part[0])
          .slice(0, 2)
          .join('')}
      </span>
      <span className="font-medium">{first}</span>
      <span className={`text-xs ${inverse ? 'text-white/60' : 'text-ink-subtle'}`}>demo</span>
    </Link>
  );
}

/**
 * Fixed glass navigation. Over the dark hero it renders light-on-dark;
 * once the page scrolls (or the mobile menu opens) it settles into a
 * frosted panel with ink text, so it stays legible over any section.
 */
export function StayWellNav({ inverse = false }: { inverse?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const solid = scrolled || open;
  const overHero = inverse && !solid;

  const brand = overHero ? 'text-white' : 'text-ink';
  const sub = overHero ? 'text-white/60' : 'text-ink-subtle';
  const link = overHero
    ? 'text-white/80 hover:bg-white/15 hover:text-white'
    : 'text-ink-muted hover:bg-sunken hover:text-ink';
  const pill = solid
    ? 'border-line bg-surface/80 shadow-sm backdrop-blur-xl'
    : 'border-white/15 bg-white/10 backdrop-blur-2xl';

  return (
    <header className="fixed inset-x-0 top-0 z-50 p-4 md:p-6">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex max-w-[1800px] items-center justify-between gap-4"
      >
        <Link
          href="/"
          className={`min-w-0 rounded-3xl px-2 py-1 text-xl font-medium tracking-tighter md:text-2xl ${brand}`}
        >
          STAYWELL
          <span className={`block text-xs font-light tracking-normal md:text-sm ${sub}`}>
            City Retreat · East River
          </span>
        </Link>

        <div className={`hidden items-center gap-1 rounded-full p-1.5 lg:flex ${pill}`}>
          {LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${link}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <GuestChip inverse={overHero} />
          <Link
            href={STAYS}
            className={`group relative hidden overflow-hidden rounded-full py-2 pl-6 pr-2 text-sm font-medium transition-colors sm:flex ${
              overHero
                ? 'border border-white/25 text-white backdrop-blur-md hover:text-ink'
                : 'border border-line bg-surface text-ink shadow-sm hover:border-ink'
            }`}
          >
            <span className="relative z-10">Booking</span>
            <span
              className={`relative z-10 ml-3 rounded-full p-1.5 transition-colors ${
                overHero ? 'bg-white text-black group-hover:bg-black group-hover:text-white' : 'bg-ink text-white group-hover:bg-white group-hover:text-ink'
              }`}
            >
              <ArrowUpRight size={16} className="transition-transform duration-300 group-hover:rotate-45" aria-hidden />
            </span>
            <span className="absolute inset-0 translate-y-full bg-white transition-transform duration-500 ease-out group-hover:translate-y-0" aria-hidden />
          </Link>

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className={`flex size-11 items-center justify-center rounded-full border transition-colors lg:hidden ${
              overHero ? 'border-white/25 bg-white/10 text-white backdrop-blur-md' : 'border-line bg-surface/80 text-ink backdrop-blur-xl'
            }`}
          >
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="mobile-menu"
          className="mx-auto mt-3 max-w-[1800px] rounded-[2rem] border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur-2xl lg:hidden"
        >
          <div className="flex flex-col">
            {LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-2xl px-5 py-4 text-base font-medium text-ink transition-colors hover:bg-sunken"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={STAYS}
              onClick={() => setOpen(false)}
              className="mt-2 flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-base font-medium text-white"
            >
              Book a room
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
