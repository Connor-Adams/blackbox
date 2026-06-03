import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { isDexcomLive } from "@/lib/connectors/dexcom-env";
import { CONNECTABLE, dexcomConnectAvailable } from "@/lib/connectors/connectable";
import { SourcesView } from "@/components/sources/SourcesView";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const rows = await listSourceConnections(SEED_USER_ID);
  const connect = dexcomConnectAvailable(isDexcomLive(), rows)
    ? [{ label: CONNECTABLE.dexcom.label, url: CONNECTABLE.dexcom.authStartUrl }]
    : [];
  return <SourcesView sources={serializeSources(rows)} connect={connect} />;
}
