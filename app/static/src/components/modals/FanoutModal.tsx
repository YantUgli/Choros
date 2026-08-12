import { useEffect, useState } from "react";
import { Button, Card } from "../ds";
import { Label, Meta } from "../Label";
import { Modal } from "../Modal";
import { fetchAgents, type WireAgentFull } from "../../services/agentApi";

/** Picker fan-out (Item C): pilih tepat 2 agent + prompt untuk menjalankan satu lane
 *  di dua agent serentak. Isolasi worktree per cabang; membakar kuota 2×. */
export function FanoutModal({
  category,
  initialPrompt,
  onStart,
  onClose,
}: {
  category: string;
  initialPrompt: string;
  onStart: (agentIds: number[], prompt: string, allowUnisolated: boolean) => void;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<WireAgentFull[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [allowUnisolated, setAllowUnisolated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents()
      .then((ags) => {
        setAgents(ags.filter((a) => a.is_active));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : p));

  const ready = picked.length === 2 && prompt.trim().length > 0;

  return (
    <Modal title={`Fan-out lane ${category}`} onClose={onClose} width={640}>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Meta>
          Jalankan lane ini di 2 agent serentak (worktree terisolasi per cabang), bandingkan,
          lalu pilih pemenang. Membakar kuota 2×.
        </Meta>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Label>Pilih 2 agent</Label>
            <Meta style={{ marginLeft: "auto" }}>{picked.length}/2 terpilih</Meta>
          </div>
          {loading ? (
            <Meta>Memuat agent…</Meta>
          ) : agents.length < 2 ? (
            <Meta>Butuh ≥2 agent aktif untuk fan-out.</Meta>
          ) : (
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {agents.map((a) => {
                const on = picked.includes(a.id);
                const dim = picked.length >= 2 && !on;
                return (
                  <Card
                    key={a.id}
                    interactive
                    active={on}
                    onClick={() => toggle(a.id)}
                    style={{
                      padding: "var(--space-2) var(--space-3)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 160,
                      opacity: dim ? 0.5 : 1,
                    }}
                  >
                    <span style={{ fontSize: "var(--fs-13)", fontFamily: "var(--font-mono)" }}>{a.name}</span>
                    <Meta>{(a.default_model || "—") + " · " + a.adapter_type}</Meta>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <Label>Prompt</Label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              width: "100%", height: 160, resize: "vertical", padding: "var(--space-2)",
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)", lineHeight: 1.5,
              border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
              background: "var(--panel-2)", color: "var(--text)",
            }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={allowUnisolated} onChange={(e) => setAllowUnisolated(e.target.checked)} />
          <Meta>Izinkan tanpa isolasi (folder bukan repo git — berisiko tabrakan tulis antar cabang)</Meta>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!ready} onClick={() => onStart(picked, prompt, allowUnisolated)}>
            Mulai fan-out (2 agent) →
          </Button>
        </div>
      </div>
    </Modal>
  );
}
