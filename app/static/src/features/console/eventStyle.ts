import type { LogLevel } from "../../components/ds";
import type { EventKind } from "../../state/types";

/**
 * Bahasa visual per tipe event: tag mono + level (warna gutter LogLine).
 * Warna status masuk HANYA lewat gutter — tag sendiri tetap muted.
 */
export const EVENT_STYLE: Record<EventKind, { tag: string; level: LogLevel }> = {
  status: { tag: "status", level: "info" },
  info: { tag: "info", level: "info" },
  thinking: { tag: "think", level: "thinking" },
  tool_call: { tag: "tool", level: "out" },
  file_edit: { tag: "edit", level: "ok" },
  output: { tag: "out", level: "out" },
  question: { tag: "question", level: "warn" },
  usage: { tag: "usage", level: "info" },
  limit: { tag: "limit", level: "limit" },
  error: { tag: "error", level: "error" },
};

const TAG_WIDTH = 9;
/** NBSP — spasi biasa akan diciutkan HTML dan kolom jadi tidak rata. */
const NBSP = " ";

/** Kolom sumber LogLine: tag rata-kolom + nama agent/model. */
export function sourceColumn(kind: EventKind, source: string): string {
  const { tag } = EVENT_STYLE[kind];
  return tag.padEnd(TAG_WIDTH, NBSP) + source;
}
