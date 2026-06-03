import { inngest } from "./client";
import { computeAndStoreSnapshot } from "@/lib/db/snapshots";
import { SEED_USER_ID } from "@/lib/constants";

/** Recompute + persist a day's snapshot. On-demand via the
 *  snapshot/recompute.requested event, and nightly by cron. Idempotent. */
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

export const functions = [dailySnapshot];
