export function Brand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""} ${className}`} aria-label="ECO-GEO">
      <svg className="brand-symbol" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M4 23V5h20v4H8v3h13v4H8v3h16v4H4Z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 21V7h16M6 14h13M6 21h16" stroke="currentColor" strokeWidth=".7" opacity=".55" />
      </svg>
      {!compact && <span className="brand-name">ECO-GEO</span>}
    </span>
  );
}
