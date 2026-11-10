"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Notice } from "@/components/Brand";
import { AddPasskey, DashboardShell, StaffGate, WaitingDevices, passkeySignIn } from "@/components/dashboard/staff";

/**
 * Your sign-in: the devices with your Face ID / fingerprint, new ones waiting
 * for approval, add this device, remove one, sign out (core/devices.ts).
 */
export default function AccountPage() {
  return (
    <StaffGate permission="guides:therapist" title="Your sign-in">
      {(me) => <Account strong={me.strong} passkeySession={me.passkeySession} />}
    </StaffGate>
  );
}

type Device = { id: string; name: string; createdAt: string; waiting: boolean; kind: "face_id" | "computer" };

function Account({ strong, passkeySession }: { strong: boolean; passkeySession: boolean }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/staff/devices", { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok || !d) return setError("Couldn't load your devices.");
    setDevices(d.devices);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const approved = devices?.filter((d) => !d.waiting) ?? [];
  const faceIds = approved.filter((d) => d.kind === "face_id");
  const waiting = devices?.filter((d) => d.waiting) ?? [];
  const added = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });

  return (
    <DashboardShell title="Your sign-in" lede="Your approved phones and computers, and any Face ID or fingerprint you've set up." narrow>
      <div className="stack-5">
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {notice && (
          <Notice tone="success">
            <p>{notice}</p>
          </Notice>
        )}

        {strong && <WaitingDevices devices={waiting} onChange={load} />}
        {!strong && waiting.length > 0 && (
          <Notice tone="warning" title="Waiting for approval">
            <p>
              {waiting.map((d) => d.name).join(", ")} {waiting.length === 1 ? "is" : "are"} waiting. Approve it on a phone or computer you&apos;ve
              already set up (sign in there with Face ID and open this page), or ask an owner. Then sign in here with Face ID.
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const r = await passkeySignIn();
                  if (!r.ok) return setError(r.message);
                  window.location.href = "/dashboard";
                }}
              >
                It&apos;s approved: sign in with Face ID
              </button>
            </div>
          </Notice>
        )}

        {devices?.length === 0 && <p>This computer isn&apos;t approved yet. Reload this page, or ask an owner for help.</p>}
        {approved.length > 0 && (
          <ul className="plain-list stack-3" role="list">
            {approved.map((k) => (
              <li key={k.id} className="panel">
                <p>
                  <strong>{k.name}</strong>
                </p>
                <p className="secondary">
                  Added {added(k.createdAt)} · {k.kind === "computer" ? "signs in with an emailed code" : "signs in with Face ID or fingerprint"}
                </p>
                {strong && k.kind === "computer" && (
                  <button
                    className="link-button"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${k.name}? It will need approving again before it can sign in. If it's the computer you're using now, you'll be signed out.`)) return;
                      const r = await fetch(`/api/staff/devices/${encodeURIComponent(k.id)}/reject`, { method: "POST" });
                      const d = await r.json().catch(() => ({}));
                      if (!r.ok) setError(d.error ?? "Couldn't remove it.");
                      else setNotice(d.message ?? "Removed.");
                      load();
                    }}
                  >
                    Remove
                  </button>
                )}
                {passkeySession && k.kind === "face_id" && faceIds.length > 1 && (
                  <button
                    className="link-button"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${k.name}? You won't be able to sign in with it any more.`)) return;
                      const r = await authClient.passkey.deletePasskey({ id: k.id });
                      if (r.error) setError("Couldn't remove it.");
                      else setNotice("Removed.");
                      load();
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {devices && (
          <section className="stack-3" aria-labelledby="add-device">
            <h2 id="add-device">Optional: Face ID or fingerprint on this device</h2>
            <p className="secondary">
              {strong
                ? "For one-tap sign-in. You don't need it: your emailed code works on every approved phone and computer. Only works if this device has a fingerprint, Face ID or PIN."
                : "Face ID or fingerprint isn't needed. Once this computer is approved, your emailed code is enough."}
            </p>
            <AddPasskey
              label={faceIds.length ? "Add Face ID on this device" : "Set up Face ID or fingerprint"}
              onDone={(isWaiting) => {
                setNotice(
                  isWaiting
                    ? "Set up. Now approve it on a phone or computer you've already set up. We've emailed you about it."
                    : "Done. Next time, sign in with one tap."
                );
                load();
              }}
            />
          </section>
        )}

        <div>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/dashboard";
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}
