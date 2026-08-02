import { useEffect, useState } from "react";
import { Label } from "../../components/Label";
import { fetchAttempts, type AttemptRow } from "../../services/taskApi";

const COLS = { idx: 12, agent: 140, model: 140, status: 100 };

export function AttemptsPanel({
  taskId,
  onEmpty,
}: {
  taskId: number;
  onEmpty: () => void;
}) {
  const [rows, setRows] = useState<AttemptRow[]>([]);

  useEffect(() => {
    fetchAttempts(taskId)
      .then((r) => {
        setRows(r);
        if (r.length === 0) onEmpty();
      })
      .catch(onEmpty);
  }, [taskId, onEmpty]);

  if (rows.length === 0) return null;

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
      <Label>Jejak eksekusi — run #{taskId}</Label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          color: "var(--muted)",
          paddingBottom: "var(--space-1)",
        }}
      >
        <span style={{ width: COLS.idx, flex: "none" }}>#</span>
        <span style={{ width: COLS.agent, flex: "none" }}>agent</span>
        <span style={{ width: COLS.model, flex: "none" }}>model</span>
        <span style={{ width: COLS.status, flex: "none" }}>status</span>
        <span>tokens in/out</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.index}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-13)",
          }}
        >
          <span style={{ color: "var(--muted)", width: COLS.idx, flex: "none" }}>{r.index}</span>
          <span
            style={{
              width: COLS.agent,
              flex: "none",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.agent}
          </span>
          <span
            style={{
              width: COLS.model,
              flex: "none",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.model}
          </span>
          <span
            style={{
              width: COLS.status,
              flex: "none",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.status}
          </span>
          <span style={{ color: "var(--muted)", fontSize: "var(--fs-12)" }}>
            in: {r.tokensIn.toLocaleString("en-US")} · out: {r.tokensOut.toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}
