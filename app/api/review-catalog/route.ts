import { standards } from "@/lib/catalog";
import { deploymentReviewPack } from "@/lib/framework-packs/deployment-review";
import { agentMcpControls } from "@/lib/agent-mcp";
export async function GET() {
  return Response.json({ standards: standards.map(standard => ({ id: standard.id, shortName: standard.shortName, pack: standard.pack, controls: standard.controls })), technicalControls: [...deploymentReviewPack.controls, ...agentMcpControls] });
}
