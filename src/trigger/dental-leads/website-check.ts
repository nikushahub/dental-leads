export type WebsiteVerdict = {
  status: "none" | "weak" | "good";
  reasons: string[];
};

const TIMEOUT_MS = 10_000;
const OUTDATED_AFTER_YEARS = 3;

// Free quality check: fetch the homepage and look for obvious signs it needs replacing.
export async function checkWebsite(url: string | undefined): Promise<WebsiteVerdict> {
  if (!url) return { status: "none", reasons: ["No website listed"] };

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinder/1.0)" },
    });
  } catch {
    return { status: "weak", reasons: ["Website doesn't load"] };
  }

  // 401/403/429 usually mean bot protection (e.g. Cloudflare) blocked our check, not a broken
  // site — skip rather than wrongly flag it
  if ([401, 403, 429].includes(res.status)) return { status: "good", reasons: [] };
  if (!res.ok) return { status: "weak", reasons: [`Website returns an error (${res.status})`] };

  const reasons: string[] = [];
  const html = await res.text().catch(() => "");

  if (res.url.startsWith("http:")) reasons.push("No HTTPS (shows 'Not secure' in browsers)");

  if (!/<meta[^>]+name=["']?viewport/i.test(html)) reasons.push("Not mobile-friendly");

  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(
    (m) => Number(m[1]),
  );
  if (years.length > 0) {
    const latest = Math.max(...years);
    if (latest < new Date().getFullYear() - OUTDATED_AFTER_YEARS) {
      reasons.push(`Looks outdated (© ${latest})`);
    }
  }

  return reasons.length > 0 ? { status: "weak", reasons } : { status: "good", reasons: [] };
}
