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
