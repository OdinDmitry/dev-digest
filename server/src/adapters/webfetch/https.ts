import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { WebFetchClient, FetchTextResult } from '@devdigest/shared';

/**
 * SSRF-guarded anonymous HTTPS text fetcher — the ONLY file in the intent
 * feature that talks to `node:dns` / the network fetch API directly.
 *
 * The PR body is attacker-controlled input, so a URL like
 * `https://169.254.169.254/latest/meta-data/` or `https://10.0.0.5/` is
 * directly reachable unless every hop is validated. Guards (see plan risk 3):
 *   - HTTPS only (no http:, file:, ftp:, data:)
 *   - hostname resolves to a PUBLIC address only — no loopback / private /
 *     link-local / CGNAT / multicast / unspecified, IPv4 AND IPv6
 *   - at most 2 redirects, each hop re-validated from scratch
 *   - 5s timeout
 *   - 256 KB cap enforced while STREAMING (not just via Content-Length)
 *   - content-type must be text/* or application/json
 *   - no cookies, no auth headers, no request body (bare GET)
 *
 * Residual risk, documented and accepted (not closed): DNS rebinding between
 * the resolve-and-check here and the connect Node's fetch performs internally
 * — acceptable for a local-first single-user studio, not for a multi-tenant
 * deployment.
 */

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 2;
const ALLOWED_CONTENT_TYPES = [/^text\//, /^application\/json$/];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The address ranges a classifier-input fetch must never reach. Built on
 * Node's own `net.BlockList` (subnet/CIDR aware for both families, including
 * IPv4-mapped IPv6) rather than a hand-rolled CIDR check.
 */
const blockList = new BlockList();
// ---- IPv4 ----
blockList.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network
blockList.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blockList.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blockList.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blockList.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blockList.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local
blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
blockList.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blockList.addAddress('255.255.255.255', 'ipv4'); // broadcast
// ---- IPv6 ----
blockList.addAddress('::', 'ipv6'); // unspecified
blockList.addAddress('::1', 'ipv6'); // loopback
blockList.addSubnet('fe80::', 10, 'ipv6'); // link-local
blockList.addSubnet('fc00::', 7, 'ipv6'); // unique-local (private-like)
blockList.addSubnet('ff00::', 8, 'ipv6'); // multicast

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Pure predicate — unit-testable without a network. `ip` must be a bare
 * address (no brackets, no port). Returns `true` for anything NOT a public,
 * globally-routable unicast address (including unparsable input).
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIPv4(ip) ? 'ipv4' : isIPv6(ip) ? 'ipv6' : null;
  if (!family) return true;
  return blockList.check(ip, family);
}

/** Resolve `hostname` (or accept it directly if it's already a literal IP)
 *  and confirm EVERY returned address is public. */
async function resolveIsSafe(hostname: string): Promise<boolean> {
  const host = stripBrackets(hostname);
  if (isIP(host)) return !isBlockedAddress(host);
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;
  return addresses.every((a) => !isBlockedAddress(a.address));
}

function contentTypeAllowed(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.some((re) => re.test(base));
}

async function fetchOnce(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      credentials: 'omit',
      headers: { accept: 'text/plain, text/markdown, text/html, application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Read the body, enforcing the byte cap WHILE STREAMING (never buffers past it). */
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        const keep = MAX_BYTES - (total - value.byteLength);
        if (keep > 0) out += decoder.decode(value.subarray(0, keep));
        truncated = true;
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { text: out, truncated };
}

export class HttpsWebFetchClient implements WebFetchClient {
  async fetchText(rawUrl: string): Promise<FetchTextResult | null> {
    let current: URL;
    try {
      current = new URL(rawUrl);
    } catch {
      return null;
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== 'https:') return null;
      if (!(await resolveIsSafe(current.hostname))) return null;

      let res: Response;
      try {
        res = await fetchOnce(current);
      } catch {
        return null;
      }

      if (REDIRECT_STATUSES.has(res.status)) {
        if (hop === MAX_REDIRECTS) return null; // redirect budget exhausted
        const location = res.headers.get('location');
        if (!location) return null;
        try {
          current = new URL(location, current);
        } catch {
          return null;
        }
        continue;
      }

      if (!res.ok) return null;
      const contentType = res.headers.get('content-type');
      if (!contentTypeAllowed(contentType)) return null;

      const { text, truncated } = await readCapped(res);
      return { text, contentType: contentType ?? 'text/plain', truncated };
    }
    return null;
  }
}
