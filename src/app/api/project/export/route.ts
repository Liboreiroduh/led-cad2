import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const json = JSON.stringify(store.state.project, null, 2);
  const filename = `led-cad-${store.state.project.project.id.toLowerCase()}-rev${store.state.revision}.json`;
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
