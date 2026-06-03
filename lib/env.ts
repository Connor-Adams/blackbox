import { z } from "zod";

const urlString = z.string().refine((value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, "must be a valid URL");

export const envSchema = z.object({
  DATABASE_URL: urlString,
  BLACKBOX_APP_URL: urlString.default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

/** Pure, testable parser. Pass a source object (defaults to process.env). */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}

let cached: Env | null = null;

/** Lazy accessor — validates on first server-side use, not at import/build time. */
export function env(): Env {
  return (cached ??= parseEnv());
}
