/**
 * AI PROVIDER REGISTRY — orquestra a transformação documento→documento.
 * Fluxo: provider.call → parse JSON → validação Zod + geométrica
 *        (em falha: 1 retry único com feedback — nunca loop)
 * Nenhuma regra CAD fora do provider mock; providers são intercambiáveis.
 */
import { z } from "zod";
import {
  ProjectDocumentSchema,
  type AITransformResponse,
  type Assumption,
  type ProjectDocument,
} from "@/lib/cad/schema";
import { validateProject, type ValidationIssue } from "@/lib/cad/validation";
import { getStore } from "@/lib/store";
import { mockProvider } from "./mock";
import { zaiProvider } from "./zai";
import { geminiProvider } from "./gemini";
import type { AiAttachment, AiProvider, ProviderError, ProviderId } from "./types";
import { extractJson } from "./types";

const REGISTRY: Record<ProviderId, AiProvider> = {
  gemini: geminiProvider,
  zai: zaiProvider,
  mock: mockProvider,
};

const AssumptionZ = z.union([z.string().max(400), z.object({ path: z.string(), source: z.string().default("visual_estimate"), review_required: z.boolean().default(true), detail: z.string() })]);

const EnvelopeSchema = z.object({
  status: z.enum(["ready", "needs_input"]),
  explain: z.string().max(2000).default(""),
  assumptions: z.array(AssumptionZ).max(60).default([]),
  questions: z.array(z.string().max(300)).max(3).default([]),
  project: ProjectDocumentSchema.nullable().default(null),
});

export interface TransformMeta {
  provider: ProviderId;
  model: string;
  latency_ms: number;
  attempts: number;
  /** id do exemplo few-shot usado (§25) — null quando nenhum aplicável */
  few_shot_id: string | null;
  /** similaridade de Jaccard entre pedido e exemplo escolhido (0–1) */
  few_shot_score: number | null;
}

/**
 * Escolhe o exemplo few-shot mais RELEVANTE que caiba no orçamento de tokens.
 * Relevância = similaridade de Jaccard entre os tokens do pedido do usuário e do
 * exemplo (stopwords PT/EN removidas); empate → exemplo mais recente.
 * Guard de economia (§16/§34): exemplo completo (antes+depois) ≤ ~220KB combinados
 * e documento "antes" com até 120 elementos — acima disso o custo supera o ganho.
 */
const FEW_SHOT_MAX_ELEMENTS = 120;
const FEW_SHOT_MAX_BYTES = 220_000;

/** stopwords PT + EN — não contam para similaridade */
const FEW_SHOT_STOPWORDS = new Set(
  ("a o os as um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre e ou mas que qual quais como quando onde ao à aos às " +
    "the an of on in for to with without under over between and or but that which how when where at from by is are be been add remove change make set " +
    "adicione remova mude troque coloque ponha coloque mude faca faça criar crie incluir inclua aumentar diminua")
    .split(" "),
);

/** tokeniza minúsculo, remove acentos simples e stopwords — p/ similaridade */
function requestTokens(text: string): Set<string> {
  const norm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = norm.match(/[a-z0-9_]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const t of tokens) {
    if (FEW_SHOT_STOPWORDS.has(t)) continue;
    out.add(t.replace(/s$/, "")); // stemming grosseiro de plural
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function pickFewShot(userRequest: string): { id: string; request: string; before: string; after: string; score: number } | null {
  try {
    const examples = getStore().listExamples();
    const query = requestTokens(userRequest);
    let best: { id: string; request: string; before: string; after: string; score: number } | null = null;
    // listExamples retorna mais recente primeiro; iterar na ordem mantém desempate = mais recente
    for (const ex of examples) {
      if (ex.before_elements <= 0 || ex.after_elements <= 0) continue;
      if (ex.before_elements > FEW_SHOT_MAX_ELEMENTS) continue;
      if (ex.size_bytes > FEW_SHOT_MAX_BYTES) continue;
      const before = JSON.stringify(ex.before);
      const after = JSON.stringify(ex.after);
      if (!before || !after || before.length + after.length > FEW_SHOT_MAX_BYTES) continue;
      const score = jaccard(query, requestTokens(ex.request));
      if (!best || score > best.score) best = { id: ex.id, request: ex.request, before, after, score };
    }
    return best;
  } catch {
    // sem exemplos — segue sem few-shot
  }
  return null;
}

export interface TransformOutput {
  response: AITransformResponse;
  candidate: ProjectDocument | null;
  candidate_hash: string;
  validation_warnings: ValidationIssue[];
  meta: TransformMeta;
}

export class AiTransformError extends Error {
  payload: { type: string; provider: string; message: string; retryable: boolean; details?: unknown };
  constructor(err: ProviderError) {
    super(err.message);
    this.payload = { type: err.type, provider: err.provider, message: err.message, retryable: err.retryable, details: err.details };
  }
}

function summarizeIssues(issues: ValidationIssue[]): string {
  return issues
    .slice(0, 8)
    .map((i) => `- ${i.path}: ${i.message}`)
    .join("\n");
}

function validateEnvelope(raw: unknown, provider: ProviderId): AITransformResponse {
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const err = new Error("envelope fora do contrato") as Error & { isEnvelope?: boolean };
    err.isEnvelope = true;
    const details = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw Object.assign(err, { details });
  }
  const env = parsed.data;
  if (env.status === "ready") {
    if (!env.project) {
      throw Object.assign(new Error("status ready exige project"), { isEnvelope: true, details: "project null" });
    }
    const check = validateProject(env.project);
    if (!check.ok) {
      throw Object.assign(new Error("project inválido"), {
        isSchema: true,
        details: summarizeIssues(check.errors),
      });
    }
    return {
      status: "ready",
      explain: env.explain,
      assumptions: env.assumptions as Assumption[],
      questions: env.questions,
      project: env.project,
    };
  }
  return {
    status: "needs_input",
    explain: env.explain,
    assumptions: env.assumptions as Assumption[],
    questions: env.questions,
    project: null,
  };
}

export function listProviders() {
  const cfg = getStore().getAiConfig();
  return (Object.keys(REGISTRY) as ProviderId[]).map((id) => {
    const p = REGISTRY[id];
    const pcfg = id === "mock" ? null : cfg[id];
    const activeModel = pcfg ? pcfg.model : p.defaultModels[0];
    return {
      id,
      label: p.label,
      default_models: p.defaultModels,
      current_model: activeModel,
      supports_image: p.supportsImage(activeModel),
      configured: id === "mock" ? true : id === "zai" ? true : Boolean(pcfg?.api_key),
      active: cfg.active_provider === id,
    };
  });
}

export async function testProvider(providerId: ProviderId): Promise<{ latency_ms: number; model: string; detail: string }> {
  const p = REGISTRY[providerId];
  const cfg = getStore().getAiConfig();
  const pcfg = providerId === "mock" ? { model: p.defaultModels[0], timeout_ms: 15000, api_key: "" } : cfg[providerId];
  const result = await p.test({ model: pcfg.model, timeoutMs: pcfg.timeout_ms, apiKey: pcfg.api_key });
  return { latency_ms: result.latencyMs, model: result.model, detail: result.detail };
}

export async function transformProject(input: {
  providerId?: ProviderId;
  currentProject: ProjectDocument;
  userRequest: string;
  attachments?: AiAttachment[];
}): Promise<TransformOutput> {
  const store = getStore();
  const cfg = store.getAiConfig();
  const providerId: ProviderId = input.providerId ?? cfg.active_provider;
  const provider = REGISTRY[providerId];
  if (!provider) throw new AiTransformError({ type: "provider_error", provider: providerId, message: "provider desconhecido", retryable: false } as ProviderError);

  const pcfg =
    providerId === "mock"
      ? { model: cfg.mock.model, timeout_ms: 30000, api_key: "" }
      : cfg[providerId];

  let attempts = 0;
  let lastError: Error & { details?: string; isEnvelope?: boolean; isSchema?: boolean } | null = null;
  const totalStart = Date.now();
  const fewShot = pickFewShot(input.userRequest);

  while (attempts < 2) {
    attempts++;
    let feedback: string | undefined;
    if (lastError?.details) {
      feedback = [
        lastError.isSchema ? "O documento violou o schema/regras:" : "A resposta não seguiu o contrato JSON:",
        String(lastError.details),
        "Devolva APENAS o JSON corrigido.",
      ].join("\n");
    }
    try {
      const result = await provider.call({
        currentProject: input.currentProject,
        userRequest: input.userRequest,
        attachments: input.attachments ?? [],
        model: pcfg.model,
        timeoutMs: pcfg.timeout_ms,
        apiKey: pcfg.api_key,
        validationFeedback: feedback,
        fewShot,
      });
      const raw = extractJson(result.text, providerId);
      const response = validateEnvelope(raw, providerId);
      const candidate = response.project;
      const warnings = candidate ? validateProject(candidate).warnings : [];
      const candidate_hash = candidate
        ? store.putPendingPreview(candidate, 0, "")
        : "";
      return {
        response,
        candidate,
        candidate_hash,
        validation_warnings: warnings,
        meta: { provider: providerId, model: result.model, latency_ms: Date.now() - totalStart, attempts, few_shot_id: fewShot?.id ?? null, few_shot_score: fewShot ? Number(fewShot.score.toFixed(3)) : null },
      };
    } catch (e) {
      const err = e as Error & { details?: string; isEnvelope?: boolean; isSchema?: boolean };
      if ((err as { name?: string }).name === "ProviderError") {
        // timeout/erro transitório: retry único permitido; se repetir, falha
        const pe = err as unknown as ProviderError;
        if (!pe.retryable || attempts >= 2) {
          throw new AiTransformError(pe);
        }
        lastError = err;
        continue;
      }
      if (err.isEnvelope || err.isSchema) {
        if (attempts >= 2) {
          throw new AiTransformError({
            type: err.isSchema ? "invalid_schema" : "invalid_json",
            provider: providerId,
            message: "A IA devolveu um documento fora do contrato após 2 tentativas.",
            retryable: false,
            details: err.details,
          } as ProviderError);
        }
        lastError = err;
        continue;
      }
      // JSON.parse de objeto malformado
      if (err instanceof SyntaxError) {
        if (attempts >= 2) {
          throw new AiTransformError({
            type: "invalid_json",
            provider: providerId,
            message: "JSON inválido após 2 tentativas.",
            retryable: false,
          } as ProviderError);
        }
        lastError = Object.assign(new Error("json parse"), { details: "JSON malformado", isEnvelope: true });
        continue;
      }
      throw err;
    }
  }

  throw new AiTransformError({
    type: "provider_error",
    provider: providerId,
    message: "Falha desconhecida na transformação.",
    retryable: false,
  } as ProviderError);
}
