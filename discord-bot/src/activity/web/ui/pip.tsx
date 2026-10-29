// Picture-in-picture: Discord shrinks the Activity to a small window when you leave the call's
// view. Nothing in it is pressed (a click brings the full page back), so it only shows where
// things stand.
import { formatTime } from "../../../domain.js";
import { formatGap, mapTitle, matchDetails } from "../../../present.js";
import type { MatchView } from "../../api.js";
import type { Viewer } from "../types.js";
import { Countdown, Logo, MarbleIn } from "./art.js";
import { Chip, nameOf, rankClass } from "./match.js";

/** The Match on screen as its top three, each with their time and gap to P1; your row replaces third if you're lower. */
const PipMatch = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  const top = m.standings.slice(0, 3);
  const me = m.standings.find((s) => s.player.discordId === viewer.discordId);
  const shown = me === undefined || top.includes(me) ? top : [...top.slice(0, 2), me];
  const lead = m.standings[0]?.ticks ?? null;
  return (
    <div className="pip">
      <div className="pip-h">
        <span className="mt">{mapTitle(m)}</span>
        <Chip m={m} />
      </div>
      <div className="pip-rows">
        {shown.map((s) => (
          <div
            key={s.player.steamId}
            className={`pr ${s.player.discordId === viewer.discordId ? "me" : ""}`}
          >
            <span className={rankClass(s.rank)}>{s.rank ?? "–"}</span>
            <MarbleIn m={m} steamId={s.player.steamId} size={15} />
            <span className="n">{nameOf(m)(s.player.discordId)}</span>
            <span>{s.ticks === null ? "—" : formatTime(s.ticks)}</span>
            <span className="gap">
              {s.ticks === null || lead === null || s.ticks === lead
                ? ""
                : `+${formatGap(s.ticks - lead)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** The small window: the Match on screen, else a Challenge that names you, else how many Matches are on. */
export const Pip = ({
  viewer,
  focus,
  matches,
}: {
  readonly viewer: Viewer;
  readonly focus: MatchView | null;
  readonly matches: ReadonlyArray<MatchView>;
}) => {
  if (focus !== null) return <PipMatch m={focus} viewer={viewer} />;
  const challenge = matches.find((m) => m.actions.includes("decline"));
  if (challenge !== undefined)
    return (
      <div className="pip">
        <Logo />
        <div className="pip-box you">
          <MarbleIn m={challenge} steamId={challenge.creator.steamId} size={22} />
          <div>
            <div className="mt">
              {nameOf(challenge)(challenge.creator.discordId)} challenges you
            </div>
            <div className="note">
              {matchDetails(challenge)} · <Countdown at={challenge.expiresAt} /> to answer
            </div>
          </div>
        </div>
      </div>
    );
  const n = matches.length;
  return (
    <div className="pip">
      <Logo />
      <div className="pip-box">
        <div className="mt">
          {n === 0 ? "No active Matches" : `${n} active Match${n === 1 ? "" : "es"}`}
        </div>
      </div>
    </div>
  );
};
