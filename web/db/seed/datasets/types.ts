import type { Db } from "../../client";

// The transaction a dataset writes in; the harness has already emptied every table.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Dataset {
  // one line for the list an unknown dataset prints
  description: string;
  seed: (tx: Tx) => Promise<void>;
}
