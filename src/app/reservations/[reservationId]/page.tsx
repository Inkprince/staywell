'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { StayWellNav } from '@/features/staywell/staywell-nav';
import { PAYMENT_METHODS } from '@/lib/staywell/world';
import { ROOM_COLLECTIONS, type RoomCollection } from '@/lib/staywell/catalog';

type Reservation = { id: string; guestName: string; guestCount: number; roomId: string; checkIn: string; nights: number; totalDollars: number; ratePlanId: string; status: string; payment?: { methodId: string; label: string; paidAt: string } | null; room: RoomCollection };

export default function ReservationPage({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = use(params);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editCheckIn, setEditCheckIn] = useState('2026-09-04');
  const [editNights, setEditNights] = useState(2);
  const [editRoomId, setEditRoomId] = useState('418');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const payForStay = useCallback(async (methodId: string) => {
    if (!reservation) return; setPaying(true); setPayError(null);
    try {
      const response = await fetch(`/api/reservations/${reservation.id}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ methodId }) });
      const body = await response.json() as { reservation?: Reservation; room?: RoomCollection; error?: string };
      if (!response.ok || !body.reservation || !body.room) throw new Error(body.error ?? 'the payment did not go through');
      setReservation({ ...body.reservation, room: body.room });
    } catch (cause) { setPayError(cause instanceof Error ? cause.message : 'the payment did not go through'); }
    finally { setPaying(false); }
  }, [reservation]);
  const load = useCallback(async () => {
    try { await fetch('/api/session'); const response = await fetch('/api/reservations'); const body = await response.json() as { reservations?: Reservation[]; error?: string }; if (!response.ok) throw new Error(body.error ?? 'could not load reservation'); const found = body.reservations?.find((item) => item.id === reservationId); if (!found) throw new Error('this reservation is not available in your current StayWell session'); setReservation(found); setEditCheckIn(found.checkIn); setEditNights(found.nights); setEditRoomId(found.roomId); } catch (cause) { setError(cause instanceof Error ? cause.message : 'could not load reservation'); }
  }, [reservationId]);
  useEffect(() => { void load(); }, [load]);
  const useProof = useCallback(() => {
    // Summons the global Proof console with its own ask box open — the guest
    // says what they want in their own words, no canned goal.
    window.dispatchEvent(new CustomEvent('proof:open'));
  }, []);
  const saveManualEdit = useCallback(async () => {
    if (!reservation) return;
    setSavingEdit(true);
    try {
      const response = await fetch(`/api/reservations/${reservation.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: editRoomId, checkIn: editCheckIn, nights: editNights }) });
      const body = await response.json() as { reservation?: Reservation; room?: RoomCollection; error?: string };
      if (!response.ok || !body.reservation || !body.room) throw new Error(body.error ?? 'could not update your stay');
      setReservation({ ...body.reservation, room: body.room });
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'could not update your stay'); }
    finally { setSavingEdit(false); }
  }, [reservation, editCheckIn, editNights, editRoomId]);
  if (!reservation) return <main className="min-h-dvh bg-canvas"><StayWellNav /><div className="mx-auto max-w-3xl px-6 pt-36 pb-24 text-ink-muted">{error ?? 'Loading your stay…'}</div></main>;
  const date = new Date(`${reservation.checkIn}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <main className="min-h-dvh bg-canvas"><StayWellNav />
    <section className="mx-auto max-w-6xl px-4 pt-32 pb-24 md:px-6 lg:pt-36"><Link href={'/reservations' as Route} className="text-sm text-ink-subtle hover:text-ink">← My stays</Link>
      <div className="mt-7 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]"><div><p className={`text-xs font-medium tracking-[0.18em] uppercase ${reservation.status === 'held' ? 'text-caution' : 'text-verified'}`}>{reservation.status === 'held' ? 'Held — payment pending' : 'Confirmed stay'}</p><h1 className="mt-3 font-display text-4xl leading-tight tracking-tight text-ink md:text-5xl">{reservation.room.name}</h1><p className="mt-4 text-lg text-ink-muted">{date} · {reservation.nights} nights · {reservation.guestName}</p><img src={reservation.room.image} alt={reservation.room.imageAlt} loading="lazy" className="mt-8 h-[420px] w-full rounded-[2.5rem] object-cover shadow-[0_20px_50px_-20px_rgba(25,26,28,0.15)]" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">{[['Room', `${reservation.room.size} · ${reservation.room.bed}`], ['Guests', `${reservation.guestCount} of ${reservation.room.maxGuests} guests`], ['Included', reservation.room.amenities[0]!]].map(([label, value]) => <div key={label} className="rounded-[2rem] border border-line bg-surface p-5"><p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{label}</p><p className="mt-2 text-sm text-ink">{value}</p></div>)}</div>
      </div>
      <aside className="self-start rounded-[2.5rem] border border-line bg-surface p-7 shadow-[0_20px_50px_-20px_rgba(25,26,28,0.12)]"><p className="text-xs font-medium tracking-[0.15em] text-ink-subtle uppercase">Reservation {reservation.id.replace('res_', '#')}</p><dl className="mt-6 space-y-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-ink-subtle">Room</dt><dd className="text-right text-ink">{reservation.room.name}<br />Room {reservation.roomId}</dd></div><div className="flex justify-between gap-4"><dt className="text-ink-subtle">Stay</dt><dd className="text-right text-ink">{date}<br />{reservation.nights} nights</dd></div><div className="flex justify-between gap-4 border-t border-line pt-4"><dt className="text-ink-subtle">Current total</dt><dd className="font-display text-2xl text-ink">${reservation.totalDollars}</dd></div></dl>
        {reservation.status === 'held' ? (
          <div className="mt-8 rounded-[2rem] border border-caution-line bg-caution-soft/70 p-5">
            <p className="font-medium text-ink">The room is yours — once it&apos;s paid.</p>
            <p className="mt-1 text-sm text-ink-muted">Pick a demo way to pay. Nothing real is charged.</p>
            <div className="mt-4 space-y-2">{PAYMENT_METHODS.map((method) => (
              <button key={method.id} onClick={() => void payForStay(method.id)} disabled={paying} className="flex w-full items-center justify-between gap-3 rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-50">
                <span>{method.label}</span><span className="text-xs text-ink-subtle">{paying ? 'Paying…' : method.detail}</span>
              </button>
            ))}</div>
            {payError ? <p role="alert" className="mt-3 text-sm text-mismatch">{payError}</p> : null}
          </div>
        ) : reservation.payment ? (
          <div className="mt-8 rounded-[2rem] border border-verified-line bg-verified-soft/60 p-5">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Payment</p>
            <p className="mt-2 text-sm text-ink">Paid with {reservation.payment.label}</p>
            <p className="mt-1 text-xs text-ink-subtle">Demo payment — no real charge. {new Date(reservation.payment.paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
          </div>
        ) : null}
        <div className="mt-8 rounded-[2rem] border border-line bg-sunken/60 p-5"><p className="font-medium text-ink">Making a simple change?</p><p className="mt-1 text-sm text-ink-muted">Choose it yourself and confirm it here.</p><button onClick={() => setEditing((current) => !current)} className="mt-4 w-full rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-sunken">{editing ? 'Cancel manual edit' : 'Edit stay yourself'}</button>
          {editing ? <div className="mt-4 space-y-3 border-t border-line pt-4"><label className="block text-xs font-medium text-ink-subtle">Check in<input type="date" value={editCheckIn} min="2026-09-01" max="2026-09-07" onChange={(event) => setEditCheckIn(event.target.value)} className="mt-1 w-full rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink" /></label><label className="block text-xs font-medium text-ink-subtle">Nights<select value={editNights} onChange={(event) => setEditNights(Number(event.target.value))} className="mt-1 w-full rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink">{[1,2,3,4].map((value) => <option key={value} value={value}>{value} night{value > 1 ? 's' : ''}</option>)}</select></label><label className="block text-xs font-medium text-ink-subtle">Room<select value={editRoomId} onChange={(event) => setEditRoomId(event.target.value)} className="mt-1 w-full rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink">{ROOM_COLLECTIONS.map((room) => <option key={room.id} value={room.roomIds[0]}>{room.name}</option>)}</select></label><button onClick={() => void saveManualEdit()} disabled={savingEdit} className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-white transition hover:scale-[1.02] disabled:opacity-50">{savingEdit ? 'Updating…' : 'Confirm change'}</button></div> : null}</div>
        <div className="mt-5 rounded-[2rem] border border-cobalt-line bg-cobalt-soft p-5"><p className="font-display text-2xl tracking-tight text-ink">Want a hand with this change?</p><p className="mt-2 text-sm leading-relaxed text-ink-muted">Tell Proof what you want in your own words. It prepares the change — you approve it, and StayWell checks what actually happened.</p><button onClick={useProof} className="mt-5 w-full rounded-full bg-cobalt px-4 py-3.5 text-sm font-medium text-white transition hover:scale-[1.02]">Ask Proof for help</button><p className="mt-3 text-xs text-ink-subtle">The agent can prepare a change. Only you can approve it.</p></div>
        <Link href={'/stays' as Route} className="mt-5 block rounded-full border border-line px-4 py-3.5 text-center text-sm font-medium text-ink hover:bg-sunken">Book another room</Link>
      </aside></div>
    </section></main>;
}
