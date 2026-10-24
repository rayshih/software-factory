import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify a GitHub `X-Hub-Signature-256` header against the raw request body. */
export function verifyGithubSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const actualHex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(actualHex)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(actualHex, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function signGithubBody(payload: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
