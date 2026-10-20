import { logger, schedules } from "@trigger.dev/sdk";
import { cityForDate } from "./cities";
import { buildEmail, sendEmail, type Lead } from "./email";
import { findPractices } from "./lead-source";
import { checkWebsite } from "./website-check";

const MAX_LEADS = 20;
// Slots kept for practices with a real but weak website — verified leads, unlike
// "no website listed", which is often just missing from OpenStreetMap
const WEAK_SITE_SLOTS = 10;
const CHECKS_AT_ONCE = 10; // how many websites to check in parallel

export const findDentalLeads = schedules.task({
  id: "find-dental-leads",
  cron: {
    pattern: "0 8 * * 1", // every Monday at 8:00
    timezone: "Asia/Tbilisi",
  },
  // Public map servers can be busy for a while — space retries out over ~15 minutes
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 8 * 60_000,
  },
  maxDuration: 600, // up to 3 servers × 75s, plus website checks
  run: async (payload) => {
    const source = process.env.LEAD_SOURCE;
    if (!source) throw new Error("LEAD_SOURCE is not set (use \"osm\" or \"mock\")");
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) throw new Error("RESEND_API_KEY is not set");

    // new Date() also handles test runs, where the timestamp arrives as an ISO string
    const runDate = new Date(payload.timestamp);
    const city = cityForDate(runDate);
    logger.info(`This week's city: ${city.name}, ${city.country}`);

    const practices = await findPractices(city, source);

    const leads: Lead[] = [];
    for (let i = 0; i < practices.length; i += CHECKS_AT_ONCE) {
      const chunk = practices.slice(i, i + CHECKS_AT_ONCE);
      const verdicts = await Promise.all(chunk.map((p) => checkWebsite(p.website)));
      chunk.forEach((p, j) => {
        const verdict = verdicts[j];
        if (verdict.status === "good") return;
        const score = verdict.status === "none" ? 100 : 50 + 10 * verdict.reasons.length;
        leads.push({ ...p, verdict, score });
      });
    }

    // Within each group: practices with a phone number first (they can be called), then
    // the most website problems first
    const byPriority = (a: Lead, b: Lead) =>
      Number(!!b.phone) - Number(!!a.phone) || b.score - a.score;
    const weak = leads.filter((l) => l.verdict.status === "weak").sort(byPriority);
    const none = leads.filter((l) => l.verdict.status === "none").sort(byPriority);

    // Up to WEAK_SITE_SLOTS weak-site leads; any unused slots go to no-website leads, and
    // vice versa if there aren't enough no-website leads
    const weakPicked = weak.slice(0, Math.max(WEAK_SITE_SLOTS, MAX_LEADS - none.length));
    const nonePicked = none.slice(0, MAX_LEADS - weakPicked.length);
    const top = [...weakPicked, ...nonePicked];

    const emailId = await sendEmail(
      buildEmail(city, top),
      resendApiKey,
      `dental-leads-${city.name}-${runDate.toISOString()}`,
    );

    return {
      city: city.name,
      practicesFound: practices.length,
      qualifiedLeads: leads.length,
      sent: top.length,
      noWebsite: top.filter((l) => l.verdict.status === "none").length,
      weakWebsite: top.filter((l) => l.verdict.status === "weak").length,
      emailId,
    };
  },
});
