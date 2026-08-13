import { useState, useEffect } from "react";
import { Badge, Button, Input, Select, Toggle } from "../ds";
import { Field } from "../Label";
import { Modal } from "../Modal";
import { ADAPTERS } from "../../data/katalogModel";
import { fetchAdapters, fetchAdapterModels } from "../../services/agentApi";
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
 * Daftar model ditarik live dari CLI adapter (`/api/adapters/{type}/models`), dengan
 * katalog statis sebagai placeholder/fallback. Model kosong = "ikut default agent".
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
  const adapterList = adapters.map((a) => a.adapter_type);

  // Penting: adapter awal diambil langsung dari preset, TIDAK bergantung pada
  // adapterList yang masih kosong saat render pertama. Dulu bug-nya di sini —
  // sebelum /api/adapters balik, adapter jatuh ke "claude_code" lalu nyangkut,
  // sehingga target Antigravity/opencode selalu tampil claude/sonnet.
  const [draft, setDraft] = useState<AgentDraft>({
    name: preset.name ?? "",
    adapter: preset.adapter ?? "",
    model: preset.model ?? "",
    active: preset.active !== false,
    tokenLimit: preset.tokenLimit ?? null,
  });

  const [models, setModels] = useState<string[]>(
    preset.adapter ? (ADAPTERS[preset.adapter] ?? []) : [],
  );
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState<"cli" | "fallback" | "unknown" | null>(null);

  // Selaraskan adapter setelah daftar adapter termuat: pertahankan preset.adapter
  // kalau valid, selain itu jatuh ke adapter pertama.
  useEffect(() => {
    if (res.phase !== "ready" || adapterList.length === 0) return;
    setDraft((prev) => {
      if (prev.adapter && adapterList.includes(prev.adapter)) return prev;
      return { ...prev, adapter: adapterList[0]!, model: "" };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.phase]);

  // Tarik daftar model live setiap kali adapter berubah. Placeholder statis tampil
  // dulu supaya tidak ada jeda kosong (query agy bisa lambat).
  useEffect(() => {
    const adapter = draft.adapter;
    if (!adapter) return;
    let cancelled = false;
    const staticList = ADAPTERS[adapter] ?? [];
    setModels(staticList);
    setModelsSource(null);
    setModelsLoading(true);
    fetchAdapterModels(adapter)
      .then((r) => {
        if (cancelled) return;
        const list = r.models.length ? r.models : staticList;
        setModels(list);
        setModelsSource(r.source);
        setDraft((prev) => {
          if (prev.adapter !== adapter) return prev;
          if (!prev.model) return prev; // kosong = ikut default agent
          if (list.includes(prev.model)) return prev; // masih valid
          if (prev.model === preset.model) return prev; // model tersimpan → pertahankan
          return { ...prev, model: "" };
        });
      })
      .catch(() => {
        if (!cancelled) {
          setModels(staticList);
          setModelsSource(null);
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.adapter]);

  const currentAdapterInfo = adapters.find((a) => a.adapter_type === draft.adapter);
  // Model tersimpan yang tidak ada di daftar live tetap ditampilkan agar tidak hilang.
  const optionModels =
    draft.model && !models.includes(draft.model) ? [draft.model, ...models] : models;

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
              onChange={(e) => setDraft({ ...draft, adapter: e.target.value, model: "" })}
              disabled={res.phase !== "ready"}
            >
              {adapterList.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {adapterList.length === 0 && draft.adapter && (
                <option value={draft.adapter}>{draft.adapter}</option>
              )}
            </Select>
          </Field>
          <Field label="Model default">
            <Select
              size="md"
              style={{ width: "100%" }}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              <option value="">(ikut default agent)</option>
              {optionModels.map((m) => (
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
            gap: 4,
          }}
        >
          <div>
            model tersedia untuk <span style={{ color: "var(--text)" }}>{draft.adapter || "—"}</span>:{" "}
            {modelsLoading ? "memuat dari CLI…" : models.join(", ") || "—"}
            {!modelsLoading && modelsSource === "cli" && (
              <span style={{ color: "var(--ok, var(--brand))" }}> · live CLI</span>
            )}
            {!modelsLoading && modelsSource === "fallback" && (
              <span style={{ color: "var(--limit)" }}> · daftar statis (CLI tak menjawab)</span>
            )}
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
