import { useState, type KeyboardEvent } from "react";
import { Button, Input, Select, Toggle } from "../../components/ds";
import { Caret } from "../../components/Icons";
import { Field, Label } from "../../components/Label";
import { useModals } from "../../state/modals";
import { useApiResource } from "../../state/useApiResource";
import { fetchCategories } from "../../services/routingApi";
import type { RunRequest, TaskCategory, TaskMode } from "../../state/types";

// data contoh
const PLAN_STEPS = [
  "1. baca modul auth",
  "2. petakan pemakaian token",
  "3. pindah ke httponly cookie",
  "4. jalankan typecheck",
];

/**
 * Nama tier persis seperti yang dimengerti `app/orchestrator/quality.py::_floor_tier`.
 * File design memakai angka 5–8; angka itu tidak dikenali orchestrator dan diam-diam
 * jatuh ke TIER_UNKNOWN, jadi di sini dipakai kosakata backend yang sebenarnya.
 */
const FLOORS: { value: string; label: string }[] = [
  { value: "", label: "— tanpa batas" },
  { value: "frontier", label: "frontier" },
  { value: "strong", label: "strong" },
  { value: "mid", label: "mid" },
  { value: "light", label: "light" },
];

export interface ComposeProps {
  busy: boolean;
  canCancel: boolean;
  onRun: (request: RunRequest) => void;
  onCancel: () => void;
}

export function ComposePanel({ busy, canCancel, onRun, onCancel }: ComposeProps) {
  const modals = useModals();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<TaskCategory>("coding_complex");
  const [mode, setMode] = useState<TaskMode>("interaktif");
  const [projectPath, setProjectPath] = useState("");
  const [floor, setFloor] = useState("");
  const [noIsolation, setNoIsolation] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  
  const [catsRes] = useApiResource(fetchCategories);
  const categories = catsRes.phase === "ready" ? catsRes.data : catsRes.phase === "error" ? [{ value: category, label: "gagal memuat" }] : [{ value: category, label: "memuat..." }];

  const runDisabled = busy || prompt.trim().length === 0;

  const run = () => {
    if (runDisabled) return;
    onRun({
      prompt: prompt.trim(),
      category,
      mode,
      projectPath,
      qualityFloor: floor || null,
      noIsolation,
    });
  };

  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };

  return (
    <div
      style={{
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <Label>Kirim tugas</Label>

      <textarea
        rows={5}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onPromptKey}
        placeholder="refactor modul auth supaya token disimpan di httponly cookie…"
        aria-label="prompt tugas"
        style={{
          resize: "vertical",
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          padding: "8px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-13)",
          lineHeight: 1.5,
          color: "var(--text)",
          minHeight: 96,
          outlineOffset: 1,
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
        <Field label="Kategori">
          <Select
            size="sm"
            style={{ width: "100%" }}
            value={category}
            onChange={(e) => setCategory(e.target.value as TaskCategory)}
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mode">
          <Select
            size="sm"
            style={{ width: "100%" }}
            value={mode}
            onChange={(e) => setMode(e.target.value as TaskMode)}
          >
            <option value="interaktif">interaktif</option>
            <option value="otonom">otonom</option>
          </Select>
        </Field>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <Label strong={false}>Project path</Label>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input
              mono
              size="sm"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="kosongkan = pakai default"
              aria-label="project path"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => modals.openBrowse(projectPath || "C:\\project", setProjectPath)}
          >
            Browse…
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 10,
          alignItems: "end",
        }}
      >
        <Field label="Quality floor">
          <Select size="sm" style={{ width: "100%" }} value={floor} onChange={(e) => setFloor(e.target.value)}>
            {FLOORS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            paddingBottom: "var(--space-1)",
          }}
        >
          <Toggle checked={noIsolation} onChange={setNoIsolation} aria-label="otonom tanpa isolasi" />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--muted)" }}>otonom tanpa isolasi</span>
        </div>
      </div>

      {noIsolation && (
        <div
          role="note"
          style={{
            border: "1px solid var(--limit)",
            background: "var(--limit-fill)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            fontSize: "var(--fs-12)",
            color: "var(--text)",
            lineHeight: 1.5,
          }}
        >
          danger zone — agent menulis langsung ke working tree, tanpa worktree terisolasi.
        </div>
      )}

      <button
        type="button"
        className="choros-hover-line"
        onClick={() => setPlanOpen((v) => !v)}
        aria-expanded={planOpen}
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          padding: "8px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          color: "var(--muted)",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          transition: "color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
        }}
      >
        <Caret open={planOpen} /> artefak plan — titik-ulang saat fallback
      </button>

      {planOpen && (
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--panel-2)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            color: "var(--muted)",
            lineHeight: 1.6,
          }}
        >
          {PLAN_STEPS.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <Button variant="primary" size="md" disabled={runDisabled} onClick={run}>
          {busy ? "Berjalan…" : "Jalankan"}
        </Button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
          ⌘↵
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Button variant="ghost" size="md" disabled={!canCancel} onClick={onCancel}>
            Batalkan
          </Button>
        </div>
      </div>
    </div>
  );
}
