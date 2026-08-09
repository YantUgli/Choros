import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Command palette (⌘K / Ctrl+K) — navigasi & aksi cepat tanpa mouse.
 *
 * Registry berbasis context: komponen mana pun mendaftarkan perintahnya lewat
 * `useRegisterCommands([...], deps)` saat mount, dan melepasnya saat unmount.
 * App mendaftarkan navigasi view; ProjectsRoot mendaftarkan lompatan layar;
 * tiap ConsolePanel mendaftarkan aksi lane-nya (delegasi, ciutkan, stream/hasil).
 *
 * Tidak menambah primitive DS baru — hanya menyusun token + elemen HTML biasa.
 */

export interface Command {
  /** unik lintas seluruh app; dipakai untuk dedup registry. */
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandCtx {
  register: (cmd: Command) => () => void;
  open: () => void;
}

const CommandContext = createContext<CommandCtx | null>(null);

/** Akses tombol buka palette (mis. untuk chip ⌘K di header). Null bila di luar provider. */
export function useCommandPalette(): CommandCtx | null {
  return useContext(CommandContext);
}

/**
 * Daftarkan sekumpulan perintah selama komponen ter-mount. `deps` mengontrol
 * kapan perintah didaftar ulang (mis. saat status/route lane berubah).
 */
export function useRegisterCommands(commands: Command[], deps: React.DependencyList): void {
  const ctx = useContext(CommandContext);
  useEffect(() => {
    if (!ctx) return;
    const cleanups = commands.map((c) => ctx.register(c));
    return () => cleanups.forEach((fn) => fn());
    // commands di-rebuild dari deps yang diberikan pemanggil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const registry = useRef<Map<string, Command>>(new Map());
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);

  const register = useCallback((cmd: Command) => {
    registry.current.set(cmd.id, cmd);
    bump((n) => n + 1);
    return () => {
      registry.current.delete(cmd.id);
      bump((n) => n + 1);
    };
  }, []);

  const value = useMemo<CommandCtx>(() => ({ register, open: () => setOpen(true) }), [register]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "j")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandContext.Provider value={value}>
      {children}
      {open && <Palette commands={[...registry.current.values()]} onClose={() => setOpen(false)} />}
    </CommandContext.Provider>
  );
}

// ── Overlay ─────────────────────────────────────────────────────────────────

const scrim: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  zIndex: 60,
  padding: "var(--space-6)",
};

const box: CSSProperties = {
  marginTop: "10vh",
  width: 560,
  maxWidth: "100%",
  maxHeight: "70vh",
  background: "var(--panel-2)",
  border: "1px solid var(--line-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-modal)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(s) || c.group.toLowerCase().includes(s),
    );
  }, [commands, q]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  const runAt = (i: number) => {
    const c = filtered[i];
    onClose();
    c?.run();
  };

  // Grup mengikuti urutan kemunculan pertama; indeks datar dipertahankan untuk highlight.
  const groups: { name: string; items: { cmd: Command; idx: number }[] }[] = [];
  filtered.forEach((cmd, idx) => {
    let g = groups.find((x) => x.name === cmd.group);
    if (!g) {
      g = { name: cmd.group, items: [] };
      groups.push(g);
    }
    g.items.push({ cmd, idx });
  });

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={scrim}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" style={box} onKeyDown={onKey}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lompat ke view, atau jalankan aksi…"
            aria-label="Cari perintah"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--fs-15)",
            }}
          />
        </div>

        <div className="ov" style={{ overflow: "auto", minHeight: 0, padding: "var(--space-2) 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "var(--space-3) var(--space-4)", color: "var(--muted)", fontSize: "var(--fs-13)" }}>
              tidak ada perintah yang cocok
            </div>
          )}
          {groups.map((g) => (
            <div key={g.name}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  letterSpacing: "var(--tracking-label)",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  padding: "var(--space-2) var(--space-4) var(--space-1)",
                }}
              >
                {g.name}
              </div>
              {g.items.map(({ cmd, idx }) => (
                <div
                  key={cmd.id}
                  role="button"
                  tabIndex={-1}
                  onMouseMove={() => setSel(idx)}
                  onClick={() => runAt(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-4)",
                    cursor: "pointer",
                    fontSize: "var(--fs-13)",
                    color: "var(--text)",
                    background: idx === sel ? "var(--brand-fill)" : "transparent",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cmd.label}
                  </span>
                  {cmd.hint && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
                      {cmd.hint}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
