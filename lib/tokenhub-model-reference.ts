// Documentation snapshot, not an availability allowlist. Runtime discovery is
// authoritative and also exposes newly added models through /api/tokenhub/v1/models.
export const TOKENHUB_MODEL_REFERENCE_DATE = "2026-10-18";
export const TOKENHUB_REFERENCE_MODELS = [
  { id: "glm-5-3-flash-260828", name: "GLM 5.3 Flash", kind: "chat" },
  { id: "glm-5-2-260617", name: "GLM 5.2", kind: "chat" },
  { id: "deepseek-v4-pro-ga-260813", name: "DeepSeek V4 Pro", kind: "chat" },
  { id: "deepseek-v4-flash-ga-260731", name: "DeepSeek V4 Flash", kind: "chat" },
  { id: "dola-seedream-5-0-pro-260628", name: "Seedream 5.0 Pro", kind: "image" },
  { id: "dreamina-seedance-2-0-260128", name: "Seedance 2.0", kind: "video" },
  { id: "dreamina-seedance-2-0-fast-260128", name: "Seedance 2.0 Fast", kind: "video" },
  { id: "dreamina-seedance-2-0-mini-260615", name: "Seedance 2.0 Mini", kind: "video" },
  { id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", kind: "video" },
] as const;
