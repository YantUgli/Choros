import { useState } from "react";
import { Button, Panel } from "../../components/ds";
import { createAgent, deleteAgent, fetchAgents, toAgentRows, updateAgent } from "../../services/agentApi";
import { useModals } from "../../state/modals";
import { useApiResource } from "../../state/useApiResource";

const grid = {
  display: "grid",
  gridTemplateColumns: "1fr 150px 200px 70px 130px",
  fontFamily: "var(--font-mono)",
} as const;

export function AgentsScreen() {
  const modals = useModals();
  const [res, reload] = useApiResource(fetchAgents);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (res.phase === "loading") {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reload} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const agents = toAgentRows(res.data);

  const edit = (id: number, name: string, adapter: string, model: string, active: boolean) =>
    modals.openAgent(
      {
        title: `Ubah agent — ${name}`,
        name,
        adapter,
        model: model === "—" ? null : model,
        active,
      },
      async (draft) => {
        setErrorMsg(null);
        try {
          await updateAgent(id, {
            name: draft.name || "agent",
            adapter_type: draft.adapter,
            default_model: draft.model || null,
            base_url: null, // UI saat ini tidak punya input ini
            config: {},
            is_active: draft.active,
          });
          reload();
        } catch (e: any) {
          setErrorMsg(e.message || String(e));
        }
      },
    );

  const create = () =>
    modals.openAgent(
      { title: "Agent baru" },
      async (draft) => {
        setErrorMsg(null);
        try {
          await createAgent({
            name: draft.name || "agent",
            adapter_type: draft.adapter,
            default_model: draft.model || null,
            base_url: null,
            config: {},
            is_active: draft.active,
          });
          reload();
        } catch (e: any) {
          setErrorMsg(e.message || String(e));
        }
      },
    );

  const remove = async (id: number) => {
    if (!window.confirm("Yakin ingin menghapus agent ini?")) return;
    setErrorMsg(null);
    try {
      await deleteAgent(id);
      reload();
    } catch (e: any) {
      setErrorMsg(`Gagal menghapus: ${e.message || String(e)}`);
    }
  };

  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 880 }}>
        <Panel title="Agents" subtitle="adapter resmi per layanan — frekuensi rendah, waktu-setup">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {errorMsg && <div style={{ color: "var(--limit)", fontSize: "var(--fs-13)", marginBottom: "var(--space-2)" }}>{errorMsg}</div>}
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

            {agents.map((a) => (
              <div
                key={a.id}
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
                    onClick={() => edit(a.id, a.name, a.adapter, a.model, a.active)}
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
                    onClick={() => remove(a.id)}
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

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
              <Button variant="secondary" size="sm" onClick={create}>
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
