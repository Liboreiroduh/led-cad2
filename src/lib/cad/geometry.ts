/**
 * GEOMETRY CORE v2 — núcleo geométrico livre do CAD.
 *
 * Princípio (TASK_MIGRAR_LED_JSON_CAD_PARA_GEOMETRIA_LIVRE):
 *   RÍGIDO NA GEOMETRIA, FLEXÍVEL NA SEMÂNTICA.
 *   - Valida fortemente números, coordenadas, dimensões, IDs únicos.
 *   - NUNCA bloqueia por material, perfil, nome, role desconhecido ou grupo novo.
 *   - metadata é um record LIVRE — não impede renderização.
 *   - mesh é o escape universal.
 *
 * Convenções preservadas: mm; X=largura, Y=profundidade, Z=altura; solo=Z 0.
 */
import { z } from "zod";

export const GEOMETRY_SCHEMA_VERSION = 2;

/** Ponto 3D — aceita [x,y,z] (compacto p/ IA) ou {x,y,z} (legado); normaliza para {x,y,z}. */
export const Vec3Schema = z
  .union([
    z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  ])
  .transform((v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v));
export type Vec3 = z.output<typeof Vec3Schema>;

/** Metadado LIVRE (qualquer JSON). Campos conhecidos são convenções, não obrigações. */
export const FreeMetadataSchema = z.record(z.string(), z.unknown()).default({});
export type FreeMetadata = z.output<typeof FreeMetadataSchema>;

const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/, "id deve ter 2-40 caracteres alfanuméricos");

const PlaneSchema = z.enum(["XY", "XZ", "YZ"]).catch("XY");

const Positive = (max = 60000) => z.number().finite().positive().max(max);

/** Seção do beam: rect/square/round — input tolerante; o transform normaliza (rígido só na saída). */
export const SectionSchema = z
  .object({
    type: z.enum(["rect", "square", "round"]).catch("square"),
    width: z.number().finite().min(0).max(2000).optional(),
    height: z.number().finite().min(0).max(2000).optional(),
    diameter: z.number().finite().min(0).max(2000).optional(),
    size: z.number().finite().min(0).max(2000).optional(),
  })
  .transform((s) => {
    const pick = (...vals: Array<number | undefined>): number => {
      for (const v of vals) if (typeof v === "number" && v > 0) return v;
      return 60;
    };
    const base = pick(s.width, s.size, s.diameter);
    const height = s.type === "round" ? base : pick(s.height, s.size, s.width);
    const diameter = s.type === "round" ? pick(s.diameter, s.width, s.size) : 0;
    return { type: s.type, width: base, height, diameter };
  });
export type Section = z.output<typeof SectionSchema>;

const ThicknessSchema = z.number().finite().positive().max(2000).optional();

/* ============================ PRIMITIVOS ============================ */

export const LineGeoSchema = z.object({
  type: z.literal("line"),
  start: Vec3Schema,
  end: Vec3Schema,
  thickness: ThicknessSchema,
});

export const BeamGeoSchema = z.object({
  type: z.literal("beam"),
  start: Vec3Schema,
  end: Vec3Schema,
  section: SectionSchema.default({ type: "square", width: 60, height: 60, diameter: 0 }),
});

export const BoxGeoSchema = z.object({
  type: z.literal("box"),
  center: Vec3Schema,
  size: z.tuple([Positive(), Positive(), Positive()]),
  rotation: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .optional(), // graus [rx,ry,rz]
});

export const CylinderGeoSchema = z.object({
  type: z.literal("cylinder"),
  start: Vec3Schema,
  end: Vec3Schema,
  diameter: Positive(),
});

export const CircleGeoSchema = z.object({
  type: z.literal("circle"),
  center: Vec3Schema,
  radius: Positive(),
  plane: PlaneSchema.optional(),
});

export const ArcGeoSchema = z.object({
  type: z.literal("arc"),
  center: Vec3Schema,
  radius: Positive(),
  start_angle: z.number().finite(), // graus
  end_angle: z.number().finite(),
  plane: PlaneSchema.optional(),
  thickness: ThicknessSchema,
});

export const PolylineGeoSchema = z.object({
  type: z.literal("polyline"),
  points: z.array(Vec3Schema).min(2).max(512),
  closed: z.boolean().optional(),
  thickness: ThicknessSchema,
});

export const PolygonGeoSchema = z.object({
  type: z.literal("polygon"),
  points: z.array(Vec3Schema).min(3).max(512),
});

export const SurfaceGeoSchema = z.object({
  type: z.literal("surface"),
  points: z.array(Vec3Schema).min(3).max(512),
  thickness: ThicknessSchema,
});

/** ESCAPE UNIVERSAL — qualquer forma cabível em vértices+faces. */
export const MeshGeoSchema = z.object({
  type: z.literal("mesh"),
  vertices: z.array(Vec3Schema).min(3).max(20000),
  faces: z.array(z.array(z.number().int().min(0)).min(3).max(64)).max(20000),
});

export const TextGeoSchema = z.object({
  type: z.literal("text"),
  position: Vec3Schema,
  text: z.string().min(1).max(300),
  height: z.number().finite().positive().max(5000).optional(),
  rotation: z.number().finite().optional(),
});

/** Cota geométrica opcional (render como linha de cota). */
export const DimensionGeoSchema = z.object({
  type: z.literal("dimension"),
  start: Vec3Schema,
  end: Vec3Schema,
  text: z.string().max(120).optional(),
});

export const GeometrySchema = z.discriminatedUnion("type", [
  LineGeoSchema,
  BeamGeoSchema,
  BoxGeoSchema,
  CylinderGeoSchema,
  CircleGeoSchema,
  ArcGeoSchema,
  PolylineGeoSchema,
  PolygonGeoSchema,
  SurfaceGeoSchema,
  MeshGeoSchema,
  TextGeoSchema,
  DimensionGeoSchema,
]);
export type Geometry = z.output<typeof GeometrySchema>;
export type GeometryType = Geometry["type"];

export const GEOMETRY_TYPES = [
  "line",
  "beam",
  "box",
  "cylinder",
  "circle",
  "arc",
  "polyline",
  "polygon",
  "surface",
  "mesh",
  "text",
  "dimension",
] as const;

/** ELEMENTO CANÔNICO — geometria obrigatória, semântica livre. */
export const GeometryElementSchema = z.object({
  id: IdSchema,
  geometry: GeometrySchema,
  metadata: FreeMetadataSchema,
});
export type GeometryElement = z.output<typeof GeometryElementSchema>;

/* ============================ DOCUMENTO ============================ */

export const GeometryProjectInfoSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(600).default(""),
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

export const GeometryDocumentSchema = z.object({
  schema_version: z.literal(2).default(GEOMETRY_SCHEMA_VERSION),
  units: z.literal("mm").catch("mm").default("mm"),
  project: GeometryProjectInfoSchema,
  elements: z.array(GeometryElementSchema).max(2000),
  assumptions: z.array(AssumptionSchema).max(60).default([]),
  /** metadata livre no documento (extensions painel/installation do legado entram aqui) */
  metadata: FreeMetadataSchema,
});
export type GeometryDocument = z.output<typeof GeometryDocumentSchema>;

/** Alias de compatibilidade — o documento canônico DO CAD é o GeometryDocument v2. */
export const ProjectDocumentSchema = GeometryDocumentSchema;
export type ProjectDocument = GeometryDocument;
export type CadElement = GeometryElement;

/* ==================== HELPERS DE METADATA (leitura tolerante) ==================== */

function metaStr(el: GeometryElement, key: string): string {
  const v = el.metadata?.[key];
  return typeof v === "string" ? v : "";
}

export const elName = (el: GeometryElement): string => metaStr(el, "name") || metaStr(el, "label") || el.id;
export const elGroup = (el: GeometryElement): string => metaStr(el, "group") || "GERAL";
export const elRole = (el: GeometryElement): string => metaStr(el, "role");
export const elProfile = (el: GeometryElement): string => metaStr(el, "profile");
export const elMaterial = (el: GeometryElement): string => metaStr(el, "material");
export const elLabel = (el: GeometryElement): string => metaStr(el, "label");
export const elLed = (el: GeometryElement): boolean => el.metadata?.led === true;

/** painel LED legado salvo em metadata.extensions.panel (compatibilidade RevisionHistory/title block) */
export function panelDimsOf(doc: GeometryDocument): { width: number; height: number; depth: number; ground_clearance: number } | null {
  const ext = doc.metadata?.["extensions"];
  if (!ext || typeof ext !== "object") return null;
  const panel = (ext as Record<string, unknown>)["panel"];
  if (!panel || typeof panel !== "object") return null;
  const p = panel as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const width = num(p["width"]);
  const height = num(p["height"]);
  if (width === null || height === null) return null;
  return {
    width,
    height,
    depth: num(p["depth"]) ?? 0,
    ground_clearance: num(p["ground_clearance"]) ?? 0,
  };
}

export function installationOf(doc: GeometryDocument): { type: string; environment: string } | null {
  const ext = doc.metadata?.["extensions"];
  if (!ext || typeof ext !== "object") return null;
  const inst = (ext as Record<string, unknown>)["installation"];
  if (!inst || typeof inst !== "object") return null;
  const i = inst as Record<string, unknown>;
  return {
    type: typeof i["type"] === "string" ? i["type"] : "other",
    environment: typeof i["environment"] === "string" ? i["environment"] : "outdoor",
  };
}
