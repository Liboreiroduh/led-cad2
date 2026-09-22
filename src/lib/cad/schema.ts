/**
 * PROJECT DOCUMENT — fonte de verdade do CAD (equivalente Pydantic, em Zod).
 *
 * Convenções (não negociáveis):
 *  - unidade interna única: milímetros (mm)
 *  - X = largura, Y = profundidade, Z = altura
 *  - solo = Z 0
 *  - IDs estáveis
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type Vec3 = z.output<typeof Vec3Schema>;

export const ROLES = [
  "post",
  "vertical",
  "horizontal",
  "brace",
  "support",
  "guardrail",
  "walkway",
  "base",
  "anchor",
  "panel",
  "rail",
  "other",
] as const;
export type ElementRole = (typeof ROLES)[number];

export const ELEMENT_TYPES = ["beam", "plate", "bolt", "panel", "cable", "surface"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/, "id deve ter 2-40 caracteres alfanuméricos");
const GroupSchema = z.string().trim().min(1).max(60).catch("GERAL");
const LabelSchema = z.string().max(120).default("");

export const BeamSchema = z.object({
  id: IdSchema,
  type: z.literal("beam"),
  role: z.enum(ROLES),
  profile: z.string().trim().min(1),
  group: GroupSchema,
  start: Vec3Schema,
  end: Vec3Schema,
  label: LabelSchema,
});
export type Beam = z.output<typeof BeamSchema>;

export const PlateSchema = z.object({
  id: IdSchema,
  type: z.literal("plate"),
  role: z.enum(ROLES),
  profile: z.string().trim().default(""),
  group: GroupSchema,
  center: Vec3Schema,
  size_x: z.number().positive(),
  size_y: z.number().positive(),
  size_z: z.number().positive(),
  label: LabelSchema,
});
export type Plate = z.output<typeof PlateSchema>;

export const BoltSchema = z.object({
  id: IdSchema,
  type: z.literal("bolt"),
  role: z.enum(ROLES),
  profile: z.string().trim().default(""),
  group: GroupSchema,
  center: Vec3Schema,
  diameter: z.number().positive(),
  length: z.number().positive(),
  label: LabelSchema,
});
export type Bolt = z.output<typeof BoltSchema>;

export const PanelElementSchema = z.object({
  id: IdSchema,
  type: z.literal("panel"),
  role: z.enum(ROLES),
  profile: z.string().trim().default(""),
  group: GroupSchema,
  center: Vec3Schema,
  size_x: z.number().positive(),
  size_y: z.number().positive(),
  size_z: z.number().positive(),
  label: LabelSchema,
});
export type PanelElement = z.output<typeof PanelElementSchema>;

export const CableSchema = z.object({
  id: IdSchema,
  type: z.literal("cable"),
  role: z.enum(ROLES),
  profile: z.string().trim().default(""),
  group: GroupSchema,
  start: Vec3Schema,
  end: Vec3Schema,
  diameter: z.number().positive().max(100),
  label: LabelSchema,
});
export type Cable = z.output<typeof CableSchema>;

export const SurfaceSchema = z.object({
  id: IdSchema,
  type: z.literal("surface"),
  role: z.enum(ROLES),
  profile: z.string().trim().default(""),
  group: GroupSchema,
  points: z.array(Vec3Schema).min(3).max(64),
  thickness: z.number().positive().default(5),
  label: LabelSchema,
});
export type Surface = z.output<typeof SurfaceSchema>;

export const ElementSchema = z.discriminatedUnion("type", [
  BeamSchema,
  PlateSchema,
  BoltSchema,
  PanelElementSchema,
  CableSchema,
  SurfaceSchema,
]);
export type CadElement = z.output<typeof ElementSchema>;

export const ProjectInfoSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(600).default(""),
});

export const PanelSpecSchema = z.object({
  width: z.number().positive().max(60000),
  height: z.number().positive().max(60000),
  depth: z.number().positive().max(6000),
  ground_clearance: z.number().min(0).max(30000),
});

export const InstallationSchema = z.object({
  type: z.enum(["post", "wall", "ground", "roof", "other"]).catch("other"),
  environment: z.enum(["indoor", "outdoor", "semi"]).catch("outdoor"),
});

/** Assumption: texto simples OU registro estruturado (medidas inferidas). */
export const AssumptionSchema = z.union([
  z.string().max(400),
  z.object({
    path: z.string().max(120),
    source: z.string().max(60).default("visual_estimate"),
    review_required: z.boolean().default(true),
    detail: z.string().max(400),
  }),
]);
export type Assumption = z.output<typeof AssumptionSchema>;

export const ReviewSchema = z.object({
  path: z.string().max(120),
  source: z.string().max(60).default("visual_estimate"),
  review_required: z.boolean().default(true),
  detail: z.string().max(400),
});

export const MetadataSchema = z.object({
  source: z.enum(["ai", "manual", "preset", "import", "mock"]).catch("manual"),
  preset_id: z.string().nullable().default(null),
  created_at: z.string().optional(),
  reviews: z.array(ReviewSchema).default([]),
});

export const ProjectDocumentSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  units: z.literal("mm").default("mm"),
  project: ProjectInfoSchema,
  panel: PanelSpecSchema,
  installation: InstallationSchema,
  elements: z.array(ElementSchema).max(600),
  assumptions: z.array(AssumptionSchema).max(60).default([]),
  metadata: z
    .object({
      source: z.enum(["ai", "manual", "preset", "import", "mock"]).catch("manual"),
      preset_id: z.string().nullable().default(null),
      created_at: z.string().optional(),
      reviews: z.array(ReviewSchema).default([]),
    })
    .default({ source: "manual", preset_id: null, reviews: [] }),
});
export type ProjectDocument = z.output<typeof ProjectDocumentSchema>;

/** Envelope do projeto armazenado (revision + hash + doc). */
export interface StoredProject {
  revision: number;
  hash: string;
  project: ProjectDocument;
  saved_at: string;
  updated_at: string;
}

/** Resposta da IA — contrato único para Gemini / Z.ai / Mock. */
export interface AITransformResponse {
  status: "ready" | "needs_input";
  explain: string;
  assumptions: Assumption[];
  questions: string[];
  project: ProjectDocument | null;
}

/** Diff calculado pelo SISTEMA (nunca pela IA). */
export interface ProjectDiff {
  added: string[];
  removed: string[];
  modified: string[];
  counts: { added: number; removed: number; modified: number; total: number };
  panel_changed: boolean;
  info_changed: boolean;
}
