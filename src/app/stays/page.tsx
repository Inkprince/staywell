'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { StayWellNav } from '@/features/staywell/staywell-nav';
import { PAYMENT_METHODS } from '@/lib/staywell/world';
import type { RoomCollection } from '@/lib/staywell/catalog';

type AvailabilityRoom = {
  roomId: string;
  available: boolean;
  reason: string | null;
  collection: RoomCollection;
  quote: { totalDollars: number; occupancy: number; tierLabel: string };
};

type Booking = {
  id: string;
  totalDollars: number;
  room: RoomCollection;
  guestName: string;
  status: string;
};

const DEFAULT_DATE = '2026-09-04';
/** Only dates the hotel sells in this build; anything else falls back to the default. */
const BOOKABLE_DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];

export default function StaysPage() {
  return <Suspense fallback={<StaysLoading />}><StaysContent /></Suspense>;
}

function StaysContent() {
  const searchParams = useSearchParams();
  const selectedCollectionId = searchParams.get('room');
  const [checkIn, setCheckIn] = useState(() => {
    const fromCalendar = searchParams.get('checkIn');
    return fromCalendar && BOOKABLE_DATES.includes(fromCalendar) ? fromCalendar : DEFAULT_DATE;
  });
  const [nights, setNights] = useState(2);
  const [guests, setGuests] = useState(2);
  const [guestName, setGuestName] = useState('Ada Lovelace');
  const [rooms, setRooms] = useState<AvailabilityRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<AvailabilityRoom | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await fetch('/api/session');
      const sessionBody = (await session.json()) as { guest?: { name?: string } };
      if (sessionBody.guest?.name) setGuestName((current) => (current ? current : sessionBody.guest!.name!));
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkIn, nights, guests }),
      });
      const body = (await response.json()) as { rooms?: AvailabilityRoom[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'could not check availability');
      setRooms(body.rooms ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not check availability');
    } finally {
      setBusy(false);
    }
  }, [checkIn, nights, guests]);

  useEffect(() => {
    void search();
  }, [search]);

  const choices = useMemo(() => {
    const grouped = new Map<string, AvailabilityRoom>();
    for (const room of rooms) {
      if (room.available && !grouped.has(room.collection.id)) grouped.set(room.collection.id, room);
    }
    return [...grouped.values()];
  }, [rooms]);

  const visibleChoices = useMemo(
    () => selectedCollectionId ? choices.filter((room) => room.collection.id === selectedCollectionId) : choices,
    [choices, selectedCollectionId],
  );

  useEffect(() => {
    if (selectedRoom && !choices.some((room) => room.roomId === selectedRoom.roomId)) {
      setSelectedRoom(null);
    }
  }, [choices, selectedRoom]);

  const chooseRoom = useCallback((room: AvailabilityRoom) => {
    setError(null);
    setSelectedRoom(room);
  }, []);

  const book = useCallback(async () => {
    if (!selectedRoom || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: selectedRoom.roomId,
          checkIn,
          nights,
          guestName,
          guestCount: guests,
        }),
      });
      const body = (await response.json()) as {
        reservation?: { id: string; totalDollars: number; status?: string };
        room?: RoomCollection;
        error?: string;
      };
      if (!response.ok || !body.reservation || !body.room) {
        throw new Error(body.error ?? 'could not complete booking');
      }
      setBooking({
        id: body.reservation.id,
        totalDollars: body.reservation.totalDollars,
        room: body.room,
        guestName,
        status: body.reservation.status ?? 'held',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not complete booking');
    } finally {
      setBusy(false);
    }
  }, [busy, checkIn, guestName, guests, nights, selectedRoom]);

  const pay = useCallback(async (methodId: string) => {
    if (!booking || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reservations/${booking.id}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ methodId }),
      });
      const body = (await response.json()) as { reservation?: { status?: string }; error?: string };
      if (!response.ok || !body.reservation) {
        throw new Error(body.error ?? 'the payment did not go through');
      }
      setBooking((current) => (current ? { ...current, status: body.reservation!.status ?? 'confirmed' } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the payment did not go through');
    } finally {
      setBusy(false);
    }
  }, [booking, busy]);

  const updateSearch = (update: () => void) => {
    setSelectedRoom(null);
    update();
  };

  if (booking) {
    if (booking.status === 'held') {
      return (
        <main className="min-h-dvh bg-canvas"><StayWellNav />
          <section className="mx-auto max-w-2xl px-6 pt-36 pb-24">
            <p className="text-xs font-medium tracking-[0.18em] text-cobalt uppercase">Your room is held</p>
            <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-ink sm:text-5xl">How would you like to pay{booking.guestName ? `, ${booking.guestName.split(' ')[0]}` : ''}?</h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-muted">{booking.room.name} · {nights} night{nights === 1 ? '' : 's'} · ${booking.totalDollars} total. Pick a way to pay and the stay is yours.</p>
            <div className="mt-9 grid gap-3">
              {PAYMENT_METHODS.map((method) => (
                <button key={method.id} type="button" onClick={() => void pay(method.id)} disabled={busy}
                  className="flex items-center justify-between gap-4 rounded-[2rem] border border-line bg-surface px-7 py-5 text-left shadow-[0_12px_36px_rgba(25,26,28,0.06)] transition hover:-translate-y-0.5 hover:border-ink disabled:cursor-not-allowed disabled:opacity-50">
                  <span><span className="block font-medium text-ink">{method.label}</span><span className="mt-1 block text-sm text-ink-subtle">{method.detail}</span></span>
                  <span className="text-sm font-medium text-cobalt">{busy ? '…' : 'Choose'}</span>
                </button>
              ))}
            </div>
            <p className="mt-6 text-xs text-ink-subtle">This is a demo checkout — no real card is charged, no real money moves.</p>
            {error ? <p role="alert" className="mt-4 text-sm text-mismatch">{error}</p> : null}
          </section>
        </main>
      );
    }
    return (
      <main className="min-h-dvh bg-canvas"><StayWellNav />
        <section className="mx-auto max-w-2xl px-6 pt-36 pb-24 text-center">
          <p className="text-xs font-medium tracking-[0.18em] text-verified uppercase">Reservation confirmed</p>
          <h1 className="mt-4 font-display text-5xl text-ink">Your stay is waiting.</h1>
          <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">{booking.room.name} is confirmed for {guests} guest{guests === 1 ? '' : 's'}. Your total is ${booking.totalDollars}.</p>
          <Link href={`/reservations/${booking.id}` as Route} className="mt-9 inline-block rounded-full bg-ink px-8 py-3.5 text-sm font-medium text-white transition hover:scale-[1.03]">View your reservation</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-canvas"><StayWellNav />
      <section className="mx-auto max-w-[1800px] px-4 pt-32 pb-10 md:px-12 lg:px-20 lg:pt-40">
        <p className="text-xs font-medium tracking-[0.18em] text-cobalt uppercase">Make yourself at home</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.02] tracking-tight text-ink sm:text-6xl">A room for how you want to spend your time.</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">Every StayWell room has its own view, pace, and reason to stay a little longer.</p>

        <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="mt-10 grid gap-3 rounded-[2rem] border border-line bg-surface/90 p-4 shadow-[0_20px_50px_-20px_rgba(25,26,28,0.15)] backdrop-blur-xl md:grid-cols-[1fr_0.6fr_0.6fr_auto]">
          <Field label="Check in"><input type="date" value={checkIn} min="2026-09-01" max="2026-09-07" onChange={(event) => updateSearch(() => setCheckIn(event.target.value))} className="w-full bg-transparent text-sm text-ink outline-none" /></Field>
          <Field label="Nights"><select value={nights} onChange={(event) => updateSearch(() => setNights(Number(event.target.value)))} className="w-full bg-transparent text-sm text-ink outline-none">{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} night{value > 1 ? 's' : ''}</option>)}</select></Field>
          <Field label="Guests"><select value={guests} onChange={(event) => updateSearch(() => setGuests(Number(event.target.value)))} className="w-full bg-transparent text-sm text-ink outline-none">{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} guest{value > 1 ? 's' : ''}</option>)}</select></Field>
          <button disabled={busy} className="rounded-full bg-ink px-7 py-3.5 text-sm font-medium text-white transition hover:scale-[1.02] disabled:opacity-50">{busy ? 'Checking…' : 'Check rooms'}</button>
        </form>
        {error ? <p role="alert" className="mt-4 text-sm text-mismatch">{error}</p> : null}
      </section>

      <section className="mx-auto max-w-[1800px] px-4 pb-24 md:px-12 lg:px-20">
        {selectedRoom ? <BookingReview room={selectedRoom} guestName={guestName} setGuestName={setGuestName} guests={guests} nights={nights} busy={busy} onBack={() => setSelectedRoom(null)} onConfirm={() => void book()} /> : null}
        <div className="mb-7 flex flex-wrap items-baseline justify-between gap-3"><div><h2 className="font-display text-3xl text-ink">{selectedCollectionId ? 'This room, for your stay' : 'Available for your stay'}</h2>{selectedCollectionId ? <Link href={'/stays' as Route} className="mt-1 inline-block text-sm text-cobalt hover:text-cobalt-hover">Show every room</Link> : null}</div><p className="text-sm text-ink-subtle">{guests} guests · {nights} nights</p></div>
        <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
          {visibleChoices.map((room) => <article key={room.collection.id} className="overflow-hidden rounded-[2rem] border border-line bg-surface shadow-[0_20px_50px_-20px_rgba(25,26,28,0.12)]">
            <img src={room.collection.image} alt={room.collection.imageAlt} loading="lazy" className="h-60 w-full object-cover" />
            <div className="p-6 sm:p-8"><p className="text-xs font-medium tracking-[0.15em] text-ink-subtle uppercase">{room.collection.eyebrow}</p><h2 className="mt-2 font-display text-3xl text-ink">{room.collection.name}</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">{room.collection.description}</p>
              <div className="mt-5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-subtle"><span>{room.collection.capacity}</span><span>{room.collection.bed}</span><span>{room.collection.size}</span></div>
              <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5"><div><p className="text-xs text-ink-subtle">Total for {nights} nights</p><p className="mt-1 font-display text-2xl text-ink">${room.quote.totalDollars}</p><p className="text-xs text-ink-subtle">{room.quote.tierLabel} demand</p></div><button onClick={() => chooseRoom(room)} disabled={busy} className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:scale-[1.02] disabled:opacity-50">Review stay</button></div>
            </div></article>)}
        </div>
        {!busy && visibleChoices.length === 0 && !error ? <p className="rounded-[2rem] border border-line bg-surface p-8 text-ink-muted">No rooms fit those dates and guest count. Try another stay.</p> : null}
      </section>
    </main>
  );
}

function BookingReview({ room, guestName, setGuestName, guests, nights, busy, onBack, onConfirm }: { room: AvailabilityRoom; guestName: string; setGuestName: (value: string) => void; guests: number; nights: number; busy: boolean; onBack: () => void; onConfirm: () => void }) {
  return <section className="mb-10 grid gap-6 rounded-[2.5rem] border border-cobalt-line bg-cobalt-soft/60 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="text-xs font-medium tracking-[0.16em] text-cobalt uppercase">Review your stay</p><h2 className="mt-2 font-display text-3xl text-ink">{room.collection.name}</h2><p className="mt-2 text-sm text-ink-muted">{guests} guest{guests === 1 ? '' : 's'} · {nights} night{nights === 1 ? '' : 's'} · ${room.quote.totalDollars} total</p><label className="mt-5 block max-w-md text-xs font-medium tracking-wide text-ink-subtle uppercase">Lead guest<input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={80} className="mt-2 w-full rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-cobalt" /></label><p className="mt-3 text-xs text-ink-subtle">This is a live quote. If the hotel changes the price before confirmation, we will show the confirmed total in your itinerary.</p></div><div className="flex flex-wrap gap-3"><button type="button" onClick={onBack} disabled={busy} className="rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium text-ink hover:bg-sunken disabled:opacity-50">Back</button><button type="button" onClick={onConfirm} disabled={busy || guestName.trim().length < 2} className="rounded-full bg-cobalt px-6 py-3 text-sm font-medium text-white transition hover:scale-[1.02] disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm booking'}</button></div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="rounded-2xl bg-sunken px-4 py-2.5"><span className="block text-[11px] font-medium tracking-wide text-ink-subtle uppercase">{label}</span>{children}</label>;
}

function StaysLoading() {
  return <main className="min-h-dvh bg-canvas"><StayWellNav /><div className="mx-auto max-w-[1800px] px-6 pt-36 pb-24 text-ink-muted">Loading rooms…</div></main>;
}
