"use client";

import { useEffect, useState } from "react";
import { apiPath } from "@/app/lib/basePath";

interface Prefs {
  hiddenApps: string[];
  hiddenDomains: string[];
  privacyPinHash: string | null;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callApi(body: Record<string, unknown>) {
  return fetch(apiPath("/api/preferences"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function PrivacySection() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // PIN unlock form
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  // Set/change/remove PIN subflows
  const [mode, setMode] = useState<"idle" | "setPin" | "removePin" | "changePin">("idle");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [modeError, setModeError] = useState("");

  useEffect(() => {
    void fetch(apiPath("/api/preferences"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Prefs | null) => {
        setPrefs(data);
        if (data && window.location.hash === "#privacy") {
          document.getElementById("privacy")?.scrollIntoView({ behavior: "smooth" });
        }
      })
      .catch(() => {});
  }, []);

  async function restore(action: "showApp" | "showDomain", key: string) {
    const body = action === "showApp" ? { action, appKey: key } : { action, domain: key };
    const res = await callApi(body);
    if (res.ok) {
      setPrefs((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          hiddenApps:
            action === "showApp" ? prev.hiddenApps.filter((k) => k !== key) : prev.hiddenApps,
          hiddenDomains:
            action === "showDomain"
              ? prev.hiddenDomains.filter((d) => d !== key)
              : prev.hiddenDomains,
        };
      });
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs?.privacyPinHash) return;
    const hash = await sha256hex(pinInput);
    if (hash === prefs.privacyPinHash) {
      setUnlocked(true);
      setPinInput("");
      setPinError("");
    } else {
      setPinError("Incorrect PIN. Try again.");
      setPinInput("");
    }
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.length < 4) {
      setModeError("PIN must be at least 4 characters.");
      return;
    }
    if (newPin !== confirmPin) {
      setModeError("PINs don't match.");
      return;
    }
    // For changePin, verify current PIN first
    if (mode === "changePin" && prefs?.privacyPinHash) {
      const currentHash = await sha256hex(currentPinInput);
      if (currentHash !== prefs.privacyPinHash) {
        setModeError("Current PIN is incorrect.");
        return;
      }
    }
    const pinHash = await sha256hex(newPin);
    const res = await callApi({ action: "setPin", pinHash });
    if (res.ok) {
      setPrefs((prev) => prev ? { ...prev, privacyPinHash: pinHash } : prev);
      setMode("idle");
      setNewPin("");
      setConfirmPin("");
      setCurrentPinInput("");
      setModeError("");
      setUnlocked(true);
    }
  }

  async function handleRemovePin(e: React.FormEvent) {
    e.preventDefault();
    if (prefs?.privacyPinHash) {
      const hash = await sha256hex(currentPinInput);
      if (hash !== prefs.privacyPinHash) {
        setModeError("Incorrect PIN.");
        return;
      }
    }
    const res = await callApi({ action: "clearPin" });
    if (res.ok) {
      setPrefs((prev) => prev ? { ...prev, privacyPinHash: null } : prev);
      setMode("idle");
      setCurrentPinInput("");
      setModeError("");
    }
  }

  function cancelMode() {
    setMode("idle");
    setNewPin("");
    setConfirmPin("");
    setCurrentPinInput("");
    setModeError("");
  }

  if (!prefs) return null;

  const totalHidden = prefs.hiddenApps.length + prefs.hiddenDomains.length;
  const hasPivacyPin = Boolean(prefs.privacyPinHash);
  const isLocked = hasPivacyPin && !unlocked;

  return (
    <section id="privacy" className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <div className="flex items-center gap-2">
          {totalHidden > 0 && (
            <span className="text-xs text-on-surface-variant">{totalHidden} hidden</span>
          )}
          {hasPivacyPin && unlocked && (
            <button
              type="button"
              onClick={() => setUnlocked(false)}
              className="rounded-lg border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-high transition-colors"
            >
              Lock
            </button>
          )}
        </div>
      </div>

      {/* Locked state */}
      {isLocked ? (
        <form onSubmit={handleUnlock} className="space-y-3">
          <p className="text-sm text-on-surface-variant">
            Enter your PIN to view hidden apps and sites.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
              placeholder="PIN"
              autoComplete="off"
              className="flex-1 rounded-lg border border-outline-variant/20 bg-surface-high/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
            />
            <button
              type="submit"
              className="rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 transition-colors"
            >
              Unlock
            </button>
          </div>
          {pinError && <p className="text-xs text-error">{pinError}</p>}
        </form>
      ) : (
        <div className="space-y-5">
          {/* Hidden items list */}
          {totalHidden === 0 ? (
            <p className="text-sm text-on-surface-variant">
              No apps or sites are hidden. Use the Hide button on the dashboard to hide items.
            </p>
          ) : (
            <div className="space-y-4">
              {prefs.hiddenApps.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Hidden Apps
                  </p>
                  {prefs.hiddenApps.map((appKey) => (
                    <div key={appKey} className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-on-surface">{appKey}</span>
                      <button
                        type="button"
                        onClick={() => restore("showApp", appKey)}
                        className="shrink-0 rounded-lg border border-outline-variant/20 px-3 py-1 text-xs text-primary hover:bg-primary/5 transition-colors"
                      >
                        Show
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {prefs.hiddenDomains.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Hidden Sites
                  </p>
                  {prefs.hiddenDomains.map((domain) => (
                    <div key={domain} className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-on-surface">{domain}</span>
                      <button
                        type="button"
                        onClick={() => restore("showDomain", domain)}
                        className="shrink-0 rounded-lg border border-outline-variant/20 px-3 py-1 text-xs text-primary hover:bg-primary/5 transition-colors"
                      >
                        Show
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PIN management */}
          <div className="border-t border-outline-variant/10 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              PIN Protection
            </p>

            {mode === "idle" && (
              <div className="flex gap-2 flex-wrap">
                {!hasPivacyPin ? (
                  <button
                    type="button"
                    onClick={() => setMode("setPin")}
                    className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-high transition-colors"
                  >
                    Set PIN
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setMode("changePin")}
                      className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-high transition-colors"
                    >
                      Change PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("removePin")}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs text-error hover:bg-error/5 transition-colors"
                    >
                      Remove PIN
                    </button>
                  </>
                )}
              </div>
            )}

            {(mode === "setPin" || mode === "changePin") && (
              <form onSubmit={handleSetPin} className="space-y-2">
                {mode === "changePin" && (
                  <input
                    type="password"
                    value={currentPinInput}
                    onChange={(e) => { setCurrentPinInput(e.target.value); setModeError(""); }}
                    placeholder="Current PIN"
                    autoComplete="off"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-high/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
                  />
                )}
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => { setNewPin(e.target.value); setModeError(""); }}
                  placeholder="New PIN (min. 4 characters)"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-high/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
                />
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => { setConfirmPin(e.target.value); setModeError(""); }}
                  placeholder="Confirm PIN"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-high/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
                />
                {modeError && <p className="text-xs text-error">{modeError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-primary/10 px-4 py-2 text-xs text-primary hover:bg-primary/20 transition-colors"
                  >
                    {mode === "changePin" ? "Update PIN" : "Set PIN"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelMode}
                    className="rounded-lg border border-outline-variant/20 px-4 py-2 text-xs text-on-surface-variant hover:bg-surface-high transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {mode === "removePin" && (
              <form onSubmit={handleRemovePin} className="space-y-2">
                <p className="text-xs text-on-surface-variant">
                  Enter your current PIN to remove protection.
                </p>
                <input
                  type="password"
                  value={currentPinInput}
                  onChange={(e) => { setCurrentPinInput(e.target.value); setModeError(""); }}
                  placeholder="Current PIN"
                  autoComplete="off"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-high/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
                />
                {modeError && <p className="text-xs text-error">{modeError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg border border-error/20 px-4 py-2 text-xs text-error hover:bg-error/5 transition-colors"
                  >
                    Remove PIN
                  </button>
                  <button
                    type="button"
                    onClick={cancelMode}
                    className="rounded-lg border border-outline-variant/20 px-4 py-2 text-xs text-on-surface-variant hover:bg-surface-high transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
