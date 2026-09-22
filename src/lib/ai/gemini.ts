/**
 * PROVIDER GEMINI — conector nativo REST (google generativelanguage API).
 * Structured output via responseMimeType application/json.
 * A chave fica SOMENTE no backend local.
 */
import type { AiCallInput, AiCallResult, AiProvider } from "./types";
import { ProviderError } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

export const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"];

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

function parseDataUrl(dataUrl: string): { mime_type: string; data: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime_type: m[1], data: m[2] };
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  label: "Google Gemini",
  defaultModels: GEMINI_MODELS,
  supportsImage: (model) => !/lite/i.test(model) || true, // modelos flash/pro aceitam imagem
  async call(input: AiCallInput): Promise<AiCallResult> {
    const started = Date.now();
    if (!input.apiKey) {
      throw new ProviderError("not_configured", "gemini", "Configure a API Key do Gemini no Conector de IA.");
    }
    const hasImages = input.attachments.length > 0;
    const userPrompt = buildUserPrompt(
      JSON.stringify(input.currentProject, null, 1),
      input.userRequest,
      input.attachments,
      input.validationFeedback,
    );

    const parts: GeminiPart[] = [{ text: userPrompt }];
    if (hasImages) {
      for (const a of input.attachments) {
        const parsed = parseDataUrl(a.data_url);
        if (!parsed) {
          throw new ProviderError("invalid_schema", "gemini", `Anexo inválido: ${a.name}`, { retryable: false });
        }
        parts.push({ inline_data: parsed });
      }
    }

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 429) {
          throw new ProviderError("provider_error", "gemini", "Cota/limite do Gemini atingido (429).", { retryable: true });
        }
        if (res.status === 400 && /API key/i.test(detail)) {
          throw new ProviderError("not_configured", "gemini", "API Key inválida do Gemini.", { retryable: false });
        }
        throw new ProviderError("provider_error", "gemini", `HTTP ${res.status}: ${detail.slice(0, 200)}`, {
          retryable: res.status >= 500,
        });
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      if (json.error) {
        throw new ProviderError("provider_error", "gemini", json.error.message ?? "erro do provider", { retryable: true });
      }
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      if (!text.trim()) {
        throw new ProviderError("provider_error", "gemini", "Resposta vazia do modelo.", { retryable: true });
      }
      return { text, latencyMs: Date.now() - started, model: input.model };
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") {
        throw new ProviderError(
          "provider_timeout",
          "gemini",
          `O provider excedeu o tempo limite de ${Math.round(input.timeoutMs / 1000)}s.`,
          { retryable: true },
        );
      }
      if (e instanceof ProviderError) throw e;
      throw new ProviderError("provider_error", "gemini", (e as Error).message ?? "falha de rede", { retryable: true });
    }
  },
  async test({ model, timeoutMs, apiKey }) {
    if (!apiKey) {
      throw new ProviderError("not_configured", "gemini", "Informe a API Key para ativar o Gemini.");
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 30000));
    try {
      const res = await fetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: 'Responda APENAS: {"ok":true}' }] }],
          generationConfig: { temperature: 0 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderError("provider_error", "gemini", `HTTP ${res.status}: ${detail.slice(0, 160)}`, {
          retryable: false,
        });
      }
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { latencyMs: Date.now() - started, model, detail: `respondeu: ${text.slice(0, 40).trim() || "(vazio)"}` };
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") {
        throw new ProviderError("provider_timeout", "gemini", "Tempo limite no teste do Gemini.", { retryable: true });
      }
      throw e;
    }
  },
};
