import { getStore } from "@/lib/store";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return ok({
    revision: store.state.revision,
    hash: store.state.hash,
    saved_at: store.state.saved_at,
    updated_at: store.state.updated_at,
    can_undo: store.undoStack.length > 0,
    project: store.state.project,
  });
}
