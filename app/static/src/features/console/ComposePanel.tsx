import { useState, type KeyboardEvent } from "react";
import { Badge, Button, Input, Select, Toggle } from "../../components/ds";

import { Field, Label } from "../../components/Label";
import { useModals } from "../../state/modals";
import { useApiResource } from "../../state/useApiResource";
import { fetchCategories } from "../../services/routingApi";
import type { RunRequest, TaskCategory, TaskMode } from "../../state/types";



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
  prompt: string;
  setPrompt: (prompt: string) => void;
  category: TaskCategory;
  setCategory: (category: TaskCategory) => void;
  onRun: (request: RunRequest) => void;
  onCancel: () => void;
  /** Judul section (default "Kirim tugas"). */
  title?: string;
  /** Kategori dikunci per-lane → tampil sebagai badge, bukan dropdown. */
  lockedCategory?: boolean;
  /** Folder kerja tetap (dari Project) → sembunyikan field path. */
  fixedProjectPath?: string;
  /** Disalurkan ke request agar eksekusi menempel pada Run ini. */
  taskRunId?: number;
  /** Input lebar ala chat (lebih tinggi). */
  wide?: boolean;
}

export function ComposePanel({
  busy,
  canCancel,
  prompt,
  setPrompt,
  category,
  setCategory,
  onRun,
  onCancel,
  title = "Kirim tugas",
  lockedCategory = false,
  fixedProjectPath,
  taskRunId,
  wide = false,
}: ComposeProps) {
  const [mode, setMode] = useState<TaskMode>("interaktif");
  const [projectPath, setProjectPath] = useState("");
  const [floor, setFloor] = useState("");
  const [noIsolation, setNoIsolation] = useState(false);
  const modals = useModals();

  const [catsRes] = useApiResource(fetchCategories);
  const categories = catsRes.phase === "ready" ? catsRes.data : catsRes.phase === "error" ? [{ value: category, label: "gagal memuat" }] : [{ value: category, label: "memuat..." }];
  const categoryLabel = categories.find((c) => c.value === category)?.label ?? category;

  const runDisabled = busy || prompt.trim().length === 0;

  const run = () => {
    if (runDisabled) return;
    onRun({
      prompt: prompt.trim(),
      category,
      mode,
      projectPath: fixedProjectPath ?? projectPath,
      qualityFloor: floor || null,
      noIsolation,
      taskRunId,
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
      <Label>{title}</Label>

      <textarea
        rows={wide ? 8 : 5}
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
          {lockedCategory ? (
            <div style={{ display: "flex", alignItems: "center", height: 30 }}>
              <Badge tone="brand" mono>{categoryLabel}</Badge>
            </div>
          ) : (
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
          )}
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

      {fixedProjectPath === undefined ? (
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
              onClick={() => modals.openBrowse(projectPath || "", setProjectPath)}
            >
              Browse…
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Label strong={false}>Folder</Label>
          <span
            style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            title={fixedProjectPath}
          >
            {fixedProjectPath}
          </span>
        </div>
      )}

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
