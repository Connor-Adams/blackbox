import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively so logically-equal
 *  payloads serialize identically. Arrays keep their order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 of the canonical payload — stable across key ordering. */
export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/** Natural dedupe key for a raw event: prefer the source's own record id,
 *  fall back to the payload hash. Mirrors the partial unique indexes on raw_event. */
export function rawEventDedupeKey(input: {
  sourceConnectionId: string;
  sourceRecordId: string | null;
  payloadHash: string;
}): string {
  return input.sourceRecordId !== null
    ? `${input.sourceConnectionId}:id:${input.sourceRecordId}`
    : `${input.sourceConnectionId}:hash:${input.payloadHash}`;
}
