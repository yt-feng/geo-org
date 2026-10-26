export type ModelRequestKind = "chat" | "image" | "video" | "music" | "audio" |
  "embedding" | "moderation" | "transcription" | "speech" | "realtime" | "completion";

/** A price expressed in tokens does not imply the chat-completions interface. */
export function modelRequestKind(id: string, category: string): ModelRequestKind {
  const value = id.toLowerCase();
  if (category === "image") return "image";
  if (category === "video") return "video";
  if (/embedding/.test(value)) return "embedding";
  if (/moderation/.test(value)) return "moderation";
  if (/(?:^|[-_.])(?:transcribe|whisper)(?:[-_.]|$)/.test(value)) return "transcription";
  if (/realtime/.test(value)) return "realtime";
  if (/(?:^|[-_.])tts(?:[-_.]|$)/.test(value)) return "speech";
  if (/(?:^|[-_.])audio(?:[-_.]|$)/.test(value)) return "audio";
  if (/^(?:babbage|davinci)(?:-|$)|^text-(?:davinci|curie|babbage|ada)(?:-|$)|^gpt-3\.5-turbo-instruct(?:-|$)/.test(value)) return "completion";
  if (category === "audio") return /^(?:suno|flowmusic)(?:-|$)/.test(value) ? "music" : "audio";
  return "chat";
}
