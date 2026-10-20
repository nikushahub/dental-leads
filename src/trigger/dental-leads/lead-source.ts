import { logger } from "@trigger.dev/sdk";
import type { City } from "./cities";

export type Practice = {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  mapUrl?: string;
};

export async function findPractices(city: City, source: string): Promise<Practice[]> {
  if (source === "mock") return mockPractices(city);
  if (source === "osm") return osmPractices(city);
  throw new Error(`Unknown LEAD_SOURCE "${source}" — use "mock" or "osm"`);
}

// ─── Mock source ─────────────────────────────────────────────────────────────
// Fake practices for testing. Websites are chosen so the real website check produces
// every outcome: no site, http-only (no HTTPS), unreachable, and a modern site.

const MOCK_TEMPLATES: Omit<Practice, "id" | "address">[] = [
  { name: "Smile Dental Clinic", phone: "+995 555 10 20 30" },
  { name: "Family Dentistry", phone: "+995 555 11 22 33" },
  { name: "White Tooth Studio", phone: "+995 555 12 34 56", website: "http://example.com" },
  { name: "DentaPlus", phone: "+995 555 98 76 54", website: "https://dentaplus-clinic.invalid" },
  { name: "Orthodontic Center" },
  { name: "Modern Dental Care", phone: "+995 555 77 88 99", website: "https://trigger.dev" },
  { name: "Dr. Beridze Dental Office" },
  { name: "Bright Smile Implants", website: "http://example.org" },
];

function mockPractices(city: City): Practice[] {
  logger.info(`Using MOCK data for ${city.name}`);
  return MOCK_TEMPLATES.map((t, i) => ({
    ...t,
    id: `mock-${city.name.toLowerCase()}-${i}`,
    name: `${t.name} ${city.name}`,
    address: `${10 + i * 7} Rustaveli St, ${city.name}, ${city.country}`,
  }));
}

// ─── OpenStreetMap via the Overpass API ──────────────────────────────────────
// Free, no API key. Usage policy: identify yourself with a User-Agent and keep volume low
// (this runs one query per week). Docs: https://wiki.openstreetmap.org/wiki/Overpass_API

// Public servers, tried in order — any of them can be busy at a given moment
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const SERVER_TIMEOUT_MS = 75_000;

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
};

async function osmPractices(city: City): Promise<Practice[]> {
  const around = `around:${city.radiusKm * 1000},${city.lat},${city.lon}`;
  const query = `[out:json][timeout:60];
(
  nwr["amenity"="dentist"](${around});
  nwr["healthcare"="dentist"](${around});
);
out tags;`;

  const elements = await queryOverpass(query);

  const practices: Practice[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags["name:en"] ?? tags.name;
    if (!name) continue; // an unnamed pin isn't a usable lead

    const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const website = tags.website ?? tags["contact:website"] ?? tags.url;

    practices.push({
      id: `${el.type}/${el.id}`,
      name,
      address: [street, city.name, city.country].filter(Boolean).join(", "),
      phone: tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"],
      // Many OSM entries omit the scheme ("www.clinic.ge"); http:// redirects to https if supported
      website: website && !/^https?:\/\//i.test(website) ? `http://${website}` : website,
      mapUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }

  logger.info(`OpenStreetMap returned ${practices.length} named practices in ${city.name}`, {
    withPhone: practices.filter((p) => p.phone).length,
    withWebsite: practices.filter((p) => p.website).length,
  });
  return practices;
}

async function queryOverpass(query: string): Promise<OsmElement[]> {
  const failures: string[] = [];

  for (const server of OVERPASS_SERVERS) {
    const host = new URL(server).host;
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "dental-leads/1.0 (Trigger.dev automation)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { elements } = (await res.json()) as { elements: OsmElement[] };
      logger.info(`Overpass query answered by ${host}`);
      return elements;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Overpass server ${host} failed (${reason}) — trying the next one`);
      failures.push(`${host}: ${reason}`);
    }
  }

  // Every server busy — throwing lets Trigger.dev retry the whole run later
  throw new Error(`All Overpass servers failed — ${failures.join("; ")}`);
}
