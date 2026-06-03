import type { SourceType } from "@/lib/db/schema";

/** A source connector emits raw payloads to be run through the ingest pipeline.
 *  v0 connectors are mock; real OAuth/HTTP connectors implement the same shape. */
export interface Connector {
  readonly sourceType: SourceType;
  sync(): Promise<unknown[]>;
}
