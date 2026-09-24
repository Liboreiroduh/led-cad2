import { getStore } from "@/lib/store";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();

  // Ping no banco de dados (Prisma/SQLite) — garante DATABASE_URL e schema ok
  let database: "ok" | "error" = "error";
  let dbError: string | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
    database = "ok";
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return ok({
    ok: true,
    service: "led-json-cad",
    revision: store.state.revision,
    database,
    ...(dbError ? { dbError } : {}),
    time: new Date().toISOString(),
  });
}
