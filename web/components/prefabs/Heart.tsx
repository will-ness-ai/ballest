// The favorite heart, filled when `on`.
export function Heart({ on }: { on?: boolean }) {
  return (
    <svg className={"pf-heart" + (on ? " on" : "")} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}
