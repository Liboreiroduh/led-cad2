import { getStore } from "@/lib/store";
import { handleError, readJsonBody } from "@/lib/api-helpers";
import { generateStandaloneHtml } from "@/lib/html/standalone";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Export HTML standalone — demo interativa 3D + visões, pronta para o cliente. */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ project?: unknown }>(req).catch(() => ({ project: undefined }));
    const store = getStore();
    const project = (body?.project as never) ?? store.state.project;
    const html = await generateStandaloneHtml(project, store.state.revision);
    const filename = `ledcollor-cad-${store.state.project.project.id.toLowerCase()}-rev${store.state.revision}.html`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
