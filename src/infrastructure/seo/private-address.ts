import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard, shared by every crawl adapter (HTTP and Playwright).
 *
 * Both adapters fetch URLs that arrive in a request body, which makes this the
 * one genuinely dangerous surface in the SEO feature: a caller who can name a
 * URL can otherwise make the server issue requests on its own behalf, and
 * `http://169.254.169.254/` is a cloud metadata endpoint, not a web page. A
 * headless browser is *worse* than a plain fetch — it will happily load
 * subresources and follow client-side redirects — so the same allowlist has to
 * gate every hop and every subresource, not just the first navigation.
 *
 * One module, one source of truth: if the HTTP adapter and the browser adapter
 * ever disagreed about what "private" means, the looser one would be the
 * exploitable one.
 */

/**
 * Address ranges that must never be reachable through a caller-supplied URL.
 * IPv4 is checked numerically; IPv6 by prefix, including the `::ffff:` mapped
 * form that would otherwise smuggle a v4 loopback past a v6 check.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    // IPv4-mapped (::ffff:10.0.0.1) — re-check the embedded v4 address.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(normalized)) return true; // unique local
    if (/^fe[89ab]/.test(normalized)) return true; // link-local
    if (normalized.startsWith("ff")) return true; // multicast
    return false;
  }

  // Not an IP literal at all — fail closed.
  return true;
}

/**
 * Resolve every address for a host and reject if ANY is non-public. A bare IP
 * in the URL skips DNS and is checked directly. A resolution failure is treated
 * as non-public — we never fetch a host we can't vet.
 */
export async function hostIsPublic(hostname: string): Promise<boolean> {
  if (isIP(hostname) !== 0) return !isPrivateAddress(hostname);
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** True when the scheme is one we are willing to fetch. */
export function isFetchableScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}
