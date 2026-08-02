import { useEffect, useRef, useState } from "react";
import { Button, Card, Panel, StatusDot } from "../../components/ds";
import { GripIcon } from "../../components/Icons";
import { Label, Meta } from "../../components/Label";
import { ADAPTERS } from "../../data/katalogModel";
import { useModals } from "../../state/modals";
import { useApiResource } from "../../state/useApiResource";
import {
  createRoutingRule,
  deleteRoutingRule,
  fetchCategories,
  fetchRoutingData,
  RouteTarget,
  updateRoutingRule,
} from "../../services/routingApi";
import { fetchAgents } from "../../services/agentApi";

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

export function RoutingScreen() {
  const modals = useModals();
  const [res, reloadData] = useApiResource(fetchRoutingData);
  const [catsRes] = useApiResource(fetchCategories);
  
  const [optimisticChains, setOptimisticChains] = useState<Record<string, RouteTarget[]> | null>(null);
  
  const [cat, setCat] = useState<string>("coding_complex");
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Optimistic update
  useEffect(() => {
    if (res.phase === "ready") {
      setOptimisticChains(res.data);
    }
  }, [res]);

  if (res.phase === "loading" || !optimisticChains) {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reloadData} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const categories = catsRes.phase === "ready" ? catsRes.data : [];
  
  // Kalau kategori tidak ada (misalnya DB kosong), tambahkan yang terpilih ke UI agar bisa di-edit.
  if (categories.length > 0 && !categories.some(c => c.value === cat)) {
    setCat(categories[0]!.value);
  }

  const targets = optimisticChains[cat] || [];

  const setTargets = (next: RouteTarget[]) => setOptimisticChains({ ...optimisticChains, [cat]: next });

  const reorder = async (from: number, to: number) => {
    const next = move(targets, from, to);
    setTargets(next);
    
    // Kirim pembaruan prioritas per baris ke server
    for (let i = 0; i < next.length; i++) {
      const t = next[i]!;
      await updateRoutingRule(t.id, {
        category: cat,
        agent_id: t.agentId,
        model: t.model,
        priority: i + 1,
      });
    }
    reloadData();
  };

  const editTarget = async (t: RouteTarget, index: number) => {
    const agents = await fetchAgents();
    modals.openAgent(
      {
        title: `Ubah target ${index + 1}`,
        name: t.agent,
        adapter: t.adapter,
        model: t.model,
        active: true,
      },
      async (draft) => {
        // Cari agent_id dari agent list by name
        let agentId = t.agentId;
        const matchingAgent = agents.find(a => a.name === draft.name);
        if (matchingAgent) {
          agentId = matchingAgent.id;
        }

        await updateRoutingRule(t.id, {
          category: cat,
          agent_id: agentId,
          model: draft.model || null,
          priority: index + 1,
        });
        reloadData();
      },
    );
  };

  const addTarget = async () => {
    const agents = await fetchAgents();
    modals.openAgent({ title: `Tambah target — ${cat}` }, async (draft) => {
      let agentId = 0;
      const matchingAgent = agents.find(a => a.name === draft.name);
      if (matchingAgent) {
        agentId = matchingAgent.id;
      }
      
      await createRoutingRule({
        category: cat,
        agent_id: agentId,
        model: draft.model || null,
        priority: targets.length + 1,
      });
      reloadData();
    });
  };

  const removeTarget = async (id: number) => {
    if (!window.confirm("Hapus target routing ini?")) return;
    await deleteRoutingRule(id);
    reloadData();
  };

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
      <div
        className="ov"
        style={{
          width: 240,
          flex: "none",
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          padding: "var(--space-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          overflow: "auto",
        }}
      >
        <Label>Kategori</Label>
        {categories.map((c) => (
          <Card key={c.value} interactive active={cat === c.value} onClick={() => setCat(c.value)}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-13)",
                padding: 2,
              }}
            >
              <span style={{ fontWeight: cat === c.value ? 600 : 400, color: cat === c.value ? "var(--text)" : "var(--muted)" }}>
                {c.label}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "var(--fs-12)" }}>{optimisticChains[c.value]?.length || 0}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
        <Panel
          title="Rantai prioritas"
          subtitle={`${cat} — urutan jatuh saat 429 · limit`}
          style={{ maxWidth: 900 }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {targets.map((t, i) => (
              <div key={t.id}>
                <Card
                  interactive
                  onClick={() => editTarget(t, i)}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom.current !== null) reorder(dragFrom.current, i);
                    dragFrom.current = null;
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null;
                    setDragOver(null);
                  }}
                  style={
                    dragOver === i && dragFrom.current !== null && dragFrom.current !== i
                      ? { borderColor: "var(--brand-dim)" }
                      : undefined
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-13)",
                      padding: 2,
                    }}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`urutkan ${t.label} — Alt+panah atas/bawah`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (!e.altKey) return;
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          reorder(i, i - 1);
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          reorder(i, i + 1);
                        }
                      }}
                      style={{ display: "inline-flex", lineHeight: 1 }}
                    >
                      <GripIcon />
                    </span>
                    <span style={{ color: "var(--muted)", width: 12, flex: "none" }}>{i + 1}</span>
                    <span
                      style={{
                        width: 280,
                        flex: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.label}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 15 }}>
                      <StatusDot status={t.quotaExhausted ? "error" : "ok"} label={t.quotaLabel} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTarget(t.id);
                        }}
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
                    </div>
                  </div>
                </Card>
                <div
                  style={{
                    padding: "4px 0 4px 28px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-12)",
                    color: "var(--muted)",
                  }}
                >
                  {i === 0 && targets.length > 1
                    ? "↓ jika 429 · limit"
                    : i < targets.length - 1
                      ? "↓"
                      : "↓ rantai habis → run masuk halted — plan tersimpan"}
                </div>
              </div>
            ))}

            {targets.length === 0 && (
              <Meta>rantai kosong — tugas kategori ini langsung masuk halted.</Meta>
            )}

            <div
              style={{
                marginTop: "var(--space-2)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <Button variant="secondary" size="sm" onClick={addTarget}>
                + tambah target
              </Button>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--muted)" }}>
                drag ⠿ untuk mengurut (Alt+↑/↓ dari keyboard) · klik baris untuk ubah agent/model
              </span>
            </div>
          </div>
        </Panel>

        <div style={{ marginTop: "var(--space-3)", maxWidth: 900 }}>
          <Meta>
            adapter tersedia: {Object.keys(ADAPTERS).join(" · ")}
          </Meta>
        </div>
      </div>
    </div>
  );
}
