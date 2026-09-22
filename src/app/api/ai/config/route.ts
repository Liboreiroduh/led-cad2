import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";
import type { ProviderId } from "@/lib/ai/types";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

export async function GET() {
  const cfg = getStore().getAiConfig();
  return ok({
    active_provider: cfg.active_provider,
    providers: {
      gemini: {
        model: cfg.gemini.model,
        timeout_ms: cfg.gemini.timeout_ms,
        api_key_masked: maskKey(cfg.gemini.api_key),
        configured: Boolean(cfg.gemini.api_key),
      },
      zai: {
        model: cfg.zai.model,
        timeout_ms: cfg.zai.timeout_ms,
        api_key_masked: maskKey(cfg.zai.api_key),
        configured: true,
      },
      mock: { model: cfg.mock.model, configured: true },
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{
      provider?: ProviderId;
      target?: "gemini" | "zai";
      model?: string;
      api_key?: string;
      timeout_ms?: number;
    }>(req);
    const cfg = getStore().updateAiConfig({
      provider: body.provider,
      target: body.target,
      model: body.model,
      api_key: body.api_key,
      timeout_ms: body.timeout_ms,
    });
    return ok({ message: "configuração salva", active_provider: cfg.active_provider });
  } catch (e) {
    return handleError(e);
  }
}
