"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiPath } from "@/app/lib/basePath";
import { formatRelativeTime } from "@/app/lib/format";
import {
  DEFAULT_MODEL_ID,
  MODEL_OPTIONS,
  isAllowedModel,
  type ModelId,
} from "../../../packages/ai-models/index";

const MODEL_STORAGE = "daylens-web:anthropic-model";

type KeyStatus = {
  hasKey: boolean;
  updatedAt: number | null;
};

export function AIProviderSection() {
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(apiPath("/api/ai-key"));
      if (!response.ok) {
        throw new Error("status_failed");
      }
      const data = (await response.json()) as KeyStatus;
      setKeyStatus(data);
      setStatusError(null);
    } catch {
      setKeyStatus({ hasKey: false, updatedAt: null });
      setStatusError(
        "Couldn't load key status. Saving a new key will still work.",
      );
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    // Legacy: early builds stored the Anthropic key in localStorage. Purge it
    // so it never sits at rest in the browser after this fix rolls out.
    window.localStorage.removeItem("daylens-web:anthropic-api-key");

    const existingModel = window.localStorage.getItem(MODEL_STORAGE);
    if (isAllowedModel(existingModel)) {
      setModel(existingModel);
    }
  }, []);

  const hasKey = Boolean(keyStatus?.hasKey);
  const activeModelLabel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model,
    [model],
  );

  async function saveKey() {
    const trimmed = draftKey.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(apiPath("/api/ai-key"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropicKey: trimmed }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSaveError(
          typeof data?.error === "string"
            ? data.error
            : "Couldn't save the key. Please try again in a moment.",
        );
        return;
      }

      setDraftKey("");
      setEditing(false);
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 1800);
      await refreshStatus();
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setSaveError(null);
    try {
      const response = await fetch(apiPath("/api/ai-key"), { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSaveError(
          typeof data?.error === "string"
            ? data.error
            : "Couldn't remove the key. Please try again in a moment.",
        );
        return;
      }
      setDraftKey("");
      setEditing(false);
      await refreshStatus();
    } catch {
      setSaveError("Couldn't reach the server. Please try again in a moment.");
    }
  }

  function changeModel(nextModel: ModelId) {
    setModel(nextModel);
    window.localStorage.setItem(MODEL_STORAGE, nextModel);
    setSavedToast(true);
    window.setTimeout(() => setSavedToast(false), 1200);
  }

  const keyDetail = hasKey
    ? keyStatus?.updatedAt
      ? `Key saved · updated ${formatRelativeTime(keyStatus.updatedAt)}. Replace or remove it any time.`
      : "Key saved. Replace or remove it any time."
    : "No key saved yet. Without one, Daylens falls back to the shared server key (if available).";

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <h2>AI Provider</h2>
        <p>
          Bring your own Anthropic API key for this workspace. Keys are encrypted
          in Daylens&apos; backend — they are never stored in your browser.
        </p>
      </div>

      <div className="settings-row settings-row--stack">
        <div className="settings-row__copy">
          <p className="settings-row__title">Anthropic API key</p>
          <p className="settings-row__detail">{keyDetail}</p>
          {statusError ? (
            <p className="settings-row__detail settings-row__detail--warn">{statusError}</p>
          ) : null}
        </div>

        {editing || !hasKey ? (
          <div className="settings-row__form">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveKey();
                }
              }}
              className="settings-input"
              disabled={saving}
            />
            <div className="settings-row__form-actions">
              <button
                type="button"
                className="settings-button settings-button--primary"
                onClick={() => void saveKey()}
                disabled={!draftKey.trim() || saving}
              >
                {saving ? "Saving…" : "Save key"}
              </button>
              {hasKey ? (
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => {
                    setEditing(false);
                    setDraftKey("");
                    setSaveError(null);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            {saveError ? <p className="settings-error">{saveError}</p> : null}
          </div>
        ) : (
          <div className="settings-row__actions">
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setEditing(true);
                setDraftKey("");
                setSaveError(null);
              }}
            >
              Replace
            </button>
            <button
              type="button"
              className="settings-button settings-button--danger"
              onClick={() => void clearKey()}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="settings-row settings-row--stack">
        <div className="settings-row__copy">
          <p className="settings-row__title">Model</p>
          <p className="settings-row__detail">
            Currently asking <strong>{activeModelLabel}</strong>. Applies to every
            new question — existing threads keep their original model.
          </p>
        </div>

        <div className="settings-model-grid">
          {MODEL_OPTIONS.map((option) => {
            const active = option.id === model;
            return (
              <button
                key={option.id}
                type="button"
                className={`settings-model-card ${active ? "is-active" : ""}`}
                onClick={() => changeModel(option.id)}
              >
                <span className="settings-model-card__label">{option.label}</span>
                <span className="settings-model-card__hint">{option.hint}</span>
                {active ? <span className="settings-model-card__check">✓</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {savedToast ? <p className="settings-save-hint">Saved.</p> : null}
    </section>
  );
}
