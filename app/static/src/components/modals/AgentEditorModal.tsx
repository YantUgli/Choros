import { useState, useEffect } from "react";
import { Badge, Button, Input, Select, Toggle } from "../ds";
import { Field } from "../Label";
import { Modal } from "../Modal";
import { ADAPTERS } from "../../data/katalogModel";
import { fetchAdapters } from "../../services/agentApi";
import { useApiResource } from "../../state/useApiResource";

export interface AgentDraft {
  name: string;
  adapter: string;
  model: string;
  active: boolean;
  tokenLimit: number | null;
}

export interface AgentPreset {
  title: string;
  name?: string;
  adapter?: string;
  model?: string | null;
  active?: boolean;
  tokenLimit?: number | null;
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
  const [res] = useApiResource(fetchAdapters);
  
  const adapters = res.phase === "ready" ? res.data : [];
  const adapterList = adapters.map(a => a.adapter_type);
  
  const initialAdapter = preset.adapter && adapterList.includes(preset.adapter) ? preset.adapter : (adapterList[0] || "claude_code");
  const initialModels = ADAPTERS[initialAdapter] ?? [];
  const [draft, setDraft] = useState<AgentDraft>({
    name: preset.name ?? "",
    adapter: initialAdapter,
    model:
      preset.model && initialModels.includes(preset.model) ? preset.model : (initialModels[0] ?? ""),
    active: preset.active !== false,
    tokenLimit: preset.tokenLimit ?? null,
  });

  // Sinkronisasi draft.adapter setelah adapters termuat jika preset.adapter tidak ada / tidak valid
  useEffect(() => {
    if (res.phase === "ready" && adapterList.length > 0 && !adapterList.includes(draft.adapter)) {
      const nextAdapter = adapterList[0]!;
      const nextModels = ADAPTERS[nextAdapter] ?? [];
      setDraft(prev => ({ ...prev, adapter: nextAdapter, model: nextModels[0] ?? "" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.phase]);

  const models = ADAPTERS[draft.adapter] ?? [];
  const currentAdapterInfo = adapters.find((a) => a.adapter_type === draft.adapter);

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
              disabled={res.phase !== "ready"}
            >
              {adapterList.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {adapterList.length === 0 && <option value={draft.adapter}>{draft.adapter}</option>}
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
            display: "flex",
            flexDirection: "column",
            gap: 4
          }}
        >
          <div>
            model tersedia untuk <span style={{ color: "var(--text)" }}>{draft.adapter}</span>:{" "}
            {models.join(", ") || "—"}
          </div>
          {currentAdapterInfo && (
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4 }}>
              <Badge tone={currentAdapterInfo.has_hands ? "brand" : "neutral"}>
                {currentAdapterInfo.has_hands ? "punya tangan" : "tanpa tangan"}
              </Badge>
              <Badge tone={currentAdapterInfo.subscription_bound ? "warn" : "ok"}>
                {currentAdapterInfo.subscription_bound ? "terikat langganan" : "bisa custom url"}
              </Badge>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Toggle
            checked={draft.active}
            onChange={(active) => setDraft({ ...draft, active })}
            aria-label="aktif"
          />
          <span style={{ fontSize: "var(--fs-13)" }}>aktif</span>
        </div>

        {draft.adapter === "opencode" && (
          <Field label="Token limit (opsional)">
            <Input
              mono
              size="md"
              type="number"
              min={0}
              value={draft.tokenLimit ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setDraft({ ...draft, tokenLimit: v === "" ? null : Math.max(0, parseInt(v, 10)) });
              }}
              placeholder="kosong = tidak ada limit"
            />
          </Field>
        )}

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
          <Button variant="primary" size="md" type="submit" disabled={!draft.name || !draft.adapter}>
            Simpan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
