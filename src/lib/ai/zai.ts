/**
 * PROVIDER Z.AI — SDK oficial (backend only). Mesmo contrato do Gemini.
 * Suporta texto (create) e imagem (createVision) quando o modelo é vision.
 */
import ZAI from "z-ai-web-dev-sdk";
import type { AiCallInput, AiCallResult, AiProvider } from "./types";
import { withTimeout, ProviderError } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import type { ChatMessage, VisionMessage } from "z-ai-web-dev-sdk";

export const ZAI_MODELS = ["glm-4.5-flash", "glm-4.5-air", "glm-4.5", "glm-4.5v"];

function isVisionModel(model: string): boolean {
  return /4\.5v|4\.6v|vision/i.test(model);
}

export const zaiProvider: AiProvider = {
  id: "zai",
  label: "Z.ai",
  defaultModels: ZAI_MODELS,
  supportsImage: isVisionModel,
  async call(input: AiCallInput): Promise<AiCallResult> {
    const started = Date.now();
    const hasImages = input.attachments.length > 0;
    if (hasImages && !isVisionModel(input.model)) {
      throw new ProviderError(
        "unsupported_attachment",
        "zai",
        "Este provider/modelo não suporta este tipo de anexo. Troque para um modelo vision (ex.: glm-4.5v).",
      );
    }

    const zai = await ZAI.create();
    const userPrompt = buildUserPrompt(
      JSON.stringify(input.currentProject, null, 1),
      input.userRequest,
      input.attachments,
      input.validationFeedback,
    );

    try {
      let raw: unknown;
      if (hasImages) {
        const messages: VisionMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              ...input.attachments.map((a) => ({
                type: "image_url" as const,
                image_url: { url: a.data_url },
              })),
            ],
          },
        ];
        raw = await withTimeout(
          zai.chat.completions.createVision({
            model: input.model,
            messages,
            thinking: { type: "disabled" },
            max_tokens: 16384,
          } as never),
          input.timeoutMs,
          "zai",
        );
      } else {
        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ];
        raw = await withTimeout(
          zai.chat.completions.create({
            model: input.model,
            messages,
            thinking: { type: "disabled" },
            max_tokens: 16384,
          } as never),
          input.timeoutMs,
          "zai",
        );
      }

      const completion = raw as {
        choices?: Array<{ message?: { content?: unknown } }>;
        error?: { message?: string };
      };
      if (completion.error) {
        throw new ProviderError("provider_error", "zai", completion.error.message ?? "erro do provider", {
          retryable: true,
        });
      }
      const content = completion.choices?.[0]?.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? "")))
                .join("")
            : "";
      if (!text.trim()) {
        throw new ProviderError("provider_error", "zai", "Resposta vazia do modelo.", { retryable: true });
      }
      return { text, latencyMs: Date.now() - started, model: input.model };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError("provider_error", "zai", (e as Error).message ?? "falha no SDK Z.ai", {
        retryable: true,
      });
    }
  },
  async test({ model, timeoutMs }) {
    const started = Date.now();
    const zai = await ZAI.create();
    const raw = await withTimeout(
      zai.chat.completions.create({
        model,
        messages: [{ role: "user", content: 'Responda APENAS: {"ok":true}' }],
        thinking: { type: "disabled" },
      }),
      Math.min(timeoutMs, 30000),
      "zai",
    );
    const completion = raw as { choices?: Array<{ message?: { content?: string } }> };
    const text = completion.choices?.[0]?.message?.content ?? "";
    return {
      latencyMs: Date.now() - started,
      model,
      detail: `respondeu: ${text.slice(0, 40).trim() || "(vazio)"}`,
    };
  },
};
