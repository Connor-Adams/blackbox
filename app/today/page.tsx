import { Button } from "@/components/ui/button";

export default function TodayPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Blackbox foundation is live. Timeline, snapshots, and insights arrive in
        later phases.
      </p>
      <div className="mt-6">
        <Button>Placeholder action</Button>
      </div>
    </main>
  );
}
