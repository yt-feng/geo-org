export function Brand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""} ${className}`} aria-label="tokvilo">
      <svg className="brand-symbol" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M4 4h20v5h-7v15h-6V9H4V4Z" fill="currentColor" />
        <path d="m20 14 5-5v15h-5V14Z" fill="currentColor" opacity=".4" />
      </svg>
      {!compact && <span className="brand-name">tokvilo</span>}
    </span>
  );
}
