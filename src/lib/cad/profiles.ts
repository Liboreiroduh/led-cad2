/** Catálogo de perfis estruturais — perfis desconhecidos FALHAM na validação. */

export type ProfileKind = "square" | "round";

export interface Profile {
  name: string;
  kind: ProfileKind;
  /** square: w×h ; round: d */
  w: number;
  h: number;
  /** espessura de parede (mm) */
  t: number;
  /** kg por metro */
  kgm: number;
}

export const PROFILES: Profile[] = [
  { name: "METALON_40x40x2", kind: "square", w: 40, h: 40, t: 2, kgm: 2.31 },
  { name: "METALON_50x50x2", kind: "square", w: 50, h: 50, t: 2, kgm: 2.97 },
  { name: "METALON_60x60x2", kind: "square", w: 60, h: 60, t: 2, kgm: 3.66 },
  { name: "METALON_100x100x3", kind: "square", w: 100, h: 100, t: 3, kgm: 9.01 },
  { name: "TUBO_219x4.75", kind: "round", w: 219, h: 219, t: 4.75, kgm: 25.08 },
  { name: "TUBO_250x10", kind: "round", w: 250, h: 250, t: 10, kgm: 59.15 },
  { name: "TUBO_380_t4.8", kind: "round", w: 380, h: 380, t: 4.8, kgm: 44.35 },
  { name: "TUBO_380_t6.35", kind: "round", w: 380, h: 380, t: 6.35, kgm: 58.52 },
];

const INDEX = new Map(PROFILES.map((p) => [p.name.toUpperCase(), p]));

export function getProfile(name: string): Profile | undefined {
  return INDEX.get(name.trim().toUpperCase());
}

export function profileNames(): string[] {
  return PROFILES.map((p) => p.name);
}

/** kg/m aproximado para cabo de aço pelo diâmetro (mm). */
export function cableKgPerMeter(diameter: number): number {
  return +(diameter * diameter * 0.00617).toFixed(3);
}

export const STEEL_DENSITY_KG_M3 = 7850;
