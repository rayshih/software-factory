/** Decode GITHUB_APP_PRIVATE_KEY_B64 into a PEM string. Never log the result. */
export function decodePrivateKeyB64(value: string): string {
  const pem = Buffer.from(value, "base64").toString("utf8");
  if (!pem.includes("PRIVATE KEY")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY_B64 did not decode to a PEM private key");
  }
  return pem;
}
