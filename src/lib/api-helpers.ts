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

/**
 * Detecção robusta de erros tipados: o Next.js dev compila cada rota em bundle
 * próprio — a classe importada pelo roteador pode ser uma CÓPIA diferente da
 * importada aqui, e `instanceof` falha (visto: transform 500 em conflito real).
 * Comparamos também pelo `name` estável definido no construtor.
 */
export function isConflictError(e: unknown): boolean {
  if (e instanceof ConflictError) return true;
  return (e as Error)?.name === "ConflictError";
}

export function isAiTransformError(e: unknown): boolean {
  if (e instanceof AiTransformError) return true;
  return (e as Error)?.name === "AiTransformError";
}

export function handleError(e: unknown): NextResponse {
  if (isConflictError(e)) {
    return fail(409, "project_changed", "O projeto mudou desde o preview. Regenere o preview.", { retryable: false });
  }
  if (isAiTransformError(e)) {
    const err = e as AiTransformError;
    return NextResponse.json({ error: err.payload }, { status: 502 });
  }
  const err = e as Error & { issues?: unknown };
  if (err?.issues) {
    return fail(400, "invalid_document", "Documento fora do schema.", { details: err.issues });
  }
  console.error("[api]", e);
  return fail(500, "internal_error", (e as Error)?.message ?? "erro interno inesperado", { retryable: false });
}

/** Teto de corpo JSON — cola gigantes no editor/import/IA não podem estourar a memória do servidor. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new Error(`corpo da requisição muito grande (${(declared / 1048576).toFixed(1)} MB) — limite 8 MB`);
    }
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new Error(`corpo da requisição muito grande (${(text.length / 1048576).toFixed(1)} MB) — limite 8 MB`);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg.includes("muito grande")) throw e;
    throw new Error("corpo da requisição não é JSON válido — confira o documento colado");
  }
}
