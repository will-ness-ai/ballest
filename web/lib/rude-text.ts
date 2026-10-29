// Text a Generator won't letter (the Sign): players spawn it into Maps others race on. The words
// are obscenity's English list (none are written here, by Will's choice), which sees through
// l33t, repeated letters and look-alike characters and lets a clean word holding a rude one
// through (Scunthorpe, assassin); then hate symbols and codes, and words spelled out a character
// at a time. Download-only, so a list is the right size of check (no moderation service): the
// Workshop is where a Map gets reported.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/* clean words the list would refuse, a racing one among them */
const CLEAN = ["cockpit", "shiitake"];

const built = englishDataset.build();
const matcher = new RegExpMatcher({
  ...built,
  ...englishRecommendedTransformers,
  whitelistedTerms: [...(built.whitelistedTerms ?? []), ...CLEAN],
});

/* swastikas (U+534D, U+5350 and the Tibetan U+0FD5-U+0FD8, which a drawn font letters like any
   other character), 1488, which the list's l33t reading turns into letters, and KKK, which its
   collapsing of repeats turns into K */
const SWASTIKAS = String.fromCodePoint(0x534d, 0x5350, 0xfd5, 0xfd6, 0xfd7, 0xfd8);
const HATE = new RegExp(
  `[${SWASTIKAS}]|(?<!\\d)1488(?!\\d)|(?<![\\p{L}\\p{N}])kkk(?![\\p{L}\\p{N}])`,
  "iu",
);

/* a word spelled out a character at a time, with spaces, dots or dashes between, joined back up */
const SPELLED = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][^\p{L}\p{N}]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;
const joinSpelled = (text: string) =>
  text.replace(SPELLED, (run) => run.replace(/[^\p{L}\p{N}]/gu, ""));

export const isRude = (text: string) =>
  [text, joinSpelled(text)].some((t) => HATE.test(t) || matcher.hasMatch(t));
