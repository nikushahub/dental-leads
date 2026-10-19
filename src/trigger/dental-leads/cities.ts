export type City = {
  name: string;
  country: string; // used in the search text, e.g. "dentist in Batumi, Georgia"
  regionCode: string; // ISO 3166-1 alpha-2, biases Google results to that country
  languageCode?: string; // language for returned names/addresses (default "en")
};

// The rotation — one city per week, in this order. Add any city in the world here.
export const CITIES: City[] = [
  { name: "Tbilisi", country: "Georgia", regionCode: "GE" },
  { name: "Batumi", country: "Georgia", regionCode: "GE" },
  { name: "Kutaisi", country: "Georgia", regionCode: "GE" },
  { name: "Rustavi", country: "Georgia", regionCode: "GE" },
  // { name: "Berlin", country: "Germany", regionCode: "DE" },
  // { name: "Austin, TX", country: "USA", regionCode: "US" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Weeks counted from a Monday, so every run within the same Mon–Sun week picks the same city.
export function cityForDate(date: Date): City {
  const weekNumber = Math.floor((date.getTime() + 3 * DAY_MS) / (7 * DAY_MS));
  return CITIES[weekNumber % CITIES.length];
}
