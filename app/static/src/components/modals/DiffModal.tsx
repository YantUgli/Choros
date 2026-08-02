import { useEffect, useState } from "react";
import { Button } from "../ds";
import { Modal } from "../Modal";
import { fetchDiff, mergeDiff, discardDiff, toDiffLines } from "../../services/taskApi";

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
  const [loading, setLoading] = useState(true);
  const [diffText, setDiffText] = useState("");
  const [filesStatus, setFilesStatus] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchDiff(runId).then(res => {
      if (active) {
        setDiffText(res.diff || "");
        setFilesStatus(res.status || "");
        setLoading(false);
      }
    }).catch(err => {
      if (active) {
        setDiffText(`Gagal mengambil diff: ${String(err)}`);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [runId]);

  const handleMerge = async () => {
    setProcessing(true);
    try {
      await mergeDiff(runId);
      onMerge(); // call reset
    } catch (err) {
      alert(`Gagal merge: ${String(err)}`);
      setProcessing(false);
    }
  };

  const handleDiscard = async () => {
    if (!window.confirm("Buang semua perubahan di worktree ini?")) return;
    setProcessing(true);
    try {
      await discardDiff(runId);
      onMerge(); // call reset
    } catch (err) {
      alert(`Gagal discard: ${String(err)}`);
      setProcessing(false);
    }
  };

  const lines = toDiffLines(diffText);

  return (
    <Modal title={`diff — run #${runId}`} width={640} onClose={onClose}>
      <div
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {loading ? (
          <div>Memuat diff...</div>
        ) : (
          <>
            {filesStatus && (
              <pre style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)", margin: 0 }}>
                {filesStatus}
              </pre>
            )}
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
                maxHeight: 400,
                overflow: "auto",
              }}
            >
              {lines.map((l, i) => (
                <div key={i} style={{ color: toneColor[l.tone], whiteSpace: "pre-wrap" }}>
                  {l.text}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "space-between", marginTop: "var(--space-2)" }}>
              <Button variant="ghost" size="md" onClick={handleDiscard} disabled={processing}>
                buang
              </Button>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="md" onClick={onClose} disabled={processing}>
                  Tutup
                </Button>
                <Button variant="secondary" size="md" onClick={handleMerge} disabled={processing}>
                  merge
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
