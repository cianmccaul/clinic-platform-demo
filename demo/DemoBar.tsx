"use client";

/**
 * Demo only: a slim bar above the real pages, with the demo inbox (every
 * email the clinic "sends", including sign-in codes), quick links and reset.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { whenShort } from "@/core/format";
import "./install";
import { getDb, onDemoChange, resetDemo } from "./server";

let version = 0;
const subscribe = (l: () => void) => onDemoChange(() => (version++, l()));

export function DemoBar() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => setReady(true), []);
  const count = ready ? getDb().outbox.length : 0;

  return (
    <>
      <div className="demo-bar" role="region" aria-label="Demo controls">
        <div className="demo-bar-inner">
          <p className="demo-bar-text">
            <strong>Demo</strong>
            <span className="demo-bar-long"> with a fictional clinic and made-up patients. Nothing is real or sent.</span>
          </p>
          <nav className="demo-bar-links" aria-label="Demo areas">
            <button type="button" className="demo-bar-button" onClick={() => setOpen(true)}>
              Inbox{count > 0 ? ` (${count})` : ""}
            </button>
            <a href="/">Book</a>
            <a href="/manage">Manage booking</a>
            <a href="/dashboard">Dashboard</a>
            <a href="/help">Help</a>
            <button
              type="button"
              className="demo-bar-button"
              onClick={() => {
                resetDemo();
                window.location.href = "/";
              }}
            >
              Reset
            </button>
          </nav>
        </div>
      </div>
      {open && <Inbox onClose={() => setOpen(false)} />}
    </>
  );
}

function Inbox({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const mails = getDb().outbox;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="demo-inbox-backdrop" onClick={onClose}>
      <aside className="demo-inbox" role="dialog" aria-modal="true" aria-labelledby="demo-inbox-title" onClick={(e) => e.stopPropagation()}>
        <div className="demo-inbox-head">
          <div>
            <h2 id="demo-inbox-title">Demo inbox</h2>
            <p className="secondary">Every email the clinic sent during this demo, newest first.</p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {mails.length === 0 ? (
          <p className="secondary demo-inbox-empty">No emails yet. Book an appointment, or ask for a code on Manage a booking.</p>
        ) : (
          <ul className="demo-inbox-list">
            {mails.map((m) => (
              <li key={m.id}>
                <p className="demo-inbox-meta">
                  To {m.to}, {whenShort(m.at)}
                </p>
                <p className="demo-inbox-subject">{m.subject}</p>
                <MailBody text={m.text} onNavigate={onClose} />
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
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
