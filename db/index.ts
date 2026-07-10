import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the binding in wrangler.jsonc before using the database.",
    );
  }

  return drizzle(database, { schema });
}
