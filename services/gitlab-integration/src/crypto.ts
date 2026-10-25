import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encrypt/decrypt GitLab tokens at rest (AES-256-GCM).
 * Tokens are never sent to AI agents; callers must use `redactToken` before
 * building any AI-facing context.
 */
export class TokenVault {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error("CREDENTIAL_KEY_BASE64 must decode to exactly 32 bytes");
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc.v1.${Buffer.concat([iv, tag, enc]).toString("base64")}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith("enc.v1.")) throw new Error("Unrecognized ciphertext format");
    const raw = Buffer.from(ciphertext.slice("enc.v1.".length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}

/** Strip token material from any string before it reaches logs or AI context. */
export function redactToken(text: string): string {
  return text
    .replace(/glpat-[A-Za-z0-9_\-]{10,}/g, "glpat-***")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer ***")
    .replace(/PRIVATE-TOKEN:\s*\S+/gi, "PRIVATE-TOKEN: ***");
}

/** Hash for storing API keys (sha256). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Constant-time string comparison for webhook secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
