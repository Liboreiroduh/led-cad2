import { getStore } from "@/lib/store";
import { fail, handleError, readJsonBody } from "@/lib/api-helpers";
import { generateDiffPdf } from "@/lib/pdf/diffReport";
import { validateProject } from "@/lib/cad/validation";
import type { ProjectDocument } from "@/lib/cad/schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/export/diff-pdf  { revision }
 * Gera o relatório PDF de diferenças entre a revisão pedida e a atual.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ revision?: number }>(req);
    const rev = Number(body.revision);
    if (!Number.isInteger(rev) || rev < 1) {
      return fail(400, "bad_request", "campo 'revision' (número inteiro ≥ 1) é obrigatório");
    }
    const store = getStore();
    const entry = store.getRevision(rev);
    if (!entry) {
      return fail(404, "not_found", `revisão ${rev} não encontrada`);
    }
    const currentCheck = validateProject(store.state.project);
    const otherCheck = validateProject(entry.project);
    if (!currentCheck.ok || !otherCheck.ok) {
      return fail(422, "invalid_project", "documento inválido para o relatório");
    }
    const bytes = await generateDiffPdf({
      currentDoc: store.state.project as ProjectDocument,
      currentRev: store.state.revision,
      otherDoc: entry.project as ProjectDocument,
      otherRev: rev,
    });
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="led-cad-diff-rev${store.state.revision}-rev${rev}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
