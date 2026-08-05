import { useState, useEffect } from "react";
import { Project, TaskGroup, fetchTaskGroups, createTaskGroup, deleteTaskGroup, createRun, fetchRuns } from "../../services/projectApi";
import { fetchCategories } from "../../services/routingApi";
import { useApiResource } from "../../state/useApiResource";
import { Button, Card, IconButton, Input, Panel, Badge, Toggle } from "../../components/ds";
import { Field, Label, Meta } from "../../components/Label";
import { useModals } from "../../state/modals";
import { TrashIcon } from "../../components/Icons";

export function TaskListScreen({ project, onOpenRun }: { project: Project; onOpenRun: (taskGroup: TaskGroup, runId: number) => void }) {
  const [res, reload] = useApiResource(() => fetchTaskGroups(project.id));
  const [name, setName] = useState("");
  const [cats, setCats] = useState<{ value: string; label: string }[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const modals = useModals();

  // Untuk saat ini fokus ke dua kategori inti saja: planning → coding.
  const ALLOWED = ["text_planning", "coding_complex"];
  useEffect(() => {
    fetchCategories()
      .then((all) => setCats(all.filter((c) => ALLOWED.includes(c.value))))
      .catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!name || selectedCats.length === 0) return;
    try {
      await createTaskGroup(project.id, name, selectedCats);
      setName("");
      setSelectedCats([]);
      reload();
    } catch (err: any) {
      alert("Failed to create task: " + err.message);
    }
  };

  const handleDelete = (id: number) => {
    modals.openConfirm({
      title: "Hapus task ini?",
      body: "Task group ini akan dihapus.",
      onConfirm: async () => {
        try {
          await deleteTaskGroup(id);
          reload();
        } catch (err: any) {
          alert("Failed to delete task: " + err.message);
        }
      }
    });
  };

  const handleToggleCat = (val: string) => {
    setSelectedCats(prev => prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val]);
  };

  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 800, margin: "0 auto", width: "100%" }}>
      <Panel>
        <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Label>Task Baru</Label>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <Field label="Nama Task" style={{ flex: 1 }}>
              <Input value={name} onChange={e => setName((e.target as any).value)} placeholder="Contoh: Buat Login Page" />
            </Field>
          </div>
          <div>
            <Label>Pipeline Kategori</Label>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
              {cats.map(c => (
                <div key={c.value} style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                  <Toggle checked={selectedCats.includes(c.value)} onChange={() => handleToggleCat(c.value)} />
                  <span style={{ fontSize: "var(--fs-13)" }}>{c.label}</span>
                </div>
              ))}
            </div>
            {selectedCats.length > 0 && (
              <div style={{ marginTop: "var(--space-2)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
                Urutan eksekusi: {selectedCats.join(" → ")}
              </div>
            )}
          </div>
          <div>
            <Button onClick={handleCreate}>+ Buat Task</Button>
          </div>
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {res.phase === "loading" && <Meta>Memuat...</Meta>}
        {res.phase === "error" && <Meta style={{ color: "var(--error)" }}>Gagal memuat: {res.message}</Meta>}
        {res.phase === "ready" && res.data.length === 0 && <Meta>Belum ada task di project ini.</Meta>}
        {res.phase === "ready" && res.data.map((t: any) => (
          <TaskGroupCard key={t.id} taskGroup={t} onDelete={() => handleDelete(t.id)} onOpenRun={(runId) => onOpenRun(t, runId)} />
        ))}
      </div>
    </div>
  );
}

function TaskGroupCard({ taskGroup, onDelete, onOpenRun }: { taskGroup: TaskGroup; onDelete: () => void; onOpenRun: (runId: number) => void }) {
  const [runsRes] = useApiResource(() => fetchRuns(taskGroup.id));

  const handleRun = async () => {
    try {
      const run = await createRun(taskGroup.id);
      onOpenRun(run.id);
    } catch (err: any) {
      alert("Gagal memulai run: " + err.message);
    }
  };

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: "var(--fs-16)", marginBottom: "var(--space-1)" }}>{taskGroup.name}</div>
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              {taskGroup.categories.map((c, i) => <Badge key={i}>{c}</Badge>)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" onClick={handleRun}>Run</Button>
            <IconButton title="Hapus" onClick={onDelete}><TrashIcon /></IconButton>
          </div>
        </div>
        
        <div style={{ marginTop: "var(--space-2)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-2)" }}>
          <Label>Riwayat Run</Label>
          {runsRes.phase === "ready" && runsRes.data.length === 0 && <Meta>Belum ada run.</Meta>}
          {runsRes.phase === "ready" && runsRes.data.map((r: any) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", cursor: "pointer" }} onClick={() => onOpenRun(r.id)}>
              <span style={{ fontSize: "var(--fs-13)", color: "var(--brand)", textDecoration: "underline" }}>Run #{r.id}</span>
              <Badge tone={r.status === "finished" ? "ok" : r.status === "error" ? "error" : "brand"}>{r.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
