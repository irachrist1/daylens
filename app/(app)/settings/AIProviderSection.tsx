"use client";

import { useEffect, useMemo, useState } from "react";

const KEY_STORAGE = "daylens-web:anthropic-api-key";
const MODEL_STORAGE = "daylens-web:anthropic-model";

const MODEL_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    hint: "Most capable — slowest + most expensive",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    hint: "Recommended — strong quality, fast",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    hint: "Fastest + cheapest — lighter answers",
  },
];

const DEFAULT_MODEL = "claude-sonnet-4-6";

function maskKey(key: string): string {
  if (!key) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "••••";
  return `${trimmed.slice(0, 7)}••••${trimmed.slice(-4)}`;
}

export function AIProviderSection() {
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existingKey = window.localStorage.getItem(KEY_STORAGE);
    const existingModel = window.localStorage.getItem(MODEL_STORAGE);
    setStoredKey(existingKey && existingKey.trim() ? existingKey : null);
    if (existingModel && MODEL_OPTIONS.some((option) => option.id === existingModel)) {
      setModel(existingModel);
    }
  }, []);

  const hasKey = useMemo(() => Boolean(storedKey), [storedKey]);
  const activeModelLabel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model,
    [model],
  );

  function saveKey() {
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    window.localStorage.setItem(KEY_STORAGE, trimmed);
    setStoredKey(trimmed);
    setDraftKey("");
    setEditing(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function clearKey() {
    window.localStorage.removeItem(KEY_STORAGE);
    setStoredKey(null);
    setDraftKey("");
    setEditing(false);
  }

  function changeModel(nextModel: string) {
    setModel(nextModel);
    window.localStorage.setItem(MODEL_STORAGE, nextModel);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <h2>AI Provider</h2>
        <p>
          Bring your own Anthropic API key and pick the model Daylens uses to
          answer questions on this device. Keys are stored only in this browser.
        </p>
      </div>

      <div className="settings-row settings-row--stack">
        <div className="settings-row__copy">
          <p className="settings-row__title">Anthropic API key</p>
          <p className="settings-row__detail">
            {hasKey
              ? `Currently using ${maskKey(storedKey ?? "")}. Replace or remove it any time.`
              : "No key saved yet. Without one, Daylens falls back to the shared server key (if available)."}
          </p>
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
                  saveKey();
                }
              }}
              className="settings-input"
            />
            <div className="settings-row__form-actions">
              <button
                type="button"
                className="settings-button settings-button--primary"
                onClick={saveKey}
                disabled={!draftKey.trim()}
              >
                Save key
              </button>
              {hasKey ? (
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => {
                    setEditing(false);
                    setDraftKey("");
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="settings-row__actions">
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setEditing(true);
                setDraftKey("");
              }}
            >
              Replace
            </button>
            <button
              type="button"
              className="settings-button settings-button--danger"
              onClick={clearKey}
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
            Currently asking <strong>{activeModelLabel}</strong>. Applies to
            every new question — existing threads keep their original model.
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

      {saved ? <p className="settings-save-hint">Saved locally.</p> : null}
    </section>
  );
}
