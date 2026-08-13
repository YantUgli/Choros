import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  AgentEditorModal,
  type AgentDraft,
  type AgentPreset,
} from "../components/modals/AgentEditorModal";
import { DiffModal } from "../components/modals/DiffModal";
import { ConfirmModal } from "../components/modals/ConfirmModal";
import { BrowseModal } from "../components/modals/BrowseModal";
import { DelegateModal } from "../components/modals/DelegateModal";
import { FanoutModal } from "../components/modals/FanoutModal";
import {
  RouteTargetModal,
  type RouteTargetPreset,
} from "../components/modals/RouteTargetModal";

type ModalRequest =
  | { type: "agent"; preset: AgentPreset; onSave: (draft: AgentDraft) => void }
  | { type: "routeTarget"; preset: RouteTargetPreset; onSave: (agentId: number) => void }
  | { type: "diff"; runId: number; onMerge: () => void }
  | { type: "confirm"; title: string; body: string; onConfirm: () => void }
  | { type: "browse"; initial: string; onPick: (path: string) => void }
  | { type: "delegate"; taskId: number; nextCategory: string; onDelegate: (artifact: string) => void }
  | { type: "fanout"; category: string; initialPrompt: string; onStart: (agentIds: number[], prompt: string, allowUnisolated: boolean) => void };

interface ModalApi {
  openAgent: (preset: AgentPreset, onSave: (draft: AgentDraft) => void) => void;
  openRouteTarget: (preset: RouteTargetPreset, onSave: (agentId: number) => void) => void;
  openDiff: (runId: number, onMerge: () => void) => void;
  openConfirm: (opts: { title: string; body: string; onConfirm: () => void }) => void;
  openBrowse: (initial: string, onPick: (path: string) => void) => void;
  openDelegate: (taskId: number, nextCategory: string, onDelegate: (artifact: string) => void) => void;
  openFanout: (category: string, initialPrompt: string, onStart: (agentIds: number[], prompt: string, allowUnisolated: boolean) => void) => void;
  close: () => void;
}

const Ctx = createContext<ModalApi | null>(null);

export function useModals(): ModalApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useModals harus dipakai di dalam <ModalProvider>");
  return api;
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const close = useCallback(() => setModal(null), []);

  const api = useMemo<ModalApi>(
    () => ({
      openAgent: (preset, onSave) => setModal({ type: "agent", preset, onSave }),
      openRouteTarget: (preset, onSave) => setModal({ type: "routeTarget", preset, onSave }),
      openDiff: (runId, onMerge) => setModal({ type: "diff", runId, onMerge }),
      openConfirm: (opts) => setModal({ type: "confirm", ...opts }),
      openBrowse: (initial, onPick) => setModal({ type: "browse", initial, onPick }),
      openDelegate: (taskId, nextCategory, onDelegate) => setModal({ type: "delegate", taskId, nextCategory, onDelegate }),
      openFanout: (category, initialPrompt, onStart) => setModal({ type: "fanout", category, initialPrompt, onStart }),
      close,
    }),
    [close],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {modal?.type === "agent" && (
        <AgentEditorModal
          preset={modal.preset}
          onSave={(draft) => {
            modal.onSave(draft);
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "routeTarget" && (
        <RouteTargetModal
          preset={modal.preset}
          onSave={(agentId) => {
            modal.onSave(agentId);
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "diff" && (
        <DiffModal
          runId={modal.runId}
          onMerge={() => {
            modal.onMerge();
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "confirm" && (
        <ConfirmModal
          title={modal.title}
          body={modal.body}
          onConfirm={() => {
            modal.onConfirm();
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "browse" && (
        <BrowseModal
          initial={modal.initial}
          onPick={(p) => {
            modal.onPick(p);
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "delegate" && (
        <DelegateModal
          taskId={modal.taskId}
          nextCategory={modal.nextCategory}
          onDelegate={(artifact) => {
            modal.onDelegate(artifact);
            close();
          }}
          onClose={close}
        />
      )}
      {modal?.type === "fanout" && (
        <FanoutModal
          category={modal.category}
          initialPrompt={modal.initialPrompt}
          onStart={(agentIds, prompt, allowUnisolated) => {
            modal.onStart(agentIds, prompt, allowUnisolated);
            close();
          }}
          onClose={close}
        />
      )}
    </Ctx.Provider>
  );
}

export type { AgentDraft, AgentPreset };
