import { logger } from "@trigger.dev/sdk";
import type { City } from "./cities";
import type { Practice } from "./lead-source";
import type { WebsiteVerdict } from "./website-check";

export type Lead = Practice & { verdict: WebsiteVerdict; score: number };

export type Email = { subject: string; text: string; html: string };

// OpenStreetMap is volunteer-maintained and often missing websites, so "no website" needs a check
const SOURCE_NOTE =
  "Source: OpenStreetMap. 'No website listed' means none is on the map — search the practice name quickly before calling.";

export function buildEmail(city: City, leads: Lead[]): Email {
  if (leads.length === 0) {
    const subject = `🦷 No new dental leads in ${city.name} this week`;
    const text = `Searched ${city.name}, ${city.country} — every practice found already has a good website.`;
    return { subject, text, html: `<p>${escape(text)}</p>` };
  }

  const subject = `🦷 ${leads.length} dental leads in ${city.name}`;

  const text = `${SOURCE_NOTE}\n\n` + leads
    .map((l, i) =>
      [
        `${i + 1}. ${l.verdict.status === "none" ? "🔥" : "⚠️"} ${l.name}`,
        `   Why: ${l.verdict.reasons.join("; ")}`,
        `   Phone: ${l.phone ?? "—"}`,
        `   Address: ${l.address}`,
        `   Website: ${l.website ?? "none listed"}`,
        `   Map: ${l.mapUrl ?? "—"}`,
      ].join("\n"),
    )
    .join("\n\n");

  const rows = leads
    .map(
      (l) => `<tr>
  <td>${l.verdict.status === "none" ? "🔥" : "⚠️"} ${l.mapUrl ? `<a href="${escape(l.mapUrl)}">${escape(l.name)}</a>` : escape(l.name)}</td>
  <td>${escape(l.verdict.reasons.join("; "))}</td>
  <td>${escape(l.phone ?? "—")}</td>
  <td>${escape(l.address)}</td>
  <td>${l.website ? `<a href="${escape(l.website)}">${escape(l.website)}</a>` : "none listed"}</td>
</tr>`,
    )
    .join("\n");

  const html = `<h2>${escape(subject)}</h2>
<p>🔥 = no website listed &nbsp; ⚠️ = weak website</p>
<p><em>${escape(SOURCE_NOTE)}</em></p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Practice</th><th>Why it's a lead</th><th>Phone</th><th>Address</th><th>Website</th></tr>
${rows}
</table>`;

  return { subject, text, html };
}

const EMAIL_TO = "nikagremelashvili@gmail.com";
// Resend's shared test sender — works without a domain, but can only deliver to the
// email address your Resend account was created with. Verify a domain in Resend to change it.
const EMAIL_FROM = "Dental Leads <onboarding@resend.dev>";

// Sends via Resend: https://resend.com/docs/api-reference/emails/send-email
// idempotencyKey stops a task retry from sending the same email twice (Resend keeps it 24h).
export async function sendEmail(email: Email, apiKey: string, idempotencyKey: string): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend failed to send email (${res.status}): ${await res.text()}`);
  }

  const { id } = (await res.json()) as { id: string };
  logger.info(`📧 Email sent — ${email.subject}`, { resendId: id });
  return id;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
