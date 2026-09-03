import Link from 'next/link';
import type { Route } from 'next';
import type { RoomCollection } from '@/lib/staywell/catalog';

/**
 * Editorial room card: full-bleed image, gradient scrim, the name settling in
 * from the bottom on hover. The whole card links into the booking flow.
 */
export function RoomCard({ room, from = 'stays' }: { room: RoomCollection; from?: string }) {
  return (
    <Link
      href={`/${from}?room=${room.id}` as Route}
      aria-label={`${room.name} — ${room.eyebrow}. See this room.`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-[2rem] shadow-xl focus-visible:outline-2 focus-visible:outline-cobalt"
    >
      <img
        src={room.image}
        alt={room.imageAlt}
        loading="lazy"
        className="absolute inset-0 size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-70 transition-opacity duration-500 group-hover:opacity-90" />

      <div className="absolute top-4 left-4 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium tracking-wider text-white uppercase backdrop-blur-xl transition-colors duration-300 group-hover:bg-white group-hover:text-ink">
        {room.capacity}
      </div>

      <div className="absolute inset-x-6 bottom-6">
        <p className="text-xs font-medium tracking-[0.18em] text-white/70 uppercase">
          {room.eyebrow}
        </p>
        <div className="mt-1.5 font-display text-2xl tracking-tight text-white sm:text-3xl">
          {room.name}
        </div>
        <div className="h-0.5 w-0 bg-white transition-all duration-700 ease-out group-hover:w-full" aria-hidden />
        <p className="mt-3 text-sm text-white/80 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-within:opacity-100">
          {room.bed} · {room.size}
        </p>
      </div>
    </Link>
  );
}
