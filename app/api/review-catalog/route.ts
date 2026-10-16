import { standards } from "@/lib/catalog";
export async function GET() {
  return Response.json({ standards: standards.map(standard => ({ id: standard.id, shortName: standard.shortName, pack: standard.pack, controls: standard.controls })) });
}
