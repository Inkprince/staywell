'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { StayWellNav } from '@/features/staywell/staywell-nav';
import type { RoomCollection } from '@/lib/staywell/catalog';

type Reservation = { id: string; guestName: string; guestCount: number; roomId: string; checkIn: string; nights: number; totalDollars: number; status: string; room: RoomCollection };

const STAYS = '/stays' as Route;

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      await fetch('/api/session');
      const response = await fetch('/api/reservations');
      const body = (await response.json()) as { reservations?: Reservation[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'could not load your stays');
      setReservations(body.reservations ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'could not load your stays'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="min-h-dvh bg-canvas"><StayWellNav />
    <section className="mx-auto max-w-5xl px-4 pt-32 pb-16 md:px-6 lg:pt-40"><p className="text-xs font-medium tracking-[0.18em] text-cobalt uppercase">Your itinerary</p><h1 className="mt-4 font-display text-4xl tracking-tight text-ink sm:text-5xl">Your stays, in one place.</h1><p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-muted">View the details, make a change, or bring Proof in when the details matter.</p>
      {error ? <p role="alert" className="mt-8 text-mismatch">{error}</p> : null}
      <div className="mt-10 space-y-5">{reservations.map((reservation) => <Link key={reservation.id} href={`/reservations/${reservation.id}` as Route} className="group grid overflow-hidden rounded-[2rem] border border-line bg-surface shadow-[0_12px_36px_rgba(25,26,28,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-xl md:grid-cols-[220px_1fr]">
        <img src={reservation.room.image} alt={reservation.room.imageAlt} loading="lazy" className="h-48 w-full object-cover md:h-full" />
        <div className="flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8"><div className="min-w-0"><p className={`text-xs font-medium tracking-[0.14em] uppercase ${reservation.status === 'held' ? 'text-caution' : 'text-ink-subtle'}`}>{reservation.status === 'held' ? 'Awaiting payment' : 'Confirmed'} · {reservation.id.replace('res_', '#')}</p><h2 className="mt-2 font-display text-3xl text-ink">{reservation.room.name}</h2><p className="mt-2 text-sm text-ink-muted">{new Date(`${reservation.checkIn}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'long' })} · {reservation.nights} nights · {reservation.guestCount} guests</p></div><div className="text-left md:text-right"><p className="font-display text-2xl text-ink">${reservation.totalDollars}</p><p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-cobalt">Manage stay <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:rotate-45" aria-hidden /></p></div></div>
      </Link>)}</div>
      {reservations.length === 0 && !error ? <div className="mt-10 rounded-[2.5rem] border border-line bg-surface p-10 text-center"><h2 className="font-display text-3xl text-ink">No stay planned yet.</h2><p className="mt-3 text-ink-muted">Find a room that feels right, then make it yours.</p><Link href={STAYS} className="mt-6 inline-block rounded-full bg-ink px-7 py-3.5 text-sm font-medium text-white transition hover:scale-[1.03]">Find a room</Link></div> : null}
    </section></main>;
}
