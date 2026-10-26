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
import { SITE_URL, workshopUrl } from "../links.js";
import { cardText, closedText, type DailyView } from "./card.js";

const ACCENT = 0x9ee34b;
/** The Workshop screenshot's name as attached to the card. */
const PREVIEW_FILE = "preview.jpg";
/** The lead graph's name as attached to the card: an edit replaces it with a fresh one. */
const GRAPH_FILE = "graph.png";
/** The Map's spinning 3D GIF's name as attached to the card (map_spins, spin.ts). */
const SPIN_FILE = "spin.gif";

/** A Daily Post's message body: post it as it is, or send it as an edit. */
export interface DailyMessage {
  readonly flags: number;
  readonly components: ReadonlyArray<APIMessageTopLevelComponent>;
  /** Nobody is ever pinged: a persona or a Map's title can hold an @ or a <@id>. */
  readonly allowed_mentions: { readonly parse: ReadonlyArray<never> };
}

/** A file attached to the card, by the name its components show it by. */
export interface DailyFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/**
 * One of the card's pictures: new bytes to attach (replacing the one the card has), "kept" when
 * the card already has it attached, or null (or left out) when the card has none.
 */
export type Picture = Uint8Array | "kept" | null;

/** A card to post or edit in: its message, and the files to attach with it. */
export interface DailyCard {
  readonly message: DailyMessage;
  readonly files: ReadonlyArray<DailyFile>;
}

/**
 * A Daily Post's card. `preview`: the Workshop screenshot, at the top; `spin`: the Map's
 * spinning GIF, beside the podium; `graph`: the lead graph, under the podium. The card shows each
 * picture that is given, and attaches the new ones under the names it shows them by. `closed`:
 * the Daily is over, and the card heads it with its winner, in the same layout with the same
 * pictures, its site button reading "Final board".
 */
export const dailyCard = (
  v: DailyView,
  {
    preview = null,
    spin = null,
    graph = null,
    closed = false,
  }: {
    readonly preview?: Picture;
    readonly spin?: Picture;
    readonly graph?: Picture;
    readonly closed?: boolean;
  },
): DailyCard => {
  const files = (
    [
      [PREVIEW_FILE, preview],
      [GRAPH_FILE, graph],
      [SPIN_FILE, spin],
    ] as const
  ).flatMap(([name, p]) => (p instanceof Uint8Array ? [{ name, data: p }] : []));
  return {
    message: cardMessage(v, {
      preview: preview !== null,
      spin: spin !== null,
      graph: graph !== null,
      closed,
    }),
    files,
  };
};

const cardMessage = (
  v: DailyView,
  {
    preview,
    spin,
    graph,
    closed,
  }: {
    readonly preview: boolean;
    readonly spin: boolean;
    readonly graph: boolean;
    readonly closed: boolean;
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
                label: closed ? "Final board" : "Today's board",
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
