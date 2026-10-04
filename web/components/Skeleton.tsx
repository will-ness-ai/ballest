// What a page shows while it is read: its frame with the rows as grey bars, as the
// single-page site showed while a file loaded. A board, a player's page or a head to head,
// and the Players table each keep their own frame.

/* `n` rows of grey bars */
function Bars({ n }: { n: number }) {
  return Array.from({ length: n }, (_, i) => (
    <div className="skel" key={i}>
      <span></span>
      <span></span>
      <span></span>
    </div>
  ));
}

/* a board's page: the rail and the bar over the list */
export function BoardSkeleton() {
  return (
    <div className="main">
      <aside className="rail">
        <h2 id="railhead">&nbsp;</h2>
        <nav className="boards" id="boards" aria-label="Leaderboard"></nav>
      </aside>
      <section className="content">
        <div className="boardbar">
          <div className="boardtitle">
            <p className="bmeta">&nbsp;</p>
          </div>
        </div>
        <div className="board" id="board">
          <Bars n={8} />
        </div>
      </section>
    </div>
  );
}

/* a player's page (id "player") and a head to head (id "vs") */
export function PlayerSkeleton({ id, className }: { id: string; className: string }) {
  return (
    <div className="main">
      <section className="content">
        <div className={className} id={id}>
          <div className="pseason">
            <Bars n={3} />
          </div>
        </div>
      </section>
    </div>
  );
}

/* the Players table, inside its section */
export function PlayersSkeleton() {
  return <Bars n={8} />;
}
