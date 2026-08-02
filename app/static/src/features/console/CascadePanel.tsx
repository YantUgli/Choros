import { Badge, type BadgeTone } from "../../components/ds";
import { Label } from "../../components/Label";
import type { CascadeAttempt, ConsoleStatus } from "../../state/types";

/**
 * "Percobaan cascade" sebagai cerita berurut: agent·model → alasan → apa berikutnya.
 * Bukan dump tabel — satu baris per percobaan, dibaca dari atas ke bawah.
 */
function toneFor(a: CascadeAttempt): BadgeTone {
  switch (a.outcome) {
    case "failed":
      return "limit";
    case "skipped":
      return "neutral";
    case "ok":
      return "ok";
    default:
      return "brand";
  }
}

function badgeText(a: CascadeAttempt): string {
  if (a.outcome === "ok") return "✓ ok";
  if (a.outcome === "running") return "running";
  if (a.outcome === "trying") return "mencoba";
  return a.reason ?? "gagal";
}

function noteFor(a: CascadeAttempt, status: ConsoleStatus): string {
  if (a.outcome === "ok") return "selesai di target ini";
  if (a.outcome === "running") {
    if (status === "cascading") return "menghubungkan — plan di-reuse";
    if (status === "waiting_for_input") return "menunggu jawaban";
    return "target aktif saat ini";
  }
  if (a.outcome === "skipped") return `↓ ${a.note ?? "dilewati"}`;
  return `↓ ${a.note ?? "jatuh ke target berikut"}`;
}

export function CascadePanel({
  runId,
  attempts,
  status,
}: {
  runId: number;
  attempts: CascadeAttempt[];
  status: ConsoleStatus;
}) {
  return (
    <div
      style={{
        flex: "none",
        borderTop: "1px solid var(--line)",
        background: "var(--panel)",
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <Label>Percobaan cascade — run #{runId}</Label>
      {attempts.map((a) => {
        const active = a.outcome === "running" || a.outcome === "trying";
        return (
          <div
            key={a.index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-13)",
            }}
          >
            <span style={{ color: "var(--muted)", width: 12, flex: "none" }}>{a.index}</span>
            <span
              style={{
                width: 280,
                flex: "none",
                fontWeight: active ? 600 : 400,
                color: a.outcome === "skipped" ? "var(--muted)" : "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.target}
            </span>
            <Badge tone={toneFor(a)}>{badgeText(a)}</Badge>
            <span style={{ color: "var(--muted)", fontSize: "var(--fs-12)" }}>
              {noteFor(a, status)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
