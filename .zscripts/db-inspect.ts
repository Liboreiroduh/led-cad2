// Inspeciona tabelas do SQLite gerado pela migration init (descartavel)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
);
console.log("TABLES:", tables.map((t) => t.name).join(", "));
await prisma.$disconnect();
