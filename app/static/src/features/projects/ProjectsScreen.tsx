import { useState } from "react";
import { Project, fetchProjects, createProject, deleteProject } from "../../services/projectApi";
import { useApiResource } from "../../state/useApiResource";
import { Button, Card, IconButton, Input, Panel } from "../../components/ds";
import { Field, Label, Meta } from "../../components/Label";
import { useModals } from "../../state/modals";
import { TrashIcon } from "../../components/Icons";

export function ProjectsScreen({ onOpen }: { onOpen: (project: Project) => void }) {
  const [res, reload] = useApiResource(fetchProjects);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const modals = useModals();

  const nameMissing = !name.trim();
  const folderMissing = !folder.trim();

  const handleCreate = async () => {
    // Validasi eksplisit — dulu diam-diam `return` sehingga klik "Buat" tanpa
    // isian tidak memberi umpan balik apa pun.
    if (nameMissing || folderMissing) {
      setError(
        nameMissing && folderMissing
          ? "Isi nama project dan folder path dulu."
          : nameMissing
          ? "Nama project belum diisi."
          : "Folder path belum diisi.",
      );
      return;
    }
    setError(null);
    try {
      await createProject(name.trim(), folder.trim());
      setName("");
      setFolder("");
      reload();
    } catch (err: any) {
      setError("Gagal membuat project: " + (err?.message ?? String(err)));
    }
  };

  const handleDelete = (id: number) => {
    modals.openConfirm({
      title: "Hapus project ini?", 
      body: "Project dan riwayat tugasnya akan hilang selamanya.",
      onConfirm: async () => {
        try {
          await deleteProject(id);
          reload();
        } catch (err: any) {
          alert("Failed to delete project: " + err.message);
        }
      }
    });
  };

  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 800, margin: "0 auto", width: "100%" }}>
      <Panel>
        <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Label>Project Baru</Label>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <Field label="Nama Project" style={{ flex: 1 }}>
              <Input
                value={name}
                onChange={(e: any) => { setName(e.target.value); if (error) setError(null); }}
                placeholder="Contoh: Web App"
                invalid={error !== null && nameMissing}
                aria-invalid={error !== null && nameMissing}
              />
            </Field>
            <Field label="Folder Path" style={{ flex: 2 }}>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Input
                  value={folder}
                  onChange={(e: any) => { setFolder(e.target.value); if (error) setError(null); }}
                  placeholder="/path/to/folder"
                  style={{ flex: 1 }}
                  invalid={error !== null && folderMissing}
                  aria-invalid={error !== null && folderMissing}
                />
                <Button variant="secondary" onClick={() => modals.openBrowse(folder || "/", setFolder)}>
                  Browse...
                </Button>
              </div>
            </Field>
            <Button onClick={handleCreate}>+ Buat</Button>
          </div>
          {error && (
            <span role="alert"><Meta style={{ color: "var(--error)" }}>{error}</Meta></span>
          )}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {res.phase === "loading" && <Meta>Memuat...</Meta>}
        {res.phase === "error" && <Meta style={{ color: "var(--error)" }}>Gagal memuat: {res.message}</Meta>}
        {res.phase === "ready" && res.data.length === 0 && <Meta>Belum ada project.</Meta>}
        {res.phase === "ready" && res.data.map(p => (
          <div key={p.id} style={{ display: "flex", gap: "var(--space-2)" }}>
            <div style={{ flex: 1 }}>
              <Card interactive onClick={() => onOpen(p)}>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <Meta>{p.folderPath}</Meta>
                </div>
              </Card>
            </div>
            <IconButton title="Hapus" onClick={() => handleDelete(p.id)}><TrashIcon /></IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
