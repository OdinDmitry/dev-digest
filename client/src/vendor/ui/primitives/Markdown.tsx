import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          // Inline code only (`` `text` ``). A FENCED block's `<code>` is a
          // child of `pre`, so react-markdown routes it through the `pre`
          // override below instead — never through this one.
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          // Fenced code block. `children` here is the ALREADY-rendered `code`
          // element from the override above — reusing it directly would nest
          // the inline-code chip's own background/radius/padding (meant for a
          // few-character span) inside `.dd-md pre`'s block styling, which is
          // exactly what produced the broken-looking corners: two mismatched
          // rounded boxes instead of one. Unwrap to the raw text and render a
          // plain `<code>` instead, so only `.dd-md pre` / `.dd-md pre code`
          // (styles.css) style the block — one rounded box, not two.
          pre: ({ children }) => {
            const raw =
              React.isValidElement<{ children?: React.ReactNode }>(children)
                ? children.props.children
                : children;
            return (
              <pre className="mono">
                <code>{raw}</code>
              </pre>
            );
          },
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
