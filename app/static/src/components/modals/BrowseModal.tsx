import { useEffect, useState } from "react";
import { Button } from "../ds";
import { FolderIcon } from "../Icons";
import { Label } from "../Label";
import { Modal } from "../Modal";
import { fetchFsList } from "../../services/fsApi";

/** Folder picker: naik/turun folder lewat /api/fs/list, breadcrumb mono, "Pilih folder ini". */
export function BrowseModal({
  initial,
  onPick,
  onClose,
}: {
  initial: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState(initial || "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchFsList(cwd)
      .then((res) => {
        if (!active) return;
        setCwd(res.path);
        setParent(res.parent);
        setEntries(res.entries);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, retryTick]);

  const up = () => {
    if (parent !== null) setCwd(parent);
  };

  const enter = (name: string) => {
    if (!cwd) {
      setCwd(name);
      return;
    }
    const sep = cwd.endsWith("\\") ? "" : "\\";
    setCwd(cwd + sep + name);
  };

  return (
    <Modal title="Pilih project path" width={560} onClose={onClose}>
      <div
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Button variant="ghost" size="sm" onClick={up} disabled={parent === null} aria-label="naik satu folder">
            ↑
          </Button>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-13)",
              color: "var(--muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
          >
            {cwd || "( pilih drive )"}
          </div>
        </div>

        <div
          className="ov"
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            maxHeight: 280,
            minHeight: 120,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading && (
            <div style={{ padding: "var(--space-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
              memuat...
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--limit)" }}>{error}</span>
              <Button size="sm" onClick={() => setRetryTick((t) => t + 1)}>Coba lagi</Button>
            </div>
          )}
          {!loading && !error && entries.map((name) => (
            <button
              key={name}
              type="button"
              className="choros-hover-row"
              onClick={() => enter(name)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 12px",
                border: "none",
                borderBottom: "1px solid var(--line)",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-13)",
                color: "var(--text)",
                textAlign: "left",
                transition: "background var(--dur) var(--ease)",
              }}
            >
              <FolderIcon />
              <span>{name}</span>
            </button>
          ))}
          {!loading && !error && entries.length === 0 && (
            <div
              style={{
                padding: "var(--space-3)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--muted)",
              }}
            >
              tidak ada subfolder
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Label style={{ flex: "none" }}>Terpilih</Label>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-13)",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
          >
            {cwd || "—"}
          </span>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="md" disabled={!cwd} onClick={() => onPick(cwd)}>
            Pilih folder ini
          </Button>
        </div>
      </div>
    </Modal>
  );
}
