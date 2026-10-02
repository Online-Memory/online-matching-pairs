import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE = "omp_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function sign(id: string, secret: string) {
  return createHmac("sha256", secret).update(`guest:${id}`).digest("base64url");
}

/** `<id>.<hmac>`: the id is random, the HMAC stops anyone from minting or borrowing an identity. */
export function issueGuestToken(secret: string): { id: string; token: string } {
  const id = randomBytes(16).toString("base64url");
  return { id, token: `${id}.${sign(id, secret)}` };
}

export function verifyGuestToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const [id, mac, ...rest] = token.split(".");
  if (!id || !mac || rest.length > 0 || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}
