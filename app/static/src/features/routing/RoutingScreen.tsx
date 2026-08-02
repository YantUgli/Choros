import { useRef, useState } from "react";
import { Badge, Button, Card, Panel, StatusDot } from "../../components/ds";
import { GripIcon } from "../../components/Icons";
import { Label, Meta } from "../../components/Label";
import { ADAPTERS, CATEGORIES, ROUTE_CHAINS, type RouteTarget } from "../../data/fixtures";
import { useModals } from "../../state/modals";
import type { TaskCategory } from "../../state/types";

type Chains = Record<TaskCategory, RouteTarget[]>;

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
  const [chains, setChains] = useState<Chains>(() => structuredClone(ROUTE_CHAINS));
  const [cat, setCat] = useState<TaskCategory>("coding_complex");
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const targets = chains[cat];

  const setTargets = (next: RouteTarget[]) => setChains({ ...chains, [cat]: next });

  const reorder = (from: number, to: number) => setTargets(move(targets, from, to));

  const editTarget = (t: RouteTarget, index: number) => {
    modals.openAgent(
      {
        title: `Ubah target ${index + 1}`,
        name: t.agent,
        adapter: t.adapter,
        model: t.model,
        active: true,
      },
      (draft) => {
        setTargets(
          targets.map((x, i) =>
            i === index
              ? {
                  ...x,
                  agent: draft.name || x.agent,
                  adapter: draft.adapter,
                  model: draft.model,
                  target: `${draft.name || x.agent}/${draft.model}`,
                }
              : x,
          ),
        );
      },
    );
  };

  const addTarget = () => {
    modals.openAgent({ title: `Tambah target — ${cat}` }, (draft) => {
      setTargets([
        ...targets,
        {
          id: `new-${Date.now()}`,
          target: `${draft.name || "agent"}/${draft.model}`,
          agent: draft.name || "agent",
          adapter: draft.adapter,
          model: draft.model,
          floor: null,
          quotaStatus: "ok",
          quotaLabel: "tersedia",
        },
      ]);
    });
  };

  const addCategory = () => {
    modals.openAgent({ title: "Kategori baru — target pertama" }, () => {
      /* kategori baru butuh endpoint daemon; belum ada di mock. */
    });
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
        {CATEGORIES.map((c) => (
          <Card key={c} interactive active={cat === c} onClick={() => setCat(c)}>
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
              <span style={{ fontWeight: cat === c ? 600 : 400, color: cat === c ? "var(--text)" : "var(--muted)" }}>
                {c}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "var(--fs-12)" }}>{chains[c].length}</span>
            </div>
          </Card>
        ))}
        <Button variant="ghost" size="sm" onClick={addCategory} style={{ width: "100%" }}>
          + kategori baru
        </Button>
      </div>

      <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
        <Panel
          title="Rantai prioritas"
          subtitle={`${cat} — urutan jatuh saat 429 · limit · < floor`}
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
                      aria-label={`urutkan ${t.target} — Alt+panah atas/bawah`}
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
                      {t.target}
                    </span>
                    <Badge tone="neutral">floor {t.floor ?? "—"}</Badge>
                    <div style={{ marginLeft: "auto" }}>
                      <StatusDot status={t.quotaStatus} label={t.quotaLabel} />
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
                    ? "↓ jika 429 · limit · < floor"
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
