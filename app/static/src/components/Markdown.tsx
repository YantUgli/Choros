

export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  const blocks = text.split(/(```[\s\S]*?```|^#{1,4}\s+.*$)/m).filter(Boolean);
  
  return (
    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, wordBreak: "break-word", fontSize: "var(--fs-13)" }}>
      {blocks.map((b, i) => {
        if (b.startsWith("```")) {
          const match = b.match(/```(\w+)?\n([\s\S]*?)```/);
          if (match) {
            return (
              <pre key={i} style={{ background: "var(--panel-2)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", overflowX: "auto", margin: "var(--space-2) 0", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>
                <code>{match[2]}</code>
              </pre>
            );
          }
          return <pre key={i}>{b}</pre>;
        }
        if (b.startsWith("# ")) {
          return <h1 key={i} style={{ fontSize: "1.5em", margin: "16px 0 8px 0", fontWeight: 600 }}>{b.replace("# ", "")}</h1>;
        }
        if (b.startsWith("## ")) {
          return <h2 key={i} style={{ fontSize: "1.25em", margin: "16px 0 8px 0", fontWeight: 600 }}>{b.replace("## ", "")}</h2>;
        }
        if (b.startsWith("### ")) {
          return <h3 key={i} style={{ fontSize: "1.1em", margin: "12px 0 8px 0", fontWeight: 600 }}>{b.replace("### ", "")}</h3>;
        }
        return <span key={i}>{b}</span>;
      })}
    </div>
  );
}
