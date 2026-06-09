import { inngest } from "./client";
import { computeAndStoreSnapshot } from "@/lib/db/snapshots";
import { computeAndStoreInsights } from "@/lib/db/insights";
import { computeAndStoreTrends } from "@/lib/db/trends";
import { computeAndStoreCorrelations } from "@/lib/db/correlations";
import { SEED_USER_ID } from "@/lib/constants";

export const dailySnapshot = inngest.createFunction(
  { id: "daily-snapshot" },
  [{ event: "snapshot/recompute.requested" }, { cron: "0 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const summary = await step.run("compute-and-store", () =>
      computeAndStoreSnapshot(SEED_USER_ID, date),
    );
    return { date, summary };
  },
);

export const insights = inngest.createFunction(
  { id: "insights" },
  [{ event: "insights/recompute.requested" }, { cron: "15 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreInsights(SEED_USER_ID, date),
    );
    return { date, count };
  },
);

export const dailyTrends = inngest.createFunction(
  { id: "daily-trends" },
  [{ event: "trends/recompute.requested" }, { cron: "5 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreTrends(SEED_USER_ID, date),
    );
    return { date, count };
  },
);

export const dailyCorrelations = inngest.createFunction(
  { id: "daily-correlations" },
  [{ event: "correlations/recompute.requested" }, { cron: "10 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreCorrelations(SEED_USER_ID, date),
    );
    return { date, count };
  },
);

export const functions = [dailySnapshot, dailyTrends, dailyCorrelations, insights];
