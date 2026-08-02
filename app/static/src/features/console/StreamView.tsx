import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Input, LogLine } from "../../components/ds";
import { Meta } from "../../components/Label";
import type { ConsoleState, StreamEvent } from "../../state/types";
import { EVENT_STYLE, sourceColumn } from "./eventStyle";

/** Baris log tunggal. `thinking` & `error` dengan detail bisa dilipat. */
function StreamLine({ event }: { event: StreamEvent }) {
  const [open, setOpen] = useState(false);
  const style = EVENT_STYLE[event.kind];
  const collapsible = (event.detail?.length ?? 0) > 0;

  if (!collapsible) {
    return (
      <LogLine ts={event.ts} level={style.level} source={sourceColumn(event.kind, event.source)}>
        {event.text}
      </LogLine>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className="choros-hover-row"
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      style={{
        cursor: "pointer",
        borderRadius: 4,
        transition: "background var(--dur) var(--ease)",
      }}
    >
      <LogLine ts={event.ts} level={style.level} source={sourceColumn(event.kind, event.source)}>
        {open
          ? `▾ ${event.text}`
          : `▸ ${event.text} (klik untuk buka)`}
      </LogLine>
      {open &&
        event.detail?.map((d, i) => (
          <LogLine key={i} ts="" level={style.level} source="">
            {`    ${d}`}
          </LogLine>
        ))}
    </div>
  );
}

/** Kartu pertanyaan yang di-pin: input balas menonjol & ter-fokus. */
function QuestionCard({
  question,
  onReply,
  onDefer,
}: {
  question: StreamEvent;
  onReply: (text: string) => void;
  onDefer: () => void;
}) {
  const [reply, setReply] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [question.id]);

  const send = () => {
    onReply(reply.trim() || "ya, lanjutkan");
    setReply("");
  };

  return (
    <div
      style={{
        marginTop: "var(--space-2)",
        background: "var(--warn-fill)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <LogLine
        ts={question.ts}
        level="warn"
        source={sourceColumn("question", question.source)}
      >
        {question.text}
      </LogLine>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            ref={inputRef}
            mono
            size="md"
            prefix="›"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            placeholder="balas…"
            aria-label="balasan untuk agent"
          />
        </div>
        <Button variant="primary" size="sm" onClick={send}>
          Kirim ↵
        </Button>
        <Button variant="ghost" size="sm" onClick={onDefer}>
          serahkan ke agent
        </Button>
      </div>
      <Meta>auto-scroll berhenti — waiting_for_input</Meta>
    </div>
  );
}

export function StreamView({
  state,
  onReply,
  onDefer,
  onScrollAway,
  onJumpLatest,
}: {
  state: ConsoleState;
  onReply: (text: string) => void;
  onDefer: () => void;
  onScrollAway: () => void;
  onJumpLatest: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [frozenLen, setFrozenLen] = useState<number | null>(null);

  // pause = jeda TAMPILAN. Event tetap masuk state; yang dibekukan hanya potongan
  // stream yang dirender, plus penghitung "event baru direkam".
  useEffect(() => {
    setFrozenLen(state.paused ? state.stream.length : null);
    // hanya saat status pause berubah
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paused]);

  const shown = frozenLen === null ? state.stream : state.stream.slice(0, frozenLen);
  // Pertanyaan yang sedang di-pin tampil di kartunya sendiri, bukan dua kali.
  const pinnedId = state.status === "waiting_for_input" ? state.question?.id : undefined;
  const visible = pinnedId ? shown.filter((e) => e.id !== pinnedId) : shown;
  const buffered = frozenLen === null ? 0 : state.stream.length - frozenLen;

  useLayoutEffect(() => {
    if (!state.autoScroll || state.paused) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, state.autoScroll, state.paused]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !state.autoScroll) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom) onScrollAway();
  };

  const jump = () => {
    onJumpLatest();
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  const showJump = !state.autoScroll || state.paused;

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="ov"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--space-3) var(--space-4) 52px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {visible.length === 0 && (
          <Meta>belum ada event — kirim tugas untuk memulai run.</Meta>
        )}

        {visible.map((e) => (
          <StreamLine key={e.id} event={e} />
        ))}

        {state.status === "error" && state.failure && (
          <ErrorDetail stack={state.failure.stack} />
        )}

        {state.status === "waiting_for_input" && state.question && (
          <QuestionCard question={state.question} onReply={onReply} onDefer={onDefer} />
        )}

        <div ref={bottomRef} />
      </div>

      {showJump && (
        <div style={{ position: "absolute", right: "var(--space-4)", bottom: "var(--space-3)" }}>
          <Button variant="secondary" size="sm" onClick={jump}>
            ↓ jump to latest{buffered > 0 ? ` · ${buffered} baru` : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Stack trace non-recoverable — ter-collapse, mono apa adanya. */
function ErrorDetail({ stack }: { stack: string[] }) {
  const [open, setOpen] = useState(false);
  if (stack.length === 0) return null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className="choros-hover-row"
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      style={{ cursor: "pointer", borderRadius: 4, transition: "background var(--dur) var(--ease)" }}
    >
      <LogLine ts="" level="info" source={sourceColumn("info", "choros")}>
        {open
          ? `▾ stack trace (${stack.length} baris)`
          : `▸ stack trace (${stack.length} baris) — klik untuk buka`}
      </LogLine>
      {open &&
        stack.map((l, i) => (
          <LogLine key={i} ts="" level="error" source="">
            {`    ${l}`}
          </LogLine>
        ))}
    </div>
  );
}
