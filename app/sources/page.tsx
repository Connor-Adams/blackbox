import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { SourcesView } from "@/components/sources/SourcesView";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const rows = await listSourceConnections(SEED_USER_ID);
  return <SourcesView sources={serializeSources(rows)} />;
}
