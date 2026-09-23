# TASK MASTER — LED JSON CAD BUILDER
## Novo projeto do zero — CAD dirigido por JSON + IA como transformadora de documento

**Agente alvo:** Fable 5.1 — Medium  
**Modo:** implementação autônoma e contínua  
**Nome recomendado do projeto:** `led-json-cad`  
**Objetivo:** construir um CAD para estruturas de painéis LED cuja fonte de verdade seja um documento JSON completo. A IA não opera o CAD por comandos; ela lê o JSON atual, entende o pedido do usuário e devolve um novo JSON completo e válido. O sistema valida, calcula diff, renderiza preview e só aplica após confirmação.

---

# 0. INSTRUÇÃO DE EXECUÇÃO

Você está em uma pasta nova.

Não entregue somente planejamento. Implemente o produto.

Regras:

1. Trabalhe autonomamente até o Definition of Done ou até um bloqueio real de credencial externa.
2. Não peça confirmação para criar arquivos, instalar dependências, executar comandos, iniciar servidor, testar localhost ou corrigir erros locais.
3. Não entre em ciclos infinitos de teste; faça smoke tests focados.
4. Use o navegador integrado para validar `http://localhost:3000`.
5. Deve existir **um único processo obrigatório** para rodar a aplicação.
6. Se não houver Git, execute `git init`.
7. Faça commits locais por milestone.
8. Não faça push e não configure remote.
9. Se não houver API key de IA, implemente tudo e use mock/dev mode para validar o fluxo.
10. Não recrie a arquitetura antiga de operações. A autoridade é o JSON completo do projeto.

---

# 1. VISÃO DO PRODUTO

O produto é um CAD de estruturas LED orientado a documento.

Fluxo principal:

```text
TEXTO / PRESET / IMAGEM / PDF / JSON
                ↓
            IA interpreta
                ↓
       PROJECT JSON candidato
                ↓
      Pydantic / validação geométrica
                ↓
      diff JSON atual × candidato
                ↓
            PREVIEW 3D
                ↓
         usuário APROVA
                ↓
    PROJECT JSON candidato vira atual
                ↓
       PDF / BOM / export JSON
```

Princípio central:

```text
JSON descreve o projeto.
IA escreve ou reescreve o JSON.
Python valida.
Renderer desenha.
Usuário aprova.
```

A IA NÃO deve devolver mini-operações como:

```text
add_post
move_element
delete_element
resize_element
multi_move
```

Esse contrato de operações foi um limitador no projeto anterior.

A nova IA devolve o **documento completo desejado**.

---

# 2. LIÇÃO PRINCIPAL DO PROJETO ANTIGO

O projeto antigo provou que a IA frequentemente entende corretamente o pedido, mas falha porque o executor não aceita algum campo ou porque uma operação específica não existe.

Exemplo do problema antigo:

```text
IA entendeu "adicione um poste"
→ devolveu add_post com group
→ schema de add_post não aceitava group
→ pedido falhou mesmo com intenção correta
```

No projeto novo isso NÃO deve existir.

Se a IA quer um poste, ela simplesmente devolve no JSON:

```json
{
  "id": "POST-02",
  "type": "beam",
  "role": "post",
  "profile": "TUBO_219x4.75",
  "group": "POSTES",
  "start": {"x": 500, "y": -325, "z": 0},
  "end": {"x": 500, "y": -325, "z": 3000}
}
```

O sistema valida e renderiza.

---

# 3. O QUE MANTER DO PROJETO ANTIGO

Conservar como conceitos:

- unidade interna única: milímetros;
- X = largura;
- Y = profundidade;
- Z = altura;
- solo = Z 0;
- painel LED como referência visual;
- elementos geométricos simples e semânticos;
- IDs estáveis;
- perfis catalogados;
- Three.js para preview;
- OrbitControls;
- vistas frontal, traseira, lateral, superior e isométrica;
- projeções e cotas derivadas do modelo;
- PDF LED Collor dinâmico;
- BOM derivado da geometria;
- preview antes de aplicar;
- undo atômico.

Não portar:

- Next.js;
- dois servidores;
- `ai_intent`;
- `ai_contract` baseado em operações;
- `ai_ops`;
- `local_edit`;
- `global_resize`;
- `pending_question`;
- memória conversacional no backend;
- dezenas de handlers semânticos;
- múltiplos exporters concorrentes;
- state store oculto;
- seleção de preset só por dimensão;
- regras duplicadas entre parser/preset/IA/compilador.

---

# 4. ARQUITETURA OBRIGATÓRIA

Stack:

```text
Python
FastAPI
Pydantic v2
Three.js
HTML/CSS/JS vanilla
ReportLab
google-genai
httpx
python-dotenv
```

Não usar Next.js.

Não criar servidor Node.

Execução final:

```cmd
py main.py
```

URL:

```text
http://localhost:3000
```

Estrutura sugerida:

```text
led-json-cad/
├── main.py
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
│
├── app/
│   ├── __init__.py
│   ├── api.py
│   └── config.py
│
├── domain/
│   ├── __init__.py
│   ├── project.py
│   ├── element.py
│   ├── profiles.py
│   ├── validation.py
│   └── hashing.py
│
├── services/
│   ├── project_diff.py
│   ├── project_store.py
│   ├── presets.py
│   └── ai/
│       ├── __init__.py
│       ├── base.py
│       ├── registry.py
│       ├── gemini.py
│       ├── zai.py
│       ├── transformer.py
│       └── prompts.py
│
├── presets/
│   ├── references/
│   └── custom/
│
├── drawing/
│   ├── projections.py
│   ├── dimensions.py
│   └── svg.py
│
├── export/
│   ├── pdf.py
│   ├── bom.py
│   └── json_export.py
│
├── static/
│   ├── index.html
│   ├── css/app.css
│   ├── js/app.js
│   ├── js/api.js
│   ├── js/viewer.js
│   ├── js/ai.js
│   ├── js/json-editor.js
│   └── vendor/
│
├── tests/
│   ├── test_project_schema.py
│   ├── test_diff.py
│   ├── test_ai_transform.py
│   ├── test_presets.py
│   └── test_api.py
│
└── docs/
    ├── ARCHITECTURE.md
    ├── PROJECT_JSON_SCHEMA.md
    ├── AI_CONTRACT.md
    └── PROVIDERS.md
```

---

# 5. PROJECT JSON É A AUTORIDADE

Criar um único modelo Pydantic principal:

```python
ProjectDocument
```

Ele representa o projeto inteiro.

Formato base:

```json
{
  "schema_version": 1,
  "units": "mm",
  "project": {
    "id": "uuid-ou-hash",
    "name": "Painel LED",
    "description": ""
  },
  "panel": {
    "width": 1920,
    "height": 960,
    "depth": 650,
    "ground_clearance": 3000
  },
  "installation": {
    "type": "post",
    "environment": "outdoor"
  },
  "elements": [],
  "assumptions": [],
  "metadata": {
    "source": "ai",
    "preset_id": null
  }
}
```

O JSON atual é a fonte de verdade.

O canvas é somente uma visualização.

O PDF é derivado dele.

O BOM é derivado dele.

O diff é derivado dele.

A IA recebe esse JSON e devolve outro JSON.

---

# 6. ELEMENTOS GEOMÉTRICOS

Suportar inicialmente:

```text
beam
plate
bolt
panel
cable
surface
```

## 6.1 Beam

```json
{
  "id": "POST-01",
  "type": "beam",
  "role": "post",
  "profile": "TUBO_219x4.75",
  "group": "POSTES",
  "start": {"x": 0, "y": -325, "z": 0},
  "end": {"x": 0, "y": -325, "z": 3000},
  "label": ""
}
```

## 6.2 Plate

```json
{
  "id": "BASE-01",
  "type": "plate",
  "role": "base",
  "group": "BASES",
  "center": {"x": 0, "y": -325, "z": 10},
  "size_x": 500,
  "size_y": 500,
  "size_z": 20
}
```

## 6.3 Cable

Cabo/tirante precisa ser um elemento de primeira classe:

```json
{
  "id": "CABO-01",
  "type": "cable",
  "role": "support",
  "group": "FIXACAO",
  "start": {"x": -960, "y": -650, "z": 3000},
  "end": {"x": -960, "y": -1500, "z": 4200},
  "diameter": 8,
  "label": "CABO DE FIXACAO"
}
```

Renderer pode usar cylinder fino ou line segment.

## 6.4 Panel

Painel LED é referência visual, não aço.

## 6.5 Surface

Para casos especiais, permitir superfície/polígono simples sem forçar tudo a ser beam.

---

# 7. PAPÉIS E GRUPOS

`role` deve ser um enum razoavelmente aberto, mas não exigir handler específico.

Exemplos:

```text
post
vertical
horizontal
brace
support
guardrail
walkway
base
anchor
panel
other
```

`group` é string livre validada em tamanho.

Exemplos:

```text
POSTES
GAIOLA FRENTE
GAIOLA TRAS
PASSARELA
GUARDA-CORPO
FIXACAO PAREDE
CABOS
CONTRAVENTAMENTO
```

A IA pode criar grupos novos sem precisar mudar código.

---

# 8. CATÁLOGO DE PERFIS

Criar catálogo mínimo:

```text
METALON_40x40x2
METALON_50x50x2
METALON_60x60x2
METALON_100x100x3
TUBO_219x4.75
TUBO_250x10
TUBO_380_t4.8
TUBO_380_t6.35
```

Cada perfil:

```json
{
  "name": "METALON_60x60x2",
  "kind": "square",
  "w": 60,
  "h": 60,
  "t": 2,
  "kgm": 3.66
}
```

Perfis desconhecidos devem falhar na validação OU entrar como assumption pendente, nunca silenciosamente.

---

# 9. PRESETS

Preset = ProjectDocument completo válido.

Formato:

```json
{
  "id": "REF_4000X2000",
  "name": "4000 × 2000 — Outdoor",
  "description": "...",
  "project": {
    "...": "ProjectDocument completo"
  }
}
```

Nada de:

```text
preset → template → enrichment → intent → operações
```

Carregar preset significa carregar JSON.

Preset não é escolhido só por dimensão.

Exemplos:

```text
"painel 4x2 metros"
→ não escolhe preset automaticamente

"use o preset 4x2"
→ pode carregar REF_4000X2000
```

---

# 10. QUATRO PRESETS INICIAIS

Criar referências iniciais baseadas no conhecimento validado do sistema anterior:

## REF_2000X4000
- painel 2000×4000
- outdoor
- PD 2000
- 2 postes
- gaiola 650
- modulação estrutural X=2 bays
- rail spacing 1000
- frame METALON_60x60x2
- secondary METALON_40x40x2
- post TUBO_380_t6.35

## REF_2000X5000
- painel 2000×5000
- outdoor
- PD 2000
- 2 postes
- gaiola 800
- bays X=2
- spacing 1000
- post fallback TUBO_380_t4.8
- assumption: referência original usava PERFIL H 310×93

## REF_3000X2000
- painel 3000×2000
- PD 3000
- 2 postes
- gaiola 650
- bays X=3
- spacing 1000
- post TUBO_250x10

## REF_4000X2000
- painel 4000×2000
- PD 3000
- 2 postes
- gaiola 650
- bays X=4
- spacing 1000
- post TUBO_380_t4.8

IMPORTANTE:

```text
structural bays ≠ cabinet grid
```

Nunca tratar modulação estrutural como gabinete.

---

# 11. IA — MODELO MENTAL

A IA não executa ferramentas CAD.

Ela funciona como:

```text
Project JSON atual
+ pedido do usuário
+ schema
+ regras
        ↓
      modelo
        ↓
Project JSON candidato completo
```

Contrato de retorno:

```json
{
  "status": "ready",
  "explain": "resumo curto do que foi alterado",
  "assumptions": [
    "mantive a gaiola a 3000 mm do solo"
  ],
  "questions": [],
  "project": {
    "...": "ProjectDocument completo"
  }
}
```

Quando faltar dado essencial:

```json
{
  "status": "needs_input",
  "explain": "faltam medidas essenciais",
  "assumptions": [],
  "questions": [
    "Qual deve ser o pé-direito?"
  ],
  "project": null
}
```

Máximo 3 perguntas.

Não pedir respostas sobre coisas que podem ser preservadas do JSON atual.

---

# 12. DUAL PROVIDER DE IA

Implementar **dois conectores nativos** desde o início:

1. Google Gemini
2. Z.ai GLM

A UI deve ter um modal semelhante ao conceito já usado no projeto anterior:

```text
CONECTOR DE IA

[ Google Gemini ]
Modelo: [ dropdown ]
API Key: [ ******** ]
[ ATIVAR GEMINI ]

status:
Gemini ativo — Google Gemini — modelo X — respondeu em 0.78s


[ Z.ai ]
Modelo: [ dropdown ]
API Key: [ ******** ]
[ ATIVAR Z.AI ]

status:
Z.ai ativo — GLM — modelo Y — respondeu em 1.10s
```

Também mostrar:

```text
CONEXÕES SALVAS
```

As chaves ficam somente no backend local.

Nunca persistir API key no frontend.

Persistência local permitida:

```text
data/ai_config.json
```

Esse arquivo deve estar no `.gitignore`.

---

# 13. GEMINI

Criar provider:

```text
services/ai/gemini.py
```

Usar SDK oficial `google-genai`.

Configuração:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

O modelo deve ser configurável.

Default inicial do produto:

```text
gemini-2.5-flash
```

A UI deve permitir escolher outros modelos configurados.

Usar structured output / JSON schema quando disponível.

A resposta deve ser validada localmente por Pydantic.

Timeout configurável.

Retry:

```text
máximo 1 retry
```

para:

- JSON inválido;
- schema inválido;
- erro transitório do provider.

Nunca entrar em loop.

---

# 14. Z.AI

Criar provider:

```text
services/ai/zai.py
```

Compatível com API Z.ai.

Configuração:

```env
ZAI_API_KEY=
ZAI_MODEL=glm-4.5-flash
```

Default:

```text
glm-4.5-flash
```

A UI deve permitir trocar modelo.

O provider precisa devolver o mesmo `AITransformResponse` usado pelo Gemini.

Ou seja:

```text
Gemini
Z.ai
```

são intercambiáveis para o restante do sistema.

Nenhuma regra CAD pode ficar dentro do provider.

---

# 15. REGISTRY DE PROVIDERS

Criar:

```python
AIProviderRegistry
```

Interface:

```python
transform_project(
    provider_id,
    current_project,
    user_request,
    attachments=None
) -> AITransformResponse
```

Provider ativo deve ser configurável na UI.

Mostrar na barra do Copiloto:

```text
IA ativa: Gemini · gemini-2.5-flash
```

ou:

```text
IA ativa: Z.ai · glm-4.5-flash
```

---

# 16. ECONOMIA DE TOKENS

O sistema deve ser projetado para gastar pouco contexto.

Enviar para a IA apenas:

1. prompt de sistema compacto;
2. JSON Schema compacto;
3. ProjectDocument atual;
4. pedido atual;
5. metadata necessária de preset quando explicitamente citado;
6. anexos quando existirem.

Não enviar:

- histórico inteiro do chat;
- logs;
- HTML;
- PDF exporter;
- código Python;
- operações disponíveis;
- documentação gigante;
- mensagens anteriores irrelevantes.

Cada chamada deve ser stateless.

O frontend pode mostrar histórico visual, mas o backend não precisa reenviar tudo.

Para pedidos pequenos, o JSON atual + pedido é suficiente.

---

# 17. EDIÇÃO POR IA

Exemplo:

Projeto atual contém 2 postes.

Usuário:

```text
este painel agora não deverá ter postes,
deverá apenas ter sustentação de parede
```

A IA deve devolver um novo ProjectDocument:

- remove postes;
- remove interfaces que dependem deles;
- preserva painel/gaiola;
- cria elementos de fixação em parede quando necessário;
- registra assumptions.

Não existe `delete_post`.

Não existe `convert_to_wall`.

Existe apenas:

```text
JSON antes
→ JSON depois
```

---

# 18. DIFF AUTOMÁTICO

O backend deve calcular o diff entre documentos.

Função:

```python
diff_projects(old, new)
```

Retornar:

```json
{
  "added": ["WALL-01", "WALL-02"],
  "removed": ["POST-01", "POST-02"],
  "modified": ["PANEL-LED"],
  "counts": {
    "added": 2,
    "removed": 2,
    "modified": 1
  }
}
```

A IA não gera diff.

O sistema calcula.

---

# 19. PREVIEW

Fluxo:

```text
JSON candidato
→ validação
→ renderer
→ ghost preview
→ diff visual
```

Cores sugeridas:

```text
adicionado = verde/translúcido
removido = vermelho/translúcido
modificado = laranja
inalterado = cinza normal
```

Mostrar barra:

```text
28 alterações propostas
27 novas · 1 editada · 0 removidas

[ APLICAR ] [ CANCELAR ]
```

---

# 20. APPLY

Ao clicar APLICAR:

1. confirmar que `base_revision` ainda é a atual;
2. guardar snapshot completo do JSON atual;
3. substituir pelo JSON candidato;
4. incrementar revision;
5. renderizar novamente.

Undo:

```text
Ctrl+Z
```

restaura o JSON anterior completo.

Isso é muito mais simples que desfazer dezenas de operações individualmente.

---

# 21. HASH E CONCORRÊNCIA

Cada projeto deve ter:

```text
project_id
revision
project_hash
```

`project_hash` = SHA-256 de JSON canônico.

Cada transformação de IA recebe:

```text
base_revision
base_hash
```

Se o usuário modificar/aplicar algo antes do preview:

```text
409 project changed
```

e o preview precisa ser regenerado.

---

# 22. JSON EDITOR

A UI precisa ter uma aba:

```text
JSON DO PROJETO
```

Funções:

- visualizar;
- editar manualmente;
- formatar;
- validar;
- atualizar preview;
- copiar;
- importar;
- exportar.

Isso é parte central do produto, não uma ferramenta escondida.

---

# 23. ENTRADA POR IMAGEM

Arquitetura preparada para anexos.

Fluxo:

```text
imagem/croqui/foto
+ instrução
+ JSON atual ou blank
→ provider multimodal compatível
→ ProjectDocument candidato
```

Não fingir precisão inexistente.

Quando uma medida for inferida visualmente:

```json
{
  "path": "panel.width",
  "source": "visual_estimate",
  "review_required": true,
  "detail": "medida estimada pela proporção da imagem"
}
```

Se o provider ativo não suportar imagem, mostrar:

```text
Este provider/modelo não suporta este tipo de anexo.
```

Não inventar suporte.

---

# 24. EXPLICAÇÃO PARA O OPERADOR

Não mostrar chain-of-thought interno.

Mostrar apenas:

```text
o que foi alterado
assumptions
perguntas pendentes
```

Exemplo:

```text
Removi os dois postes,
mantive a gaiola a 3000 mm do solo
e criei quatro pontos de fixação na parede.

Assumi afastamento traseiro de 150 mm.
```

O operador pode responder:

```text
o afastamento deve ser 300 mm
```

Nova chamada:

```text
JSON atual
+ correção
→ novo JSON candidato
```

---

# 25. SALVAR COMO EXEMPLO

Adicionar opcionalmente:

```text
SALVAR COMO EXEMPLO
```

Guardar:

```json
{
  "request": "...",
  "before": {},
  "after": {},
  "operator_note": ""
}
```

Destino:

```text
examples/
```

Esses exemplos podem futuramente ser usados como few-shot.

Não fazer fine-tuning automático.

---

# 26. FRONTEND

Visual semelhante ao produto anterior:

- topbar grafite/navy;
- fundo claro;
- acento laranja;
- viewport grande;
- dock Copiloto à direita;
- JSON em aba;
- histórico curto;
- chips contextuais.

Dock:

```text
COPILOTO IA

[ Copiloto ]
[ JSON ]
[ Presets ]

histórico

[ input ]
[ anexar ]
[ enviar ]

IA ativa: Gemini · gemini-2.5-flash
```

Quando um elemento é selecionado, pode mostrar chips contextuais:

```text
duplicar
mover
trocar perfil
excluir
adicionar paralelo
```

Esses chips só preenchem uma instrução textual para a IA.

Não executam handlers ocultos.

---

# 27. THREE.JS

O renderer lê ProjectDocument.

Suportar:

- beam square → box orientado;
- beam round → cylinder orientado;
- cable → linha/cylinder fino;
- plate → box;
- panel → superfície translúcida;
- surface → polygon/mesh simples.

Vistas:

```text
3D
Frente
Fundo
Esquerda
Direita
Superior
Isométrica
```

Não mostrar `Inferior` por padrão.

---

# 28. PDF ÚNICO

Um exporter PDF canônico.

Pipeline:

```text
ProjectDocument
→ projections
→ dimensions
→ plan_sheets
→ LED Collor template
→ PDF
```

A2 landscape.

Folhas dinâmicas:

1. frontal;
2. traseira se relevante;
3. lateral;
4. superior;
5. detalhe de suporte/base se relevante;
6. isométrica.

Aviso:

```text
ESBOÇO DE REFERÊNCIA GEOMÉTRICO — NÃO UTILIZAR PARA FABRICAÇÃO SEM REVISÃO TÉCNICA.
```

Não criar múltiplos exporters competindo.

---

# 29. BOM

Derivar do JSON:

- perfil;
- quantidade;
- comprimento;
- comprimento total;
- peso estimado.

Sem preço no MVP.

---

# 30. API

Criar:

```text
GET  /api/health
GET  /api/meta
GET  /api/project
POST /api/project/new
POST /api/project/import
GET  /api/project/export

GET  /api/presets
GET  /api/presets/{id}
POST /api/presets/load
POST /api/presets/custom

GET  /api/ai/providers
GET  /api/ai/config
POST /api/ai/config
POST /api/ai/test
POST /api/ai/transform

POST /api/preview
POST /api/apply
POST /api/undo

POST /api/export/pdf
POST /api/export/bom
```

`/api/ai/transform` recebe:

```json
{
  "provider": "gemini",
  "request": "remova os postes e faça sustentação de parede",
  "base_revision": 4,
  "base_hash": "...",
  "project": {}
}
```

Resposta:

```json
{
  "status": "ready",
  "explain": "...",
  "assumptions": [],
  "questions": [],
  "candidate_project": {},
  "candidate_hash": "...",
  "diff": {}
}
```

---

# 31. TIMEOUT E ERROS

O projeto anterior teve:

```text
TimeoutError: The read operation timed out
```

Tratar isso corretamente.

Nunca deixar frontend receber apenas:

```text
Failed to fetch
```

Retornar erros estruturados:

```json
{
  "error": {
    "type": "provider_timeout",
    "provider": "zai",
    "message": "O provider excedeu o tempo limite.",
    "retryable": true
  }
}
```

Frontend mostra mensagem legível.

Configurar timeout por provider.

---

# 32. TESTES ESSENCIAIS

## Schema

- JSON válido;
- IDs únicos;
- coordenadas finitas;
- perfil conhecido;
- elementos inválidos falham.

## Diff

Antes:

```text
POST-01
POST-02
```

Depois:

```text
WALL-01
WALL-02
```

Diff correto.

## Apply/Undo

```text
apply JSON candidato
→ revision +1
→ undo
→ JSON original idêntico
```

## Gemini mock

- ready;
- needs_input;
- JSON inválido;
- timeout;
- retry único.

## Z.ai mock

Mesmos contratos.

## API

- health;
- config provider;
- transform;
- preview;
- apply;
- undo.

---

# 33. CASOS DE ACEITE

## Caso A — criar estrutura

Pedido:

```text
Crie um painel outdoor de 1920x960,
1 poste central,
pé-direito 3m,
gaiola 650,
passarela traseira 650,
guarda-corpo 1100.
```

Esperado:

- JSON completo;
- painel 1920×960;
- poste X=0;
- poste termina Z=3000;
- gaiola base Z=3000;
- passarela atrás;
- rail 1100;
- preview coerente.

## Caso B — converter suporte

Projeto atual tem 2 postes.

Pedido:

```text
este painel agora não deverá ter mais postes
deverá apenas ter sustentação de parede
```

Esperado:

- postes removidos;
- interfaces dependentes removidas;
- suporte de parede criado;
- painel/gaiola preservados;
- diff claro;
- preview antes de aplicar.

## Caso C — cabo por coluna

Pedido:

```text
preciso que ele tenha cabos para fixação
1 por coluna
```

Esperado:

- IA analisa colunas existentes;
- cria `cable` elements;
- um cabo por coluna;
- sem necessidade de novo handler.

## Caso D — redimensionar

Pedido:

```text
transforme o painel em 4x2 mantendo a lógica atual
```

A IA altera o JSON inteiro mantendo coerência.

Nenhum erro de:

```text
operation desconhecida
campo group inválido
add_post não aceita ...
```

porque não existe contrato de operações.

---

# 34. OTIMIZAÇÃO DE TOKENS

O prompt do provider deve ser curto.

Enviar apenas:

```text
SYSTEM RULES compactas
PROJECT JSON
USER REQUEST
SCHEMA
```

Não mandar história inteira.

Não mandar documentação do app.

Não mandar lista de handlers.

Não mandar frontend.

Não mandar logs.

Em edições pequenas, o modelo recebe um documento compacto e devolve o documento completo.

Se o JSON crescer muito no futuro, implementar compactação estrutural ou representação resumida, mas NÃO antes de medir.

---

# 35. MILESTONES

## M1 — Bootstrap
- FastAPI
- single server
- frontend mínimo
- Git

Commit:

```text
chore: bootstrap json cad
```

## M2 — ProjectDocument
- schema
- element types
- profiles
- hashing
- validation

Commit:

```text
feat: add canonical project document
```

## M3 — Renderer
- Three.js
- JSON → geometry
- cameras/views

Commit:

```text
feat: render project json in 3d
```

## M4 — Project lifecycle
- current project
- import/export
- revision/hash
- undo snapshot

Commit:

```text
feat: add project lifecycle and undo
```

## M5 — Presets
- four references
- load/save custom

Commit:

```text
feat: add json reference presets
```

## M6 — Diff + Preview
- project diff
- candidate preview
- apply

Commit:

```text
feat: preview and apply full project json
```

## M7 — Gemini
- config
- activation
- test
- transform

Commit:

```text
feat: add gemini project transformer
```

## M8 — Z.ai
- config
- activation
- test
- transform

Commit:

```text
feat: add zai project transformer
```

## M9 — Copilot UI
- provider modal
- history
- chips
- JSON tab

Commit:

```text
feat: add json copilot workflow
```

## M10 — PDF/BOM
- one PDF
- BOM

Commit:

```text
feat: export approved json projects
```

## M11 — Browser validation
- validate complete flows
- cleanup
- docs

Commit:

```text
chore: validate json cad end to end
```

---

# 36. DEFINITION OF DONE

O projeto só está concluído quando:

1. `py main.py` abre localhost:3000;
2. existe apenas um servidor;
3. ProjectDocument é a fonte de verdade;
4. canvas é derivado do JSON;
5. JSON editor funciona;
6. Gemini pode ser configurado/ativado;
7. Z.ai pode ser configurado/ativado;
8. provider ativo aparece na UI;
9. IA recebe JSON atual + pedido;
10. IA devolve JSON completo candidato;
11. backend valida;
12. backend calcula diff;
13. preview mostra candidato;
14. aplicar substitui JSON atual;
15. undo restaura JSON anterior;
16. nenhum fluxo depende de `add_post`, `move_element`, etc.;
17. presets são JSON completos;
18. PDF único funciona;
19. BOM funciona;
20. erros de provider aparecem de forma legível;
21. browser validation executada.

---

# 37. NÃO NEGOCIÁVEIS

1. JSON do projeto é a autoridade.
2. IA transforma documentos, não executa mini-operações.
3. Provider não conhece regras de UI.
4. Gemini e Z.ai usam o mesmo contrato.
5. Canvas nunca é a fonte de verdade.
6. Preview antes de Apply.
7. Diff calculado pelo sistema.
8. Undo = snapshot JSON anterior.
9. IDs estáveis.
10. Coordenadas em mm.
11. Um servidor.
12. Sem Next.js.
13. Sem `ai_ops`.
14. Sem `local_edit/global_resize`.
15. Sem memória conversacional backend.
16. Sem selecionar preset por dimensão comum.
17. Assumptions visíveis.
18. Não inventar medidas sem registrar assumption.
19. Sem arquivos paralelos `v2/new/final2`.
20. Não transformar `main.py`/`index.html` em monólitos.

---

# 38. RELATÓRIO FINAL

Ao terminar, responder:

```text
STATUS
ARQUITETURA
PROJECT JSON
PROVIDERS
COMO RODAR
TESTES
VALIDAÇÃO VISUAL
COMMITS
LIMITAÇÕES REAIS
```

Não terminar com sugestões genéricas.

Entregue o projeto funcionando.
