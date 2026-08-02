import { Button, Panel } from "../../components/ds";

const grid = {
  display: "grid",
  gridTemplateColumns: "1fr 140px 130px",
  fontFamily: "var(--font-mono)",
} as const;

export function UsersScreen() {
  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div
          role="note"
          style={{
            border: "1px solid var(--limit)",
            background: "var(--limit-fill)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 12px",
            fontSize: "var(--fs-12)",
            color: "var(--text)",
            lineHeight: 1.5,
          }}
        >
          mode lokal terbuka (CHOROS_ADMIN_PASSWORD_HASH kosong &amp; belum ada user berpassword).
          Jangan expose port ini ke jaringan.
        </div>

        <Panel title="Users" subtitle="satu operator lokal — instrumen single-user">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div
              style={{
                ...grid,
                fontSize: "var(--fs-12)",
                color: "var(--muted)",
                letterSpacing: "var(--tracking-label)",
                textTransform: "uppercase",
                padding: "6px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span>user</span>
              <span>peran</span>
              <span />
            </div>
            <div
              style={{
                ...grid,
                alignItems: "center",
                fontSize: "var(--fs-13)",
                padding: "var(--space-1) 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span>admin</span>
              <span style={{ color: "var(--muted)" }}>operator</span>
              <button
                type="button"
                style={{
                  fontSize: "var(--fs-12)",
                  color: "var(--brand)",
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                set password
              </button>
            </div>
            <div>
              <Button variant="secondary" size="sm">
                + user baru
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
