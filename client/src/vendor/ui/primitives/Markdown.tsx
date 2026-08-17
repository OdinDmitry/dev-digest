import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Only these link schemes are ever rendered as a real `<a href>` — notably
 * excludes `javascript:` and any other executable scheme. Control characters
 * (tab/newline/etc.) are stripped first: browsers ignore them when parsing a
 * URL scheme, a classic `javascript:` obfuscation vector.
 */
const SAFE_HREF_RE = /^(https?:|mailto:)/i;
function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  const cleaned = href.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return SAFE_HREF_RE.test(cleaned);
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM.
 *
 * Renders untrusted markdown as INERT content (Project Context documents are
 * third-party repository text, see docs/specs/cross/SPEC-01-project-context.md):
 * no `<img src>` (would fetch an attacker-named address on render — the alt
 * text is shown as plain text instead), and only http:/https:/mailto: links
 * render as a real anchor (`rel="noopener noreferrer"`); anything else
 * (`javascript:`, `data:`, …) renders as plain text. react-markdown v9 does
 * not render raw HTML without `rehype-raw`, which is not installed and must
 * not be added — this file is the whole guarantee. Additive/backwards
 * compatible: every existing consumer (skill body, import preview) inherits
 * the same protection. */
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
          // Never render <img src> — that fetches an attacker-named address on
          // render. Show the alt text as plain content instead.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ children, href }) =>
            isSafeHref(href) ? (
              <a
                href={href}
                rel="noopener noreferrer"
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
              >
                {children}
              </a>
            ) : (
              <>{children}</>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
