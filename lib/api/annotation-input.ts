import { z } from "zod";
import { annotationTypes } from "@/lib/db/schema";

const isoTimestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid timestamp");

export const annotationInputSchema = z.object({
  type: z.enum(annotationTypes as unknown as [string, ...string[]]),
  title: z.string().min(1),
  timestamp: isoTimestamp,
  endTimestamp: isoTimestamp.optional(),
  notes: z.string().optional(),
});

export type AnnotationInput = z.infer<typeof annotationInputSchema>;

export function parseAnnotationInput(body: unknown): AnnotationInput {
  return annotationInputSchema.parse(body);
}
