import { useEffect, useState } from "react";
import { Button, Card } from "../ds";
import { Label, Meta } from "../Label";
import { Modal } from "../Modal";
import { fetchAgents, type WireAgentFull } from "../../services/agentApi";

export interface RouteTargetPreset {
  title: string;
  /** Agent yang sudah terpasang di target (mode ubah) → diseleksi awal. */
  agentId?: number;
}

/**
 * Picker target routing: PILIH agent yang sudah ada (bukan ketik nama).
 * Target menyimpan `agent_id`; model selalu ikut `default_model` agent
 * (tanpa override per-target). Menghapus kelas gagal "Agent tidak ditemukan".
 */
export function RouteTargetModal({
  preset,
  onSave,
  onClose,
}: {
  preset: RouteTargetPreset;
  onSave: (agentId: number) => void;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<WireAgentFull[]>([]);
  const [picked, setPicked] = useState<number | null>(preset.agentId ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents()
      .then((ags) => {
        setAgents(ags.filter((a) => a.is_active));
        setLoading(false);
      })
      .catch((e: any) => {
        setError(e?.message || String(e));
        setLoading(false);
      });
  }, []);

  const ready = picked !== null;

  return (
    <Modal title={preset.title} onClose={onClose} width={560}>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Meta>
          Pilih agent yang sudah terdaftar. Model mengikuti default agent tersebut.
        </Meta>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Label>Agent</Label>
            <Meta style={{ marginLeft: "auto" }}>{picked !== null ? "1 terpilih" : "belum dipilih"}</Meta>
          </div>
          {error ? (
            <Meta style={{ color: "var(--limit)" }}>gagal memuat agent: {error}</Meta>
          ) : loading ? (
            <Meta>Memuat agent…</Meta>
          ) : agents.length === 0 ? (
            <Meta>belum ada agent aktif — tambahkan agent lebih dulu di menu Agents.</Meta>
          ) : (
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {agents.map((a) => {
                const on = picked === a.id;
                return (
                  <Card
                    key={a.id}
                    interactive
                    active={on}
                    onClick={() => setPicked(a.id)}
                    style={{
                      padding: "var(--space-2) var(--space-3)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 160,
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

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="md" disabled={!ready} onClick={() => picked !== null && onSave(picked)}>
            Simpan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
