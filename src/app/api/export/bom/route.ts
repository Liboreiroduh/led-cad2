import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";
import { deriveBom, bomToCsv } from "@/lib/cad/bom";
import type { ProjectDocument } from "@/lib/cad/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ format?: "json" | "csv"; project?: unknown }>(req).catch(() => ({
      format: "json",
      project: undefined,
    }));
    const store = getStore();
    const project = (body.project ?? store.state.project) as ProjectDocument;
    const bom = deriveBom(project);
    if (body.format === "csv") {
      return new Response("\uFEFF" + bomToCsv(bom), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="bom-${project.project?.id ?? "projeto"}.csv"`,
        },
      });
    }
    return ok(bom);
  } catch (e) {
    return handleError(e);
  }
}
