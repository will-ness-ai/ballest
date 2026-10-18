// A Daily Post's card as Discord gets it: a Components V2 message (spec #268, the settled
// prototype on branch claude/prototype-daily-post). Built from the card's text (card.ts), so the
// layout lives here and the words there.
import {
  type APIMessageTopLevelComponent,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js";
import { cardText, closedText, type DailyView } from "./card.js";

/** The site and the Workshop: links only, so no press ever reaches the bot. */
const SITE_URL = "https://ballestrecords.com";
const ACCENT = 0x9ee34b;
/** The Workshop screenshot's name as attached to the card. */
export const PREVIEW_FILE = "preview.jpg";
/** The lead graph's name as attached to the card: an edit replaces it with a fresh one. */
export const GRAPH_FILE = "graph.png";
/** The Map's spinning 3D GIF's name as attached to the card (map_spins, spin.ts). */
export const SPIN_FILE = "spin.gif";

export const workshopUrl = (pfid: string) =>
  `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;

/** A Daily Post's message body: post it as it is, or send it as an edit. */
export interface DailyMessage {
  readonly flags: number;
  readonly components: ReadonlyArray<APIMessageTopLevelComponent>;
  /** Nobody is ever pinged: a persona or a Map's title can hold an @ or a <@id>. */
  readonly allowed_mentions: { readonly parse: ReadonlyArray<never> };
}

/**
 * The live card. `preview`: the Workshop screenshot is attached as PREVIEW_FILE; `spin`: the
 * Map's spinning GIF is attached as SPIN_FILE, beside the podium; `graph`: the lead graph is
 * attached as GRAPH_FILE, and shows under the podium. `closed`: the Daily is over, and the card
 * heads it with its winner, in the same layout with the same pictures and buttons.
 */
export const dailyCardMessage = (
  v: DailyView,
  {
    preview,
    spin = false,
    graph = false,
    closed = false,
  }: {
    readonly preview: boolean;
    readonly spin?: boolean;
    readonly graph?: boolean;
    readonly closed?: boolean;
  },
): DailyMessage => {
  const text = closed ? closedText(v) : cardText(v);
  const textDisplay = (content: string) => ({ type: ComponentType.TextDisplay as const, content });
  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: ComponentType.Container,
        accent_color: ACCENT,
        components: [
          textDisplay(text.header),
          ...(preview
            ? [
                {
                  type: ComponentType.MediaGallery as const,
                  items: [{ media: { url: `attachment://${PREVIEW_FILE}` } }],
                },
              ]
            : []),
          spin
            ? {
                type: ComponentType.Section as const,
                components: [textDisplay(text.stats)],
                accessory: {
                  type: ComponentType.Thumbnail as const,
                  media: { url: `attachment://${SPIN_FILE}` },
                },
              }
            : textDisplay(text.stats),
          ...(graph
            ? [
                {
                  type: ComponentType.MediaGallery as const,
                  items: [{ media: { url: `attachment://${GRAPH_FILE}` } }],
                },
              ]
            : []),
          {
            type: ComponentType.Separator,
            divider: true,
            spacing: SeparatorSpacingSize.Small,
          },
          textDisplay(text.foot),
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                label: "Steam Workshop",
                url: workshopUrl(v.pfid),
              },
              {
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                label: "Today's board",
                url: `${SITE_URL}/daily/${v.date}`,
              },
            ],
          },
        ],
      },
    ],
  };
};

/** A line in the Daily Post's thread: quiet, and pings nobody. */
export interface DailyLine {
  readonly content: string;
  readonly flags: number;
  readonly allowed_mentions: { readonly parse: ReadonlyArray<never> };
}

export const dailyLineMessage = (content: string): DailyLine => ({
  content,
  flags: MessageFlags.SuppressNotifications,
  allowed_mentions: { parse: [] },
});
