/**
 * The guest-facing identity for StayWell's inventory.
 *
 * `world.ts` deliberately models rooms as small, priceable units. This file
 * gives those units a useful hotel vocabulary without creating a second source
 * of availability or price truth.
 */

export interface RoomCollection {
  id: string;
  name: string;
  eyebrow: string;
  roomIds: readonly string[];
  capacity: string;
  maxGuests: number;
  bed: string;
  size: string;
  description: string;
  amenities: readonly string[];
  image: string;
  imageAlt: string;
}

export const ROOM_COLLECTIONS: readonly RoomCollection[] = [
  {
    id: 'garden-king',
    name: 'Garden King',
    eyebrow: 'The quiet edge of the house',
    roomIds: ['401', '402', '403', '404', '405'],
    capacity: '2 guests',
    maxGuests: 2,
    bed: 'One king bed',
    size: '34 m²',
    description: 'A calm room opening onto a pocket garden, with linen textures and slow mornings in mind.',
    amenities: ['Garden outlook', 'Rain shower', 'Breakfast for two'],
    image: '/images/photo-1600210492486-724fe5c67fb0.jpg',
    imageAlt: 'Warm, sunlit hotel bedroom with a large bed and soft neutral furnishings',
  },
  {
    id: 'city-king',
    name: 'City View King',
    eyebrow: 'A little higher up',
    roomIds: ['406', '407', '408', '409', '410'],
    capacity: '2 guests',
    maxGuests: 2,
    bed: 'One king bed',
    size: '38 m²',
    description: 'A generous city-facing room with a deep window seat and a place to settle after a long day out.',
    amenities: ['City outlook', 'Window lounge', 'Espresso service'],
    image: '/images/photo-1590490360182-c33d57733427.jpg',
    imageAlt: 'Elegant hotel room with a large bed and a view through tall windows',
  },
  {
    id: 'terrace-studio',
    name: 'Terrace Studio',
    eyebrow: 'Room to breathe',
    roomIds: ['411', '412', '413', '414', '415'],
    capacity: '2 guests',
    maxGuests: 2,
    bed: 'One king bed',
    size: '45 m²',
    description: 'An airy studio with a private terrace, a reading chair, and enough room to make a weekend feel unhurried.',
    amenities: ['Private terrace', 'Soaking tub', 'Morning yoga mat'],
    image: '/images/photo-1591088398332-8a7791972843.jpg',
    imageAlt: 'Spacious hotel room with a bed, armchair, and contemporary warm interior',
  },
  {
    id: 'river-suite',
    name: 'River Suite',
    eyebrow: 'The long-view stay',
    roomIds: ['416', '417', '418', '419', '420'],
    capacity: '3 guests',
    maxGuests: 3,
    bed: 'One king bed + daybed',
    size: '58 m²',
    description: 'A proper suite with a separate living space and East River views that make an ordinary stay feel like an escape.',
    amenities: ['River outlook', 'Separate lounge', 'Evening aperitif'],
    image: '/images/photo-1582719478250-c89cae4dc85b.jpg',
    imageAlt: 'Luxury hotel suite with a lounge area and water-facing windows',
  },
  {
    id: 'penthouse-residence',
    name: 'Penthouse Residence',
    eyebrow: 'Stay a little longer',
    roomIds: ['421', '422', '423', '424', '425'],
    capacity: '4 guests',
    maxGuests: 4,
    bed: 'Two king bedrooms',
    size: '92 m²',
    description: 'A two-bedroom residence for shared stays, with a dining table, a generous lounge, and space to disappear into.',
    amenities: ['Two bedrooms', 'Dining for six', 'Private host'],
    image: '/images/photo-1618221195710-dd6b41faaea6.jpg',
    imageAlt: 'Large luxury hotel living room with a sofa, dining table, and refined interior',
  },
] as const;

export function collectionForRoom(roomId: string): RoomCollection {
  return (
    ROOM_COLLECTIONS.find((collection) => collection.roomIds.includes(roomId)) ?? ROOM_COLLECTIONS[0]!
  );
}

export function lowestRoomId(collection: RoomCollection): string {
  return collection.roomIds[0]!;
}

/** The one capacity rule used by search, booking, and reservation changes. */
export function maxGuestsForRoom(roomId: string): number {
  return collectionForRoom(roomId).maxGuests;
}
