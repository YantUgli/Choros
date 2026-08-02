import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  AgentEditorModal,
  type AgentDraft,
  type AgentPreset,
} from "../components/modals/AgentEditorModal";
import { BrowseModal } from "../components/modals/BrowseModal";
import { DiffModal } from "../components/modals/DiffModal";

type ModalRequest =
  | { type: "agent"; preset: AgentPreset; onSave: (draft: AgentDraft) => void }
  | { type: "diff"; runId: number; onMerge: () => void }
  | { type: "browse"; initial: string; onPick: (path: string) => void };

interface ModalApi {
  openAgent: (preset: AgentPreset, onSave: (draft: AgentDraft) => void) => void;
  openDiff: (runId: number, onMerge: () => void) => void;
  openBrowse: (initial: string, onPick: (path: string) => void) => void;
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
      openDiff: (runId, onMerge) => setModal({ type: "diff", runId, onMerge }),
      openBrowse: (initial, onPick) => setModal({ type: "browse", initial, onPick }),
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
    </Ctx.Provider>
  );
}

export type { AgentDraft, AgentPreset };
