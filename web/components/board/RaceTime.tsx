import { raceDrawerId } from "../../lib/race";

/* a run's time, which opens its race drawer when the run races */
export function RaceTime({
  steamId,
  who,
  score,
  className,
  open,
  onRace,
}: {
  steamId: string;
  who: string;
  score: React.ReactNode;
  className?: string;
  open: boolean;
  /* absent when the run doesn't race */
  onRace?: (steamId: string) => void;
}) {
  if (!onRace) return <span className={className}>{score}</span>;
  return (
    <button
      type="button"
      className={className ? `${className} c-race` : "c-race"}
      aria-expanded={open}
      aria-controls={open ? raceDrawerId(steamId) : undefined}
      aria-label={`Race ${who}'s run`}
      onClick={() => {
        onRace(steamId);
      }}
    >
      {score}
    </button>
  );
}
