import { Button } from "../ds";
import { Modal } from "../Modal";
import { DIFF_FILE, DIFF_LINES } from "../../data/fixtures";

const toneColor = {
  muted: "var(--muted)",
  add: "var(--ok)",
  del: "var(--error)",
} as const;

export function DiffModal({
  runId,
  onMerge,
  onClose,
}: {
  runId: number;
  onMerge: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={`diff — run #${runId}`} width={560} onClose={onClose}>
      <div
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
          {DIFF_FILE}
        </span>
        <div
          className="ov"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            lineHeight: 1.7,
            maxHeight: 300,
            overflow: "auto",
          }}
        >
          {DIFF_LINES.map((l, i) => (
            <div key={i} style={{ color: toneColor[l.tone], whiteSpace: "pre-wrap" }}>
              {l.text}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Tutup
          </Button>
          <Button variant="secondary" size="md" onClick={onMerge}>
            merge
          </Button>
        </div>
      </div>
    </Modal>
  );
}
