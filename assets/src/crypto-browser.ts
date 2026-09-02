import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";

type HashInput = string | Uint8Array;

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported browser hash: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  return {
    update(value: HashInput) {
      chunks.push(typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value));
      return this;
    },
    digest(encoding?: "base64" | "hex") {
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      const hashed = sha256(joined);
      if (encoding === "base64") return base64.encode(hashed);
      if (encoding === "hex") return Array.from(hashed, byte => byte.toString(16).padStart(2, "0")).join("");
      return hashed;
    },
  };
}
