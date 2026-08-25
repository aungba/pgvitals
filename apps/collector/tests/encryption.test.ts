import { describe, it, expect } from "vitest";
import { encrypt, decrypt, LocalAesGcmKeyProvider } from "../src/lib/encryption.js";
import crypto from "node:crypto";

/* ===================================================================
   Tests: Encryption Module (AES-256-GCM)
   =================================================================== */

describe("encryption", () => {
  // Generate a valid 32-byte (64-char hex) key for tests
  const validKey = crypto.randomBytes(32).toString("hex");

  describe("encrypt()", () => {
    it("should return a string in v1:iv:authTag:ciphertext format", () => {
      const result = encrypt("hello world", validKey);
      const parts = result.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
      // IV = 16 bytes = 32 hex chars
      expect(parts[1]).toHaveLength(32);
      // Auth tag = 16 bytes = 32 hex chars
      expect(parts[2]).toHaveLength(32);
      // Ciphertext should be non-empty
      expect(parts[3].length).toBeGreaterThan(0);
    });

    it("should produce different ciphertexts for the same plaintext (random IV)", () => {
      const a = encrypt("same input", validKey);
      const b = encrypt("same input", validKey);
      expect(a).not.toBe(b); // Different IVs → different ciphertexts
    });

    it("should handle empty string", () => {
      const result = encrypt("", validKey);
      expect(result.split(":")).toHaveLength(4);
    });

    it("should handle unicode text", () => {
      const text = "日本語テスト 🎉 émojis";
      const encrypted = encrypt(text, validKey);
      const decrypted = decrypt(encrypted, validKey);
      expect(decrypted).toBe(text);
    });

    it("should handle long strings", () => {
      const text = "x".repeat(10000);
      const encrypted = encrypt(text, validKey);
      const decrypted = decrypt(encrypted, validKey);
      expect(decrypted).toBe(text);
    });
  });

  describe("decrypt()", () => {
    it("should correctly decrypt a versioned v1 encrypted value", () => {
      const plaintext = "postgresql://user:pass@localhost:5432/db";
      const encrypted = encrypt(plaintext, validKey);
      const decrypted = decrypt(encrypted, validKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should correctly decrypt a legacy 3-part format value without version prefix", () => {
      const plaintext = "postgresql://legacy:pass@localhost:5432/db";
      const encrypted = encrypt(plaintext, validKey);
      // Strip v1: prefix to simulate legacy stored string
      const legacyFormat = encrypted.replace(/^v1:/, "");
      expect(legacyFormat.split(":")).toHaveLength(3);

      const decrypted = decrypt(legacyFormat, validKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should throw on invalid format (missing parts)", () => {
      expect(() => decrypt("onlyonepart", validKey)).toThrow(
        "Invalid encrypted string format"
      );
    });

    it("should throw on invalid IV length", () => {
      expect(() => decrypt("ab:cd:ef", validKey)).toThrow(
        "Invalid IV length"
      );
    });

    it("should throw with wrong key (authentication failure)", () => {
      const encrypted = encrypt("secret", validKey);
      const wrongKey = crypto.randomBytes(32).toString("hex");
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it("should throw if key is not 32 bytes", () => {
      expect(() => encrypt("test", "tooshort")).toThrow(
        "ENCRYPTION_KEY must be 64 hex characters"
      );
    });

    it("should throw on tampered ciphertext", () => {
      const encrypted = encrypt("test data", validKey);
      const parts = encrypted.split(":");
      // Flip a character in the ciphertext
      parts[3] = parts[3].slice(0, -1) + (parts[3].at(-1) === "a" ? "b" : "a");
      expect(() => decrypt(parts.join(":"), validKey)).toThrow();
    });
  });

  describe("LocalAesGcmKeyProvider", () => {
    it("encrypts and decrypts via KeyProvider interface", () => {
      const provider = new LocalAesGcmKeyProvider(validKey);
      const secret = "postgres://root:secret@db.lan/prod";

      const encrypted = provider.encrypt(secret);
      expect(encrypted).toMatch(/^v1:/);

      const decrypted = provider.decrypt(encrypted);
      expect(decrypted).toBe(secret);
    });
  });
});
