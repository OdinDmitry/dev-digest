import React from "react";

export function MonoLink({
  children,
  onClick,
  href,
  title,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  /** When set, renders an anchor that opens in a new tab (middle-click works). */
  href?: string;
  /** Optional tooltip/aria-label, e.g. to distinguish a same-page-navigation
   *  button from an external link when the visible text alone doesn't. */
  title?: string;
}) {
  const [h, setH] = React.useState(false);
  const style: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    cursor: "pointer",
    color: h ? "var(--accent-text)" : "var(--text-secondary)",
    textDecoration: h ? "underline" : "none",
    textUnderlineOffset: 2,
  };

  if (href) {
    return (
      <a
        className="mono"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      className="mono"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={style}
    >
      {children}
    </button>
  );
}
