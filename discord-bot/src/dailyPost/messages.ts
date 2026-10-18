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
import { cardText, type DailyView } from "./card.js";

/** The site and the Workshop: links only, so no press ever reaches the bot. */
const SITE_URL = "https://ballestrecords.com";
const ACCENT = 0x9ee34b;
/** The Workshop screenshot's name as attached to the card. */
export const PREVIEW_FILE = "preview.jpg";

export const workshopUrl = (pfid: string) =>
  `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;

/** A Daily Post's message body: post it as it is, or send it as an edit. */
export interface DailyMessage {
  readonly flags: number;
  readonly components: ReadonlyArray<APIMessageTopLevelComponent>;
  /** Nobody is ever pinged: a persona or a Map's title can hold an @ or a <@id>. */
  readonly allowed_mentions: { readonly parse: ReadonlyArray<never> };
}

/** The live card. `preview`: the Workshop screenshot is attached as PREVIEW_FILE. */
export const dailyCardMessage = (
  v: DailyView,
  { preview }: { readonly preview: boolean },
): DailyMessage => {
  const text = cardText(v);
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
          textDisplay(text.stats),
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
