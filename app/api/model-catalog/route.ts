import { getModelDirectory } from "@/lib/model-directory";

export async function GET() {
  const directory = await getModelDirectory();
  return Response.json(directory, { headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
}
