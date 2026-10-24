// The control kit every page draws its controls with (spec #339, round 4's variant 1, styled
// in app/styles/controls.css): a choice is a pill in a named row of them, lit when it is the
// current page (a link) or pressed (a button); a search box is a rounded field with a
// magnifier. An action is a plain link or button with the `btn` class, and a select the
// `field` class. No state here, so server and client components both draw them.
import Link from "next/link";

export function Pills({
  label,
  nav = false,
  className,
  children,
}: {
  label: string;
  /* a row of links to other pages is a navigation landmark, a row of buttons a group */
  nav?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = className ? "pills " + className : "pills";
  return nav ? (
    <nav className={cls} aria-label={label}>
      {children}
    </nav>
  ) : (
    <div className={cls} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function PillLink({
  href,
  on,
  scroll,
  children,
}: {
  href: string;
  on: boolean;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link className="pill" href={href} scroll={scroll} aria-current={on ? "page" : undefined}>
      {children}
    </Link>
  );
}

export function PillButton({
  on,
  children,
  ...props
}: { on: boolean; children: React.ReactNode } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "className" | "aria-pressed"
>) {
  return (
    <button type="button" className="pill" aria-pressed={on} {...props}>
      {children}
    </button>
  );
}

export function SearchBox({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={className ? "searchbox " + className : "searchbox"}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="7" />
        <path d="m16 16 5 5" />
      </svg>
      <input className="field" type="search" {...props} />
    </span>
  );
}
