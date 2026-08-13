import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** Render hasil sebagai Markdown penuh (GFM + math KaTeX), di-styling ke token
    cockpit lewat kelas `.choros-md` di global.css. HTML mentah TIDAK dirender
    (tanpa rehype-raw) → aman dari injeksi. */
export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="choros-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Link keluar aman + tak membajak tab konsol.
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
