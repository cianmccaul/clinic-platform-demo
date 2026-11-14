"use client";

/**
 * Demo only: a small "try this" card under the demo bar, one per page, so a
 * visitor with two minutes knows what to do next. It sits in the page's flow
 * (it never covers anything), every control is a real button or link, and
 * closing it is remembered in this browser.
 */
import { useEffect, useState } from "react";
import { displayCode } from "@/core/vouchers";
import { fillField } from "./fill";
import { hintFor, type Hint } from "./nav";
import { getDb } from "./server";

const KEY = "northbank-demo:hints-closed";
const readClosed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};

/** "{voucher}" in a hint is the seeded part-used voucher's code, which is different each day. */
function resolve(value: string) {
  if (value !== "{voucher}") return value;
  const v = getDb().vouchers.find((x) => x.id === "v-demo-1") ?? getDb().vouchers[0];
  return v ? displayCode(v.code) : "";
}

export function DemoHint({ pathname }: { pathname: string }) {
  const hint = hintFor(pathname);
  const [closed, setClosed] = useState<string[] | null>(null);
  useEffect(() => setClosed(readClosed()), []);
  if (!hint || !closed || closed.includes(hint.id)) return null;
  const close = () => {
    const next = [...closed, hint.id];
    setClosed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  return <HintCard key={hint.id} hint={hint} onClose={close} />;
}

function HintCard({ hint, onClose }: { hint: Hint; onClose: () => void }) {
  // A fill button only shows while its field is on the page (the email box on step 4, say).
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => {
    if (!hint.fills?.length) return;
    const check = () => {
      const now = [...new Set(hint.fills!.map((f) => f.selector))].filter((s) => document.querySelector(s));
      setPresent((prev) => (prev.join() === now.join() ? prev : now));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hint]);
  const fills = (hint.fills ?? []).filter((f) => present.includes(f.selector));

  return (
    <aside className="demo-hint" aria-label="Demo tip">
      <div className="demo-hint-inner">
        <span className="demo-hint-tag">Try this</span>
        <div className="demo-hint-body">
          <p className="demo-hint-title">{hint.title}</p>
          <p className="demo-hint-text">{hint.text}</p>
          {(fills.length > 0 || hint.next) && (
            <div className="demo-hint-actions">
              {fills.map((f) => (
                <button key={f.label} type="button" className="demo-hint-fill" onClick={() => fillField(f.selector, resolve(f.value), { submit: f.submit })}>
                  {f.label}
                </button>
              ))}
              {hint.next && (
                <a className="demo-hint-next" href={hint.next.href}>
                  {hint.next.label} <span aria-hidden="true">→</span>
                </a>
              )}
            </div>
          )}
        </div>
        <button type="button" className="demo-hint-close" onClick={onClose} aria-label={`Hide this tip: ${hint.title}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
