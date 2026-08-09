import { useEffect, useState } from "react";
import { fetchTranscript } from "../../services/historyApi";
import type { ConsoleState, StreamEvent, CascadeAttempt } from "../../state/types";
import { StreamView } from "./StreamView";
import { CascadePanel } from "./CascadePanel";
import type { ConsoleEvent } from "../../state/consoleMachine";
import { AttemptsPanel } from "./AttemptsPanel";

function processEvents(events: ConsoleEvent[]): StreamEvent[] {
  const stream: StreamEvent[] = [];
  
  for (const ev of events) {
    if (
      ev.type === "LOG" || 
      ev.type === "QUESTION" || 
      ev.type === "USAGE" || 
      ev.type === "TARGET_FAILED" || 
      ev.type === "TARGET_SELECTED" || 
      ev.type === "CHAIN_EXHAUSTED" || 
      ev.type === "FATAL"
    ) {
      if ("event" in ev) {
        stream.push(ev.event);
      }
    } else if (ev.type === "FINAL") {
      stream.push(...ev.events);
    } else if (ev.type === "LOG_DELTA") {
       stream.push({
           id: ev.streamId,
           ts: ev.ts,
           kind: "output",
           source: ev.source,
           text: ev.text
       });
    }
  }
  
  return stream;
}

export function TranscriptView({ taskId }: { taskId: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ stream: StreamEvent[]; attempts: CascadeAttempt[]; attemptsData: any[] } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    
    fetchTranscript(taskId)
      .then((res) => {
        if (active) {
          const cascadeAttempts: CascadeAttempt[] = res.attempts.map((a) => ({
            index: a.index,
            target: a.model ? `${a.agent}/${a.model}` : a.agent,
            outcome: a.status === "ok" ? "ok" : a.status === "skipped" ? "skipped" : "failed",
            reason: a.status,
            note: a.status === "ok" ? "berhasil" : a.status === "skipped" ? "dilewati" : "jatuh ke target berikut"
          }));

          setData({
             stream: processEvents(res.events),
             attempts: cascadeAttempts,
             attemptsData: res.attempts
          });
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(String(err));
          setLoading(false);
        }
      });
      
    return () => {
      active = false;
    };
  }, [taskId]);

  if (loading) {
    return <div style={{ padding: "var(--space-4)" }}>Memuat transkrip...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        Gagal memuat transkrip: {error}
      </div>
    );
  }

  if (!data) return null;

  const mockState: ConsoleState = {
    status: "done",
    runId: taskId,
    startedAt: null,
    stream: data.stream,
    attempts: data.attempts,
    request: null,
    route: "",
    paused: false,
    autoScroll: false,
    question: null,
    failure: null,
    halt: null,
    result: null,
    usage: { in: 0, out: 0, cache: 0, total: 0 },
    planReused: false,
  };

  const showAttempts = data.attemptsData.length > 0;
  const showCascade = data.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");

  return (
    <>
      <StreamView
        state={mockState}
        onReply={() => {}}
        onDefer={() => {}}
        onScrollAway={() => {}}
        onJumpLatest={() => {}}
      />
      
      {showAttempts && <AttemptsPanel taskId={taskId} initialRows={data.attemptsData} />}
      {showCascade && !showAttempts && (
        <CascadePanel runId={taskId} attempts={data.attempts} status="done" />
      )}
    </>
  );
}
