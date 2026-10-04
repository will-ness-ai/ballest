// The datasets `pnpm db:seed <name>` can write. Adding one is a module beside this file
// that exports a Dataset, and a line here (docs/data.md).
import { empty } from "./empty";
import { tiny } from "./tiny";

export const datasets = { empty, tiny };

export type DatasetName = keyof typeof datasets;
