// Secrets the server hands out (a room's invite token, the owner secret) and how it compares what comes back.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A new URL-safe secret from the system's random source: 24 bytes (192 bits) unless told otherwise. */
export const newSecret = (bytes = 24): string => randomBytes(bytes).toString("base64url");

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** A secret's SHA-256, as hex: what a table of secrets is keyed by, so looking one up does not compare the secret itself. */
export const fingerprint = (secret: string): string => digest(secret).toString("hex");

/**
 * Whether `given` is the secret `expected`, in time that does not depend on where they differ or on their
 * lengths: both are hashed first, so the comparison always runs over 32 bytes. Anything that is not a
 * non-empty string is not the secret.
 */
export function safeEqual(given: unknown, expected: string): boolean {
  const ok = typeof given === "string" && given.length > 0 && expected.length > 0;
  // compare something even when the answer is already no
  const same = timingSafeEqual(digest(ok ? given : ""), digest(expected));
  return ok && same;
}
