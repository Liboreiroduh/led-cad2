/** Helpers de API — erros estruturados legíveis (nunca "Failed to fetch" seco). */
import { NextResponse } from "next/server";
import { ConflictError } from "@/lib/store";
import { AiTransformError } from "@/lib/ai/registry";

export function ok<T>(data: T, init?: number): NextResponse {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(status: number, type: string, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: { type, message, ...extra } }, { status });
}

export function handleError(e: unknown): NextResponse {
  if (e instanceof ConflictError) {
    return fail(409, "project_changed", "O projeto mudou desde o preview. Regenere o preview.", { retryable: false });
  }
  if (e instanceof AiTransformError) {
    return NextResponse.json({ error: e.payload }, { status: 502 });
  }
  const err = e as Error & { issues?: unknown };
  if (err?.issues) {
    return fail(400, "invalid_document", "Documento fora do schema.", { details: err.issues });
  }
  console.error("[api]", e);
  return fail(500, "internal_error", (e as Error)?.message ?? "erro interno inesperado", { retryable: false });
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("corpo da requisição não é JSON válido");
  }
}
