"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiPath } from "@/app/lib/basePath";

export default function RecoverPage() {
  const [mnemonic, setMnemonic] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const isComplete = wordCount === 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (wordCount !== 12) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(apiPath("/api/recover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mnemonic: mnemonic.trim() }),
      });

      const data = await res.json().catch(() => ({} as { error?: string }));

      if (!res.ok) {
        setError(data.error || "Recovery failed");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Connection failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="lp">
      <div className="lp-recover-layout">
        <div className="lp-recover-inner">

          <Link href="/" className="lp-recover-logo">
            <img src="/daylens/app-icon.png" alt="Daylens" width={28} height={28} style={{ borderRadius: 7 }} />
            Daylens
          </Link>

          <div className="lp-accent-rule" style={{ marginBottom: "1.5rem" }} />

          <p className="text-label" style={{ color: "var(--lp-accent)", marginBottom: "0.875rem" }}>
            Account Recovery
          </p>

          <h1 className="text-display-md" style={{ color: "var(--lp-bone)", margin: "0 0 0.875rem" }}>
            Restore your account.
          </h1>

          <p style={{ fontSize: "0.9375rem", fontWeight: 300, lineHeight: 1.65, color: "var(--lp-ink-muted)", margin: "0 0 2.5rem" }}>
            Enter your 12-word recovery phrase to regain access to your web companion.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label
                htmlFor="mnemonic"
                className="text-label"
                style={{ color: "var(--lp-ink-muted)", display: "block", marginBottom: "0.75rem" }}
              >
                Recovery phrase
              </label>

              <textarea
                id="mnemonic"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value.toLowerCase())}
                placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
                rows={4}
                className="lp-textarea"
                autoFocus
              />

              <p
                className="lp-word-count"
                style={{ color: isComplete ? "var(--lp-accent)" : "var(--lp-ink-faint)" }}
              >
                {wordCount} / 12 words{isComplete ? " ✓" : ""}
              </p>
            </div>

            {error && (
              <p className="lp-error-msg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !isComplete}
              className="lp-btn-primary"
              style={{
                width: "100%",
                justifyContent: "center",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                opacity: (loading || !isComplete) ? 0.4 : 1,
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Restoring…
                </>
              ) : (
                "Restore Workspace →"
              )}
            </button>
          </form>

          <div className="lp-recover-footer">
            <Link href="/link" className="lp-ghost-link lp-ghost-link--accent">
              Have a link code instead? Connect a device
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
