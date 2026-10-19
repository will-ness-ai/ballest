import { boardTag, DAILY_TAG, DATA_TAG } from "../../../db/tags";

// What a revalidate request expires: every read after a Refresh, or after a Daily read
// (`?daily=<board>` for each Daily it read) only the Daily reads and those boards'.
export function tagsToExpire(params: URLSearchParams): Array<string> {
  if (!params.has("daily")) return [DATA_TAG];
  return [
    DAILY_TAG,
    ...params
      .getAll("daily")
      .filter((b) => b.includes("_Daily_"))
      .map(boardTag),
  ];
}
