// The race drawer's math on two Ghost profiles (RunRace in lib/rows.ts). A profile is a
// run's time at each of n equal parts of its own path, the last its finish; both runs
// start at time 0 at fraction 0. Gaps are in seconds, positive where this run is behind.

/* the gap at each point */
export const gaps = (run: ReadonlyArray<number>, rival: ReadonlyArray<number>) =>
  run.map((t, i) => t - rival[i]);

export const gapAtLine = (run: ReadonlyArray<number>, rival: ReadonlyArray<number>) =>
  run[run.length - 1] - rival[rival.length - 1];

/* the race runs until the slower run finishes */
export const raceEnd = (run: ReadonlyArray<number>, rival: ReadonlyArray<number>) =>
  Math.max(run[run.length - 1], rival[rival.length - 1]);

/* the fraction of its path a run has reached at race time t */
export function reached(profile: ReadonlyArray<number>, t: number) {
  const n = profile.length;
  let before = 0;
  for (let i = 0; i < n; i++) {
    if (profile[i] >= t) {
      const span = profile[i] - before;
      return (i + (span > 0 ? Math.max(0, t - before) / span : 1)) / n;
    }
    before = profile[i];
  }
  return 1;
}

/* the race time a run reached fraction f of its path */
export function timeAt(profile: ReadonlyArray<number>, f: number) {
  const n = profile.length;
  const x = Math.max(0, Math.min(1, f)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const before = i ? profile[i - 1] : 0;
  return x >= n ? profile[n - 1] : before + (profile[i] - before) * (x - i);
}

/* the id of a row's race drawer, which its button controls */
export const raceDrawerId = (steamId: string) => "race-" + steamId;
