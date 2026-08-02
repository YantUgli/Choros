import { useState } from "react";
import { ChorosWordmark, StatusDot, Tabs, type TabItem } from "./components/ds";
import { Meta } from "./components/Label";
import { ConsoleScreen } from "./features/console/ConsoleScreen";
import { RoutingScreen } from "./features/routing/RoutingScreen";
import { QuotaScreen } from "./features/quota/QuotaScreen";
import { AgentsScreen } from "./features/agents/AgentsScreen";
import { WorkflowsScreen } from "./features/config/WorkflowsScreen";
import { UsersScreen } from "./features/config/UsersScreen";
import { ModalProvider } from "./state/modals";
import { useConsole } from "./state/useConsole";

type View = "console" | "routing" | "quota" | "agents" | "workflows" | "users";

const NAV_TABS: TabItem<View>[] = [
  { value: "console", label: "Console" },
  { value: "routing", label: "Routing" },
  { value: "quota", label: "Quota" },
  { value: "agents", label: "Agents" },
  { value: "workflows", label: "Workflows" },
  { value: "users", label: "Users" },
];

export default function App() {
  const [view, setView] = useState<View>("console");
  const { state, actions, scenario, setScenario } = useConsole();

  return (
    <ModalProvider>
      <div
        style={{
          height: "100vh",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--font-sans)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            height: 48,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <ChorosWordmark size={18} markSize={22} />
          <div style={{ display: "flex", alignItems: "center", alignSelf: "stretch", minWidth: 0, overflow: "auto" }}>
            <Tabs tabs={NAV_TABS} value={view} onChange={setView} aria-label="navigasi utama" />
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              flex: "none",
            }}
          >
            <StatusDot status="ok" label="daemon ok" />
            <Meta>mode lokal terbuka</Meta>
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {view === "console" && (
            <ConsoleScreen
              state={state}
              actions={actions}
              scenario={scenario}
              setScenario={setScenario}
              onOpenQuota={() => setView("quota")}
            />
          )}
          {view === "routing" && <RoutingScreen />}
          {view === "quota" && <QuotaScreen />}
          {view === "agents" && <AgentsScreen />}
          {view === "workflows" && <WorkflowsScreen />}
          {view === "users" && <UsersScreen />}
        </div>
      </div>
    </ModalProvider>
  );
}
