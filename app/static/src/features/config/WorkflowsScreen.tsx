import { Button, Panel } from "../../components/ds";

export function WorkflowsScreen() {
  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 880 }}>
        <Panel
          title="Workflows"
          subtitle="rangkaian tugas multi-langkah — opsional"
          actions={
            <Button variant="secondary" size="sm">
              + buat baru
            </Button>
          }
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "var(--space-2)",
              padding: "var(--space-2) 0",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)", color: "var(--muted)" }}>
              belum ada workflow
            </span>
            <span style={{ fontSize: "var(--fs-12)", color: "var(--muted)", lineHeight: 1.5 }}>
              buat rangkaian tugas yang jalan berurut lewat rantai routing yang sama.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
