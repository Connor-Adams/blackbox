# Blackbox — `/money` Finance View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/money` screen showing live cashflow aggregates (top-line tiles, monthly chart, category breakdown, account balances) plus recent/largest transactions from blackbox's ingested data, each section degrading independently.

**Architecture:** Thin typed GETs against cashflow's `/api/v1/*` reporting API (same `cfr_` Bearer as the transactions connector), composed by `getCashflowDashboard()` with `Promise.allSettled` (null per failed section). The `/money` server page combines that live data with a DB query for cashflow timeline events (split into recent/largest by a pure helper) and renders a client `FinanceView`.

**Tech Stack:** Next.js App Router (server + client) · Recharts · Drizzle · Vitest.

**Spec:** [docs/superpowers/specs/2026-06-03-blackbox-money-finance-view-design.md](../specs/2026-06-03-blackbox-money-finance-view-design.md). Builds on `lib/connectors/cashflow-api.ts` (branch `claude/blackbox-cashflow-connector`).

> Run from repo root. Branch: `claude/blackbox-cashflow-connector` (the finance view stacks on the connector). **Env:** no `pnpm add`; no deletions; run `pnpm test`/`build` in the subagent; stage only each task's files (`git add <files>`, never `-A` — leave the unrelated `components/timeline/AnnotationForm.tsx`). If a build hits a stale `.next`, `mv .next /tmp/bb-next-stale` and rebuild.

## File Structure

- `lib/connectors/cashflow-api.ts` — **modify**: add `cashflowGet` helper + `fetchCashflowSummary/Accounts/Monthly/ByCategory` + their types.
- `lib/connectors/cashflow-dashboard.ts` + `.test.ts` — `getCashflowDashboard` (allSettled orchestrator).
- `lib/db/finance.ts` — `getCashflowTimelineEvents(userId, days)` (DB query).
- `lib/domain/finance.ts` + `.test.ts` — pure `pickTransactions(events, opts)` (recent/largest split).
- `components/money/{FinanceView,MonthlyChart,CategoryBars,AccountsList,TransactionsList}.tsx` — UI.
- `app/money/page.tsx` — server page.
- `components/Nav.tsx` — **modify**: add the `Money` link.

---

## Task 1: Cashflow aggregate fetch fns (TDD)

**Files:** Modify `lib/connectors/cashflow-api.ts`, create/extend `lib/connectors/cashflow-api.test.ts`.

- [ ] **Step 1: Append failing tests** to `lib/connectors/cashflow-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  cashflowGet,
  fetchCashflowSummary,
  fetchCashflowByCategory,
} from "@/lib/connectors/cashflow-api";

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("cashflowGet", () => {
  it("sends the bearer token and returns the parsed body", async () => {
    const f = okFetch({ hello: "world" });
    const out = await cashflowGet<{ hello: string }>("https://api.test", "cfr_x", "/api/v1/summary", f);
    expect(out).toEqual({ hello: "world" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.test/api/v1/summary");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer cfr_x" });
  });

  it("throws on a non-2xx response", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(cashflowGet("https://api.test", "t", "/api/v1/summary", f)).rejects.toThrow(/401/);
  });
});

describe("aggregate fetchers", () => {
  it("fetchCashflowSummary returns the summary body", async () => {
    const summary = { currency: "CAD", netWorth: 1000, liquidCash: 200, monthlyBurn: 50, monthlyIncome: 80, monthlySavingsRate: 0.3, runwayMonths: 4 };
    const out = await fetchCashflowSummary("https://api.test", "t", okFetch(summary));
    expect(out).toEqual(summary);
  });

  it("fetchCashflowByCategory passes start/end and returns categories", async () => {
    const f = okFetch({ categories: [{ name: "dining", amount: 100, percentage: 50, transactionCount: 3, trendVsPreviousPeriod: 0.1 }] });
    const out = await fetchCashflowByCategory("https://api.test", "t", { start: "2026-03-01", end: "2026-06-01" }, f);
    expect(out.categories[0].name).toBe("dining");
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/v1/spending/by-category?start=2026-03-01&end=2026-06-01");
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/connectors/cashflow-api.test.ts` → the new names don't exist.

- [ ] **Step 3: Add to `lib/connectors/cashflow-api.ts`** (alongside the existing `fetchCashflowTransactions`):

```ts
/** Typed GET against cashflow's reporting API. Throws on non-2xx. */
export async function cashflowGet<T>(
  baseUrl: string,
  token: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`cashflow API ${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

export interface CashflowSummary {
  currency: string;
  netWorth: number;
  liquidCash: number;
  monthlyBurn: number;
  monthlyIncome: number;
  monthlySavingsRate: number;
  runwayMonths: number;
}
export interface CashflowAccount {
  id: number;
  name: string;
  type: string;
  currency: string;
  balance: number;
  updatedAt?: string;
}
export interface CashflowMonth {
  month: string;
  income: number;
  expenses: number;
  netCashflow: number;
  savingsRate: number;
}
export interface CashflowCategory {
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
  trendVsPreviousPeriod: number;
}

export const fetchCashflowSummary = (b: string, t: string, f: typeof fetch = fetch) =>
  cashflowGet<CashflowSummary>(b, t, "/api/v1/summary", f);

export const fetchCashflowAccounts = (b: string, t: string, f: typeof fetch = fetch) =>
  cashflowGet<{ accounts: CashflowAccount[] }>(b, t, "/api/v1/accounts", f);

export const fetchCashflowMonthly = (b: string, t: string, f: typeof fetch = fetch) =>
  cashflowGet<{ months: CashflowMonth[] }>(b, t, "/api/v1/cashflow/monthly", f);

export const fetchCashflowByCategory = (
  b: string,
  t: string,
  range: { start: string; end: string },
  f: typeof fetch = fetch,
) => cashflowGet<{ categories: CashflowCategory[] }>(b, t, `/api/v1/spending/by-category?start=${range.start}&end=${range.end}`, f);
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/connectors/cashflow-api.test.ts` → all pass (existing transaction tests + the new ones).

- [ ] **Step 5: Commit.**
```bash
git add lib/connectors/cashflow-api.ts lib/connectors/cashflow-api.test.ts
git commit -m "feat: add cashflow summary/accounts/monthly/by-category fetchers"
```

---

## Task 2: `getCashflowDashboard` orchestrator (TDD)

**Files:** Create `lib/connectors/cashflow-dashboard.ts`, `lib/connectors/cashflow-dashboard.test.ts`.

- [ ] **Step 1: Failing test** `lib/connectors/cashflow-dashboard.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getCashflowDashboard } from "@/lib/connectors/cashflow-dashboard";

function body(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
}

describe("getCashflowDashboard", () => {
  it("returns each section, with null for any that fail (no throw)", async () => {
    // fetch routes by path: summary ok, accounts 500, monthly ok, by-category ok
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/summary")) return body({ currency: "CAD", netWorth: 1, liquidCash: 1, monthlyBurn: 1, monthlyIncome: 1, monthlySavingsRate: 0.1, runwayMonths: 1 });
      if (u.includes("/accounts")) return body("err", 500);
      if (u.includes("/cashflow/monthly")) return body({ months: [] });
      if (u.includes("/by-category")) return body({ categories: [] });
      return body("?", 404);
    }) as unknown as typeof fetch;

    const dash = await getCashflowDashboard({ baseUrl: "https://api.test", token: "t", fetchImpl });
    expect(dash.summary).not.toBeNull();
    expect(dash.accounts).toBeNull(); // 500 → degraded
    expect(dash.monthly).toEqual({ months: [] });
    expect(dash.byCategory).toEqual({ categories: [] });
  });

  it("returns all-null when base/token are missing", async () => {
    const dash = await getCashflowDashboard({ baseUrl: undefined, token: undefined });
    expect(dash).toEqual({ summary: null, accounts: null, monthly: null, byCategory: null });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/connectors/cashflow-dashboard.test.ts`.

- [ ] **Step 3: Implement `lib/connectors/cashflow-dashboard.ts`:**

```ts
import { env } from "@/lib/env";
import {
  fetchCashflowSummary,
  fetchCashflowAccounts,
  fetchCashflowMonthly,
  fetchCashflowByCategory,
  type CashflowSummary,
  type CashflowAccount,
  type CashflowMonth,
  type CashflowCategory,
} from "./cashflow-api";

export interface CashflowDashboard {
  summary: CashflowSummary | null;
  accounts: { accounts: CashflowAccount[] } | null;
  monthly: { months: CashflowMonth[] } | null;
  byCategory: { categories: CashflowCategory[] } | null;
}

const WINDOW_DAYS = 90;
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ok<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

/** Fetch cashflow's aggregate reporting endpoints in parallel; each section is
 *  null on failure (or when base/token are absent). Never throws. */
export async function getCashflowDashboard(opts?: {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<CashflowDashboard> {
  const e = (() => {
    try {
      return env();
    } catch {
      return { CASHFLOW_API_BASE_URL: undefined, CASHFLOW_API_TOKEN: undefined } as ReturnType<typeof env>;
    }
  })();
  const baseUrl = opts?.baseUrl ?? e.CASHFLOW_API_BASE_URL;
  const token = opts?.token ?? e.CASHFLOW_API_TOKEN;
  const f = opts?.fetchImpl ?? fetch;

  if (!baseUrl || !token) {
    return { summary: null, accounts: null, monthly: null, byCategory: null };
  }

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [summary, accounts, monthly, byCategory] = await Promise.allSettled([
    fetchCashflowSummary(baseUrl, token, f),
    fetchCashflowAccounts(baseUrl, token, f),
    fetchCashflowMonthly(baseUrl, token, f),
    fetchCashflowByCategory(baseUrl, token, { start: ymd(start), end: ymd(end) }, f),
  ]);

  return {
    summary: ok(summary),
    accounts: ok(accounts),
    monthly: ok(monthly),
    byCategory: ok(byCategory),
  };
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/connectors/cashflow-dashboard.test.ts` → 2 pass.

- [ ] **Step 5: Commit.**
```bash
git add lib/connectors/cashflow-dashboard.ts lib/connectors/cashflow-dashboard.test.ts
git commit -m "feat: add getCashflowDashboard with per-section degradation"
```

---

## Task 3: Finance transactions — DB query + pure split (TDD)

**Files:** Create `lib/db/finance.ts`, `lib/domain/finance.ts`, `lib/domain/finance.test.ts`.

- [ ] **Step 1: Failing test** `lib/domain/finance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickTransactions, type FinanceTxn } from "@/lib/domain/finance";

const t = (id: string, amount: number, iso: string): FinanceTxn => ({
  id, title: `txn ${id}`, amount, timestamp: iso, category: null,
});

describe("pickTransactions", () => {
  const txns = [
    t("a", 10, "2026-06-01T12:00:00Z"),
    t("b", 200, "2026-05-20T12:00:00Z"),
    t("c", 35, "2026-06-03T12:00:00Z"),
    t("d", 5, "2026-04-10T12:00:00Z"),
  ];

  it("recent is sorted by timestamp desc, limited", () => {
    const { recent } = pickTransactions(txns, { recentLimit: 2, largestLimit: 2 });
    expect(recent.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("largest is sorted by amount desc, limited", () => {
    const { largest } = pickTransactions(txns, { recentLimit: 2, largestLimit: 2 });
    expect(largest.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("does not mutate the input", () => {
    pickTransactions(txns, { recentLimit: 2, largestLimit: 2 });
    expect(txns.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/domain/finance.test.ts`.

- [ ] **Step 3: Implement `lib/domain/finance.ts`:**

```ts
export interface FinanceTxn {
  id: string;
  title: string;
  amount: number; // positive = spend
  timestamp: string; // ISO
  category: string | null;
}

/** Split a set of transactions into recent (by time) and largest (by amount). Pure. */
export function pickTransactions(
  txns: readonly FinanceTxn[],
  opts: { recentLimit: number; largestLimit: number },
): { recent: FinanceTxn[]; largest: FinanceTxn[] } {
  const byTime = [...txns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const byAmount = [...txns].sort((a, b) => b.amount - a.amount);
  return {
    recent: byTime.slice(0, opts.recentLimit),
    largest: byAmount.slice(0, opts.largestLimit),
  };
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/domain/finance.test.ts` → 3 pass.

- [ ] **Step 5: Create `lib/db/finance.ts`** (DB query → `FinanceTxn[]`, last N days of cashflow timeline events):

```ts
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { timelineEvent } from "@/lib/db/schema";
import type { FinanceTxn } from "@/lib/domain/finance";

type Db = ReturnType<typeof getDb>;

/** Cashflow transactions (as timeline events) for the last `days`, mapped to FinanceTxn. */
export async function getCashflowTimelineEvents(
  userId: string,
  days: number,
  db: Db = getDb(),
): Promise<FinanceTxn[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.userId, userId),
        eq(timelineEvent.sourceType, "cashflow"),
        gte(timelineEvent.startedAt, since),
      ),
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
```

- [ ] **Step 6: Type-check.** `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit.**
```bash
git add lib/domain/finance.ts lib/domain/finance.test.ts lib/db/finance.ts
git commit -m "feat: add finance transaction query + recent/largest split"
```

---

## Task 4: FinanceView components

**Files:** Create `components/money/{MonthlyChart,CategoryBars,AccountsList,TransactionsList,FinanceView}.tsx`.

- [ ] **Step 1: `components/money/MonthlyChart.tsx`** (client, Recharts income vs expenses):

```tsx
"use client";

import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CashflowMonth } from "@/lib/connectors/cashflow-api";

export function MonthlyChart({ months }: { months: CashflowMonth[] }) {
  if (months.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No monthly cashflow data.</div>;
  }
  const data = months.map((m) => ({ month: m.month, income: Math.round(m.income), expenses: Math.round(m.expenses) }));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Income vs expenses</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={48} />
          <Tooltip />
          <Legend />
          <Bar dataKey="income" fill="currentColor" className="text-foreground/60" isAnimationActive={false} />
          <Bar dataKey="expenses" fill="currentColor" className="text-destructive/60" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: `components/money/CategoryBars.tsx`** (client, horizontal bars):

```tsx
"use client";

import type { CashflowCategory } from "@/lib/connectors/cashflow-api";

export function CategoryBars({ categories }: { categories: CashflowCategory[] }) {
  if (categories.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No category data.</div>;
  }
  const top = [...categories].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const max = Math.max(...top.map((c) => Math.abs(c.amount)), 1);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Spending by category</div>
      <ul className="space-y-1.5">
        {top.map((c) => (
          <li key={c.name} className="text-sm">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{c.name}</span>
              <span className="tabular-nums">${Math.round(Math.abs(c.amount))} · {Math.round(c.percentage)}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-muted">
              <div className="h-1.5 rounded bg-foreground/50" style={{ width: `${(Math.abs(c.amount) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: `components/money/AccountsList.tsx`** (server-safe; presentational):

```tsx
import type { CashflowAccount } from "@/lib/connectors/cashflow-api";

export function AccountsList({ accounts }: { accounts: CashflowAccount[] }) {
  if (accounts.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No accounts.</div>;
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Accounts</div>
      <ul className="divide-y divide-border">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between py-1.5 text-sm">
            <span>{a.name} <span className="text-[10px] uppercase text-muted-foreground">{a.type}</span></span>
            <span className="tabular-nums">{a.currency} {Math.round(a.balance).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: `components/money/TransactionsList.tsx`** (server-safe; recent + largest, links to timeline):

```tsx
import Link from "next/link";
import type { FinanceTxn } from "@/lib/domain/finance";

function Row({ t }: { t: FinanceTxn }) {
  const day = t.timestamp.slice(0, 10);
  return (
    <li>
      <Link href={`/timeline?date=${day}`} className="flex items-center justify-between gap-3 py-1.5 text-sm hover:bg-muted">
        <span className="truncate">{t.title}{t.category ? <span className="ml-2 text-[10px] uppercase text-muted-foreground">{t.category}</span> : null}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{day} · ${Math.round(t.amount)}</span>
      </Link>
    </li>
  );
}

export function TransactionsList({ recent, largest }: { recent: FinanceTxn[]; largest: FinanceTxn[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-sm font-medium">Recent</div>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y divide-border">{recent.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-sm font-medium">Largest</div>
        {largest.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y divide-border">{largest.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `components/money/FinanceView.tsx`** (composes; top-line tiles via StateCard):

```tsx
import { StateCard } from "@/components/today/StateCard";
import { MonthlyChart } from "./MonthlyChart";
import { CategoryBars } from "./CategoryBars";
import { AccountsList } from "./AccountsList";
import { TransactionsList } from "./TransactionsList";
import type { CashflowDashboard } from "@/lib/connectors/cashflow-dashboard";
import type { FinanceTxn } from "@/lib/domain/finance";

export function FinanceView({
  dashboard,
  recent,
  largest,
}: {
  dashboard: CashflowDashboard;
  recent: FinanceTxn[];
  largest: FinanceTxn[];
}) {
  const s = dashboard.summary;
  const cur = s?.currency ?? "";
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Money</h1>

      {s ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StateCard label="Net worth" value={money(s.netWorth)} />
          <StateCard label="Liquid cash" value={money(s.liquidCash)} />
          <StateCard label="Monthly burn" value={money(s.monthlyBurn)} />
          <StateCard label="Runway" value={`${Math.round(s.runwayMonths)} mo`} />
          <StateCard label="Savings rate" value={`${Math.round(s.monthlySavingsRate * 100)}%`} />
        </div>
      ) : (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Top-line metrics unavailable (cashflow API unreachable).</div>
      )}

      {dashboard.monthly ? <MonthlyChart months={dashboard.monthly.months} /> : null}
      {dashboard.byCategory ? <CategoryBars categories={dashboard.byCategory.categories} /> : null}
      {dashboard.accounts ? <AccountsList accounts={dashboard.accounts.accounts} /> : null}

      <TransactionsList recent={recent} largest={largest} />
    </div>
  );
}
```

- [ ] **Step 6: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean (components compile; not yet routed). `MonthlyChart`/`CategoryBars` are `"use client"` (Recharts/inline); the presentational `AccountsList`/`TransactionsList`/`FinanceView` are server components importing only types — fine.

- [ ] **Step 7: Commit.**
```bash
git add components/money
git commit -m "feat: add money finance view components"
```

---

## Task 5: `/money` page + nav

**Files:** Create `app/money/page.tsx`; Modify `components/Nav.tsx`.

- [ ] **Step 1: Create `app/money/page.tsx`:**

```tsx
import { getCashflowDashboard } from "@/lib/connectors/cashflow-dashboard";
import { getCashflowTimelineEvents } from "@/lib/db/finance";
import { pickTransactions } from "@/lib/domain/finance";
import { SEED_USER_ID } from "@/lib/constants";
import { FinanceView } from "@/components/money/FinanceView";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const [dashboard, txns] = await Promise.all([
    getCashflowDashboard(),
    getCashflowTimelineEvents(SEED_USER_ID, 90),
  ]);
  const { recent, largest } = pickTransactions(txns, { recentLimit: 10, largestLimit: 10 });
  return <FinanceView dashboard={dashboard} recent={recent} largest={largest} />;
}
```

- [ ] **Step 2: Add `Money` to `components/Nav.tsx`.** Add `["/money", "Money"]` to the `LINKS` array (after Sources, or after Today — your call; put it after `["/today","Today"]`).

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; `/money` appears in the route list (dynamic); build works without `DATABASE_URL` (page is force-dynamic; `getCashflowDashboard` swallows the missing-env case → all-null, and the DB query only runs at request time).

- [ ] **Step 4: Commit.**
```bash
git add app/money/page.tsx components/Nav.tsx
git commit -m "feat: add /money page and nav link"
```

---

## Task 6: Verification gate + review

**Files:** none.

- [ ] **Step 1: tsc.** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2: lint.** `pnpm lint` → clean.
- [ ] **Step 3: tests.** `pnpm test` → all pass (prior + cashflow-api new + cashflow-dashboard 2 + finance 3). Report count.
- [ ] **Step 4: build.** `pnpm build` → success; routes include `/money`; build without `DATABASE_URL`.
- [ ] **Step 5: tree.** `git status -s` → only `components/timeline/AnnotationForm.tsx` (known residual).
- [ ] **Step 6: whole-branch review** (this feature's diff) — fetchers + dashboard degradation + DB query + pure split + components + page; confirm no `@/lib/db/*` runtime import in any `"use client"` component (MonthlyChart/CategoryBars import only the `Cashflow*` types).

---

## Task 7: Manual verification on the live app (Connor)

- [ ] Open `/money` on the deployed app (with `CASHFLOW_API_BASE_URL` + `CASHFLOW_API_TOKEN` set): expect top-line tiles (net worth / cash / burn / runway / savings), income-vs-expenses chart, category bars, account balances, and Recent/Largest transactions linking into `/timeline`. If cashflow's API is briefly down, the tiles/charts show "unavailable" but the transaction lists (from the DB) still render.

---

## Self-Review

**Spec coverage:** 4 aggregate fetchers (Task 1) ✓; `getCashflowDashboard` allSettled degradation (Task 2) ✓; DB transactions + recent/largest (Task 3) ✓; 5 sections — tiles/monthly/category/accounts/transactions (Tasks 4–5) ✓; graceful per-section degradation (FinanceView null-guards + dashboard nulls) ✓; transactions link into `/timeline` (TransactionsList) ✓; testing of fetchers + dashboard + pure split (Tasks 1–3) ✓; no new cashflow token (reuses env) ✓; client components import only types ✓.

**Placeholder scan:** complete code in every step; no TBD/vague. ✓

**Type consistency:** `Cashflow{Summary,Account,Month,Category}` defined in Task 1, consumed by `cashflow-dashboard.ts` (Task 2) + components (Task 4). `CashflowDashboard` (Task 2) consumed by FinanceView + page. `FinanceTxn`/`pickTransactions` (Task 3) consumed by `lib/db/finance.ts` + page + TransactionsList. `getCashflowDashboard`/`getCashflowTimelineEvents`/`SEED_USER_ID`/`StateCard` referenced with correct names. ✓

---

## Execution Handoff

Subagent-driven. Pure/TDD tasks (1–3) + the feature get fresh-eyes review at the Task 6 gate. UI (Tasks 4–5) is tsc/build-verified + confirmed on the live app (Task 7). Stacks on the cashflow-connector branch → ships in that PR (or its own, your call).
