import { useCallback, useEffect, useRef, useState } from "react";
import { type Project, fetchRunDetail, selectWinner, type RunLane, type TaskRunDetail } from "../../services/projectApi";
import { Badge, Card, IconButton, StatusDot } from "../../components/ds";
import { Label, Meta } from "../../components/Label";
import { ConsolePanel } from "./ConsolePanel";

const TERMINAL = ["ok", "done", "error", "halted"];

function laneDot(status: string | null) {
  if (status === "ok" || status === "done") return "ok" as const;
  if (status === "error") return "error" as const;
  if (status === "halted") return "limit" as const;
  if (!status) return "idle" as const;
  return "running" as const;
}

/** Status run diturunkan dari lane — task_runs.status backend belum di-update. */
function deriveRunStatus(lanes: RunLane[]): string {
  const active = lanes.filter((l) => l.taskId !== null);
  if (active.length === 0) return "idle";
  if (active.some((l) => l.status && !TERMINAL.includes(l.status))) return "running";
  if (active.some((l) => l.status === "error")) return "error";
  if (active.every((l) => l.status === "ok" || l.status === "done")) return "done";
  return "running";
}

export function RunWorkspace({
  project,
  taskName,
  runId,
}: {
  project: Project;
  taskName?: string;
  runId: number;
}) {
  // Polling TIDAK boleh melewati fase "loading" (itu meng-unmount semua ConsolePanel
  // → prompt & state console ter-reset). Simpan detail di state lokal & perbarui
  // di tempat; layar "Memuat" hanya untuk muat pertama.
  const [detail, setDetail] = useState<TaskRunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Kontainer lane menggulir horizontal → lane yang baru aktif (hasil delegasi)
  // sering muncul di luar layar kanan; tanpa ini delegasi terasa "tidak terjadi apa-apa".
  const lanesRef = useRef<HTMLDivElement>(null);
  const activeCatsRef = useRef<Set<string> | null>(null);

  const reload = useCallback(() => {
    fetchRunDetail(runId).then((d) => { setDetail(d); setErr(null); }).catch((e) => setErr(String(e)));
  }, [runId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [reload]);

  // Saat sebuah lane berpindah dari "menunggu" → aktif (punya task), bawa ke layar.
  useEffect(() => {
    if (!detail) return;
    const active = new Set(detail.lanes.filter((l) => l.taskId !== null || l.branches).map((l) => l.category));
    const prev = activeCatsRef.current;
    activeCatsRef.current = active;
    if (prev === null) return; // muat pertama — jangan lompat
    const newly = [...active].filter((c) => !prev.has(c));
    const cat = newly[newly.length - 1];
    if (!cat) return;
    lanesRef.current
      ?.querySelector<HTMLElement>(`[data-lane="${CSS.escape(cat)}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [detail]);

  if (!detail) {
    return (
      <div style={{ padding: "var(--space-4)" }}>
        <Meta>{err ? `Gagal memuat run: ${err}` : "Memuat workspace…"}</Meta>
      </div>
    );
  }

  const { lanes } = detail;
  const status = deriveRunStatus(lanes as RunLane[]);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, background: "var(--bg)" }}>
      {/* ── Center: kolom-kolom console (scroll horizontal) ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--line)",
            flex: "none",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "var(--fs-14)" }}>{taskName ?? "Run"}</span>
          <Badge tone="neutral" mono>run #{runId}</Badge>
          <StatusDot status={laneDot(status)} label={status} />
          <div style={{ marginLeft: "auto" }}>
            <IconButton title="Segarkan status" onClick={reload}>↻</IconButton>
          </div>
        </div>

        <div
          ref={lanesRef}
          style={{
            flex: 1, minHeight: 0, display: "flex", gap: "var(--space-3)",
            overflowX: "auto", overflowY: "hidden", padding: "var(--space-3)",
          }}
        >
          {(lanes as RunLane[]).map((lane, i) => {
            const nextCategory = lanes[i + 1]?.category ?? null;

            // Fan-out belum diputuskan → cabang-cabang berdampingan + tombol pilih pemenang.
            if (lane.branches && lane.branches.length >= 2) {
              return (
                <div key={lane.category} data-lane={lane.category} style={{ width: 960, minWidth: 900, flex: "1 0 900px", display: "flex", gap: "var(--space-3)", minHeight: 0 }}>
                  {lane.branches.map((b) => (
                    <div key={b.taskId} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                      <ConsolePanel
                        runId={runId}
                        category={lane.category}
                        laneTaskId={b.taskId}
                        folderPath={project.folderPath}
                        onDelegated={reload}
                        nextCategory={nextCategory}
                        tokensAccumulated={b.tokensRun}
                        fanoutAgent={b.agent}
                        onSelectWinner={() => { selectWinner(b.taskId).then(reload).catch(() => {}); }}
                      />
                    </div>
                  ))}
                </div>
              );
            }

            const isActive = i === 0 || lane.taskId !== null;

            return (
              <div key={lane.category} data-lane={lane.category} style={{ width: 540, minWidth: 480, flex: "1 0 480px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                {isActive ? (
                  <ConsolePanel
                    runId={runId}
                    category={lane.category}
                    laneTaskId={lane.taskId}
                    folderPath={project.folderPath}
                    onDelegated={reload}
                    nextCategory={nextCategory}
                    tokensAccumulated={lane.tokensAccumulated}
                  />
                ) : (
                  <Card style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", border: "1px dashed var(--line)", background: "transparent" }}>
                    <StatusDot status="idle" />
                    <Badge tone="neutral" mono>{lane.category}</Badge>
                    <Meta>menunggu delegasi dari lane sebelumnya</Meta>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Rail kanan: pipeline / route (ciri cockpit 1c) ── */}
      <div
        style={{
          width: 220, flex: "none", borderLeft: "1px solid var(--line)",
          background: "var(--panel)", padding: "var(--space-4)",
          display: "flex", flexDirection: "column", gap: "var(--space-3)", overflow: "auto",
        }}
      >
        <Label>Pipeline</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {(lanes as RunLane[]).map((lane, i) => (
            <div key={lane.category}>
              <div style={{ padding: "var(--space-1) 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <StatusDot status={laneDot(lane.status)} />
                  <span style={{ fontSize: "var(--fs-13)", flex: 1 }}>{lane.category}</span>
                  <Meta style={{ whiteSpace: "nowrap" }}>Σ {lane.tokensAccumulated.toLocaleString()}</Meta>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", paddingLeft: 16, marginTop: 2 }}>
                  <Meta>{lane.branches ? `fan-out (${lane.branches.length})` : lane.status ?? "menunggu"}</Meta>
                  {lane.tokensRun > 0 && <Meta>run {lane.tokensRun.toLocaleString()}</Meta>}
                </div>
              </div>
              {i < lanes.length - 1 && (
                <div style={{ paddingLeft: 3, color: "var(--muted)", fontSize: "var(--fs-12)", lineHeight: 1 }}>│</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto" }}>
          <Meta>folder</Meta>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)", wordBreak: "break-all" }}>
            {project.folderPath}
          </div>
        </div>
      </div>
    </div>
  );
}
