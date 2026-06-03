import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { timelineEvent } from "@/lib/db/schema";
import type { FinanceTxn } from "@/lib/domain/finance";

type Db = ReturnType<typeof getDb>;

export async function getCashflowTimelineEvents(userId: string, days: number, db: Db = getDb()): Promise<FinanceTxn[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(timelineEvent).where(
    and(eq(timelineEvent.userId, userId), eq(timelineEvent.sourceType, "cashflow"), gte(timelineEvent.startedAt, since)),
  );
  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as { amount?: number; category?: string };
    return {
      id: r.id,
      title: r.title,
      amount: typeof meta.amount === "number" ? meta.amount : 0,
      timestamp: r.startedAt.toISOString(),
      category: typeof meta.category === "string" ? meta.category : null,
    };
  });
}
