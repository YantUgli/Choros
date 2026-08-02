import { useState } from "react";
import { Button, Input } from "../../components/ds";

const strip = {
  flex: "none" as const,
  borderTop: "1px solid var(--line)",
  background: "var(--panel)",
  padding: "var(--space-3) var(--space-4)",
};

export function FollowUpStrip({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div style={{ ...strip, display: "flex", gap: "var(--space-2)" }}>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Tanya balik / lanjutkan di sesi yang sama…"
        aria-label="Tanya balik atau lanjutkan sesi"
        style={{ flex: 1 }}
      />
      <Button variant="primary" size="sm" onClick={send} disabled={!text.trim()}>
        Kirim
      </Button>
    </div>
  );
}
