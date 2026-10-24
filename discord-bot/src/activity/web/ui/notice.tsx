// A screen of its own, for when there's nothing else to show: signing in, loading, a refusal.
// The server draws the signing-in one into the page itself, so it shows before any script runs.
import type { ReactNode } from "react";
import { Logo } from "./art.js";

export const Notice = ({ children }: { readonly children: ReactNode }) => (
  <div className="vE">
    <div className="emptyb" style={{ border: 0 }}>
      <Logo />
      {children}
    </div>
  </div>
);

export const SigningIn = () => (
  <Notice>
    <span className="note">Signing in…</span>
  </Notice>
);
