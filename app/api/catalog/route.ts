import { safeCatalog } from "@/lib/assessment";

export const runtime = "edge";

export async function GET() {
  return Response.json(safeCatalog(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

