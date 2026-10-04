import type { Dataset } from "./types";

export const empty: Dataset = {
  description: "no rows at all: the schema and nothing else",
  seed: () => Promise.resolve(),
};
