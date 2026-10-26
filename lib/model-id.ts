// Only these known catalog identifiers have a tokvilo alias. Unknown IDs stay exact.
const modelAliases: Record<string, string> = {
  "grok-imagine-1.5-apimart": "grok-imagine-1.5-tokvilo",
  "grok-imagine-1.5-edit-apimart": "grok-imagine-1.5-edit-tokvilo",
  "imagen-4.0-apimart": "imagen-4.0-tokvilo",
  "grok-imagine-1.5-video-apimart": "grok-imagine-1.5-video-tokvilo",
};
const upstreamAliases = Object.fromEntries(Object.entries(modelAliases).map(([id, alias]) => [alias, id]));

export const publicModelId = (id: string): string => modelAliases[id] || id;
export const upstreamModelId = (id: string): string => upstreamAliases[id] || id;
