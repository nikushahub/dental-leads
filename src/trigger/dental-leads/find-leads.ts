import { logger, schedules } from "@trigger.dev/sdk";
import { cityForDate } from "./cities";
import { buildEmail, sendEmail, type Lead } from "./email";
import { findPractices } from "./lead-source";
import { checkWebsite } from "./website-check";

const MAX_LEADS = 20;
const CHECKS_AT_ONCE = 10; // how many websites to check in parallel

export const findDentalLeads = schedules.task({
  id: "find-dental-leads",
  cron: {
    pattern: "0 8 * * 1", // every Monday at 8:00
    timezone: "Asia/Tbilisi",
  },
  run: async (payload) => {
    const source = process.env.LEAD_SOURCE;
    if (!source) throw new Error("LEAD_SOURCE is not set (use \"mock\" or \"google\")");

    // new Date() also handles test runs, where the timestamp arrives as an ISO string
    const city = cityForDate(new Date(payload.timestamp));
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

    // Hottest first; among equals, busier practices (more reviews) are better prospects
    leads.sort((a, b) => b.score - a.score || (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    const top = leads.slice(0, MAX_LEADS);

    await sendEmail(buildEmail(city, top));

    return {
      city: city.name,
      practicesFound: practices.length,
      qualifiedLeads: leads.length,
      sent: top.length,
      noWebsite: top.filter((l) => l.verdict.status === "none").length,
      weakWebsite: top.filter((l) => l.verdict.status === "weak").length,
    };
  },
});
