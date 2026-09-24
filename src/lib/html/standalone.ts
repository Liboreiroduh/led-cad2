/**
 * DEMO HTML STANDALONE — arquivo único pronto para o cliente:
 *  - visão 3D INTERATIVA (three.js via CDN) com o mesmo estilo técnico do editor
 *    (faces claras, arestas escuras, silhueta de desenho técnico)
 *  - visões ortográficas em SVG (FRONTAL / LATERAL / PLANTA) geradas no servidor
 *  - resumo do projeto, conjuntos com toggle de visibilidade, avisos e branding
 * Tudo embutido num único .html — basta abrir no navegador ou enviar por e-mail.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProjectDocument, GeometryElement } from "@/lib/cad/schema";
import { panelDimsOf, installationOf, elGroup } from "@/lib/cad/schema";
import { projectView, type Projection, type ViewName } from "@/lib/pdf/report";
import { validateProject } from "@/lib/cad/validation";

function escapeHtml(s: string): string {
  // entidades construídas por charcode (não escrever entidades nomeadas literalmente no fonte)
  const amp = String.fromCharCode(38);
  return s
    .replace(new RegExp(amp, "g"), amp + "amp;")
    .replace(/</g, amp + "#60;")
    .replace(/>/g, amp + "#62;")
    .replace(/"/g, amp + "#34;");
}

function escapeJsonForScript(s: string): string {
  return s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function logoDataUri(): string | null {
  try {
    const buf = readFileSync(path.join(process.cwd(), "public", "logo-ledcollor.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Visão ortográfica em SVG (mesma projeção da prancha). */
function projectionSvg(proj: Projection, width: number, height: number, label: string): string {
  const effMinY = proj.view !== "top" && proj.bbox.min.y > 20 ? 0 : proj.bbox.min.y;
  const pad = 16;
  const bw = Math.max(1, proj.bbox.max.x - proj.bbox.min.x);
  const bh = Math.max(1, proj.bbox.max.y - effMinY);
  const s = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const X = (x: number) => (pad + (x - proj.bbox.min.x) * s).toFixed(1);
  const Y = (y: number) => (height - pad - (y - effMinY) * s).toFixed(1);
  const parts: string[] = [];
  // faces
  for (const el of proj.els) {
    for (const f of el.faces) {
      const tone = f.tone > 0 ? Math.round(f.tone * 60) : 0;
      const fill = f.tone > 0 ? `rgb(${Math.max(0, 242 - tone)},${Math.max(0, 244 - tone)},${Math.max(0, 247 - tone)})` : "#f2f4f7";
      const d = f.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
      parts.push(`<polygon points="${d}" fill="${fill}" stroke="#a6adb6" stroke-width="0.6"/>`);
    }
  }
  // arestas/membros
  for (const el of proj.els) {
    for (const sg of el.segs) {
      const color = sg.light ? "#b6bdc5" : sg.edge ? "#313840" : "#4d555f";
      const sw = sg.light ? 0.5 : sg.edge ? 0.9 : 1.1;
      parts.push(`<line x1="${X(sg.a.x)}" y1="${Y(sg.a.y)}" x2="${X(sg.b.x)}" y2="${Y(sg.b.y)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
    }
  }
  // textos
  for (const el of proj.els) {
    for (const t of el.texts) {
      const size = Math.max(6, Math.min(t.height * s * 0.72, 12));
      parts.push(`<text x="${X(t.p.x)}" y="${Y(t.p.y)}" font-size="${size.toFixed(1)}" fill="#313840" font-family="system-ui,sans-serif">${escapeHtml(t.text)}</text>`);
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="${escapeHtml(label)}">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="#ffffff" stroke="#cbd5e1"/>` +
    parts.join("") +
    `<text x="10" y="18" font-size="12" font-weight="700" fill="#1e3a5f" font-family="system-ui,sans-serif">${escapeHtml(label)}</text>` +
    `</svg>`;
}

/** Conjuntos (grupos) com contagem. */
function groupCounts(doc: ProjectDocument): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const el of doc.elements) m.set(elGroup(el), (m.get(elGroup(el)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export async function generateStandaloneHtml(raw: unknown, revision: number): Promise<string> {
  const check = validateProject(raw);
  if (!check.ok || !check.doc) {
    throw new Error(`documento inválido para HTML: ${check.errors[0]?.message ?? "erro"}`);
  }
  const doc = check.doc;
  const panel = panelDimsOf(doc);
  const inst = installationOf(doc);
  const groups = groupCounts(doc);
  const logo = logoDataUri();

  const svgFront = projectionSvg(projectView(doc, "front"), 560, 400, "FRONTAL");
  const svgSide = projectionSvg(projectView(doc, "side"), 560, 400, "LATERAL");
  const svgTop = projectionSvg(projectView(doc, "top"), 560, 380, "PLANTA (SUPERIOR)");

  const docJson = escapeJsonForScript(JSON.stringify(doc));
  const logoHtml = logo
    ? `<img src="${logo}" alt="LED Collor" style="height:34px;width:auto"/>`
    : `<span style="font-weight:800;color:#16324a;font-size:18px">ledcollor</span>`;

  const groupCheckboxes = groups
    .map(([g, n], i) => `<label class="grp"><input type="checkbox" data-group="${escapeHtml(g)}" checked/> ${escapeHtml(g)} <span class="cnt">${n}</span></label>`)
    .join("");

  const summaryRows: Array<[string, string]> = [
    ["Projeto", escapeHtml(doc.project.name)],
    ["ID / REV", `${escapeHtml(doc.project.id)} · REV ${String(revision).padStart(3, "0")}`],
    ["Geometria", `${doc.elements.length} elementos · ${groups.length} conjunto(s) · unidade mm`],
    ["Data", new Date().toLocaleString("pt-BR")],
  ];
  if (panel) summaryRows.push(["Ref. encaixe", `painel ${panel.width} × ${panel.height} × ${panel.depth} mm · PD ${panel.ground_clearance} mm`]);
  if (inst) summaryRows.push(["Instalação", `${escapeHtml(inst.type)} · ${escapeHtml(inst.environment)}`]);

  const assumptions = doc.assumptions.slice(0, 6).map((a) => `<li>${escapeHtml(typeof a === "string" ? a : `${a.detail} (${a.path})`)}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>LED Collor CAD — ${escapeHtml(doc.project.name)}</title>
<style>
  :root { --navy:#141f2b; --ink:#1e293b; --line:#cbd5e1; --accent:#ea580c; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background:#f1f5f9; color:var(--ink); }
  header { display:flex; align-items:center; gap:14px; padding:10px 18px; background:linear-gradient(90deg,#141f2b,#223344); color:#f1f5f9; border-bottom:4px solid var(--accent); }
  .logo-chip { background:#fff; border-radius:8px; padding:4px 8px; display:flex; align-items:center; }
  header h1 { font-size:15px; margin:0; font-weight:700; }
  header .sub { font-size:11px; color:#94a3b8; }
  .banner { background:#fdf1ec; color:#b91c1c; font-size:11.5px; font-weight:700; padding:7px 18px; border-bottom:1px solid #f3cab8; }
  .wrap { display:flex; gap:14px; padding:14px 18px; flex-wrap:wrap; }
  .viewer-card { flex:1 1 620px; min-width:320px; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .toolbar { display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:8px 10px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
  .toolbar button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:5px 11px; font-size:12px; font-weight:600; color:#334155; cursor:pointer; }
  .toolbar button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .toolbar .hint { margin-left:auto; font-size:10.5px; color:#94a3b8; }
  #c3d { width:100%; height:62vh; min-height:380px; display:block; background:linear-gradient(180deg,#f8fafc,#eef2f6); touch-action:none; }
  aside { flex:0 1 300px; min-width:260px; display:flex; flex-direction:column; gap:12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .card h2 { font-size:11px; letter-spacing:.12em; color:#64748b; margin:0 0 8px; }
  .card table { width:100%; border-collapse:collapse; font-size:12px; }
  .card td { padding:3px 0; vertical-align:top; }
  .card td:first-child { color:#64748b; font-weight:600; width:84px; }
  .grp { display:flex; align-items:center; gap:6px; font-size:12.5px; padding:3px 0; cursor:pointer; }
  .grp .cnt { margin-left:auto; color:#94a3b8; font-size:11px; }
  .warn { font-size:11px; color:#b91c1c; font-weight:600; line-height:1.45; }
  .views { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; padding:0 18px 18px; }
  .views figure { margin:0; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  footer { padding:10px 18px 22px; font-size:11px; color:#94a3b8; }
  ul { margin:6px 0 0; padding-left:18px; font-size:12px; color:#475569; }
  @media print { .toolbar { display:none; } #c3d { height:480px; } }
</style>
</head>
<body>
<header>
  <div class="logo-chip">${logoHtml}</div>
  <div>
    <h1>LED Collor CAD — proposta geométrica</h1>
    <div class="sub">esboço interativo gerado a partir do documento do projeto · unidade mm</div>
  </div>
</header>
<div class="banner">ESBOÇO GEOMÉTRICO INTERATIVO — SEM DEFINIÇÃO DE MATERIAL, PERFIL OU FABRICAÇÃO · DIMENSIONAMENTO ESTRUTURAL E EXECUÇÃO SOB RESPONSABILIDADE DE PROFISSIONAL HABILITADO.</div>

<div class="wrap">
  <div class="viewer-card">
    <div class="toolbar">
      <button data-view="3d" class="active">3D</button>
      <button data-view="frente">Frente</button>
      <button data-view="fundo">Fundo</button>
      <button data-view="esquerda">Esquerda</button>
      <button data-view="direita">Direita</button>
      <button data-view="superior">Topo</button>
      <button data-view="iso">Isométrica</button>
      <button id="btnFit">Enquadrar</button>
      <label class="grp" style="margin-left:8px"><input type="checkbox" id="chkGrid" checked/> grade</label>
      <span class="hint">arraste para girar · scroll para zoom · botão direito move</span>
    </div>
    <canvas id="c3d"></canvas>
  </div>
  <aside>
    <div class="card">
      <h2>RESUMO</h2>
      <table>${summaryRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    </div>
    <div class="card">
      <h2>CONJUNTOS (clique para ocultar no 3D)</h2>
      ${groupCheckboxes}
    </div>
    <div class="card">
      <h2>AVISOS</h2>
      <p class="warn">Forma + dimensões + encaixe. Material, fabricação e resistência estrutural: responsabilidade de engenheiro habilitado.</p>
      ${assumptions ? `<h2 style="margin-top:10px">PREMISSAS</h2><ul>${assumptions}</ul>` : ""}
    </div>
  </aside>
</div>

<div class="views">
  <figure>${svgFront}</figure>
  <figure>${svgSide}</figure>
  <figure>${svgTop}</figure>
</div>

<footer>LED Collor CAD · esboço de referência geométrica gerado automaticamente · ${escapeHtml(doc.project.id)} · REV ${String(revision).padStart(3, "0")}</footer>

<script>window.__LED_DOC__ = ${docJson};</script>
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const doc = window.__LED_DOC__;
const canvas = document.getElementById("c3d");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f7fa);
scene.add(new THREE.HemisphereLight(0xffffff, 0x94a0ae, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1, 1.7, 0.9).multiplyScalar(20000); scene.add(sun);
const fill = new THREE.DirectionalLight(0xdde6f0, 0.55); fill.position.set(-1, 0.7, -0.8).multiplyScalar(20000); scene.add(fill);

// modelo: three(x, y=altura, z=profundidade)
const V3 = (p) => new THREE.Vector3(p.x, p.z, p.y);
const EDGE_DARK = 0x272d34, EDGE_MED = 0x4d555f, EDGE_SOFT = 0xb6bdc5;
const light = (c, amt = 0.4) => { const r=(c>>16)&255,g=(c>>8)&255,b=c&255; const m=(v)=>Math.round(v+(255-v)*amt); return (m(r)<<16)|(m(g)<<8)|m(b); };
const BASE = { beam: 0xe9edf1, box: 0xecf0f3, cylinder: 0xe9edf1, polygon: 0xf2f4f7, surface: 0xf2f4f7, mesh: 0xf2f4f7 };
const silMat = new THREE.MeshBasicMaterial({ color: EDGE_DARK, side: THREE.BackSide });
const ledGroup = doc.metadata?.extensions?.panel != null;

function fillMat(color, led) {
  return new THREE.MeshStandardMaterial({ color, metalness: led ? 0.2 : 0.06, roughness: led ? 0.35 : 0.9, flatShading: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}
function withTech(host, geo, opts = {}) {
  const { feature = 14, silhouette = true, wire = false } = opts;
  if (silhouette) {
    geo.computeBoundingSphere();
    const c = geo.boundingSphere.center, s = 1.018;
    const hull = new THREE.Mesh(geo, silMat);
    hull.position.set(c.x*(1-s), c.y*(1-s), c.z*(1-s)); hull.scale.setScalar(s);
    host.add(hull);
  }
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, feature), new THREE.LineBasicMaterial({ color: EDGE_MED, transparent: true, opacity: 0.95 }));
  host.add(e);
  if (wire) {
    const pos = geo.getAttribute("position"); const tris = geo.index ? geo.index.count/3 : (pos?pos.count/3:0);
    if (tris > 0 && tris <= 4000) {
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: EDGE_SOFT, transparent: true, opacity: 0.2 }));
      host.add(w);
    }
  }
}
function oriented(a, b, makeGeo, axis) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.001);
  const m = new THREE.Mesh(makeGeo(len));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  // eixo LOCAL da geometria que aponta na direção do membro:
  // BoxGeometry(len no Z) → (0,0,1) · CylinderGeometry(len no Y) → (0,1,0)
  m.quaternion.setFromUnitVectors(axis, dir.normalize());
  return m;
}

const content = new THREE.Group();
const byGroup = new Map();
const reg = (el, obj) => {
  obj.userData.elementGroup = el.metadata?.group || "GERAL";
  obj.userData.elementId = el.id;
  if (!byGroup.has(obj.userData.elementGroup)) byGroup.set(obj.userData.elementGroup, []);
  byGroup.get(obj.userData.elementGroup).push(obj);
  content.add(obj);
};

for (const el of doc.elements) {
  const g = el.geometry;
  const led = el.metadata?.led === true;
  const col = typeof el.metadata?.color === "string" && /^#[0-9a-f]{6}$/i.test(el.metadata.color) ? light(parseInt(el.metadata.color.slice(1), 16)) : (BASE[g.type] ?? 0xe9edf1);
  if (g.type === "box") {
    const geo = new THREE.BoxGeometry(g.size[0], g.size[2], g.size[1]);
    const mat = led ? fillMat(0x1f2937, true) : fillMat(col);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(V3(g.center));
    if (g.rotation) { const [rx, ry, rz] = g.rotation.map(THREE.MathUtils.degToRad); m.rotation.set(rx, rz, ry); }
    withTech(m, geo, { feature: 1 });
    reg(el, m);
  } else if (g.type === "beam" || g.type === "cylinder") {
    const a = V3(g.start), b = V3(g.end);
    const round = g.type === "cylinder" || g.section.type === "round";
    const w = g.type === "cylinder" ? g.diameter : (round ? g.section.diameter : g.section.width);
    const h = g.type === "cylinder" ? g.diameter : (round ? g.section.diameter : g.section.height);
    // eixo local correto por tipo de geometria — sem isso vigas retas saem "de lado"
    const m = round
      ? oriented(a, b, (len) => new THREE.CylinderGeometry(w/2, w/2, len, 16), new THREE.Vector3(0, 1, 0))
      : oriented(a, b, (len) => new THREE.BoxGeometry(w, h, len), new THREE.Vector3(0, 0, 1));
    m.material = fillMat(col);
    reg(el, m);
    withTech(m, m.geometry, { feature: round ? 30 : 1 });
  } else if (g.type === "line" || g.type === "polyline") {
    const t = Math.max(g.thickness ?? 8, 2);
    const pts = g.type === "line" ? [V3(g.start), V3(g.end)] : g.points.map(V3);
    if (g.type === "polyline" && g.closed && pts.length > 2) pts.push(pts[0].clone());
    const grp = new THREE.Group();
    for (let i = 1; i < pts.length; i++) { const m = oriented(pts[i-1], pts[i], (len) => new THREE.CylinderGeometry(t/2, t/2, len, 8), new THREE.Vector3(0, 1, 0)); m.material = fillMat(col); grp.add(m); }
    reg(el, grp);
  } else if (g.type === "polygon" || g.type === "surface") {
    const pts = g.points.map(V3);
    const verts = [];
    for (let i = 1; i < pts.length - 1; i++) verts.push(pts[0], pts[i], pts[i+1]);
    const geo = new THREE.BufferGeometry().setFromPoints(verts); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, fillMat(col));
    reg(el, m);
    withTech(m, geo, { feature: 14, wire: true });
  } else if (g.type === "mesh") {
    const verts = [];
    for (const f of g.faces) { const idx = f.map((i) => g.vertices[i]).filter(Boolean); if (idx.length < 3) continue; for (let i = 1; i < idx.length - 1; i++) verts.push(V3(idx[0]), V3(idx[i]), V3(idx[i+1])); }
    const geo = new THREE.BufferGeometry().setFromPoints(verts); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, fillMat(col));
    reg(el, m);
    withTech(m, geo, { feature: 14, wire: true });
  } else if (g.type === "circle" || g.type === "arc") {
    const basis = (plane) => (u, v) => plane === "XY" ? { x: u, y: v, z: 0 } : plane === "YZ" ? { x: 0, y: u, z: v } : { x: u, y: 0, z: v };
    const bf = basis(g.plane ?? "XY");
    const c = g.center, pts = [];
    const a0 = g.type === "arc" ? g.start_angle : 0;
    const a1 = g.type === "arc" ? g.end_angle : 360;
    for (let i = 0; i <= 64; i++) { const an = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / 64); const p = bf(c.x + g.radius * Math.cos(an), c.y + g.radius * Math.sin(an)); pts.push(V3(p)); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8f99a4 }));
    reg(el, l);
  } else if (g.type === "text") {
    const d = document.createElement("div"); d.textContent = g.text;
    d.style.cssText = "font:700 12px system-ui;color:#334155;background:rgba(255,255,255,.92);border:1px solid #cbd5e1;border-radius:6px;padding:2px 6px;white-space:nowrap";
    const label = new THREE.CSS2DObject ? null : null;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; const cx = cv.getContext("2d"); cx.fillStyle = "rgba(255,255,255,.94)"; cx.fillRect(0,0,256,64); cx.fillStyle = "#1e293b"; cx.font = "bold 30px system-ui"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText(g.text.slice(0,24), 128, 32); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(), depthTest: false }));
    sp.scale.set((g.height ?? 120) * 4, (g.height ?? 120), 1); sp.position.copy(V3(g.position));
    reg(el, sp);
  } else if (g.type === "dimension") {
    const a = V3(g.start), b = V3(g.end);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xea580c }));
    reg(el, l);
  }
}

// grade + chão
const grid = new THREE.GridHelper(60, 60, 0xb8c0ca, 0xd8dee6);
grid.material.transparent = true; grid.material.opacity = 0.55;
const envGroup = new THREE.Group(); envGroup.add(grid); scene.add(envGroup);
scene.add(content);

// enquadramento
const bbox = new THREE.Box3().setFromObject(content);
const sphere = bbox.getBoundingSphere(new THREE.Sphere());
const center = sphere.center.clone();
const radius = Math.max(sphere.radius, 1);
const camera = new THREE.PerspectiveCamera(50, 2, Math.max(radius / 1000, 0.1), Math.max(radius * 60, 10000));
const controls = new OrbitControls(camera, canvas);
controls.target.copy(center);
controls.enableDamping = true;

const DIRS = {
  "3d": [1, 0.6, 1.15], frente: [0, 0.05, 1], fundo: [0, 0.05, -1], esquerda: [-1, 0.05, 0], direita: [1, 0.05, 0], superior: [0, 1, 0.001], iso: [1, 0.75, 1],
};
let currentView = "3d";
function applyView(v) {
  currentView = v;
  const d = new THREE.Vector3(...(DIRS[v] || DIRS["3d"])).normalize();
  camera.position.copy(center).add(d.multiplyScalar(radius * 2.2));
  camera.lookAt(center);
  controls.update();
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
}
function fitAll() { applyView(currentView); }

// controles da barra
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => applyView(b.dataset.view)));
document.getElementById("btnFit").addEventListener("click", fitAll);
document.getElementById("chkGrid").addEventListener("change", (e) => { grid.visible = e.target.checked; });
document.querySelectorAll("input[data-group]").forEach((cb) => {
  cb.addEventListener("change", () => {
    const objs = byGroup.get(cb.dataset.group) || [];
    objs.forEach((o) => (o.visible = cb.checked));
  });
});

function resize() {
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 500;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();
applyView("3d");
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script>
</body>
</html>`;
}
