import { useState } from "react";
import { Button, Panel } from "../../components/ds";
import { AGENTS, type AgentRow } from "../../data/fixtures";
import { useModals } from "../../state/modals";

const grid = {
  display: "grid",
  gridTemplateColumns: "1fr 150px 200px 70px 130px",
  fontFamily: "var(--font-mono)",
} as const;

export function AgentsScreen() {
  const modals = useModals();
  const [agents, setAgents] = useState<AgentRow[]>(AGENTS);

  const upsert = (row: AgentRow, replaceIndex?: number) => {
    setAgents((prev) => {
      if (replaceIndex != null) return prev.map((a, i) => (i === replaceIndex ? row : a));
      const idx = prev.findIndex((a) => a.name === row.name);
      return idx >= 0 ? prev.map((a, i) => (i === idx ? row : a)) : [...prev, row];
    });
  };

  const edit = (a: AgentRow, index: number) =>
    modals.openAgent(
      {
        title: `Ubah agent — ${a.name}`,
        name: a.name,
        adapter: a.adapter,
        model: a.model === "—" ? null : a.model,
        active: a.active,
      },
      (draft) =>
        upsert(
          { name: draft.name || "agent", adapter: draft.adapter, model: draft.model || "—", active: draft.active },
          index,
        ),
    );

  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 880 }}>
        <Panel title="Agents" subtitle="adapter resmi per layanan — frekuensi rendah, waktu-setup">
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
              <span>nama</span>
              <span>adapter</span>
              <span>model default</span>
              <span>aktif</span>
              <span />
            </div>

            {agents.map((a, i) => (
              <div
                key={a.name}
                style={{
                  ...grid,
                  alignItems: "center",
                  fontSize: "var(--fs-13)",
                  padding: "var(--space-1) 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span>{a.name}</span>
                <span style={{ color: "var(--muted)" }}>{a.adapter}</span>
                <span style={{ color: "var(--muted)" }}>{a.model}</span>
                <span>{a.active ? "ya" : "tidak"}</span>
                <span style={{ fontSize: "var(--fs-12)", display: "flex", gap: "var(--space-2)" }}>
                  <button
                    type="button"
                    onClick={() => edit(a, i)}
                    style={{
                      color: "var(--brand)",
                      cursor: "pointer",
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                    }}
                  >
                    ubah
                  </button>
                  <span style={{ color: "var(--muted)" }}>·</span>
                  <button
                    type="button"
                    onClick={() => setAgents((prev) => prev.filter((_, j) => j !== i))}
                    className="choros-danger-link"
                    style={{
                      color: "var(--muted)",
                      cursor: "pointer",
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      transition: "color var(--dur) var(--ease)",
                    }}
                  >
                    hapus
                  </button>
                </span>
              </div>
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  modals.openAgent({ title: "Agent baru" }, (draft) =>
                    upsert({
                      name: draft.name || "agent",
                      adapter: draft.adapter,
                      model: draft.model || "—",
                      active: draft.active,
                    }),
                  )
                }
              >
                + agent baru
              </Button>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--muted)" }}>
                model default dipilih dari daftar adapter — bukan ketik manual (hindari typo)
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
