import { useEffect, useState } from "react";
import { Button, Card, Badge } from "../ds";
import { Label, Meta } from "../Label";
import { Modal } from "../Modal";
import { fetchArtifactCandidates, type ArtifactCandidates } from "../../services/projectApi";

export function DelegateModal({
  taskId,
  nextCategory,
  onDelegate,
  onClose,
}: {
  taskId: number;
  nextCategory: string;
  onDelegate: (artifact: string) => void;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<ArtifactCandidates | null>(null);
  const [selected, setSelected] = useState<string>("_final");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchArtifactCandidates(taskId)
      .then((res) => {
        setCandidates(res);
        setText(res.finalOutput || "");
        setLoading(false);
      })
      .catch((err) => {
        // Dulu error ini ditelan diam-diam → modal kosong, tombol non-aktif,
        // tanpa penjelasan. Sekarang ditampilkan.
        setLoadError(err?.message ? String(err.message) : String(err));
        setLoading(false);
      });
  }, [taskId]);

  const select = (val: string) => {
    setSelected(val);
    if (!candidates) return;
    if (val === "_final") setText(candidates.finalOutput || "");
    else setText(candidates.mdFiles[Number(val)]?.content || "");
  };

  const sources = [
    { key: "_final", label: "Output akhir", hint: "hasil teks console ini" },
    ...(candidates?.mdFiles ?? []).map((m, i) => ({ key: String(i), label: m.path, hint: "file markdown" })),
  ];

  return (
    <Modal title={`Delegasikan ke ${nextCategory}`} onClose={onClose} width={720}>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {loading ? (
          <Meta>Memuat artefak…</Meta>
        ) : loadError ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <span role="alert">
              <Meta style={{ color: "var(--error)" }}>Gagal memuat artefak: {loadError}</Meta>
            </span>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={onClose}>Tutup</Button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <Label>Sumber konteks</Label>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {sources.map((s) => (
                  <Card
                    key={s.key}
                    interactive
                    active={selected === s.key}
                    onClick={() => select(s.key)}
                    style={{ padding: "var(--space-2) var(--space-3)", display: "flex", flexDirection: "column", gap: 2, minWidth: 140 }}
                  >
                    <span style={{ fontSize: "var(--fs-13)", fontFamily: "var(--font-mono)" }}>{s.label}</span>
                    <Meta>{s.hint}</Meta>
                  </Card>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Label>Konteks untuk</Label>
                <Badge tone="brand" mono>{nextCategory}</Badge>
                <Meta style={{ marginLeft: "auto" }}>bisa diedit sebelum dikirim</Meta>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{
                  width: "100%", height: 300, resize: "vertical", padding: "var(--space-2)",
                  fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)", lineHeight: 1.5,
                  border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
                  background: "var(--panel-2)", color: "var(--text)",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              {!text.trim() && (
                <Meta style={{ marginRight: "auto", color: "var(--warn)" }}>
                  Tidak ada artefak — tulis/pilih konteks dulu sebelum delegasi.
                </Meta>
              )}
              <Button variant="ghost" onClick={onClose}>Batal</Button>
              <Button
                variant="secondary"
                onClick={() => onDelegate(candidates?.finalOutput || text)}
                disabled={!(candidates?.finalOutput || text).trim()}
                title="Kirim output akhir apa adanya"
              >
                Execute tanpa edit
              </Button>
              <Button variant="primary" onClick={() => onDelegate(text)} disabled={!text.trim()}>
                Delegasikan →
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
