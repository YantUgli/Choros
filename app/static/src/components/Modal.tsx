import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./ds";

/**
 * Lapisan mengambang — satu-satunya tempat shadow dipakai.
 * Tutup: klik scrim di luar kartu, tombol ✕, atau Esc. Fokus dikunci di dalam.
 */
export function Modal({
  title,
  width = 460,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => {
      cardRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
    };
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "var(--space-6)",
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "100%",
          background: "var(--panel)",
          border: "1px solid var(--line-strong)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 44,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span
            style={{
              fontSize: "var(--fs-13)",
              fontWeight: 600,
              letterSpacing: "var(--tracking-label)",
            }}
          >
            {title}
          </span>
          <div style={{ marginLeft: "auto" }}>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Tutup">
              ✕
            </Button>
          </div>
        </div>
        <div style={{ overflow: "auto", minHeight: 0 }} className="ov">
          {children}
        </div>
      </div>
    </div>
  );
}
