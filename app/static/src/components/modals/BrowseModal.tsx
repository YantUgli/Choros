import { useState } from "react";
import { Button } from "../ds";
import { FolderIcon } from "../Icons";
import { Label } from "../Label";
import { Modal } from "../Modal";
// data contoh
const FS: Record<string, string[]> = {
  "C:\\": ["project", "Users", "Windows", "temp"],
  "C:\\project": ["src", "Assets", "api", "infra", "web"],
  "C:\\project\\src": ["auth", "components", "lib", "routes"],
  "C:\\project\\src\\auth": [],
  "C:\\project\\src\\components": [],
  "C:\\project\\src\\lib": [],
  "C:\\project\\src\\routes": [],
  "C:\\project\\Assets": ["portpilot-notes"],
  "C:\\project\\Assets\\portpilot-notes": [],
  "C:\\project\\api": ["handlers", "db"],
  "C:\\project\\api\\handlers": [],
  "C:\\project\\api\\db": [],
  "C:\\project\\infra": [],
  "C:\\project\\web": ["public", "styles"],
  "C:\\project\\web\\public": [],
  "C:\\project\\web\\styles": [],
  "C:\\Users": ["dev"],
  "C:\\Users\\dev": ["repos"],
  "C:\\Users\\dev\\repos": [],
  "C:\\Windows": [],
  "C:\\temp": [],
};

/** Folder picker: naik/turun folder, breadcrumb mono, "Pilih folder ini". */
export function BrowseModal({
  initial,
  onPick,
  onClose,
}: {
  initial: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState(initial in FS ? initial : "C:\\project");
  const entries = FS[cwd] ?? [];

  const up = () => {
    const parts = cwd.split("\\").filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    setCwd(parts.join("\\") + (parts.length === 1 ? "\\" : ""));
  };

  const enter = (name: string) => setCwd(cwd.replace(/\\+$/, "") + "\\" + name);

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
          <Button variant="ghost" size="sm" onClick={up} aria-label="naik satu folder">
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
            {cwd}
          </div>
        </div>

        <div
          className="ov"
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            maxHeight: 280,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {entries.map((name) => (
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
          {entries.length === 0 && (
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
            {cwd}
          </span>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="md" onClick={() => onPick(cwd)}>
            Pilih folder ini
          </Button>
        </div>
      </div>
    </Modal>
  );
}
