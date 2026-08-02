import { useState } from "react";
import { Button, Input, Select, Toggle } from "../ds";
import { Field } from "../Label";
import { Modal } from "../Modal";
import { ADAPTERS, ADAPTER_LIST } from "../../data/fixtures";

export interface AgentDraft {
  name: string;
  adapter: string;
  model: string;
  active: boolean;
}

export interface AgentPreset {
  title: string;
  name?: string;
  adapter?: string;
  model?: string | null;
  active?: boolean;
}

/**
 * Editor agent / target routing.
 * Model default WAJIB dipilih dari Select yang bergantung adapter — ganti adapter,
 * daftar model ikut berubah. Tidak ada input teks bebas untuk model (hindari typo).
 */
export function AgentEditorModal({
  preset,
  onSave,
  onClose,
}: {
  preset: AgentPreset;
  onSave: (draft: AgentDraft) => void;
  onClose: () => void;
}) {
  const initialAdapter = preset.adapter && ADAPTERS[preset.adapter] ? preset.adapter : "claude_code";
  const initialModels = ADAPTERS[initialAdapter] ?? [];
  const [draft, setDraft] = useState<AgentDraft>({
    name: preset.name ?? "",
    adapter: initialAdapter,
    model:
      preset.model && initialModels.includes(preset.model) ? preset.model : (initialModels[0] ?? ""),
    active: preset.active !== false,
  });

  const models = ADAPTERS[draft.adapter] ?? [];

  return (
    <Modal title={preset.title} width={460} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <Field label="Nama">
          <Input
            mono
            size="md"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="claude"
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <Field label="Adapter">
            <Select
              size="md"
              style={{ width: "100%" }}
              value={draft.adapter}
              onChange={(e) => {
                const adapter = e.target.value;
                const next = ADAPTERS[adapter] ?? [];
                setDraft({ ...draft, adapter, model: next[0] ?? "" });
              }}
            >
              {ADAPTER_LIST.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model default">
            <Select
              size="md"
              style={{ width: "100%" }}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              disabled={models.length === 0}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            color: "var(--muted)",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            lineHeight: 1.55,
          }}
        >
          model tersedia untuk <span style={{ color: "var(--text)" }}>{draft.adapter}</span>:{" "}
          {models.join(", ") || "—"}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Toggle
            checked={draft.active}
            onChange={(active) => setDraft({ ...draft, active })}
            aria-label="aktif"
          />
          <span style={{ fontSize: "var(--fs-13)" }}>aktif</span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "flex-end",
            marginTop: "var(--space-1)",
          }}
        >
          <Button variant="ghost" size="md" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="md" type="submit">
            Simpan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
