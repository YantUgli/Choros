import { useState } from "react";
import { Project, TaskGroup } from "../../services/projectApi";
import { Button } from "../../components/ds";
import { Meta } from "../../components/Label";
import { ProjectsScreen } from "./ProjectsScreen";
import { TaskListScreen } from "./TaskListScreen";
import { RunWorkspace } from "./RunWorkspace";

export type Nav =
  | { screen: "projects" }
  | { screen: "tasks"; project: Project }
  | { screen: "run"; project: Project; taskGroup: TaskGroup; runId: number };

export function ProjectsRoot() {
  const [nav, setNav] = useState<Nav>({ screen: "projects" });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ padding: "8px 16px", display: "flex", gap: "8px", alignItems: "center", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
        <Button variant="ghost" onClick={() => setNav({ screen: "projects" })}>
          Projects
        </Button>
        {nav.screen !== "projects" && (
          <>
            <Meta>/</Meta>
            <Button variant="ghost" onClick={() => setNav({ screen: "tasks", project: nav.project })}>
              {nav.project.name}
            </Button>
          </>
        )}
        {nav.screen === "run" && (
          <>
            <Meta>/</Meta>
            <Meta>Run #{nav.runId} ({nav.taskGroup.name})</Meta>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: nav.screen === "run" ? "hidden" : "auto" }}>
        {nav.screen === "projects" && <ProjectsScreen onOpen={(project) => setNav({ screen: "tasks", project })} />}
        {nav.screen === "tasks" && <TaskListScreen project={nav.project} onOpenRun={(taskGroup, runId) => setNav({ screen: "run", project: nav.project, taskGroup, runId })} />}
        {nav.screen === "run" && <RunWorkspace project={nav.project} taskName={nav.taskGroup.name} runId={nav.runId} />}
      </div>
    </div>
  );
}
