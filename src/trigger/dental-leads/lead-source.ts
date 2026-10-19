import { logger } from "@trigger.dev/sdk";
import type { City } from "./cities";

export type Practice = {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  mapsUrl?: string;
};

export async function findPractices(city: City, source: string): Promise<Practice[]> {
  if (source === "mock") return mockPractices(city);
  if (source === "google") return googlePractices(city);
  throw new Error(`Unknown LEAD_SOURCE "${source}" — use "mock" or "google"`);
}

// ─── Mock source ─────────────────────────────────────────────────────────────
// Fake practices for testing. Websites are chosen so the real website check produces
// every outcome: no site, http-only (no HTTPS), unreachable, and a modern site.

const MOCK_TEMPLATES: Omit<Practice, "id" | "address">[] = [
  { name: "Smile Dental Clinic", phone: "+995 555 10 20 30", rating: 4.8, reviewCount: 212 },
  { name: "Family Dentistry", phone: "+995 555 11 22 33", rating: 4.5, reviewCount: 87 },
  { name: "White Tooth Studio", phone: "+995 555 12 34 56", website: "http://example.com", rating: 4.6, reviewCount: 140 },
  { name: "DentaPlus", phone: "+995 555 98 76 54", website: "https://dentaplus-clinic.invalid", rating: 4.2, reviewCount: 45 },
  { name: "Orthodontic Center", phone: "+995 555 44 55 66", rating: 4.9, reviewCount: 301 },
  { name: "Modern Dental Care", phone: "+995 555 77 88 99", website: "https://trigger.dev", rating: 4.7, reviewCount: 98 },
  { name: "Dr. Beridze Dental Office", phone: "+995 555 21 43 65", rating: 4.3, reviewCount: 19 },
  { name: "Bright Smile Implants", phone: "+995 555 31 41 59", website: "http://example.org", rating: 4.4, reviewCount: 63 },
];

function mockPractices(city: City): Practice[] {
  logger.info(`Using MOCK data for ${city.name}`);
  return MOCK_TEMPLATES.map((t, i) => ({
    ...t,
    id: `mock-${city.name.toLowerCase()}-${i}`,
    name: `${t.name} ${city.name}`,
    address: `${10 + i * 7} Rustaveli St, ${city.name}, ${city.country}`,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${t.name} ${city.name}`)}`,
  }));
}

// ─── Google Places API (New) — Text Search ───────────────────────────────────
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

const MAX_PAGES = 3; // 20 results per page → up to 60 practices per city

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
};

async function googlePractices(city: City): Promise<Practice[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set (required when LEAD_SOURCE=google)");

  const practices: Practice[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `dentist in ${city.name}, ${city.country}`,
        regionCode: city.regionCode,
        languageCode: city.languageCode ?? "en",
        pageSize: 20,
        pageToken,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google Places search failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { places?: GooglePlace[]; nextPageToken?: string };
    for (const p of data.places ?? []) {
      practices.push({
        id: p.id,
        name: p.displayName?.text ?? "Unknown practice",
        address: p.formattedAddress ?? "",
        phone: p.internationalPhoneNumber,
        website: p.websiteUri,
        rating: p.rating,
        reviewCount: p.userRatingCount,
        mapsUrl: p.googleMapsUri,
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  logger.info(`Google Places returned ${practices.length} practices in ${city.name}`);
  return practices;
}
