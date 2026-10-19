import { logger } from "@trigger.dev/sdk";
import type { City } from "./cities";
import type { Practice } from "./lead-source";
import type { WebsiteVerdict } from "./website-check";

export type Lead = Practice & { verdict: WebsiteVerdict; score: number };

export type Email = { subject: string; text: string; html: string };

export function buildEmail(city: City, leads: Lead[]): Email {
  if (leads.length === 0) {
    const subject = `🦷 No new dental leads in ${city.name} this week`;
    const text = `Searched ${city.name}, ${city.country} — every practice found already has a good website.`;
    return { subject, text, html: `<p>${escape(text)}</p>` };
  }

  const subject = `🦷 ${leads.length} dental leads in ${city.name}`;

  const text = leads
    .map((l, i) =>
      [
        `${i + 1}. ${l.verdict.status === "none" ? "🔥" : "⚠️"} ${l.name}`,
        `   Why: ${l.verdict.reasons.join("; ")}`,
        `   Phone: ${l.phone ?? "—"}`,
        `   Address: ${l.address}`,
        `   Website: ${l.website ?? "none"}`,
        `   Rating: ${l.rating ?? "—"} (${l.reviewCount ?? 0} reviews)`,
        `   Maps: ${l.mapsUrl ?? "—"}`,
      ].join("\n"),
    )
    .join("\n\n");

  const rows = leads
    .map(
      (l) => `<tr>
  <td>${l.verdict.status === "none" ? "🔥" : "⚠️"} ${l.mapsUrl ? `<a href="${escape(l.mapsUrl)}">${escape(l.name)}</a>` : escape(l.name)}</td>
  <td>${escape(l.verdict.reasons.join("; "))}</td>
  <td>${escape(l.phone ?? "—")}</td>
  <td>${escape(l.address)}</td>
  <td>${l.website ? `<a href="${escape(l.website)}">${escape(l.website)}</a>` : "none"}</td>
  <td>${l.rating ?? "—"} (${l.reviewCount ?? 0})</td>
</tr>`,
    )
    .join("\n");

  const html = `<h2>${escape(subject)}</h2>
<p>🔥 = no website &nbsp; ⚠️ = weak website</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Practice</th><th>Why it's a lead</th><th>Phone</th><th>Address</th><th>Website</th><th>Rating</th></tr>
${rows}
</table>`;

  return { subject, text, html };
}

// Mock delivery: prints the email to the run logs. Swap for a real sender (e.g. Resend) later.
export async function sendEmail(email: Email): Promise<void> {
  logger.info(`📧 MOCK EMAIL — ${email.subject}\n\n${email.text}`, { html: email.html });
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
