// The score between two players, A's wins, a dash, B's wins: the head to head's tally and
// the score card's. No state, so server and client components both use it.
import { fmtN } from "../../lib/rules";

export function Score({ t }: { t: { a: number; b: number } }) {
  return (
    <span className="score">
      <span className="ca">{fmtN(t.a)}</span>
      <span className="d">&ndash;</span>
      <span className="cb">{fmtN(t.b)}</span>
    </span>
  );
}
