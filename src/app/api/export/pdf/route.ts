import { getStore } from "@/lib/store";
import { handleError, readJsonBody } from "@/lib/api-helpers";
import { generateProjectPdf } from "@/lib/pdf/report";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ project?: unknown }>(req).catch(() => ({ project: undefined }));
    const store = getStore();
    const project = (body?.project as never) ?? store.state.project;
    const bytes = await generateProjectPdf(project, store.state.revision);
    const filename = `led-cad-${store.state.project.project.id.toLowerCase()}-rev${store.state.revision}.pdf`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
