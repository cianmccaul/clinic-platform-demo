"use client";

/**
 * Demo only: everything wrapped around the real pages.
 * - a slim bar above each page: back to the portfolio, the Inbox (every email
 *   and text the clinic "sends"), Reset, and on phones a Menu button;
 * - a sidebar (desktop) or Menu (phones) listing every page of the demo;
 * - a "try this" hint for the page you're on (DemoHints);
 * - a simulated phone notification when a sign-in code is sent (DemoNotification).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { whenShort } from "@/core/format";
import "./install";
import { getDb, onDemoChange, resetDemo } from "./server";
import { DemoHint } from "./DemoHints";
import { DemoNotification } from "./DemoNotification";
import { NAV, PORTFOLIO_URL, currentHref } from "./nav";

let version = 0;
const subscribe = (l: () => void) => onDemoChange(() => (version++, l()));
/** Re-render when the demo's data changes (a booking made, an email sent). */
export function useDemoVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

function reset() {
  resetDemo();
  window.location.href = "/";
}

export function DemoBar() {
  const [ready, setReady] = useState(false);
  const [inbox, setInbox] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname() ?? "/";
  useDemoVersion();
  useEffect(() => setReady(true), []);
  const count = ready ? getDb().outbox.length : 0;
  const closeMenu = () => {
    setMenu(false);
    menuButton.current?.focus();
  };

  return (
    <>
      <aside className="demo-sidebar" aria-label="Demo pages">
        <div className="demo-sidebar-head">
          <p className="demo-sidebar-title">Clinic platform demo</p>
          <p className="demo-sidebar-sub">A fictional clinic. Nothing is real or sent.</p>
        </div>
        <NavList pathname={pathname} id="side" />
        <div className="demo-sidebar-foot">
          <a className="demo-portfolio" href={PORTFOLIO_URL}>
            <span aria-hidden="true">←</span> Back to portfolio
          </a>
        </div>
      </aside>

      <div className="demo-bar" role="region" aria-label="Demo controls">
        <div className="demo-bar-inner">
          <a className="demo-portfolio demo-bar-portfolio" href={PORTFOLIO_URL}>
            <span aria-hidden="true">←</span> Back to portfolio
          </a>
          <p className="demo-bar-text">
            <strong>Demo</strong>
            <span className="demo-bar-long"> with a fictional clinic and made-up patients. Nothing is real or sent.</span>
          </p>
          <div className="demo-bar-links">
            <button type="button" className="demo-bar-button" onClick={() => setInbox(true)}>
              Inbox{count > 0 ? ` (${count})` : ""}
            </button>
            <button type="button" className="demo-bar-button demo-bar-reset" onClick={reset}>
              Reset
            </button>
            <button ref={menuButton} type="button" className="demo-menu-button" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Menu
            </button>
          </div>
        </div>
      </div>

      <DemoHint pathname={pathname} />
      <DemoNotification />

      {menu && (
        <Drawer side="left" title="Menu" lede="Every page of the demo." onClose={closeMenu}>
          <NavList pathname={pathname} id="menu" onNavigate={() => setMenu(false)} />
          <div className="demo-drawer-foot">
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Reset the demo
            </button>
            <a className="demo-portfolio" href={PORTFOLIO_URL}>
              <span aria-hidden="true">←</span> Back to portfolio
            </a>
          </div>
        </Drawer>
      )}
      {inbox && (
        <Drawer side="right" title="Demo inbox" lede="Every email and text the clinic sent during this demo, newest first." onClose={() => setInbox(false)}>
          <Inbox onNavigate={() => setInbox(false)} />
        </Drawer>
      )}
    </>
  );
}

function NavList({ pathname, id, onNavigate }: { pathname: string; id: string; onNavigate?: () => void }) {
  const here = currentHref(pathname);
  return (
    <nav className="demo-nav" aria-label="All pages">
      {NAV.map((g, i) => (
        <section key={g.title} aria-labelledby={`${id}-nav-${i}`}>
          <h2 id={`${id}-nav-${i}`}>{g.title}</h2>
          <ul role="list">
            {g.items.map((item) => (
              <li key={item.href}>
                <a href={item.href} aria-current={here === item.href ? "page" : undefined} onClick={onNavigate}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** A panel from the side: Escape or the backdrop closes it, and Tab stays inside while it's open. */
function Drawer({ side, title, lede, onClose, children }: { side: "left" | "right"; title: string; lede: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const items = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const titleId = `demo-drawer-${side}`;
  return (
    <div className={`demo-drawer-backdrop is-${side}`} onClick={onClose}>
      <aside ref={panel} className="demo-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="demo-drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="secondary">{lede}</p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="demo-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function Inbox({ onNavigate }: { onNavigate: () => void }) {
  const mails = getDb().outbox;
  if (mails.length === 0) return <p className="secondary demo-inbox-empty">Nothing yet. Book an appointment, or ask for a code on Manage a booking.</p>;
  return (
    <ul className="demo-inbox-list">
      {mails.map((m) => (
        <li key={m.id}>
          <p className="demo-inbox-meta">
            <span className={`demo-inbox-kind${m.channel === "sms" ? " is-text" : ""}`}>{m.channel === "sms" ? "Text" : "Email"}</span> to {m.to}, {whenShort(m.at)}
          </p>
          {m.channel !== "sms" && <p className="demo-inbox-subject">{m.subject}</p>}
          <MailBody text={m.text} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

/** Plain text, with [label](/path) links turned into real links. */
function MailBody({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <p className="demo-inbox-body">
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (!m) return <span key={i}>{p}</span>;
        const internal = m[2].startsWith("/");
        return (
          <a key={i} className="btn btn-primary demo-inbox-link" href={internal ? m[2] : "#"} onClick={internal ? onNavigate : (e) => e.preventDefault()}>
            {m[1]}
          </a>
        );
      })}
    </p>
  );
}
