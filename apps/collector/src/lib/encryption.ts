import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from the hex-encoded ENCRYPTION_KEY.
 */
function getKeyBuffer(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${buf.length} bytes.`
    );
  }
  return buf;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns format: iv:authTag:ciphertext (all hex encoded).
 */
export function encrypt(plaintext: string, hexKey: string): string {
  const key = getKeyBuffer(hexKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with encrypt().
 * Expects format: iv:authTag:ciphertext (all hex encoded).
 */
export function decrypt(encryptedString: string, hexKey: string): string {
  const key = getKeyBuffer(hexKey);
  const parts = encryptedString.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted string format. Expected iv:authTag:ciphertext"
    );
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
