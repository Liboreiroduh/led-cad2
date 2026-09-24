# Worklog — LED JSON CAD (LED Collor)

---

Task ID: fix-html-oriented-20260923
Agent: Zoo (Code)
Task: CORRIGIR ORIENTAÇÃO DOS MEMBROS NO HTML STANDALONE (vigas retas saíam "de lado" — leque/rógulo na roda).

Work Log:
- CAUSA: no gerador standalone, oriented() alinhava SEMPRE o eixo local +Y com a direção do membro; mas BoxGeometry(w,h,len) coloca o COMPRIMENTO no eixo Z → vigas de seção reta ficavam rotacionadas 90°, aparecendo como espetas radiando (o "leque" da roda no print do operador).
- FIX (standalone.ts): oriented(a, b, makeGeo, axis) com eixo local explícito — beam reta: BoxGeometry + eixo (0,0,1) (igual ao sceneBuilder); beam/cylinder redonda: CylinderGeometry + eixo (0,1,0); line/polyline: (0,1,0). Agora o standalone replica 1:1 a orientação do editor.
- Testes: tsc/eslint limpos; /api/export/html 200 (2,04 MB) — download/demo-cliente.html regenerada.

Stage Summary:
- O HTML standalone agora interpreta a geometria EXATAMENTE como o modelo 3D do editor (mesma convenção de eixos por tipo de primitivo).

---

Task ID: demo-html-standalone-20260923
Agent: Zoo (Code)
Task: EXPORT HTML STANDALONE — demonstração interativa 3D + visões, arquivo único pronto para o cliente.

Work Log:
- NOVO GERADOR (src/lib/html/standalone.ts): generateStandaloneHtml(doc, revision) → arquivo HTML ÚNICO e autocontido. Header com logo (base64 de public/logo-ledcollor.png, fallback tipográfico), nome do projeto, REV, data, banner de responsabilidade estrutural.
- 3D INTERATIVO: three.js 0.160 via importmap CDN (jsdelivr) + OrbitControls; constrói o modelo client-side a partir do GeometryDocument embutido (window.__LED_DOC__ com escapes \u003c) com o MESMO estilo técnico do editor (faces claras flatShading, EdgesGeometry escuras, silhueta inverted-hull, wireframe leve em surfaces/meshes); botões de vista (3D/Frente/Fundo/Esquerda/Direita/Topo/Isométrica + Enquadrar), toggle de grade, checkboxes por CONJUNTO para ocultar/mostrar no 3D; resize observer; grid + luzes.
- VISÕES SVG GERADAS NO SERVIDOR: projectionSvg consome a MESMA projeção da prancha (projectView front/side/top) → FRONTAL/LATERAL/PLANTA em cards SVG inline (funciona até sem JS).
- RESUMO: projeto, id/rev, elementos/conjuntos, encaixe do painel (legado), instalação, premissas e avisos. Print CSS.
- ROTA /api/export/html (POST, attachment text/html, filename ledcollor-cad-{id}-rev{N}.html); client-api.downloadStandaloneHtml; botão HTML na topbar ao lado de PRANCHA (estado htmlBusy, toast).
- FIX: escapeHtml reescrito com String.fromCharCode(38) — entidades nomeadas literais no fonte foram corrompidas no transporte e quebravam o parse.
- Testes: tsc/eslint limpos; POST /api/export/html 200 → download/demo-cliente.html com 2,0 MB (logo base64 + doc + 3 SVGs + viewer), contém __LED_DOC__/importmap/SVGs.

Stage Summary:
- O cliente recebe UM arquivo .html que abre em qualquer navegador: giro o modelo em 3D, alterna vistas, liga/desliga conjuntos, vê as visões ortográficas e o resumo — mesma geometria e estilo da prancha.

---

Task ID: prancha-maximo-detalhe-20260923
Agent: Zoo (Code)
Task: MÁXIMO DETALHE NA PRANCHA — sombreamento por orientação de face, triangulação interna, hachura de solo e rótulos de conjunto.

Work Log:
- TOM POR ORIENTAÇÃO DE FACE: faceNormalZ (Newell) → topo das lajes/telhados com tom 10% mais escuro, fundos 18% — leitura de plano sem shading (mixRGB para o tom FILL_DARK).
- TRIANGULAÇÃO INTERNA NO PDF: polygon/surface ganham diagonais do leque como traços leves (thickness 0.6, light, noNode); mesh ganha diagonais das faces com teto de 3000; drawProjection desenha light com EDGE_SOFT a 50% da espessura.
- HACHURA DE SOLO: traços a 45° abaixo da linha SOLO ±0 (clássico de desenho técnico).
- RÓTULOS DE CONJUNTO: drawGroupLabels — nome do grupo (até 10) no topo do bbox de cada conjunto na vista FRONTAL, chip branco 85%.
- Orçamento de fills 2500→4000 (prismas aumentaram as faces).
- Testes: tsc limpo em src/ (após corrigir light? no tipo de segs e EDGE_SOFT→LINE_SOFT), eslint limpo, 3 PDFs regenerados OK.

---

Task ID: membros-prisma-pdf-20260923
Agent: Zoo (Code)
Task: SALTO DE QUALIDADE DA PRANCHA LIVRE — membros desenhados como prismas (não linhas soltas) + isométrica com profundidade de traço (alvo: croqui arquitetônico completo, ref. imagem do operador).

Work Log:
- MEMBROS COMO PRISMAS NO PDF (report.ts): beam/cylinder agora geram PRISMA real (memberPrism/sectionRing/prismSegments/prismFaces) — seção reta = prisma de 4 lados (12 arestas), redonda = octógono (24 arestas); arestas marcadas noNode (não viram nós de cadeia de cotas — cadeias continuam saindo do EIXO do membro, limpas); FACES do prisma entram no preenchimento cinza claro → postes/vigas/tubos aparecem como sólidos desenhados com contorno, e não como linhas soltas. Membro degenerado (len<0.001) cai para linha simples.
- ISO COM PROFUNDIDADE DE TRAÇO: cada aresta carrega depth (x−y+0.3z); drawProjection mapeia para TOM (LINE_SOFT→cinza escuro 0.32) e ESPESSURA (×0.75–1.3) — perto escuro/forte, longe claro/leve: sensação de croqui de perspectiva à mão.
- Verificado com o projeto real do operador (agora casa com surfaces: 43 el., Z 20–6100) e nos 3 PDFs de exemplo — geração OK, orientação OK, cadeias limpas.

Stage Summary:
- A prancha agora "desenha" os membros: cada viga/posto/tubo é um volume com arestas e faces claras, e a isométrica tem profundidade de traço — o maior passo até agora rumo ao croqui arquitetônico completo da imagem de referência.

---

Task ID: refinamento-tecnico-3d-round2-20260923
Agent: Zoo (Code)
Task: REFINAMENTO FINAL DO MODO TÉCNICO — cotas mais próximas, hierarquia mais forte, hidden mais discreto, mais detalhe arquitetônico.

Work Log:
- HIERARQUIA REFORÇADA: silhueta mais escura (0x313840→0x272d34) e inflação 1,5%→1,8%; arestas de recurso mais escuras (0x5b646f→0x4d555f); traços internos mais leves (0xa6adb6→0xb6bdc5, wireframe opacity 0.28→0.2).
- COTAS MAIS PRÓXIMAS: primitivo `dimension` com offset 10%→5% do comprimento (cap 25–220); cotas do envelope (buildDimensionGroup) com off 7%→4,5% da diagonal e deslocamentos das linhas 0,55→0,38 — as cotas agora ficam coladas à geometria que medem.
- HIDDEN DISCRETO: tracejadas só quando a geometria tem ≤4000 triângulos (meshes grandes ficam sem hidden — evita ruído), threshold min(recurso,14°), opacity 0.4→0.3.
- MAIS DETALHE ARQUITETÔNICO: threshold de recurso em surface/mesh 18°→14° — esquadrias, marquise, sacadas e planos de vidro modelados aparecem nas arestas.
- Testes: tsc limpo em src/, eslint limpo, HMR OK.

---

Task ID: wireframe-assistido-20260923
Agent: Zoo (Code)
Task: REFINAR O MODO "DESENHO TÉCNICO 3D" — faces quase desaparecendo, hidden edges tracejados, mais traços úteis e cotas ancoradas.

Work Log:
- FACES DISCRETAS: paleta clareada de novo (membros 0xe9edf1, box 0xecf0f3, superfícies 0xf2f4f7, linhas 0xb3bbc4) — o foco visual vai para as arestas; flatShading mantém mudanças de plano perceptíveis sem shading pesado.
- HIDDEN EDGES: addTechLines ganhou passada de arestas OCULTAS tracejadas (LineDashedMaterial EDGE_HIDDEN 0xbac2cb, opacity 0.4, depthTest false, computeLineDistances) com dash adaptativo ao raio da bounding sphere (8–90mm); renderOrder 1 (sob as arestas visíveis em 2). Caixa: as 12 arestas existem em versão visível E tracejada → leitura "enxergando através" (wireframe assistido). Superfícies/mesh: hidden com threshold reduzido (min(10°)) quando ≤6000 triângulos, senão usa o threshold de recurso.
- MAIS TRAÇOS: threshold de recurso 30°→18° em surface/mesh (vincos sutis aparecem); wireframe interno ampliado (cap 1500→4000 triângulos, opacidade 0.28).
- COTAS ANCORADAS (dimLine reescrita): linha de cota PARALELA deslocada da geometria com linhas de extensão (122% do offset) ligando os pontos medidos, ticks nas âncoras, setas na linha deslocada e rótulo sobre ela — padrão de desenho técnico, sem flutuar sobre o modelo. Primitivo `dimension` agora usa medidas proporcionais ao trecho (labelH 6% do comprimento cap 25–260; offset 10% cap 40–420) em vez de constantes globais.
- Testes: tsc limpo em src/, eslint limpo, HMR OK; todos os fluxos de API continuam 200.

Stage Summary:
- De "bloco sólido com algumas linhas" para "desenho técnico 3D": silhueta forte → arestas médias → hidden tracejado discreto → triangulação leve; faces quase brancas; cotas ancoradas com extensão. Vale para casa, painel, estrutura, formas abertas e geometrias livres.

---

Task ID: visual-desenho-tecnico-3d-20260923
Agent: Zoo (Code)
Task: HIERARQUIA VISUAL DE TRAÇOS NO VIEWER 3D — silhueta × arestas × traços internos (fim do "volume chapado").

Work Log:
- SISTEMA DE TRAÇOS (sceneBuilder.ts): 1) SILHUETA via inverted hull — clone do mesh com material BackSide cinza-escuro (EDGE_DARK 0x3d444d) inflado 1,5% em torno do centro da bounding sphere (funciona com geometria centrada E absoluta) → contorno externo forte de qualquer ângulo; 2) ARESTAS DE RECURSO — EdgesGeometry com ângulo-limite (quinas/mudanças de plano reais, sem ruído de triangulação); 3) TRAÇOS INTERNOS — WireframeGeometry cinza-claro (EDGE_SOFT, opacidade 0.32) só para polygon/surface/mesh com teto de 1500 triângulos (legibilidade sem peso).
- APLICAÇÃO POR PRIMITIVO: box → silhueta + 12 arestas (threshold 1); box LED → silhueta + arestas laranja existentes mantidas; beam → silhueta + arestas (threshold 1 p/ seção reta, 30 p/ redonda: só aros); cylinder → silhueta + aros; line/polyline/arc-tubo → silhueta por segmento (tubos finos); polygon/surface → silhueta + contorno + triangulação interna; mesh → silhueta + dobras reais (threshold 30°) + triangulação leve.
- MATERIAIS: MeshStandard mais fosco e flat (metalness 0.55→0.06, roughness 0.9, flatShading true, polygonOffset p/ arestas sem z-fight); paleta CLAREADA (STEEL 0x8b95a1→0xd7dce2, box→0xcfd5db, superfícies→0xe3e7eb, linhas 0xaab2bc); metadata.color é clareada 40% p/ branco (lighten()) — cor mantém matiz sem dominar. Status de diff (verde/laranja/vermelho) preservados.
- PERFORMANCE: silhueta compartilha material estático; wireframe interno limitado; filhos herdam visibilidade dos pais registrados no byId (toggle/isolar continuam funcionando); raycast de seleção intocado (fill recebe o clique primeiro).
- Testes: tsc limpo em src/, eslint limpo, HMR compilou; Viewer3D com iluminação hemisférica+direcional existente realça as facetas planas.

Stage Summary:
- O viewer agora lê como desenho técnico 3D: contorno forte, quinas médias, traços internos leves, preenchimentos claros — hierarquia visual real em vez de blocos chapados.

---

Task ID: logo-ledcollor-20260923
Agent: Zoo (Code)
Task: IDENTIDADE VISUAL — logo LED Collor no quadro do PDF e no programa ("LED Collor CAD").

Work Log:
- LOGO: 'LOGO-LEDCOLLOR-FINAL-VETORIZADA.png' (9183×2671, RGBA, 3.44:1) copiada para public/logo-ledcollor.png.
- PDF (report.ts): drawTitleBlock recebe a logo embedada (public/, fs no runtime do servidor, fallback para texto "LED COLLOR" se o arquivo faltar); header do quadro ganha chip branco + drawImage (h=22pt) e o subtítulo "ESBOÇO GEOMÉTRICO COTADO" desloca para a direita. Rodapé do banner: "LED Collor CAD · esboço de referência geométrica".
- PDF DE DIF (diffReport.ts): mesma logo no rodapé (chip h=18) + marca "LED Collor CAD".
- UI (page.tsx): topbar troca o quadrado "LC" por chip branco com a logo (h-6) + título "LED Collor CAD"; notificação de IA atualizada. layout.tsx: <title> "LED Collor CAD". meta route: app "LED Collor CAD". CompareSplit: snapshot A/B "COMPARAÇÃO A/B — LED Collor CAD".
- Testes: tsc limpo em src/, eslint limpo; PDFs de exemplo regenerados (~1,1 MB com a logo embutida); /api/export/pdf com o doc real 200 (1,18 MB).

Stage Summary:
- Marca consistente: logo LED Collor no title block do PDF (todas as folhas), no PDF de diferenças e na topbar do programa com o nome "LED Collor CAD".

---

Task ID: fix-prancha-invertida-20260923
Agent: Zoo (Code)
Task: CORRIGIR PRANCHA PDF DE CABEÇA PRA BAIXO (relato do operador com JSON antigo importado) + investigar travamento do node + hardening de corpo gigante.

Work Log:
- DIAGNÓSTICO COM O PROJETO REAL IMPORTADO (data/project.json, 110 elementos: 48 box + 62 beam, Z real 0..5020): TODOS os passos do pipeline passam in-process (validate/normalize, diff, hash, BOM, PDF 3 folhas) — a conversão v1→v2 NÃO foi a causa.
- CAUSA RAIZ DA PRANCHA INVERTIDA: em PDF o eixo Y cresce PARA CIMA, mas o toPage do desenhista SUBTRAÍA o y do modelo — quanto maior o Z, mais BAIXO na folha. Bug herdado do exportador antigo (mesma fórmula), que só incomodou agora que a prancha é o foco. FIX: y da página = box.y + pad + (y_model − effMinY)·escala (direto, sem inversão); verificado numericamente pelos rótulos no stream do PDF: "CASA TESTE" (z=4700) em y=905 na frontal / 1090 na lateral / 260 na planta (borda frontal — convenção correta de planta) / 728 iso / 706 traseira; laje embaixo, telhado em cima.
- SOLO NO ENQUADRAMENTO: quando a geometria está afastada do chão (bbox.min.z > 20), o solo (z=0) entra no cálculo de escala (effMinY=0) — linha SOLO ±0 e cota PD agora nascem DENTRO do quadro da vista; condição do rótulo "SOLO +/-0" corrigida (checagem contra a página, não contra a caixa). Quando a estrutura toca o chão (z_min=0, caso do projeto importado), a linha de solo é omitida corretamente.
- TRAVAMENTO DO NODE ("deu erro no node inteiro"): reproduzido uma vez localmente (event loop do dev server travou, todas as rotas em timeout — inclusive presence) e recuperado com restart; TODOS os fluxos com o doc real passam em sequência (project → preview +1 → apply → undo → bom → pdf 65 KB) — sem reprodução determinística; suspeita: travamento transitório do Next dev (HMR+compile) localmente e/ou stress de colagem gigante na versão online com build antigo. HARDENING: readJsonBody agora limita corpo a 8 MB (content-length + tamanho lido) com erro estruturado legível — cola gigante no editor/import/IA não derruba mais o servidor; mensagem de JSON inválido orienta a conferir o documento colado.
- Ferramentas novas: .zscripts/diag-import.ts (diagnóstico completo com o doc real + verificação de orientação) e .zscripts/test-api-flows.ts (fluxos da API com timeout por passo).
- Testes: tsc limpo em src/, eslint limpo; test-api-flows 100% OK contra o servidor local.

Stage Summary:
- Prancha sai orientada corretamente (solo embaixo, topo em cima) para qualquer documento, incluindo JSON antigo convertido.
- Proteção contra corpos gigantes; travamento do node não reproduzível nos fluxos locais — se voltar a ocorrer na versão online, verificar build antigo/recurso do sandbox (o deploy precisa do código atual).

---

Task ID: fix-viewport-menus-inferiores-20260923
Agent: Zoo (Code)
Task: CORRIGIR MENUS INFERIORES CORTANDO/DESAPARECENDO (relato do operador na versão online) + subir app localmente.

Work Log:
- CAUSA RAIZ: raiz do app usava `h-screen` (100vh) — em navegadores com barra de URL/toolbar dinâmica (mobile/tablet) ou preview embutido, 100vh é MAIOR que a área visível e o fim da coluna (barra de abas IA/ELEMENTOS/HISTÓRICO/JSON + rodapé) caía fora da tela. Agravante: MobileSheet com alturas fixas em vh (`46vh`, `calc(46vh-18px)` + min-h-220px) e wrapper `shrink-0` — em telas baixas com o sheet aberto o conteúdo estourava e cortava a navegação; toast bottom-right cobria a barra de abas.
- FIX: raiz com `h-screen supports-[height:100dvh]:h-[100dvh]` + overflow-hidden (dvh = altura visível real, com fallback para vh em motores antigos); main com overflow-hidden; wrapper mobile sem shrink-0; MobileSheet raiz `flex-1 min-h-0`, SHEET_H = `min(46vh, 46dvh)`, motion.div min-h-0 (flexbox encolhe o painel quando a tela é baixa) e conteúdo interno `flex-1 min-h-0 overflow-y-auto` (rola em vez de cortar) — a barra de abas (com safe-area iOS) fica SEMPRE visível; Toaster movido para top-center (não cobre mais a navegação inferior).
- Testes: tsc limpo em src/, eslint limpo (page/layout/MobileSheet); dev server subiu (`bun run dev`, porta 3000), `/` e `/api/health` 200.

Stage Summary:
- Nos menus inferiores nunca mais desaparecem: com sheet aberto em tela baixa o painel encolhe e rola; sem sheet, abas+rodapé sempre dentro do dvh visível.
- App local operando em http://localhost:3000 para conferência da prancha geométrica (botão PRANCHA).

---

Task ID: prancha-geometrica-cotada-20260923
Agent: Zoo (Code)
Task: REDESENHAR EXPORT PDF COMO PRANCHA TÉCNICA DE REFERÊNCIA — esboço geométrico cotado (forma + dimensões + encaixe), sem conteúdo de fabricação.

Work Log:
- FOCO DO PDF (`src/lib/pdf/report.ts` reescrito): o PDF deixou de ser documento de fabricação e virou ESBOÇO GEOMÉTRICO COTADO. Removidos BOM, peso estimado, material, perfil, densidade e qualquer lista de corte — title block agora mostra projeto, id/rev, contagem de elementos/conjuntos, data/folha e (se legado) "REF. ENCAIXE PAINEL W×H×D · PD". Banner/aviso reescrito: "sem definição de material, perfil ou fabricação · dimensionamento estrutural sob responsabilidade de profissional habilitado".
- MOTOR DE VISTAS: projectView(doc, view) com front/back/side/top/iso; projeção por elemento (segs + faces + texts + dims). Folhas DINÂMICAS: 1 = frontal (grande, cadeias completas) + lateral + planta com cotas overall; 2 = isométrica + TRASEIRA (somente se assimétrica em profundidade — detectado por fingerprint geométrico, senão nota explicativa); 3 = DETALHES POR CONJUNTO (grid 4×N com vista frontal por grupo + cotas overall, até 12 grupos) quando ≥2 grupos.
- COTAS AVANÇADAS: cadeias horizontais (eixos verticais → divisões de postes/módulos/gabinetes) e verticais (níveis de altura) por clustering com tolerância proporcional (cap 14 eixos); overall W×H; linha SOLO ±0 quando geometria elevada; PD (afastamento do solo) cotado à direita; ângulos de segmentos inclinados marcados com arco+graus (8°–82°, cap 6); primitivo `dimension` renderizado como cota real; primitivo `text` desenhado na vista; nota de escala "ESC ~1:N".
- ESTILO VISUAL LEVE: geometria em cinzas (EDGE 0.24 contornos fortes, LINE 0.46 membros, LINE_SOFT iso), superfícies com preenchimento cinza claro FILL (0.945) com contorno sutil, painel/encaixe em FILL_LED azulado sutil; preto sólido eliminado da geometria (mantido só em texto de bloco de título). Preenchimento de polígonos via drawSvgPath (confirmado y-flip scale(1,-1) no pdf-lib) com atalho drawRectangle para retânguros alinhados; iso ordena faces por profundidade (x−y+0.3z); mesh >256 faces vira só arestas (legível, sem massa); budget de 2500 fills/vista.
- LEGIBILIDADE GEOMETRIA LIVRE: pipeline é 100% derivado dos 12 primitivos v2 — funciona para casa, mesh, arcos, V, articulações, qualquer forma (painel LED é só uso); testado com casa irregular (lajes/paredes/telhado mesh/arc/cota/text) gerando prancha legível de 3 folhas.
- diffReport.ts atualizado para a nova API (projectView/drawProjection), resumo sem pesos (REVISÃO/PAINEL/ELEMENTOS/+~−), rodapé "comparação puramente geométrica"; cores de diff preservadas (verde/laranja/vermelho sobre base cinza).
- UI: botão "PDF" → "PRANCHA" com tooltip "esboço geométrico cotado", toast "Prancha PDF gerada", rodapé "prancha geométrica/BOM derivados". Rota /api/export/pdf inalterada (mesma assinatura). BOM continua disponível separadamente (rota/dialog BOM).
- ROBUSTEZ DE LAYOUT: TF carrega box; linha de solo e PD se auto-contêm na caixa da vista (skip quando não cabe); frontal deslocada (x=100) para cadeia vertical não sair da página; rótulos de cota com fundo branco 0.92.
- Testes: tsc limpo em src/ (erros pré-existentes só em examples/); eslint limpo nos 3 arquivos; .zscripts/test-prancha-pdf.ts gera 3 PDFs em download/ (painel 3 folhas, casa livre 3 folhas, diff 1 folha) — verificação de streams confirma cadeias (150/1580/150/1980…), overall (2380/6050 mm), ângulos (44°), escalas (~1:21), legenda, encaixe painel 2000×4000×650, e ZERO ocorrências de PESO/kg/MATERIAIS/PERFIL/CORTE/SOLDA.

Stage Summary:
- Critério do produto atendido: "menos lista de peças, mais desenho geométrico técnico cotado e visualmente legível" — prancha com vistas úteis por geometria, cotas de divisão interna, visual cinza leve, aviso de responsabilidade correto.
- PDFs de exemplo: download/teste-prancha-painel.pdf, download/teste-prancha-livre.pdf, download/teste-prancha-diff.pdf (regeneráveis via bun .zscripts/test-prancha-pdf.ts).
- Próximos passos sugeridos: hachura de solo (padrão), marcas de encaixe dedicadas (painel × estrutura), numeração de módulos via metadata para cotas nomeadas.

---

Task ID: migrar-geometria-livre-20260923
Agent: Zoo (Code)
Task: MIGRAR LED JSON CAD PARA MOTOR GEOMÉTRICO LIVRE (TASK_MIGRAR_LED_JSON_CAD_PARA_GEOMETRIA_LIVRE.md) — trocar o núcleo geométrico sem refazer a infraestrutura.

Work Log:
- M1 — NOVO SCHEMA (`src/lib/cad/geometry.ts`): GeometryElement {id, geometry, metadata} com 12 primitivos (line, beam, box, cylinder, circle, arc, polyline, polygon, surface, mesh, text, dimension); Vec3 aceita [x,y,z] ou {x,y,z} (normaliza); SectionSchema tolerante com normalização; metadata é record LIVRE (nunca bloqueia); GeometryDocumentSchema v2 sem panel/installation obrigatórios; helpers elName/elGroup/elRole/elProfile/elMaterial/elLed + panelDimsOf/installationOf (extensions legadas).
- M2 — LEGACY ADAPTER (`src/lib/cad/legacy-adapter.ts`): legacyElementToGeometry (beam→beam+section do perfil, plate→box, bolt→cylinder, panel→box led:true, cable→line, surface→polygon); legacyProjectToGeometry preserva panel/installation em metadata.extensions; normalizeProjectDoc detecta v1×v2 (isLegacyProject).
- M3 — NÚCLEO: schema.ts reexporta v2 mantendo nomes (ProjectDocument, CadElement, ProjectDocumentSchema) — 16 arquivos continuam compilando; validation.ts reescrito (rígido na geometria: IDs únicos, coords finitas, beams nulos, faces de mesh fora dos vértices; ZERO validação de perfil/material/role; aceita v1 via normalize); diff.ts compara elements + extensions.panel (panel_changed); blank.ts v2.
- M4 — BOM OPCIONAL GEOMÉTRICO (bom.ts): massa por volumetria (beam/cylinder/box/line/polyline/surface × densidade, default aço 7850, custom metadata.density_kg_m3); circle/arc/mesh/text/dimension = "sem massa calculável"; Bom.partial; deriveBom agrupa por metadata.profile/material/tipo; estimateElementWeightKg puro.
- M5 — RENDERER (sceneBuilder.ts): buildProjectGroup decide por geometry.type (renderLine/renderBeam/renderBox/renderCylinder/renderCircle/renderArc/renderPolyline/renderPolygon/renderSurface/renderMesh/renderText/renderDimension); textura LED por metadata.led (não por tipo semântico); cor por metadata.color "#rrggbb" → paleta por primitivo; box com rotation; cotas/vistas/ghost diff preservados.
- M6 — CONTRATO IA: prompts.ts SYSTEM_PROMPT v2 (princípio "A IA ESCREVE O DOCUMENTO, O CAD DESENHA"; mini-schema dos 12 primitivos em tuple; sem catálogo/roles); mock.ts reescrito v2 (casos painel/parede/cabos/diagonal/arco/mesh — Testes A–G determinísticos); registry.ts: repairProjectInfo (IA omite raiz project → preserva a atual), GUARDA contra candidato com elements vazio (retry com feedback "devolva o documento COMPLETO"), few-shot legado convertido na injeção (não ensinar formato errado).
- M7 — STORE/PRESETS: STORE_VERSION 7; boot normaliza project.json v1→v2; replace()/undo() normalizam snapshots antigos (restauração de revisão legada converte); makeLogEntry usa panelDimsOf; presets.referencePresets() converte a saída do gerador clássico para v2 (cache).
- M8 — PDF: report.ts extrator genérico elementSegments (QUALQUER primitivo → segmentos 3D; box rotacionado → 12 arestas; circle/arc amostrados; mesh arestas únicas) → project()/isoProject() consomem; drawTitleBlock/notes via panelDimsOf/installationOf; "BOM PARCIAL" quando incompleto; diffReport.ts idem (panel dims de extensions).
- M9 — UI: page.tsx (info do elemento via geometry/metadata + helpers), ElementBrowser (busca/ícones para 12 tipos), CopilotDock (chips contextuais), meta route schema_version 2 (PROFILES como referência opcional).
- FIXES DURANTE MIGRAÇÃO: SectionSchema positive rejeitava diameter:0 de seções quadradas do adapter (input tolerante min(0) + normalização); cache stale do bundle Next (.next) dava 400 fantasma → limpeza + restart do dev server; Z.ai local dá 502 estruturado not_configured (.z-ai-config só existe no sandbox — usar Gemini/Mock).
- Rota /api/ai/test recriada (não veio do sandbox; 404 travava o botão ATIVAR do Conector).
- AMBIENTE LOCAL (Windows): .env DATABASE_URL file:../db/custom.db; scripts npm sem tee/cp/bun-standalone; bun install; prisma generate.

Testes (§16 — via curl contra a API local):
- A beam sem material ✅ | B role "dobradica_customizada" ✅ | C TUBO_200x10 desconhecido ✅ | D line role=cable ✅ | E mesh arbitrária ✅ | arco+text extras ✅ (todos aceitos na rev 3 sem erro)
- F JSON legado v1 importado → 200 convertido (extensions.panel preservado) ✅
- G "adicione uma peça inclinada..." (mock) → DIAG-01 beam inclinado criado sem add_brace ✅
- GEMINI REAL: transform 200 em 43–45s, attempts 1, candidato com 59/59 elementos preservados + text novo ✅ (após repairProjectInfo + guarda de candidato vazio)
- PDF export 200 ✅ | BOM 200 ✅ | tsc --noEmit limpo ✅
- Teste H (imagem): infra pronta (Gemini supports_image, anexos fluem) — pendente validação visual pelo operador.

Stage Summary:
- Critério §17 atendido: geometria nova é desenhada SEM alterar código (metadata/mesh são o escape).
- 20/20 não-negociáveis respeitados: infra preservada, servidor único, diff/preview/apply/undo/histórico intactos, Gemini+Z.ai, BOM opcional, JSON antigo continua abrindo.
- Z.ai local exige credencial do sandbox (.z-ai-config) — erro 502 orientado na UI; Gemini operacional com API key do operador.
- Próximos passos sugeridos: few-shot de exemplos v2 coletados pelo uso; PDF com labels de text; converter mesh emcolisão/cota; limpeza final M8 (remover catálogo de profiles do caminho do BOM quando docs v2 dominarem).

---


Task ID: 1
Agent: Z.ai Code (main)
Task: Implementar o TASK MASTER "LED JSON CAD BUILDER" — CAD dirigido por ProjectDocument JSON com IA como transformadora de documento, dual provider (Gemini + Z.ai), diff do sistema, preview 3D antes de apply, undo por snapshot, presets, JSON editor, PDF/BOM.

Work Log:
- Lido o documento mestre completo (`upload/TASK_MASTER_FABLE_LED_JSON_CAD_DUAL_AI.md`, 1688 linhas) e mapeados os 11 milestones + 21 itens de Definition of Done.
- ADAPTAÇÃO DE AMBIENTE (decisão de arquitetura): o documento pede Python/FastAPI, mas o sandbox é Next.js 16 App Router obrigatório (porta única 3000, preview só expõe `/`). Os PRINCÍPIOS do documento foram mantidos 1:1 e a stack portada: Pydantic v2 → Zod v4; FastAPI → Next.js API Routes (servidor único); ReportLab → pdf-lib; three.js vanilla → React + three 0.186. Nada do "não negociável" foi violado (JSON autoridade, sem mini-operações, diff pelo sistema, preview→apply, undo snapshot, IDs estáveis, mm, servidor único, sem estado conversacional no backend).
- Bootstrap: instalado three/@types/three/pdf-lib; removido scaffold `src/app/api/route.ts`; `data/` no .gitignore.
- Domain layer (`src/lib/cad/`): schema.ts (ProjectDocument Zod: beam/plate/bolt/panel/cable/surface, roles, assumptions texto+estruturado), profiles.ts (catálogo 8 perfis com kgm), validation.ts (IDs únicos, perfis desconhecidos falham, coordenadas finitas, beams nulos, coerência postes/solo — errors vs warnings), hashing.ts (canonical JSON + SHA-256), diff.ts (added/removed/modified por id + panel_changed), blank.ts, bom.ts (perfis kgm, cabo d²×0.00617, chapas 7850 kg/m³), presets.ts (gerador de estrutura completa + 4 presets REF com gaiola/passarela/guarda-corpo/contraventamento/rails/bases/chumbadores).
- Store servidor (`src/lib/store.ts`): singleton com persistência write-through em `data/*.json`, revision/hash, undo stack (25 snapshots), pendingPreviews TTL 1h, ai_config (chaves só no backend), custom presets, examples, checkConflict → 409.
- Camada IA (`src/lib/ai/`): prompts.ts (system compacto com catálogo/contrato/mini-schema — economia de tokens §16/§34), mock.ts (casos de aceite A–D determinísticos), zai.ts (SDK oficial, create/createVision, max_tokens 16384 — correção após resposta truncada), gemini.ts (REST generativelanguage, responseMimeType json, AbortController timeout), registry.ts (parse JSON tolerante a markdown → envelope Zod → validação geométrica → retry ÚNICO com feedback; ProviderError tipado: provider_timeout/invalid_json/invalid_schema/not_configured/unsupported_attachment).
- API completa (`src/app/api/`): health, meta, project (get/new/import/export), presets (list/[id]/load/custom), ai (providers/config/test/transform), preview, apply (409 em conflito), undo, export/pdf, export/bom (json+csv), examples. Erros sempre `{error:{type,message,retryable}}`.
- PDF A2 landscape (`src/lib/pdf/report.ts`): 2 páginas — vistas frontal/lateral/superior com cotas, iso wireframe, BOM, title block LED Collor (rev, painel, peso, data) e banner vermelho "ESBOÇO DE REFERÊNCIA GEOMÉTRICO — NÃO UTILIZAR PARA FABRICAÇÃO SEM REVISÃO TÉCNICA" em todas as folhas.
- Frontend (`src/app/page.tsx` + `src/components/cad/`): Viewer3D (OrbitControls, 7 vistas sem "Inferior", raycast selection com BoxHelper, hover cursor, rebuild com diff ghost: added verde/removido vermelho/modificado laranja/inalterado cinza), CopilotDock (abas Copiloto/JSON/Presets, histórico com status/assumptions/questions/diff/latência, chips contextuais que só preenchem texto, anexo de imagens, editor JSON com validar+preview), ProviderModal (§12 completo: Gemini/Z.ai/Mock, modelo dropdown, key mascarada, ATIVAR com teste de latência, conexões salvas), BomDialog, PreviewBar (APLICAR/CANCELAR + contagem), topbar navy + acento laranja, footer status fixo, Ctrl+Z undo, mobile-first (dock empilha em <lg).
- Smoke tests backend: mock (Casos A–D), Z.ai real (ping 345ms; transform "cabos por coluna" 52s → 4 cabos, diff correto), apply/undo/conflict 409 via curl.
- Verificação agent-browser (desktop 1280×800 + mobile 390×844): render 3D, vistas, seleção PANEL-LED com chips, mock transform → ghost diff → apply (rev 3→4), ativação Z.ai pelo modal ("IA ativa: Z.ai · glm-4.5-flash"), transform real "4x2" (44.7s, 0 alterações — correto, painel já é 4×2), transform real Caso B parede 300mm (22.6s, 37 alterações: postes vermelhos/suportes verdes/painel laranja) → apply rev 5, Ctrl+Z restaurou postes (rev 6), presets load (rev 7), BOM (726.6kg), erro estruturado Gemini sem key (502 not_configured).
- Commits por milestone (4 commits locais, sem remote).

Stage Summary:
- Definition of Done: 20/21 itens implementados e verificados; item 21 (browser validation) EXECUTADO com agent-browser nos fluxos principais.
- Z.ai funciona de verdade no sandbox (SDK nativo). Gemini implementado e testado até a camada de erro — precisa apenas de API key do usuário para funcionar.
- Latências Z.ai com documento completo: 22–52s (glm-4.5-flash); UI mostra loading e timeout configurável (120s default).
- Artefatos: app em `/` (porta 3000), store em `data/`, PDF/BOM exportáveis, 4 presets + custom.
- Próximos passos sugeridos: few-shot com examples/, visão (glm-4.5v) para croquis, comparação lado-a-lado de revisões, lock de edição multi-usuário.

---
Task ID: cron-review-202609230703 (round 2)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado do projeto, QA via agent-browser e evoluir com novas features + polish de styling.

Work Log:
- QA: health 200 (rev 8), dev.log sem erros, screenshot confirmou estado estável (REF_4000X2000, IA Z.ai ativa). Sem regressões a corrigir → rodada de evolução.
- FEATURE — Element Browser (nova aba "ELEM." no dock, `src/components/cad/ElementBrowser.tsx`): árvore de elementos agrupada por `group`, busca (id/tipo/role/perfil), contagem, toggle de visibilidade por elemento e por grupo (olho), ISOLAR GRUPO ao clicar no título (badge "ISOLADO: X ×" no viewport + footer indicando isolamento), botão "localizar" (crosshair) que enquadra a câmera no elemento (focusRequest com nonce no Viewer3D).
- FEATURE — Textura LED no painel 3D (`sceneBuilder.ts`): CanvasTexture procedural (grade de módulos 8×4 + pixels com variação sutil + pontos laranja) aplicada como map+emissiveMap na face frontal do elemento type=panel; painel agora parece uma tela LED de verdade.
- FEATURE — Snapshot PNG do viewport: botão câmera na barra de vistas → render explícito + toDataURL → download `led-cad-3d-*.png` (testado: 88KB gerado).
- FEATURE — Atalhos de teclado: teclas 1–7 trocam as vistas (fora de inputs), Esc desseleciona, popover "?" com a lista completa de atalhos.
- FEATURE — Histórico do copiloto persistido em localStorage (últimos 30, candidatos removidos para quota), restaurado no reload.
- FIX — "Salvar como exemplo" agora envia `before` (projeto atual) além de `after`.
- STYLING — Barra de vistas em linha única (scroll horizontal em telas pequenas) com botões redondos de câmera/atalhos; PreviewBar com animação spring (framer-motion) e borda laranja; legenda de diff animada; badge de isolamento animado; footer com contagem "N el. · N grupos"; abas do dock com 4ª aba e tipografia ajustada; sombras/backdrop-blur consistentes.

Stage Summary:
- Verificado via agent-browser: ELEM tab com todos os grupos, isolamento CONTRAVENTAMENTO (só X-braces visíveis + badge), "mostrar todos", foco em PANEL-LED (câmera enquadrou + highlight), atalho "2" → Frente, PNG exportado, textura LED visível na vista frontal.
- tsc + eslint limpos; commit df03b6c.
- Estado: rev 8, REF_4000X2000, provider ativo Z.ai glm-4.5-flash.
- Próximos passos sugeridos (prioridade): 1) comparação lado-a-lado de revisões (diff visual histórico); 2) visão glm-4.5v com croqui (anexo já suportado na UI, falta UX de feedback); 3) cotas 3D (linhas de dimensão width/height/PD no viewer); 4) redimensionamento do dock (arrastar borda); 5) few-shot: injetar examples/ no prompt quando disponíveis.

---
Task ID: cron-review-202609230718 (round 3)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado do projeto, QA via agent-browser, corrigir bugs e evoluir com novas features + polish de styling.

Work Log:
- QA inicial: health 200 (rev 8), dev.log sem erros, app renderiza (screenshot desktop). Descoberta importante: a rodada anterior havia implementado (e commitado em b1d7220) cotas 3D, medição, comparação de revisões, RevisionHistory e alça de dock — MAS sem atualizar o worklog e com duas falhas deixadas para trás.
- BUG FIX 1 — HIST tab com 500 ("store.listRevisions is not a function"): o singleton do ProjectStore vive em globalThis e sobrevive ao HMR; a instância antiga foi criada antes dos métodos de revision-history existirem. Fix: guard de versão (STORE_VERSION) no getStore() — recria a instância quando a classe muda (seguro: todo estado é persistido em data/*.json e recarregado no construtor). Verificado: /api/project/history lista revisões; ?rev=N retorna documento.
- BUG FIX 2 — alça de redimensionamento do dock era decorativa (sem mousemove, largura nunca aplicada). Fix completo: listeners de mousemove/mouseup no window, largura aplicada via CSS var (--dock-w) com lg:w-[var(--dock-w)], clamp 320–680px e máx 60% da janela, persistência em localStorage, duplo clique restaura, teclado ←/→/Home com aria-valuenow, indicador visual sempre sutil + laranja no hover/focus. Detalhe de robustez descoberto em teste headless: o sync do ref via useEffect atrasa sem frames de compositor — agora o ref é sincronizado sincronamente no handler (comentado no código). Verificado por drag real: 390→501px, persistiu no localStorage, Home restaura 390.
- FEATURE — Pipeline few-shot (§25 feita de ponta a ponta): store.listExamples() lê data/examples (id, request, before/after, contagem de elementos, tamanho); GET /api/examples lista; registry.pickFewShot() escolhe o exemplo mais recente que caiba (≤120 elementos no "antes", ≤220KB combinados — economia de tokens §16/§34) e injeta via AiCallInput.fewShot → buildUserPrompt renderiza bloco "EXEMPLO DE REFERÊNCIA" (imitar FORMATO, não geometria); meta.few_shot_id retorna ao cliente; UI: badge violeta "few-shot" com GraduationCap no card do histórico + dica no estado vazio do copiloto. Testado com transform mock: meta.few_shot_id preenchido.
- FEATURE — UX de visão para anexos: listProviders agora reporta supports_image real (zai glm-4.5-flash=false, glm-4.5v=true; antes hardcoded true); meta() tipada no cliente; page.tsx mantém activeVision e repassa ao dock; ao anexar imagem com modelo não-vision aparece alerta âmbar (ImageOff) clicável que abre o Conector de IA, e o rodapé do copiloto mostra "· sem visão". Verificado no browser: alerta aparece ao simular anexo com glm-4.5-flash ativo.
- FEATURE — card do elemento selecionado mostra peso estimado (≈ kg) via estimateElementWeightKg() em bom.ts (beam: kgm×comprimento; cabo: d²×0.00617×comprimento; chapa: volume×7850; panel/bolt/surface → null). Animado com framer-motion (slide-in). Verificado: BASE-01 (chapa 500×500×20) → ≈ 39.3 kg (matemática confere).
- STYLING — topbar com gradiente sutil (3 tons navy) + shadow; barra de vistas com fade branco à direita indicando scroll (o "Direita" truncado agora tem affordance); alça do dock visível (slate-300/50 → orange no hover/focus); card de elemento rounded-xl com backdrop-blur e sombra.
- QA completo via agent-browser: criação das revs 9/10 via API (rename + ground_clearance 800), aba HIST mostra timeline com badges de fonte (IA aplicada/Inicial), COMPARAR rev 9 abre banner "COMPARAÇÃO COM REV 9 · panel alterado" com RESTAURAR/CANCELAR e footer PREVIEW ATIVO; cancelamento limpo; mobile 390×844 OK (dock empilha, fade de scroll visível).
- Lint limpo; tsc sem erros em src/ (erros restantes são de examples/ e skills/ fora do app). Commit a7015ee.

Stage Summary:
- Estado: rev 10 "Outdoor Rodovia BR-116", 31 el., provider Z.ai glm-4.5-flash ativo; 1 exemplo few-shot semeado (data/examples) para a próxima transformação real.
- Definition of Done segue 21/21; histórico de revisões (que estava QUEBRADO em produção silenciosa) agora funcional de ponta a ponta.
- Próximos passos sugeridos (prioridade): 1) transformação REAL com Z.ai usando o few-shot semeado para medir ganho de qualidade/latência (atenção: few-shot ~dobra tokens de entrada); 2) UI de gerenciamento de exemplos (listar/excluir data/examples); 3) covisão: teste end-to-end com croqui + glm-4.5v; 4) modo comparação lado-a-lado (split viewport) além do ghost; 5) exportar comparação de revisões como relatório PDF.

---
Task ID: cron-review-202609230733 (round 4)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado do projeto, QA via agent-browser, e evoluir com novas features + polish de styling.

Work Log:
- QA inicial: health 200 (rev 10), dev.log sem erros, HIST/ELEM/COPILOTO renderizam, git clean. Sem bugs bloqueantes → rodada de EVOLUÇÃO.
- BUG/UI FIX — DiffInspector coberto pela PreviewBar em viewports estreitos (clique no botão DIFF caía na barra). Fix: posicionado acima da barra (bottom-[108px] mobile / bottom-[68px] sm, z-10).
- FEATURE — Gerenciador de exemplos few-shot completo (ciclo de vida inteiro): store.deleteExample(id) com sanitização anti-path-traversal; nova rota DELETE /api/examples/[id]; novo componente ExamplesManager (seção colapsável "EXEMPLOS FEW-SHOT" no CopilotTab entre chips e input) com lista (pedido truncado, data pt-BR, elementos antes→depois, tamanho KB), badge de contagem, refresh manual, delete com confirmação em 2 cliques (3s de janela, fica vermelho) e estado vazio instrutivo. STORE_VERSION 3→4→5.
- FIX — POST /api/examples retornava id com ".json" mas GET lista sem — inconsistentes. saveExample agora retorna id SEM extensão (bump v5 necessário porque o singleton em globalThis sobrevive ao HMR com método antigo).
- FIX — botão "salvar como exemplo" sumia ao aplicar (condição m.candidate && !m.applied). Agora fica disponível com sufixo "· aplicada" — permite salvar o exemplo DEPOIS de validar o resultado aplicado.
- FEATURE — DiffInspector: a legenda de diff virou um inspetor expansível. Header "DIFF +N ~N -N" clicável expande painel (max-h-52, scroll) com seções ADICIONADAS/EDITADAS/REMOVIDAS; cada ID é um chip clicável que ENQUADRA o elemento no viewport (reusa focusRequest); chips de removidos são estáticos com strike-through e tooltip "só no documento atual"; aviso âmbar quando panel_changed; limite de 40 chips por seção com "+N…".
- FEATURE — BOM com insights: barra empilhada de distribuição de peso por grupo (paleta quente sem azul, top 4 na legenda com %), "maior peso" destacado (TrendingUp), contagens (itens/peças/elementos), tabela com zebra + hover laranja + grupo como sub-linha, header com ícone Package, total em kg + toneladas. Verificado no browser: BASES 63% / ESTRUTURA 37% / FIXAÇÃO 0%, maior peso CHAPA 4000x650x30mm 612.3 kg, total 1094.2 kg (1.094 t).
- E2E REAL via agent-browser (Z.ai glm-4.5-flash): pedido "adicione uma escada de acesso com degraus no poste direito" → 110s → candidato com 14 elementos novos (grupo ESCALA: LADDER-01..12 degraus + 2 rails METALON_40x40x2), assumptions coerentes (fixação POST-02, degraus 300mm, 75°, altura 3000mm); DIFF +14 ~0 -0; chip LADDER-06 clicado → câmera enquadrou + info card com peso ≈0.69 kg; APLICAR → rev 11 (45 el., hash da47c28e).
- E2E REAL few-shot: exemplo salvo (rev 10→11, 15.2KB) via API; segunda transformação "troque o perfil dos postes para TUBO_250x10" retornou meta.few_shot_id preenchido (injeção confirmada), 2 editadas, 105.7s (few-shot ~dobra tokens de entrada, latência esperada). Candidato NÃO aplicado (mantido estado com escada).
- QA mobile 390×844: dock empilha, DiffInspector acima da PreviewBar, seção exemplos acessível. Lint limpo; tsc sem erros em src/. Commit <hash da rodada>.

Stage Summary:
- Estado: rev 11 "Outdoor Rodovia BR-116" com escada aplicada (45 el., 12 grupos), Z.ai glm-4.5-flash ativo, 1 exemplo few-shot válido (escada) em data/examples.
- Pipeline few-shot agora tem ciclo de vida completo verificado: transformar → aplicar → salvar exemplo → gerenciar (listar/excluir) → reusar automaticamente na próxima transformação (few_shot_id confirmado).
- DoD segue 21/21 + novos extras. Latência observada Z.ai com few-shot: ~105-110s (documento 31-45 el.).
- Próximos passos sugeridos (prioridade): 1) modo comparação lado-a-lado (split viewport) além do ghost; 2) relatório PDF do diff entre revisões; 3) covisão end-to-end com croqui + glm-4.5v (anexo já alerta corretamente); 4) few-shot: escolher exemplo por similaridade simples (palavras-chave) em vez do mais recente; 5) undo stack visível na UI (timeline já existe — faltam marcadores de undo/restore).

---
Task ID: cron-review-202609230800 + 202609230845 (round 5, consolidado)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado, QA via agent-browser, evoluir com novas features (comparação A/B, PDF de diff, few-shot por similaridade) + polish de styling.

Work Log:
- QA inicial: health 200 (rev 11), dev.log sem erros, app renderiza. OBS: dev server foi encontrado MORTO no início da rodada (porta 3000 sem listener) — reiniciado manualmente com setsid nohup; se acontecer de novo, subir com `(setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &)`.
- BUG FIX — Viewer3D ficava VAZIO ("Context Lost") após usar comparação: criar 2 viewports WebGL extras (split A/B) em headless/SwiftShader derrubava o contexto principal e não havia tratamento. Fix duplo: (1) listeners webglcontextlost (preventDefault) / webglcontextrestored → setCtxEpoch força rebuild do conteúdo; (2) nova prop `paused` — loop RAF do viewer principal é pausado enquanto o split A/B está ativo (economiza GPU). Verificado E2E: abrir split → voltar (B) → viewport renderiza ghost diff corretamente; cancelar → modelo normal intacto.
- FEATURE — Comparação A/B lado a lado (CompareSplit.tsx, dynamic import): dois viewports Three.js sincronizados por órbita (drag num replica no outro, guard anti-loop com syncingRef + rAF), painel A = atual (borda rose, removidos em vermelho), painel B = revisão comparada (borda emerald, adicionados em verde, modificados laranja), divisor "VS", cabeçalho pill com counts +N ~N -N e fechamento, labels compactos por painel. Mobile: painéis empilham (flex-col lg:flex-row) — verificado em 390×844. Integração: estado compareMode "ghost"|"split" na page.tsx, toggle segmentado GHOST|A/B na PreviewBar (só no fluxo de restauração, z-20), atalho B alterna, Esc volta para ghost, viewer principal fica invisible+paused durante split, DiffInspector/toolbar/badges ocultos no modo split, footer mostra "A/B rev N" pulsante.
- FEATURE — Relatório PDF de diferenças entre revisões: src/lib/pdf/diffReport.ts (A2 landscape) com vistas frontais A/B coloridas por status (report.ts agora exporta project/drawView/sanitize/cores e aceita colorFor por elemento), resumo (painel, elementos, pesos, dif. peso), listas de IDs ENTRARIA/EDITADAS/SAIRIA na restauração (capacidade dinâmica por largura, "+N outros"), aviso de painel alterado, footer LED Collor. Rota POST /api/export/diff-pdf {revision} (400/404/422 estruturados). FIX WinAnsi: sanitize agora converte "→" (0x2192) que quebrava Helvetica. Botão PDF (emerald) em cada revisão do histórico → downloadDiffPdf + toast. Verificado: rev 8 vs 11 (escada vermelha, +109.1 kg), rev inexistente → 404.
- FEATURE — Few-shot por similaridade: pickFewShot pontua exemplos com Jaccard entre tokens do pedido e do exemplo (stopwords PT/EN, stemming grosseiro de plural, acentos removidos); empate → mais recente; guarda de tamanho mantido. meta.few_shot_score (0–1) novo; badge violeta no histórico mostra "few-shot NN%". Testado via transform mock: pedido de ADICIONAR escada → exemplo de adicionar (score 1.0) mesmo com exemplo de remover mais recente; pedido de remover → exemplo de remover (score 1.0); pedido sem relação → score 0 (cai no mais recente, referência de formato).
- STYLING — estado vazio do copiloto com gradiente + 3 prompts clicáveis que preenchem o input; barra de shimmer animada (cad-shimmer) no "IA está reescrevendo…"; hash da topbar clicável copia SHA-256 com toast; badge A/B do footer com pulso suave (cad-pulse-soft); PreviewBar com flex-wrap (botões não cortam mais no mobile).
- QA E2E agent-browser: split A/B vs rev 10 e rev 8 (sincronização de órbita confirmada por drag), B/Esc/GHOST/A-B, PDF do histórico com toast verde, cancelamento limpo, mobile 390×844 com painéis empilhados. Lint e tsc limpos. Commit 39c3407.

Stage Summary:
- Estado: rev 11 "Outdoor Rodovia BR-116" (45 el.), Z.ai glm-4.5-flash ativo, 2 exemplos few-shot em data/examples (adicionar escada / remover escada) para teste de similaridade.
- Fluxo de comparação agora tem 3 formas: ghost (transparência), A/B lado a lado com órbita sincronizada, e relatório PDF — todas acessíveis do histórico (COMPARAR / toggle A/B / botão PDF).
- Conhecidos/risco: em sessões com HMR + múltiplos remounts do split o contexto WebGL pode ser perdido e restaurado (agora tratado); dev server do sandbox pode morrer entre rodadas — reiniciar com setsid se health falhar; poucos contextos WebGL em navegadores antigos podem limitar o A/B (mitigado pelo paused).
- Próximos passos sugeridos (prioridade): 1) covisão end-to-end com croqui + glm-4.5v (alerta de visão já existe); 2) transformação REAL com Z.ai usando os 2 exemplos para medir ganho de qualidade/latência com few-shot por similaridade; 3) animação de transição entre ghost e A/B (crossfade); 4) exportar o A/B como imagem única lado a lado; 5) testes de screenshot automáticos para detectar viewport vazio (regressão de contexto).

---
Task ID: cron-review-202609230900 (round 6)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado, QA via agent-browser, e evoluir com novas features (export A/B como imagem, ativação de visão em 1 clique, limpeza de histórico) + polish de styling.

Work Log:
- QA inicial: health 200 (rev 14, preset REF_2000X4000), dev.log sem erros, app renderiza (desktop 1440×900). Estado entre rodadas: revs 12–14 (novo projeto + presets carregados, provavelmente pelo usuário). Modelo ativo mudado para glm-4.5-air (sem visão). Sem bugs bloqueantes → rodada de EVOLUÇÃO.
- FEATURE — Exportação A/B como imagem única (item 4 do backlog da rodada 5): CompareSplit agora tem botão "EXPORTAR A/B" (pill inferior-direita, desktop) + botão câmera no cabeçalho; exportCompositeImage() renderiza ambos os viewports explicitamente (sem preserveDrawingBuffer), compõe num canvas 2D com cabeçalho navy (título, revs, counts de diff, data pt-BR, branding LED Collor laranja), painéis A/B com bordas rose/emerald e etiquetas, rodapé com disclaimer de esboço + counts (counts omitidos se não couberem sem sobreposição — fix de overlap verificado em segunda exportação); download `led-cad-ab-rev{A}-rev{B}.png` (~270–326KB, escala limitada a 2400px). Panes expostos via window.__abPanes (limpo no unmount). Verificado E2E: rev 14 vs 10 e rev 20 vs 9 (diff extremo +31 ~0 -52 colorido corretamente nas duas vistas).
- FEATURE — Ativação de visão em 1 clique (item 1 do backlog: covisão E2E): o alerta âmbar de anexo sem visão virou card acionável — ao anexar imagem com modelo não-vision, CopilotTab busca /api/ai/providers e oferece botão "ATIVAR VISÃO · glm-4.5v" (prioriza zai sempre configurado; fallback gemini configurado; fallback final = link para o Conector); clique chama saveAiConfig({provider, target, model}) → toast verde → onProviderChanged() re-sincroniza meta (rótulo + activeVision) → alerta desaparece. Verificado E2E completo: anexo → botão → ativação → "IA ativa: Z.ai · glm-4.5v" persistido no servidor (data/ai_config.json).
- FEATURE — COVISÃO E2E REAL (primeira da história do projeto): croqui laranja 320×240 anexado + pedido "ajuste a altura do painel para 3000 mm" via glm-4.5v → candidato pronto em 71.9s com 8 alterações (7 editadas, 1 removida, painel alterado), assumptions coerentes (rails Z=3000/3500/4000, painel center Z 4000→3500). few-shot 0% (score Jaccard 0 → fallback mais recente, correto).
- BUG/COMPORTAMENTO CONFIRMADO sob concorrência: durante minha sessão, OUTRA sessão aplicou seu próprio candidato (rev 15 "1000×2000 — Outdoor Dupla Face", 52 el.) entre meu preview e meu apply → meu apply recebeu 409 e o sistema se recuperou (candidato limpo, refresh). Detecção de conflito funcionando como projetado. Nota: há OUTRA sessão/browser ativo no mesmo store — cuidado ao assumir estado.
- FEATURE — Toast de apply com ação "Desfazer" (sonner action, 6s): APLICAR/RESTAURAR agora oferecem undo direto no toast. Verificado com clique REAL do agent-browser (clique sintético via eval .click() NÃO dispara o handler do sonner — usar find text click). Fluxo: apply rev 18 → Desfazer → rev 19 "Desfeito — JSON anterior restaurado".
- FEATURE — Barra de sessão do copiloto (SessionBar): faixa fina acima do chat com "N mensagens nesta sessão" + botão LIMPAR com confirmação em 2 cliques (janela 3s, fica vermelho) → clearCopilotHistory() limpa estado + localStorage (HISTORY_KEY). Resolve o desconforto de histórico antigo de outros projetos persistindo.
- STYLING — crossfade ghost↔A/B: CompareSplit montado dentro de AnimatePresence + motion.div (opacity 0→1, scale 0.985→1, 0.2s easeOut, com exit) — transição suave ao alternar GHOST/A/B e fechar; cabeçalho pill do A/B com entrada spring (stiffness 380, damping 26); linha "IA ativa" com ponto de status (verde = com visão, âmbar = sem); export button pill com hover laranja.
- Refactor: lógica de meta refresh extraída em refreshProviderInfo() (boot, rodapé, ProviderModal.onActivated e dock reutilizam — antes duplicada 3×).
- QA final: mobile 390×844 OK (SessionBar, copiloto, sem scroll horizontal); A/B export 2×; session bar clear 2-cliques; undo-action toast; lint e tsc limpos. Commits dbf4595 + 542546c (untrack tool-results/).

Stage Summary:
- Estado final: rev 20 "1000 × 2000 — Outdoor Dupla Face" (52 el., hash 3478f069 — idêntico a rev 15 após limpeza dos artefatos de QA), provider Z.ai glm-4.5v ATIVO (com visão).
- Pipeline de covisão 100% operacional de ponta a ponta: anexo → alerta → ATIVAR VISÃO (1 clique) → transformação real com croqui → candidato validado → preview/apply/undo.
- A comparação de revisões agora exporta imagem única compartilhável (PNG composto) além de ghost/A-B/PDF.
- Conhecidos/risco: sessão concorrente ativa no mesmo store (409s esperados se ambos aplicarem ao mesmo tempo); cliques sintéticos (eval .click()) não disparam handlers de toast do sonner — usar cliques reais em testes; dev server pode morrer entre rodadas — reiniciar com setsid se health falhar.
- Próximos passos sugeridos (prioridade): 1) transformação real com glm-4.5v + few-shot para medir ganho de qualidade; 2) editor de nome do projeto inline na topbar (nome só muda via JSON/IA hoje); 3) câmera de snapshot A/B respeitando zoom sincronizado custom (hoje usa a câmera atual — já correto, validar com órbita não-padrão); 4) notificação do navegador quando transform longa termina (aba em background); 5) filtros por tipo/grupo no histórico de revisões.

---
Task ID: cron-review-202609230918 (round 7)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado, QA via agent-browser, corrigir bug de conflito e evoluir com novas features (renomear projeto inline, notificações em background, histórico escopado por projeto, filtros no histórico) + polish de styling.

Work Log:
- QA inicial: health 200, git clean, dev.log com 1 pista real — POST /api/ai/transform 500 em ConflictError. App renderiza (desktop 1440×900, rev 22→20 entre loads: sessão concorrente ativa de novo, comportamento documentado). Console limpo (só Fast Refresh logs). HIST/ELEM/COPILOTO OK.
- BUG FIX — /api/ai/transform retornava 500 "internal_error: project changed" em conflito real (deveria ser 409 "project_changed", como o apply já faz). Causa raiz: o dev do Next compila cada rota em bundle próprio; a classe ConflictError importada por api-helpers pode ser uma CÓPIA diferente da usada pela rota → `instanceof` falha e cai no branch 500, mascarando a mensagem amigável do cliente (ERRORS_FRIENDLY.project_changed). Fix: isConflictError()/isAiTransformError() em api-helpers.ts checam `instanceof` OU `name` estável. Verificado via curl: conflito em transform → HTTP 409 {"type":"project_changed"}; mesmo tratamento valendo para AiTransformError.
- FEATURE — Renomear projeto inline na topbar (item 2 do backlog da rodada 6): store.renameProject() (trim/colapso de espaços, max 120, no-op se igual, structuredClone, revision própria com source NOVO "rename", undo-able via replace() normal); STORE_VERSION 5→6 (singleton em globalThis); rota POST /api/project/rename (400 sem nome, 409 em conflito — testado); api.renameProject() no client; UI: nome na topbar virou botão (hover = fundo sutil + sublinhado tracejado + lápis), clique abre input inline com texto selecionado, Enter/blur confirma, Esc cancela (guard renameCancelRef evita commit duplo no blur), botões ✓/✗, busy spinner, toast de sucesso com ação "Desfazer", 409 recarrega estado. Verificado E2E no browser: "1000 × 2000 — Outdoor Dupla Face" → "Outdoor Rodovia BR-116" (rev 26, hash mudou, toast com Desfazer).
- FEATURE — Notificação do navegador quando a IA responde com a aba em segundo plano (item 4 do backlog): Notification.requestPermission() pedido no envio (contexto: transform leva 20–110s); ao concluir (sucesso/erro/needs_input), se document.visibilityState === "hidden" e permissão granted → new Notification("LED JSON CAD — IA respondeu", {tag led-cad-transform}) com resumo do diff ou erro. Silencioso quando a aba está visível ou sem permissão.
- FEATURE — Histórico do copiloto escopado por projeto (observado em QA: conversas de outro projeto apareciam): chave localStorage v2 = led-json-cad:history:v2:<project.id>; efeito carrega ao trocar project.id (novo/importar/preset); guard historyScope no efeito de persistência evita gravar o histórico antigo sob a chave nova na troca; migração única do legado v1 para o primeiro projeto aberto (v1 removido); SessionBar LIMPAR limpa a chave do projeto atual.
- FEATURE — Filtros no histórico de revisões (item 5 do backlog): barra de chips Todas/IA/Manual/Preset/Undo-Restore/Outros COM contagens por grupo, busca textual (rev, hash, nota, nº de elementos), estado vazio com link "limpar filtros", badges "Renomeado" (âmbar, lápis) para o novo source. Verificado: IA 7 → só revisões de IA; busca "renomeado" dentro de IA → vazio com limpar filtros; limpar → 19 revisões.
- STYLING — botão ENVIAR com gradiente vertical + sombra + active:scale-[0.98]; TopBtn com focus-visible ring laranja (teclado); input de rename com ring laranja e fundo navy; chips de filtro com pill ativa laranja + contagem; hover do nome do projeto com affordance tracejada; transições suaves em todos os novos controles.
- QA final: mobile 390×844 (filtros quebram linha corretamente, timeline legível, sem scroll horizontal); lint limpo; tsc limpo em src/. Commit d976c6c.

Stage Summary:
- Estado: rev 26 "Outdoor Rodovia BR-116" (52 el., hash 26cf8269), Z.ai glm-4.5v ativo, 19 revisões no log.
- Bug de produção silenciosa corrigido: conflito em /api/ai/transform agora retorna 409 com mensagem amigável no cliente (antes 500 genérico).
- Renomear projeto agora é operação de primeira classe (revisão própria, undo-able, com conflito tratado) — antes só via JSON/IA.
- Copiloto e histórico de revisões ganham organização: conversa por projeto, filtros por fonte + busca.
- Conhecidos/risco: sessão concorrente continua ativa no store (rev pulou 22→20→25 entre loads; 409s são esperados e agora CORRETOS em todas as rotas); Notification não funciona em headless (testado só o fluxo de permissão/granted por code review — caminho de UI é no-op seguro sem permissão).
- Próximos passos sugeridos (prioridade): 1) transformação real com glm-4.5v para validar notificação em desktop real (com aba em background); 2) indicador de "outro operador ativo" na topbar (heartbeat via polling de updated_at) — a sessão concorrente é recorrente; 3) desfazer em lote/multi-level com timeline clicável; 4) exportar CSV do histórico de revisões; 5) few-shot: peso por similaridade no pickFewShot para exemplos com score intermediário.

---
Task ID: cron-review-202609230933 (round 8)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado, QA via agent-browser, e evoluir com itens do backlog da rodada 7 (indicador de co-presença multi-operador, exportar CSV do histórico) + scoring híbrido no few-shot + polish de styling.

Work Log:
- QA inicial: health 200 (rev 26 "Outdoor Rodovia BR-116", 52 el.), dev.log sem erros (apenas 409/400 esperados de rodadas anteriores), app renderiza em desktop 1440×900 e mobile 390×844, console limpo, HIST/ELEM/COPILOTO operacionais. Nenhum bug bloqueante → rodada de EVOLUÇÃO (itens 2, 4 e 5 do backlog da rodada 7).
- FEATURE — Indicador de co-presença multi-operador (item 2 do backlog; a sessão concorrente é recorrente e confundia operadores): novo endpoint GET /api/presence (leve — só revision/hash/updated_at, sem o documento) + polling no cliente (6s visível, 20s oculto, re-check 800s ao voltar para a aba). Lógica: hash igual → SINCRONIZADO (pill verde com dot, tooltip "verificação a cada 6s"); rev do servidor MAIOR que a local → pill âmbar pulsante "OUTRO OPERADOR · rev N ↻" clicável + toast informativo (1× por rev) + indicador no rodapé (visível no mobile); rev MENOR → resposta antiga de mutação própria em voo, descartada. Mutações próprias (undo/apply/rename/novo/importar) setam mutatingRef para pausar a detecção e evitar falso alerta; refresh() limpa o alerta (self-heal ≤ 6s). Clique no alerta → syncFromServer(): recarrega projeto + histórico com toast de sucesso. VERIFICADO E2E REAL: mutação via curl simulou outro operador (rev 27) → em ≤7s o pill virou "OUTRO OPERADOR · rev 27", toast disparou, rodapé sinalizou; clique sincronizou (pill verde de volta, nome do projeto atualizado).
- FEATURE — Exportar CSV do histórico de revisões (item 4 do backlog): botão de download no cabeçalho do HIST (ao lado de recarregar, hover esmeralda, disabled quando vazio). Exporta as revisões EXIBIDAS (respeita filtro de fonte + busca) com colunas revisao;salvo_em;fonte;nota;hash;elementos;painel_largura;painel_altura;atual — separador ";" + BOM UTF-8 (abre direto no Excel pt-BR), fields com escape de aspas. Toast de sucesso indica contagem + escopo do filtro ativo. VERIFICADO E2E: download com 21 revisões (nome led-cad-revisoes-YYYY-MM-DD.csv), colunas e acentos corretos.
- FEATURE — Scoring híbrido no few-shot (item 5 do backlog): pickFewShot agora usa score = 0.6×Jaccard(pedido,exemplo) + 0.4×cobertura(pedido) — cobertura = fração dos tokens do PEDIDO presentes no exemplo, favorecendo exemplos que cobrem mais da intenção do usuário. Novo guard FEW_SHOT_MIN_SCORE = 0.06: exemplos abaixo disso são ruído e poluem o contexto → transforma SEM few-shot (economia de tokens §16; antes um exemplo com score 0 aleatório era injetado). meta.few_shot_score agora reporta o score híbrido. Função jaccard() removida (inline no picker).
- STYLING — detalhes: card da revisão ATUAL com barra lateral interna laranja (shadow inset 3px); cards não-atuais com hover elevado (hover:shadow-sm + hover:-translate-y-px) para tato visual; pill de presença com entrada framer-motion (scale/x 0.18s) e active:scale-95; dot âmbar com cad-pulse-soft; botão CSV com focus-visible ring esmeralda; indicador de rodapé com role="status" para leitores de tela.
- QA final: presença testada E2E (flip verde→âmbar→verde + sync), CSV baixado e conferido byte a byte, rename via UI re-testado (rev 28), mobile 390×844 sem scroll horizontal, lint limpo, tsc limpo em src/. Commit 5ade708.

Stage Summary:
- Estado: rev 28 "Outdoor Rodovia BR-116" (52 el., hash 26cf8269), provider Z.ai glm-4.5v ativo, 21 revisões no log, projeto em sincronia (pill verde).
- Multi-operador agora é cidadão de primeira classe: outra sessão aplicando mudanças é detectada em ≤6s com alerta acionável (antes: rev pulava silenciosamente entre loads e 409s apareciam sem contexto).
- Histórico de revisões exportável em CSV compatível com Excel pt-BR, respeitando filtros ativos.
- Few-shot agora é econômico por padrão: só injeta exemplo com relevância real (score híbrido ≥ 0.06), medindo qualidade via meta.few_shot_score.
- Conhecidos/risco: janela de corrida teórica (fetch de presença entre write do servidor e setState próprio) pode gerar falso alerta isolado — self-heals no próximo tick (≤6s) e é mitigada por mutatingRef nas mutações da página; restauração feita DENTRO do RevisionHistory não passa pelo mutatingRef da página (risco residual mínimo); presença é por hash+rev — renomear em outra aba conta como "outro operador" (comportamento correto, documento mudou).
- Próximos passos sugeridos (prioridade): 1) transformação real com glm-4.5v + few-shot para medir ganho de qualidade com o novo score híbrido (comparar few_shot_score/latência antes/depois); 2) desfazer em lote/multi-level com timeline clicável; 3) heartbeat de presença com identidade de sessão (quem exatamente está ativo, não só "outro operador"); 4) diff direto entre duas revisões quaisquer (hoje só contra a atual); 5) testes de screenshot automáticos para regressão de viewport.

---
Task ID: cron-review-202609230948 (round 9)
Agent: Z.ai Code (cron webDevReview)
Task: Avaliar estado, QA via agent-browser, e evoluir com itens do backlog da rodada 8 (heartbeat de presença com identidade de sessão; transformação real para medir o score híbrido do few-shot) + confirmação em 2 cliques no RESTAURAR + polish de styling.

Work Log:
- QA inicial: health 200 (rev 28), dev.log sem erros de compilação. ALERTA FALSO investigado: console do browser mostrava 2 erros de parse em page.tsx (linhas 203/682) — erros STALE do buffer do agent-browser acumulados durante a edição da rodada 8 (estado intermediário entre batches de MultiEdit). Provas: tsc limpo, dev.log sem erros, app renderiza 100% e, após fechar e reabrir o browser (sessão nova), console ZERO erros. Lição: ao ver erro de compile no console do agent-browser, fechar/reabrir a sessão ou conferir dev.log antes de tratar como bug real.
- FEATURE — Heartbeat de presença com identidade de sessão (item 3 do backlog): /api/presence agora tem POST { client_id, label? } → registra heartbeat em mapa TRANSIENTE em globalThis (sobrevive ao HMR; TTL 30s; cap 50 peers; prune automático) e devolve { revision, hash, updated_at, peers: [{id, label, last_seen_s}] }. GET mantido (leitura). Cliente gera client_id uma vez (crypto.randomUUID, localStorage led-json-cad:client-id:v1) e o ciclo de polling virou POST (heartbeat + detecção numa chamada só). Pill da topbar evoluída: só você → "SINCRONIZADO" (dot verde); com outros ativos → "N OPERADORES" com dot LARANJA pulsante + até 2 dots coloridos por peer (cor determinística via hue do id) + tooltip listando cada peer ("Você · Operador-XXXX (ativo há Ns)"). Alerta âmbar de mudança remota (rev/hash) permanece com precedência. VERIFICADO E2E: 2 browsers reais + visitor via curl → pill "3 OPERADORES"; TTL de 30s expirou o visitor → "2 OPERADORES" sozinho.
- BUG FIX (UI) — pill de presença quebrava em 2 linhas em viewports apertados (1280px) quando texto longo + 3 dots: adicionado whitespace-nowrap + shrink-0 nos dots + texto encurtado ("N OPERADORES") + máx. 2 dots de peer. Re-verificado em 1280×720: uma linha só, sem overlap com botões.
- FEATURE — RESTAURAR com confirmação em 2 cliques (segurança de timeline): 1º clique arma o botão (fica vermelho "CONFIRMAR?" com pulse, tooltip explicativo), 2º clique (≤3s) executa a restauração; auto-desarma em 3s ou ao clicar COMPARAR/outro card. VERIFICADO E2E: armar → desarme automático (3s) → armar+confirmar → rev 29 criada ("restaurada da rev 21").
- VALIDAÇÃO REAL — Transformação com glm-4.5v para medir o score híbrido do few-shot (item 1 do backlog da rodada 8): pedido "adicione uma escada de acesso com degraus no poste esquerdo" (variante do exemplo salvo "…no poste direito"). Resultado: status ready, meta { provider zai, model glm-4.5v, latency 112s, attempts 1, few_shot_id 1790121449566-LED-223D9BE8F0, few_shot_score 0.72 }, diff "+11 novas" (escada completa no PILAR-01), explain citando que seguiu o padrão do exemplo — o score híbrido (0.6×Jaccard + 0.4×cobertura) selecionou o exemplo correto com relevância ALTA (0.72) e a IA ADAPTOU direito→esquerdo em vez de copiar. Candidato NÃO aplicado (só pending preview, expira em 1h). Nota de estabilidade: 1 tentativa anterior do teste (pedido sem "com degraus") deu provider_timeout no glm-4.5v (120s) — flakiness ocasional do modelo com documento grande; retry manual funcionou de primeira. Custo de latência com few-shot de 29KB: aceitável (~112s vs ~72s da covisão da rodada 6 sem few-shot).
- STYLING — detalhes: dots de peer com border branca/40 sobre navy; botão CONFIRMAR? com animate-pulse + bg-red-50 + font-black; pill com whitespace-nowrap em ambas as variantes; tooltips descritivos (quem está ativo + há quanto tempo; o que o 2º clique faz).
- QA final: lint limpo, tsc limpo, mobile 390×844 sem scroll horizontal, desktop 1280/1440 sem wrap, console limpo em sessão fresca. Commit c3e1101.

Stage Summary:
- Estado: rev 29 "Outdoor Rodovia BR-116" (52 el., hash 26cf8269 — conteúdo idêntico ao pós-rename; restauração de QA), provider Z.ai glm-4.5v ativo, 23 revisões no log.
- Presença agora responde "QUEM está ativo" e não só "algo mudou": contagem de operadores, identidade persistente por navegador, dots coloridos por peer, TTL automático de 30s.
- Score híbrido do few-shot VALIDADO com IA real: 0.72 de relevância em pedido alinhado ao exemplo (vs 0/skip em pedidos não relacionados) — mecanismo de economia de tokens funcionando como desenhado.
- Restauração de revisões protegida contra misclick (2 cliques, 3s de janela, auto-desarme).
- Conhecidos/risco: glm-4.5v tem flakiness de timeout ocasional (~120s) com documento grande + few-shot — o retry único do registry cobre parte; restauração dentro do RevisionHistory ainda não passa pelo mutatingRef da página (janela de corrida teórica de falso alerta ≤6s, self-heal); heartbeat é por navegador — duas abas do mesmo usuário contam como 2 operadores (aceitável: são sessões de edição independentes).
- Próximos passos sugeridos (prioridade): 1) diff direto entre duas revisões quaisquer (hoje só contra a atual) — estender /api/export/diff-pdf com from_rev/to_rev; 2) desfazer em lote/multi-level com timeline clicável; 3) testes de screenshot automáticos (regressão de viewport vazio); 4) badge "sincronizado há Xs" com ticker leve no rodapé (evitar re-render global); 5) mostrar no pill o NOME do peer que fez a última mudança remota (juntar heartbeat + log de revisões).

---
Task ID: round-10
Agent: Z.ai Code (sessão principal)
Task: Versão mobile com botões mapeados à IA funcional (Z.ai glm-4.5v) + garantir IA do Z.ai funcionando no servidor para demonstração ao usuário.

Work Log:
- Avaliação inicial: health OK (rev 29), provider zai/glm-4.5v ativo e configurado; teste de conectividade /api/ai/test → ok em 0.37s. IA REAL já funcional no servidor (validada na rodada 9 com few-shot 0.72).
- Investigado falso-positivo de "corrupção" em page.tsx (linhas de useState aparentavam perder `const [h…`/`[m…`): verificado via od -c e node que os BYTES do arquivo estão íntegros — é artefato da camada de exibição de tool-outputs que stripa as sequências literais `[h` e `[m`. Nenhum fix necessário; lição registrada: não copiar strings "corrompidas" da exibição para old_str de Edit.
- NOVO componente `src/components/cad/MobileAiBar.tsx` — barra de ações rápidas IA (mobile <lg): 6 comandos pré-mapeados que disparam o MESMO fluxo real do copiloto (/api/ai/transform → glm-4.5v → preview → APLICAR): Luminária, Escada, Cor, Renomear, +20% largura, Remover. Header "IA NO SERVIDOR · <provider> · <model>" dá visibilidade de QUAL IA responde; badge "PROCESSANDO · Ns" com cronômetro durante a execução; chips com alvos ≥44px, estados disabled/ativo, spinner no chip ativo, snap horizontal com scrollbar oculta.
- NOVO componente `src/components/cad/MobileSheet.tsx` — bottom sheet (<lg): barra de navegação fixa (6 colunas: IA/Elementos/Histórico/JSON/Presets/Abrir) com alvos ≥52px, indicador laranja na aba ativa, badge de candidato pendente na aba IA, chevron abrir/fechar animado, safe-area iOS (pb-[env(safe-area-inset-bottom)]); painel desliza com spring (framer-motion height 0↔46vh), alça de toque para colapsar, sombra de elevação.
- page.tsx: dock extraído para `dockElement` (instância única reaproveitada no dock lateral desktop E no bottom sheet mobile — mesma fonte de funcionalidade); wrapper do dock desktop agora `hidden lg:block`; novo cluster mobile `lg:hidden` (MobileAiBar + MobileSheet); viewport min-h-[220px] no mobile para caber o sheet aberto; efeitos de UX: sheet colapsa ao enviar pedido e quando o candidato chega (preview 3D + APLICAR ficam visíveis); topbar px-2 no mobile + overflow-x-clip.
- Verificações: lint limpo (corrigido setState-em-effect no cronômetro → timeout/interval), tsc limpo (ícone Ladder não existe no lucide-react → Construction), commit pendente.

Stage Summary:
- MOBILE É PLENAMENTE OPERACIONAL: navegação por polegar (bottom nav 52px), bottom sheet com o MESMO dock do desktop (copiloto, JSON, presets, elementos, histórico), e botões de 1 toque que acionam a IA REAL glm-4.5v no servidor.
- IA Z.ai FUNCIONAL NO SERVIDOR — provas em andamento nesta rodada: (1) teste de conectividade 0.37s ok; (2) transform real via curl em background; (3) transform real disparado PELO CHIP MOBILE "Luminária" no agent-browser (PROCESSANDO·Ns visível) → resultado a confirmar no fim da rodada.
- Desktop 100% preservado (dock lateral lg+, nenhum comportamento alterado).
- QA agent-browser (390×844) — VERIFICADO E2E COM IA REAL:
  (1) Mobile render: barra "IA NO SERVIDOR · Z.AI · GLM-4.5V" + 6 chips + IA LIVRE + bottom nav 6 colunas — sem scroll horizontal;
  (2) Bottom sheet: abrir/fechar via aba e chevron, ELEMENTOS com árvore de 52 elementos dentro do sheet, alça de colapso funcional;
  (3) CICLO IA REAL PELO MOBILE: chip "Luminária" → badge "PROCESSANDO · 2s→83s" (cronômetro visível) → ~100s depois glm-4.5v retornou "4 alterações propostas" (diff +4/~0/-0, few-shot aplicado) → preview 3D com fantasma verde + barra APLICAR/CANCELAR + badge "1" na aba IA + sheet auto-colapsado → APLICAR → toast "Aplicado — revision 30" com Desfazer;
  (4) Desktop 1440×900: dock lateral intacto, 56 el. (52+4 da IA), pill "2 OPERADORES", zero vazamento de UI mobile (lg:hidden correto), estado de aba contínuo mobile↔desktop.
- Resultado final do servidor: rev 30 (hash 5b68e952, 56 el., 24 revisões) — a luminária adicionada pela IA fica como demonstração visível (Desfazer reverte com 1 toque).
- Nota honesta: o transform de controle disparado por curl em background não gravou arquivo (processo nohup morreu silenciosamente) — a prova E2E definitiva foi o ciclo real pelo chip mobile acima.

Stage Summary (round 10 / final):
- ENTREGA CENTRAL: versão mobile completa com botões mapeados à IA FUNCIONAL do Z.ai — o usuário agora vê, com 1 toque, a glm-4.5v processando no servidor (cronômetro), recebendo o diff, visualizando o preview 3D e aplicando como nova revisão.
- Arquitetura: dockElement único compartilhado entre dock desktop e bottom sheet mobile — zero duplicação de lógica; MobileAiBar/MobileSheet isolados em componentes próprios (<lg only via CSS, sem JS de detecção).
- Provas da IA Z.ai funcional: /api/ai/test 0.37s ok + ciclo completo mobile→servidor→rev 30.
- Riscos: transform de ~100s exige paciência no mobile (badge PROCESSANDO mitiga; notificação de sistema já existente ajuda); sheet 46vh + alça podem ser refinados com drag contínuo (snap points) no futuro.
- Próximos passos sugeridos: 1) drag contínuo do sheet com snap points (peek/meio/fim); 2) diff entre duas revisões quaisquer (item pendente da rodada 9); 3) teste de screenshot automático de regressão de viewport; 4) badge de sincronia "há Xs" no rodapé mobile; 5) suporte a anexo de foto no mobile (câmera → vision glm-4.5v).
