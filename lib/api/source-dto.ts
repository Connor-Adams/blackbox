import type { sourceConnection } from "@/lib/db/schema";

type SourceRow = typeof sourceConnection.$inferSelect;

export interface SourceDTO {
  id: string;
  sourceType: string;
  displayName: string;
  status: string;
  lastSyncAt: string | null;
}

export function serializeSources(rows: SourceRow[]): SourceDTO[] {
  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    displayName: r.displayName,
    status: r.status,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
  }));
}
