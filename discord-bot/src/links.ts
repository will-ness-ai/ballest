// Where the bot's links go: each Map's page on the site (as the Daily Report has linked them since
// #171), and its Workshop page, which is where a Player subscribes to play it.

export const SITE_URL = "https://ballestrecords.com";

/** The Map's page on the site. */
export const mapUrl = (pfid: string) => `${SITE_URL}/map/${pfid}`;

export const workshopUrl = (pfid: string) =>
  `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;

/** Neutralise Discord markdown and mentions in a persona or Map title. */
export const escape = (s: string) =>
  s
    .replace(/[\\*_~`|>[\]]/g, (c) => `\\${c}`)
    .replaceAll("@", "@​")
    .replaceAll("<", "<​");

/** A masked link to a page on the site; the <> stop Discord unfurling an embed. */
export const siteLink = (text: string, path: string) => `[${escape(text)}](<${SITE_URL}${path}>)`;

interface NamedMap {
  readonly pfid: string;
  readonly title: string;
}

/** What a Map is called: its Workshop title, or its ID when it has none. */
export const mapName = (m: NamedMap) => m.title || m.pfid;

/** The Map's name, linked to its page on the site. */
export const mapLink = (m: NamedMap) => siteLink(mapName(m), `/map/${m.pfid}`);
