/** Contratos comuns dos providers de IA — Gemini e Z.ai são intercambiáveis. */
import type { ProjectDocument } from "@/lib/cad/schema";

export type ProviderId = "gemini" | "zai" | "mock";

export interface AiAttachment {
  type: "image";
  name: string;
  /** data URL (base64) */
  data_url: string;
}

export interface AiCallInput {
  currentProject: ProjectDocument;
  userRequest: string;
  attachments: AiAttachment[];
  model: string;
  timeoutMs: number;
  apiKey?: string;
  /** feedback de validação para o retry único */
  validationFeedback?: string;
}

export interface AiCallResult {
  text: string;
  latencyMs: number;
  model: string;
}

export type ProviderErrorType =
  | "provider_timeout"
  | "provider_error"
  | "invalid_json"
  | "invalid_schema"
  | "unsupported_attachment"
  | "not_configured";

export class ProviderError extends Error {
  type: ProviderErrorType;
  provider: ProviderId;
  retryable: boolean;
  details?: unknown;

  constructor(
    type: ProviderErrorType,
    provider: ProviderId,
    message: string,
    opts: { retryable?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.type = type;
    this.provider = provider;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  defaultModels: string[];
  supportsImage(model: string): boolean;
  /** Chamada bruta — SEM regras de CAD dentro do provider. */
  call(input: AiCallInput): Promise<AiCallResult>;
  /** Ping curto para o botão ATIVAR/TESTAR. */
  test(input: Pick<AiCallInput, "model" | "timeoutMs" | "apiKey">): Promise<{ latencyMs: number; model: string; detail: string }>;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, provider: ProviderId): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ProviderError("provider_timeout", provider, `O provider excedeu o tempo limite de ${Math.round(ms / 1000)}s.`, {
          retryable: true,
        }),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Extrai o primeiro objeto JSON balanceado de um texto (tolerante a markdown). */
export function extractJson(text: string, provider: string = "mock"): unknown {
  const cleaned = text
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new ProviderError("invalid_json", provider as never, "Resposta sem JSON.", { retryable: true });
  }
  let depth = 0;
  let inString = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch (e) {
          throw new ProviderError("invalid_json", provider as never, `JSON malformado: ${(e as Error).message.slice(0, 120)}`, {
            retryable: true,
          });
        }
      }
    }
  }
  throw new ProviderError("invalid_json", provider as never, "JSON truncado na resposta.", { retryable: true });
}
