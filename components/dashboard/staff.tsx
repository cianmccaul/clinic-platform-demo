"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CodeEntry } from "@/components/booking/Steps";
import { allowedOnWeakSession, needsStrongFor, type Permission, type Role } from "@/core/roles";
import { BackToDashboard } from "@/components/dashboard/BackToDashboard";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { PASSKEY_SETUP_TIMEOUT_MS, passkeySetupFor, type PasskeySetup } from "@/core/passkey-support";
import { clearAllPhoneDrafts } from "@/core/phone-draft";

/**
 * The dashboard's shared pieces: who is signed in (useStaff), the sign-in
 * screen, Face ID setup, and the gate each page sits behind. Showing or
 * hiding things here is only for clarity: every action is checked again on
 * the server (lib/staff.ts).
 */

export type Me =
  | { signedIn: false }
  | {
      signedIn: true;
      id: string;
      name: string;
      email: string;
      role: Role;
      roleLabel: string;
      strong: boolean;
      passkeySession: boolean;
      computer: "approved" | "waiting" | "unknown";
      passkeys: number;
      waitingDevices: { id: string; name: string; createdAt: string; kind?: "face_id" | "computer" }[];
      timesheets: boolean;
      approvesDevices: boolean;
      limited: boolean;
      permissions: Permission[];
      ownPractitionerId: string | null;
      guides: string[];
    };

let registering: Promise<string | null> | null = null;

export function useStaff() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computerError, setComputerError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setError(null);
    const load = async (): Promise<Me> => {
      const res = await fetch("/api/staff/me", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sign-in is unavailable right now.");
      return data;
    };
    try {
      let data = await load();
      // First time this browser has signed in: the server approves it or asks for approval
      // (core/devices.ts), and remembers it with a cookie.
      if (data.signedIn && data.computer === "unknown") {
        setComputerError(null);
        // One request at a time, even if the page loads twice, so a second answer can't replace the first one's cookie.
        registering ??= fetch("/api/staff/computer", { method: "POST" })
          .then(async (r) => (r.ok ? null : ((await r.json().catch(() => null))?.error ?? "Couldn't remember this computer. Try again in a minute.")))
          .catch(() => "Couldn't remember this computer. Try again in a minute.")
          .finally(() => {
            registering = null;
          });
        const failed = await registering;
        if (failed) setComputerError(failed);
        data = await load();
      }
      // Signed out (or the session ended): no phone booking in progress is kept in this tab.
      if (!data.signedIn) clearAllPhoneDrafts();
      setMe(data);
    } catch (err: any) {
      setError(err.message ?? "Sign-in is unavailable right now.");
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { me, error, reload, computerError };
}

export { BackToDashboard };

export function DashboardShell({ title, lede, narrow, home, children }: { title: string; lede?: ReactNode; narrow?: boolean; home?: boolean; children: ReactNode }) {
  // Each page its own tab title, so screen readers and browser tabs say where you are (review, 15 Oct).
  useEffect(() => {
    document.title = title === "Dashboard" ? "Dashboard · Northbank" : `${title} · Northbank dashboard`;
  }, [title]);
  return (
    <>
      <SiteHeader variant="staff" />
      <main id="main" className={narrow ? "page page-narrow" : "page"}>
        {!home && title !== "Dashboard" && <BackToDashboard />}
        <div className="page-intro">
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {children}
      </main>
    </>
  );
}

const plainError = (e: { message?: string; code?: string } | null | undefined, fallback: string) => {
  if (!e) return fallback;
  if (e.code === "TOO_MANY_ATTEMPTS" || /too many/i.test(e.message ?? "")) return "Too many tries. Ask for a new code.";
  if (/invalid|expired/i.test(e.message ?? "")) return "That code is incorrect or has expired.";
  return e.message || fallback;
};

// ---------------------------------------------------------------- this device

/**
 * Whether this browser has its own Face ID for the dashboard, remembered
 * here so the sign-in page can lead with the emailed code on a new device
 * instead of a Face ID prompt that would fall back to a QR code. Only a
 * convenience: the server decides everything (core/devices.ts).
 */
const HERE_KEY = "northbank-faceid-here";
const WAITING_KEY = "northbank-faceid-waiting";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) === "1";
    } catch {
      return false;
    }
  },
  set: (k: string, on: boolean) => {
    try {
      if (on) localStorage.setItem(k, "1");
      else localStorage.removeItem(k);
    } catch {}
  },
};
export const thisDevice = {
  hasFaceId: () => store.get(HERE_KEY),
  isWaiting: () => store.get(WAITING_KEY),
  setUp: (waiting: boolean) => {
    store.set(HERE_KEY, true);
    store.set(WAITING_KEY, waiting);
  },
  signedInHere: () => {
    store.set(HERE_KEY, true);
    store.set(WAITING_KEY, false);
  },
};

/**
 * Sign in with Face ID. Remembers this device only when the passkey was on
 * this device itself (not a phone scanned with a QR code).
 */
export async function passkeySignIn(): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = (await authClient.signIn.passkey({ returnWebAuthnResponse: true } as never)) as {
    error?: { message?: string; code?: string } | null;
    webauthn?: { response?: { authenticatorAttachment?: string } };
  } | null;
  if (r?.error) {
    const m = r.error.message ?? "";
    if (r.error.code === "DEVICE_WAITING" || /waiting to be approved/i.test(m)) return { ok: false, message: m };
    if (/cancel|abort|not allowed/i.test(m) || r.error.code === "AUTH_CANCELLED")
      return { ok: false, message: "Face ID was cancelled, or this device doesn't have your Face ID yet. Use an emailed code instead." };
    return { ok: false, message: "That didn't work on this device. Use an emailed code instead, then set up Face ID here." };
  }
  if (r?.webauthn?.response?.authenticatorAttachment !== "cross-platform") thisDevice.signedInHere();
  return { ok: true };
}

/** Sign in: Face ID / fingerprint first on a device that has it; otherwise the emailed code first. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"start" | "code">("start");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState(true);
  useEffect(() => setHere(thisDevice.hasFaceId()), []);

  // Offer a saved passkey in the email box's autofill where the browser supports it.
  useEffect(() => {
    if (typeof PublicKeyCredential === "undefined" || !PublicKeyCredential.isConditionalMediationAvailable) return;
    PublicKeyCredential.isConditionalMediationAvailable()
      .then((ok) => {
        if (ok)
          return authClient.signIn.passkey({ autoFill: true, returnWebAuthnResponse: true } as never).then((r) => {
            const res = r as { error?: unknown; webauthn?: { response?: { authenticatorAttachment?: string } } } | null;
            if (res && !res.error) {
              if (res.webauthn?.response?.authenticatorAttachment !== "cross-platform") thisDevice.signedInHere();
              onSignedIn();
            }
          });
      })
      .catch(() => {});
  }, [onSignedIn]);

  async function withPasskey() {
    setBusy(true);
    setError(null);
    const r = await passkeySignIn();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSignedIn();
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    const r = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "sign-in" });
    setBusy(false);
    if (r.error && r.error.status === 429) return setError("Too many codes asked for. Wait a minute and try again.");
    // Same answer whether or not the email is on the team.
    setStage("code");
    setCode("");
    setSentAt(Date.now());
  }

  async function checkCode() {
    setBusy(true);
    setError(null);
    const r = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp: code.replace(/\D/g, "") });
    setBusy(false);
    if (r.error) return setError(plainError(r.error, "That code didn't work. Check it and try again."));
    onSignedIn();
  }

  return (
    <DashboardShell title="Sign in" lede="The Northbank dashboard is for staff. Patients can book and manage appointments on book.northbank.example." narrow home>
      <div className="stack-5">
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {here ? (
          <>
        <section className="summary-panel stack-3">
          <h2>Face ID or fingerprint</h2>
          <p>{here ? "The quickest way in on this device." : "On a phone or computer you've already set up. On a new one, use an emailed code first."}</p>
          <div>
            <button className={here ? "btn btn-primary" : "btn btn-secondary"} onClick={withPasskey} disabled={busy}>
              Sign in with Face ID or fingerprint
            </button>
          </div>
        </section>
        <section className="summary-panel stack-3">
          <h2>Email me a code</h2>
          {stage === "start" ? (
            <form
              className="inline-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (email.includes("@")) sendCode();
              }}
            >
              <div className="field">
                <label htmlFor="staff-email">Your work email</label>
                <input
                  id="staff-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username webauthn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={busy || !email.includes("@")}>
                Email me a code
              </button>
            </form>
          ) : (
            <CodeEntry
              email={email}
              code={code}
              busy={busy}
              sentAt={sentAt}
              error={null}
              onChange={setCode}
              onSubmit={checkCode}
              onResend={sendCode}
              submitLabel="Sign in"
              intro={
                <>
                  If <strong>{email}</strong> is on the Northbank team, we&apos;ve emailed it a 6-digit code. Not on the team yet? Ask the clinic owner to
                  add you.
                </>
              }
            />
          )}
          {stage === "code" && (
            <button className="link-button" onClick={() => setStage("start")}>
              Use a different email
            </button>
          )}
        </section>
          </>
        ) : (
          <>
        <section className="summary-panel stack-3">
          <h2>Email me a code</h2>
          {stage === "start" ? (
            <form
              className="inline-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (email.includes("@")) sendCode();
              }}
            >
              <div className="field">
                <label htmlFor="staff-email">Your work email</label>
                <input
                  id="staff-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username webauthn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={busy || !email.includes("@")}>
                Email me a code
              </button>
            </form>
          ) : (
            <CodeEntry
              email={email}
              code={code}
              busy={busy}
              sentAt={sentAt}
              error={null}
              onChange={setCode}
              onSubmit={checkCode}
              onResend={sendCode}
              submitLabel="Sign in"
              intro={
                <>
                  If <strong>{email}</strong> is on the Northbank team, we&apos;ve emailed it a 6-digit code. Not on the team yet? Ask the clinic owner to
                  add you.
                </>
              }
            />
          )}
          {stage === "code" && (
            <button className="link-button" onClick={() => setStage("start")}>
              Use a different email
            </button>
          )}
        </section>
        <section className="summary-panel stack-3">
          <h2>Face ID or fingerprint</h2>
          <p>{here ? "The quickest way in on this device." : "On a phone or computer you've already set up. On a new one, use an emailed code first."}</p>
          <div>
            <button className={here ? "btn btn-primary" : "btn btn-secondary"} onClick={withPasskey} disabled={busy}>
              Sign in with Face ID or fingerprint
            </button>
          </div>
        </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

/**
 * Set up Face ID / fingerprint / PIN on this device (this device's own, never
 * a QR code to another one). Works the same on iPhone, Mac, Android, Samsung
 * and Windows (core/passkey-support.ts): it's only offered where the device
 * has its own fingerprint, face or screen-lock PIN, and a request the device
 * never answers is cancelled after 60 s (or with Stop) instead of hanging.
 * The first one works at once; a later one added on an emailed-code session
 * waits for approval (core/devices.ts). `onDone(waiting)` says which.
 */
export function AddPasskey({ onDone, label = "Set up Face ID or fingerprint" }: { onDone: (waiting: boolean) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // undefined while checking the device; then what it can do.
  const [setup, setSetup] = useState<PasskeySetup | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const ua = navigator.userAgent;
    const check =
      typeof PublicKeyCredential === "undefined" || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
        ? Promise.resolve(null)
        : PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => null);
    check.then((platformAuthenticator) => {
      if (live) setSetup(typeof PublicKeyCredential === "undefined" ? { offer: false } : passkeySetupFor({ userAgent: ua, platformAuthenticator }));
    });
    return () => {
      live = false;
    };
  }, []);

  async function add() {
    if (!setup?.offer) return;
    setBusy(true);
    setError(null);
    // The server names the device from its browser (core/devices.ts).
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      WebAuthnAbortService.cancelCeremony();
    }, PASSKEY_SETUP_TIMEOUT_MS);
    const r = await authClient.passkey.addPasskey(setup.attachment ? { authenticatorAttachment: setup.attachment } : {});
    clearTimeout(timer);
    if (r?.error) {
      setBusy(false);
      const code = (r.error as { code?: string }).code ?? "";
      const m = r.error.message ?? "";
      setError(
        timedOut
          ? "Nothing happened, so we stopped asking. That's fine: keep signing in with your emailed code. See the sign-in guide if you'd like to try again."
          : /PREVIOUSLY_REGISTERED|InvalidState/i.test(code)
            ? "This device already has your Face ID or fingerprint. Press Sign in with Face ID or fingerprint instead."
            : /ABORTED|cancel|abort|not allowed/i.test(code + " " + m)
              ? "Setup was stopped. Try again when you're ready, or keep using your emailed code."
              : m || "That didn't work on this device. Try again, or ask an owner for help."
      );
      return;
    }
    // Ask the server whether it's waiting (an emailed-code session with Face ID elsewhere).
    const me = await fetch("/api/staff/devices", { cache: "no-store" })
      .then((x) => x.json())
      .catch(() => null);
    const mine = (me?.devices ?? []) as { id: string; waiting: boolean }[];
    const waiting = mine.some((d) => d.id === (r.data as { id?: string } | null)?.id && d.waiting);
    thisDevice.setUp(waiting);
    setBusy(false);
    onDone(waiting);
  }

  if (setup === undefined) return null;
  if (!setup.offer)
    return (
      <p className="secondary" data-testid="passkey-not-offered">
        This device doesn&apos;t have a fingerprint, face or screen-lock PIN we can use, and that&apos;s fine: your emailed code is all you need here. (On
        Windows, setting up Windows Hello adds one. Then reload this page.)
      </p>
    );
  return (
    <div className="stack-3">
      {error && (
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      )}
      <div>
        <button className="btn btn-primary" onClick={add} disabled={busy}>
          {busy ? "Waiting for your device…" : label}
        </button>
      </div>
      {busy && (
        <p className="secondary">
          Your phone or computer should ask for your face, fingerprint or PIN.{" "}
          <button className="link-button" onClick={() => WebAuthnAbortService.cancelCeremony()}>
            Stop
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Reception and owners on an emailed-code session from a computer that isn't
 * approved yet (core/devices.ts): it opens the guides only, until the person
 * (on a device already set up) or an owner approves it. Face ID is optional.
 */
export function StrongSignInNotice({ me, onDone, computerError }: { me: Extract<Me, { signedIn: true }>; onDone: () => void; computerError?: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [hasFaceId, setHasFaceId] = useState(false);
  useEffect(() => setHasFaceId(thisDevice.hasFaceId()), []);

  async function signInWithFaceId() {
    setError(null);
    const r = await passkeySignIn();
    if (!r.ok) return setError(r.message);
    onDone();
  }

  if (me.computer === "unknown") {
    return (
      <Notice tone="warning" title="We couldn't remember this computer">
        <p>{computerError ?? "Something went wrong while setting this computer up. Try again, or ask an owner for help."}</p>
        <div className="actions">
          <button className="btn btn-primary" onClick={onDone}>
            Try again
          </button>
        </div>
      </Notice>
    );
  }

  return (
    <Notice tone="warning" title="This computer is waiting for approval">
      <p>
        You signed in with your emailed code, and this is the first time on this computer. Until it&apos;s approved you can read the guides. To approve
        it, open the dashboard on a phone or computer you&apos;ve already used, and press <strong>Approve</strong> there. Or ask an owner to approve it
        on the Team page. We&apos;ve emailed you and the clinic about it.
      </p>
      <div className="actions">
        <button className="btn btn-primary" onClick={onDone}>
          It&apos;s approved: check again
        </button>
        {hasFaceId && (
          <button className="btn btn-secondary" onClick={signInWithFaceId}>
            Sign in with Face ID or fingerprint instead
          </button>
        )}
      </div>
      {error && <p>{error}</p>}
    </Notice>
  );
}

/**
 * An optional tip, shown only where the browser says it has a fingerprint,
 * Face ID or screen-lock PIN to offer: one-tap sign-in on this device.
 */
export function FaceIdTip({ me }: { me: Extract<Me, { signedIn: true }> }) {
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    if (typeof PublicKeyCredential === "undefined" || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((ok) => setOffer(ok && !thisDevice.hasFaceId()))
      .catch(() => {});
  }, []);
  if (!offer || !me.strong || me.passkeys > 0) return null;
  return (
    <Notice title="Optional: one-tap sign-in">
      <p>
        This device can sign you in with its fingerprint, Face ID or PIN. You don&apos;t need it: your emailed code works here.{" "}
        <a href="/dashboard/account">Set it up</a> if you&apos;d like it.
      </p>
    </Notice>
  );
}

/**
 * New devices waiting to join this person's Face ID sign-in: approve them, or
 * turn them away. Shown on a Face ID session (dashboard home, Your sign-in).
 */
export function WaitingDevices({ devices, onChange }: { devices: { id: string; name: string; createdAt: string; kind?: "face_id" | "computer" }[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (!devices.length && !message) return null;
  async function decide(id: string, action: "approve" | "reject", question: string) {
    if (!window.confirm(question)) return;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/staff/devices/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok ? { tone: "success", text: data.message } : { tone: "error", text: data.error ?? "That didn't work." });
      onChange();
    } finally {
      setBusy(null);
    }
  }
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack-3">
      {message && (
        <Notice tone={message.tone}>
          <p>{message.text}</p>
        </Notice>
      )}
      {devices.map((d) => (
        <Notice key={d.id} tone="warning" title={`New device waiting: ${d.name}`}>
          <p>
            {d.kind === "computer" ? "Someone signed in on" : "Face ID was set up on"} {/^[aeiou]|^i[A-Z]/i.test(d.name) ? "an" : "a"} {d.name} with your emailed code (
            {when(d.createdAt)}). Was that you?
          </p>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => decide(d.id, "approve", `Approve ${d.name}? It can then sign in ${d.kind === "computer" ? "with an emailed code" : "with Face ID"}.`)}
            >
              Approve
            </button>
            <button
              className="btn btn-destructive"
              disabled={!!busy}
              onClick={() => decide(d.id, "reject", `Remove ${d.name}? It won't be able to sign in, and any emailed-code sign-ins on your account end.`)}
            >
              It wasn&apos;t me
            </button>
          </div>
        </Notice>
      ))}
    </div>
  );
}

/**
 * New devices waiting on colleagues' accounts, for owners, super admins and
 * device approvers (Team page switch, core/devices.ts, 10 Nov 2026). The
 * server decides whose devices are listed and checks again on Approve.
 */
export function TeamWaitingDevices() {
  type D = { id: string; name: string; createdAt: string; kind: "face_id" | "computer"; userId: string; userName: string; roleLabel: string };
  const [devices, setDevices] = useState<D[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/staff/devices/team", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    setDevices(Array.isArray(data?.devices) ? data.devices : []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!devices.length && !message) return null;
  async function decide(d: D, action: "approve" | "reject", question: string) {
    if (!window.confirm(question)) return;
    setBusy(d.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/staff/devices/${encodeURIComponent(d.id)}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok ? { tone: "success", text: data.message } : { tone: "error", text: data.error ?? "That didn't work." });
      await load();
    } finally {
      setBusy(null);
    }
  }
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack-3">
      {message && (
        <Notice tone={message.tone}>
          <p>{message.text}</p>
        </Notice>
      )}
      {devices.map((d) => {
        const first = d.userName.split(" ")[0];
        return (
          <Notice key={d.id} tone="warning" title={`${d.userName} is waiting to sign in: ${d.name}`}>
            <p>
              {d.roleLabel} · {d.kind === "computer" ? "signed in on a new phone or computer" : "set up Face ID on a new device"} with an emailed code ({when(d.createdAt)}). Check with {first} that it was
              them (a call or message, not email) before approving.
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() => decide(d, "approve", `Approve ${d.userName}'s ${d.name}? Only if ${first} has told you it's theirs.`)}
              >
                Approve
              </button>
              <button
                className="btn btn-destructive"
                disabled={!!busy}
                onClick={() => decide(d, "reject", `Remove ${d.userName}'s ${d.name}? It won't be able to sign in, and ${first}'s emailed-code sign-ins end.`)}
              >
                Not them, remove
              </button>
            </div>
          </Notice>
        );
      })}
    </div>
  );
}

/**
 * Wraps a dashboard page: shows sign-in, Face ID setup, or "not part of your
 * role" as needed, otherwise the page.
 */
export function StaffGate({ permission, title, children }: { permission: Permission; title: string; children: (me: Extract<Me, { signedIn: true }>) => ReactNode }) {
  const { me, error, reload, computerError } = useStaff();
  if (error) {
    return (
      <DashboardShell title={title} narrow>
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      </DashboardShell>
    );
  }
  if (!me) return <DashboardShell title={title} narrow>{<p className="secondary">Loading…</p>}</DashboardShell>;
  if (!me.signedIn) return <SignIn onSignedIn={reload} />;
  if (!me.permissions.includes(permission)) {
    return (
      <DashboardShell title={title} narrow>
        <Notice title="Not part of your role" actions={<a className="btn btn-secondary" href="/dashboard">Back to the dashboard</a>}>
          <p>Your role ({me.roleLabel}) doesn&apos;t include this page. Ask the clinic owner if you need it.</p>
        </Notice>
      </DashboardShell>
    );
  }
  // Money roles on a weak session (me.limited), and therapists on a page that sends a payment request in the
  // clinic's name (Book a patient in, Payment for a past appointment): the server would refuse every request,
  // so say how to get a strong sign-in here rather than show the server's error on the page.
  if ((me.limited || (needsStrongFor(me.role, permission) && !me.strong)) && !allowedOnWeakSession(permission)) {
    return (
      <DashboardShell title={title} narrow>
        <StrongSignInNotice me={me} onDone={reload} computerError={computerError} />
      </DashboardShell>
    );
  }
  return <>{children(me)}</>;
}

export function Tile({ href, title, desc, badge }: { href: string; title: string; desc: string; badge?: string }) {
  return (
    <li>
      <a className="option" href={href}>
        <span className="option-main">
          <span className="option-title">
            {title}
            {badge && (
              <>
                {" "}
                <span className="badge is-warn">{badge}</span>
              </>
            )}
          </span>
          <span className="option-desc">{desc}</span>
        </span>
        <Icon name="chevron-right" className="option-chevron" />
      </a>
    </li>
  );
}
