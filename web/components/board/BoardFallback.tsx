// What a board shows while its page is read: the frame of the board view with its rows
// as grey bars, as the single-page site showed while a board file loaded.
export function BoardFallback() {
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
          {Array.from({ length: 8 }, (_, i) => (
            <div className="skel" key={i}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
