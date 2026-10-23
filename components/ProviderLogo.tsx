import type { CSSProperties } from "react";
import { providerIdentity } from "@/lib/model-identity";

const productMarks: Record<string, string> = { claude: "claude", gemini: "gemini", qwen: "qwen", kimi: "kimi", flux: "flux", hunyuan: "hunyuan" };

/** Real, locally hosted brand marks; monochrome masks remain legible in either theme. */
export function ProviderLogo({ provider, size = 28, className = "" }: { provider: string; size?: number; className?: string }) {
  const identity = providerIdentity(provider);
  const product = productMarks[provider.toLowerCase().trim()];
  const logo = product ? `/provider-logos/${product}.svg` : identity.logo;
  const style: CSSProperties = { width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--provider-logo-color, var(--text))", verticalAlign: "middle" };
  return <span className={`provider-logo ${className}`.trim()} role="img" aria-label={`${product ? provider : identity.nameEn || identity.name} logo`} style={style}>
    {logo ? <span aria-hidden="true" style={{ display: "block", width: "100%", height: "100%", backgroundColor: "currentColor", mask: `url("${logo}") center / contain no-repeat`, WebkitMask: `url("${logo}") center / contain no-repeat` }} /> : <span aria-hidden="true" style={{ fontSize: Math.max(10, size * 0.42), fontWeight: 650, letterSpacing: "-.03em" }}>{identity.name === "其他" ? "···" : identity.name.slice(0, 2)}</span>}
  </span>;
}
