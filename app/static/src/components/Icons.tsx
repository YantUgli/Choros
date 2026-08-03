/** Ikon garis 1.6–1.8px, currentColor. Tidak ada ikon berwarna. */

export function FolderIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      <path d="M3 7 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v8 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 z" />
    </svg>
  );
}

export function GripIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-13)",
        color: "var(--muted)",
        cursor: "grab",
        lineHeight: 1,
      }}
    >
      ⠿
    </span>
  );
}

export function Caret({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", lineHeight: 1 }}
    >
      {open ? "▾" : "▸"}
    </span>
  );
}
