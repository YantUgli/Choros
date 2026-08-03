import { Badge, Button, StatusDot } from "../../components/ds";
import { Label, Meta } from "../../components/Label";
import type { FailureInfo, HaltInfo, RunResult } from "../../state/types";

const strip = {
  flex: "none" as const,
  borderTop: "1px solid var(--line)",
  background: "var(--panel)",
  padding: "var(--space-3) var(--space-4)",
};

/** done — Hasil + worktree review (diff / merge / discard). */
export function ResultStrip({
  result,
  onDiff,
  onMerge,
  onDiscard,
}: {
  result: RunResult;
  onDiff: () => void;
  onMerge: () => void;
  onDiscard: () => void;
}) {
  return (
    <div style={{ ...strip, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Label>{result.isolated ? "Hasil · worktree review" : "Hasil"}</Label>
      <div
        className="ov"
        style={{
          fontSize: "var(--fs-13)",
          color: "var(--text)",
          lineHeight: 1.5,
          maxHeight: 92,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {result.summary}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {result.worktree && (
          <Badge tone="neutral">
            {result.isolated ? "worktree" : "workdir"} {result.worktree}
          </Badge>
        )}
        <Meta>
          {/* stat diff hanya jujur kalau worktree-nya memang terisolasi */}
          {result.isolated ? `+${result.added} −${result.removed} · ${result.filesChanged} file · ` : ""}
          {result.tokens.toLocaleString("en-US")} tok · {result.duration}
        </Meta>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
          {result.isolated ? (
            <>
              <Button variant="ghost" size="sm" onClick={onDiff}>
                lihat diff
              </Button>
              <Button variant="secondary" size="sm" onClick={onMerge}>
                merge
              </Button>
              <Button variant="danger" size="sm" onClick={onDiscard}>
                discard
              </Button>
            </>
          ) : (
            // Mode interaktif menulis langsung ke working dir — tidak ada yang
            // bisa di-merge/discard, dan endpoint diff backend memang menolaknya.
            <Button variant="ghost" size="sm" onClick={onDiscard}>
              tutup
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** halted — tenang & jujur, BUKAN error merah. */
export function HaltedStrip({
  halt,
  category,
  onResume,
  onQuota,
}: {
  halt: HaltInfo;
  category: string;
  onResume: () => void;
  onQuota: () => void;
}) {
  const exhausted = halt.reason === "chain_exhausted";
  return (
    <div style={{ ...strip, display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <StatusDot status="idle" />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: "var(--fs-13)" }}>
          {exhausted ? `Semua target ${category} habis — plan tersimpan.` : halt.message}
        </span>
        <Meta>
          {halt.resetIn
            ? `reset terdekat ${halt.resetIn} · run bisa dilanjutkan dari artefak plan`
            : "run bisa dilanjutkan dari artefak plan"}
        </Meta>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
        <Button variant="secondary" size="sm" onClick={onResume}>
          {exhausted ? "resume otomatis saat reset" : "jalankan lagi"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onQuota}>
          buka Quota
        </Button>
      </div>
    </div>
  );
}

/** error — kegagalan non-recoverable, stream beku di titik gagal. */
export function ErrorStrip({
  failure,
  onRetry,
  onCopy,
}: {
  failure: FailureInfo;
  onRetry: () => void;
  onCopy: () => void;
}) {
  return (
    <div style={{ ...strip, display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <StatusDot status="error" />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: "var(--fs-13)" }}>
          Kegagalan non-recoverable — stream dibekukan pada titik gagal.
        </span>
        <Meta>{failure.message}</Meta>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          coba lagi — plan di-reuse
        </Button>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          salin log
        </Button>
      </div>
    </div>
  );
}
