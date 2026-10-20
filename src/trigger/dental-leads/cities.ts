export type City = {
  name: string;
  country: string;
  // Search circle — practices within radiusKm of this point. Find coordinates by
  // right-clicking the city centre on openstreetmap.org → "Show address".
  lat: number;
  lon: number;
  radiusKm: number;
};

// The rotation — one city per week, in this order. Add any city in the world here.
export const CITIES: City[] = [
  { name: "Tbilisi", country: "Georgia", lat: 41.7151, lon: 44.8271, radiusKm: 12 },
  { name: "Batumi", country: "Georgia", lat: 41.6168, lon: 41.6367, radiusKm: 8 },
  { name: "Kutaisi", country: "Georgia", lat: 42.2679, lon: 42.6946, radiusKm: 6 },
  { name: "Rustavi", country: "Georgia", lat: 41.5495, lon: 44.9932, radiusKm: 6 },
  // { name: "Berlin", country: "Germany", lat: 52.52, lon: 13.405, radiusKm: 15 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Weeks counted from a Monday, so every run within the same Mon–Sun week picks the same city.
export function cityForDate(date: Date): City {
  const weekNumber = Math.floor((date.getTime() + 3 * DAY_MS) / (7 * DAY_MS));
  return CITIES[weekNumber % CITIES.length];
}
