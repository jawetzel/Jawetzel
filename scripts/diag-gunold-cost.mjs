// Diagnostic: replicate pullGunnold's two-step (token scrape -> itemextend API)
// and report which price/cost fields the live response still contains.
// Throwaway — safe to delete.

const PAGE_URL = "https://www.gunold.com/mx/polyester-embroidery-thread-40/";
const API_URL =
  "https://gunoldusa.itemextend.com/api/search/?format=json&rc=10000&fs=2&o=_score";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

const COST_FIELDS = ["list_price", "last_cost", "average_cost", "standard_cost"];

async function main() {
  // Step 1: scrape ix_token.
  const pageRes = await fetch(PAGE_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  console.log(`page: ${pageRes.status} ${pageRes.statusText}`);
  if (!pageRes.ok) return;
  const html = await pageRes.text();

  const block = html.match(/var\s+ix_token\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!block) {
    console.log("ix_token block NOT FOUND on page (scrape broke)");
    return;
  }
  const tokenMatch = block[1].match(/"access_token"\s*:\s*"([^"]+)"/);
  if (!tokenMatch) {
    console.log("access_token NOT FOUND in ix_token block");
    console.log("ix_token block contents:\n", block[1].slice(0, 500));
    return;
  }
  const accessToken = tokenMatch[1];
  console.log(`access_token: present (len ${accessToken.length})`);

  // Step 2: call the search API.
  const apiRes = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  console.log(`api: ${apiRes.status} ${apiRes.statusText}`);
  if (!apiRes.ok) {
    console.log(await apiRes.text());
    return;
  }
  const payload = await apiRes.json();
  const results = payload.results ?? [];
  console.log(`results_total: ${payload.results_total}, results: ${results.length}`);

  if (results.length === 0) return;

  // Field-presence counts across the whole result set.
  const counts = {};
  for (const f of COST_FIELDS) counts[f] = { present: 0, nonNull: 0 };
  for (const hit of results) {
    const s = hit._source ?? {};
    for (const f of COST_FIELDS) {
      if (f in s) {
        counts[f].present += 1;
        if (s[f] !== null && s[f] !== undefined) counts[f].nonNull += 1;
      }
    }
  }
  console.log("\nField presence across all", results.length, "items:");
  for (const f of COST_FIELDS) {
    console.log(
      `  ${f.padEnd(16)} present in ${String(counts[f].present).padStart(5)}  non-null ${String(counts[f].nonNull).padStart(5)}`,
    );
  }

  // Show the full key list + a sample item so we can see if cost was renamed.
  const sample = results[0]._source ?? {};
  console.log("\nFirst item keys:\n", Object.keys(sample).sort().join(", "));
  console.log("\nFirst item price/cost-ish fields:");
  for (const [k, v] of Object.entries(sample)) {
    if (/cost|price|msrp|wholesale|dealer/i.test(k)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
}

main().catch((e) => console.error("FAILED:", e));
