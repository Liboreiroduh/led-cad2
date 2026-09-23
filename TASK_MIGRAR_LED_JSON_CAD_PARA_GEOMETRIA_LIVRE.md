# TASK — MIGRAR LED JSON CAD PARA MOTOR GEOMÉTRICO LIVRE
## NÃO REFAZER O PROJETO — TROCAR SOMENTE O NÚCLEO GEOMÉTRICO

Você está trabalhando no projeto atual LED JSON CAD.

O sistema já possui infraestrutura funcional e NÃO deve ser refeito do zero.

OBJETIVO PRINCIPAL:

Transformar o projeto atual em um CAD geométrico genérico dirigido por JSON, no qual a IA possa desenhar praticamente qualquer estrutura/esboço sem depender de materiais, perfis, roles fechados, famílias estruturais ou operações pré-programadas.

A regra central passa a ser:

```text
A IA NÃO OPERA O CAD.
A IA ESCREVE O DOCUMENTO JSON COMPLETO.
O CAD NÃO PRECISA ENTENDER O QUE O OBJETO É.
O CAD PRECISA SABER COMO DESENHÁ-LO.
```

Fluxo desejado:

```text
TEXTO / PRESET / IMAGEM / PDF / CROQUI / JSON
                ↓
               IA
                ↓
      PROJECT JSON candidato
                ↓
      validação geométrica
                ↓
      diff JSON atual × candidato
                ↓
           preview 3D
                ↓
             aplicar
```

## 1. NÃO REFAZER A INFRAESTRUTURA

PRESERVAR:
- FastAPI
- servidor único em localhost:3000
- Gemini
- Z.ai
- modal/configuração dos providers
- ProjectDocument
- revision/hash
- histórico
- diff
- preview
- apply/cancel
- undo por snapshot
- import/export JSON
- frontend atual
- Three.js
- câmeras/vistas
- Copiloto
- few-shot examples
- presets
- PDF como infraestrutura
- BOM apenas como recurso opcional existente

NÃO criar:
- novo projeto paralelo
- v2 separado
- new/final/legacy copy
- segundo backend
- segundo frontend
- Next.js
- outro servidor

Esta é uma MIGRAÇÃO INTERNA DO MOTOR.

## 2. PROBLEMA DO MODELO ATUAL

Hoje o ProjectDocument ainda carrega restrições herdadas do modelo estrutural:
- profile obrigatório
- catálogo de perfis
- role enum fechado
- tipos semânticos rígidos
- material como parte central
- validação de perfil conhecido
- lógica de post/walkway/guardrail
- elementos dependentes de domínio LED
- IA limitada pelo que o schema aceita

Isso cria erros como:
```text
perfil desconhecido
role inválido
campo não aceito
tipo não suportado
```

Mesmo quando a IA entende perfeitamente a geometria.

Isso precisa acabar.

## 3. NOVO PRINCÍPIO DO SCHEMA

O novo schema deve ser:

```text
RÍGIDO NA GEOMETRIA
FLEXÍVEL NA SEMÂNTICA
```

Validar fortemente:
- números
- coordenadas
- dimensões
- rotação
- vértices
- faces
- raio
- espessura
- IDs únicos
- geometria válida

NÃO bloquear por:
- material
- perfil
- nome
- função estrutural
- role desconhecido
- grupo desconhecido
- tipo de peça de engenharia

Metadata deve ser livre.

## 4. NOVO ELEMENTO CANÔNICO

Criar:
```python
GeometryElement
```

Formato:

```json
{
  "id": "E001",
  "geometry": {
    "type": "box"
  },
  "metadata": {
    "name": "gaiola",
    "group": "estrutura",
    "role": "qualquer texto",
    "material": "opcional",
    "profile": "opcional"
  }
}
```

`metadata` NÃO pode impedir renderização.

## 5. PRIMITIVOS GEOMÉTRICOS OBRIGATÓRIOS

Implementar no mínimo:

```text
line
beam
box
cylinder
circle
arc
polyline
polygon
surface
mesh
text
dimension
```

### line
```json
{
  "geometry": {
    "type": "line",
    "start": [0,0,0],
    "end": [1000,0,0],
    "thickness": 10
  }
}
```

### beam
```json
{
  "geometry": {
    "type": "beam",
    "start": [0,0,0],
    "end": [0,0,3000],
    "section": {
      "type": "rect",
      "width": 80,
      "height": 80
    }
  }
}
```

Seção aceita:
```text
rect
square
round
```

### box
```json
{
  "geometry": {
    "type": "box",
    "center": [0,0,3000],
    "size": [4000,650,2000],
    "rotation": [0,0,0]
  }
}
```

### cylinder
```json
{
  "geometry": {
    "type": "cylinder",
    "start": [0,0,0],
    "end": [0,0,3000],
    "diameter": 200
  }
}
```

### circle
```json
{
  "geometry": {
    "type": "circle",
    "center": [0,0,0],
    "radius": 500,
    "plane": "XY"
  }
}
```

### arc
```json
{
  "geometry": {
    "type": "arc",
    "center": [0,0,0],
    "radius": 1000,
    "start_angle": 0,
    "end_angle": 90,
    "plane": "XY"
  }
}
```

### polyline
```json
{
  "geometry": {
    "type": "polyline",
    "points": [
      [0,0,0],
      [1000,0,0],
      [1000,500,0]
    ],
    "closed": false,
    "thickness": 10
  }
}
```

### polygon
```json
{
  "geometry": {
    "type": "polygon",
    "points": [
      [0,0,0],
      [1000,0,0],
      [1000,500,0],
      [0,500,0]
    ]
  }
}
```

### surface
Superfície simples orientável no espaço.

### mesh
ESCAPE UNIVERSAL.

```json
{
  "geometry": {
    "type": "mesh",
    "vertices": [
      [0,0,0],
      [1000,0,0],
      [1000,1000,0]
    ],
    "faces": [
      [0,1,2]
    ]
  }
}
```

Se algo não couber nos demais primitivos, a IA deve conseguir representar por `mesh`.

### text
Texto no espaço.

### dimension
Cota geométrica opcional.

## 6. MATERIAL E PERFIL VIRAM APENAS METADATA

O sistema NÃO deve exigir:
```text
METALON_40x40x2
TUBO_200x10
TUBO_380...
```

Se existir em metadata, ótimo.
Se não existir, o objeto continua válido.

Se a IA inventar:
```text
perfil H especial
cabo
tirante
dobradiça
suporte
estrutura tubular
peça customizada
```

o CAD NÃO deve falhar.

Ele renderiza pela geometria.

## 7. ROLE E GROUP NÃO PODEM SER ENUM FECHADO

Remover validação fechada.

Usar:
```python
role: str | None
group: str | None
```

ou simplesmente metadata livre.

A IA pode escrever:
```text
dobradiça
cabo
suporte
estrutura móvel
estrutura fixa
reforço
base
travamento
qualquer outro
```

sem exigir alteração de código.

## 8. PROJECT DOCUMENT NOVO

Formato desejado:

```json
{
  "schema_version": 2,
  "units": "mm",
  "project": {
    "id": "...",
    "name": "...",
    "description": ""
  },
  "elements": [
    {
      "id": "E001",
      "geometry": {},
      "metadata": {}
    }
  ],
  "assumptions": [],
  "metadata": {}
}
```

Não exigir obrigatoriamente:
```text
panel
installation
profiles
materials
structural family
```

Esses dados podem existir em metadata/extensions, mas não são necessários para desenhar.

## 9. COMPATIBILIDADE COM JSON ATUAL

NÃO quebrar imediatamente os projetos atuais.

Criar adapter:

```text
LegacyElement
→ GeometryElement
```

Fluxo temporário:

```text
JSON antigo
→ legacy adapter
→ GeometryDocument
→ renderer
```

O renderer novo trabalha sempre com `GeometryElement`.

Fases:

```text
FASE 1
renderer aceita antigo via adapter + novo nativo

FASE 2
IA passa a gerar apenas schema novo

FASE 3
presets antigos podem ser convertidos

FASE 4
schema antigo pode ser removido futuramente
```

## 10. RENDERER THREE.JS

Migrar o renderer para decidir por:

```text
element.geometry.type
```

e NÃO por:

```text
element.type semântico
profile
role
material
```

Implementar:

```text
renderLine()
renderBeam()
renderBox()
renderCylinder()
renderCircle()
renderArc()
renderPolyline()
renderPolygon()
renderSurface()
renderMesh()
renderText()
renderDimension()
```

## 11. IA

Gemini e Z.ai continuam como providers atuais.

Mas o contrato muda.

A IA recebe:

```text
schema geométrico compacto
JSON atual
pedido do usuário
anexo se houver
```

A IA devolve:

```json
{
  "status": "ready",
  "explain": "resumo curto",
  "assumptions": [],
  "questions": [],
  "project": {
    "...": "documento completo"
  }
}
```

NÃO devolver:

```text
ops
commands
add_post
delete
move
resize
```

A IA reescreve o documento inteiro.

## 12. IMAGEM COMO ENTRADA

Preparar para:

```text
imagem
croqui
foto
PDF
```

Exemplo:

```text
"reproduza esta estrutura em 4m x 2m"
```

A IA deve poder montar:
```text
beam
box
cylinder
mesh
etc.
```

sem depender de conceitos estruturais programados.

Se medidas forem estimadas visualmente:
registrar em assumptions.

Nunca bloquear porque "tipo de estrutura não existe".

## 13. DIFF / PREVIEW / APPLY

Preservar arquitetura atual:

```text
JSON atual
→ IA
→ JSON candidato
→ validação
→ diff automático
→ preview
→ aplicar
```

Undo continua sendo snapshot do JSON anterior.

## 14. PDF

NÃO transformar PDF em prioridade desta migração.

Primeiro faça:
```text
novo schema
adapter
renderer
IA
preview
apply
```

Depois adapte projeções/PDF para consumir `GeometryElement`.

PDF deve ser derivado da geometria.

Não criar regras de material no PDF.

## 15. BOM

BOM passa a ser OPCIONAL.

Se metadata tiver material/perfil, pode calcular.
Se não tiver:
```text
BOM indisponível ou parcial
```

O CAD nunca pode exigir BOM para aceitar geometria.

## 16. TESTES OBRIGATÓRIOS

### Teste A — objeto sem material
Beam sem profile/material deve renderizar.

### Teste B — role inventado
```json
"metadata": {
  "role": "dobradica_customizada"
}
```
Deve renderizar.

### Teste C — tubo desconhecido
Metadata:
```text
TUBO_200x10
```
Não pode falhar.

### Teste D — cabo
Elemento:
```text
geometry.type = line
metadata.role = cable
```
Deve renderizar sem handler especial.

### Teste E — mesh arbitrária
Criar mesh triangular simples e renderizar.

### Teste F — JSON antigo
Importar preset/projeto antigo.
Adapter deve converter e renderizar.

### Teste G — IA
Pedido:
```text
"adicione uma peça inclinada ligando a parte superior da estrutura ao solo"
```
IA deve criar geometria válida sem existir operação `add_brace`.

### Teste H — imagem
Se provider multimodal disponível:
anexar imagem simples e gerar ProjectDocument.

## 17. CRITÉRIO PRINCIPAL DE SUCESSO

O sistema deve aceitar geometricamente algo novo SEM ALTERAR O CÓDIGO.

Exemplo:

```text
"crie uma estrutura curva em arco,
dupla face,
com um mastro central inclinado
e duas hastes diagonais laterais"
```

Se a IA consegue expressar em:

```text
arc
beam
cylinder
mesh
```

o CAD deve desenhar.

Nenhum novo handler pode ser necessário.

## 18. MIGRAÇÃO EM MILESTONES

### M1 — novo schema geométrico
Commit:
```text
feat: add free geometry schema
```

### M2 — legacy adapter
Commit:
```text
feat: adapt legacy project elements to geometry
```

### M3 — renderer
Commit:
```text
feat: render generic geometry primitives
```

### M4 — AI contract
Commit:
```text
feat: transform full geometry documents with ai
```

### M5 — preview/apply
Commit:
```text
feat: apply ai geometry documents
```

### M6 — imports/presets
Commit:
```text
feat: preserve legacy json compatibility
```

### M7 — PDF
Commit:
```text
feat: export generic geometry projects
```

### M8 — cleanup
Remover dependências centrais de:
```text
profile catalog
role enum
material validation
ai_ops
```
somente depois da compatibilidade funcionar.

Commit:
```text
refactor: remove structural constraints from geometry core
```

## 19. NÃO NEGOCIÁVEIS

1. NÃO refazer o projeto do zero.
2. NÃO criar nova aplicação paralela.
3. GeometryElement vira núcleo.
4. Material não é obrigatório.
5. Profile não é obrigatório.
6. Role não é enum fechado.
7. Group não é enum fechado.
8. Renderer depende de geometry.type.
9. IA devolve documento completo.
10. IA não devolve mini-operações.
11. Mesh é escape universal.
12. JSON antigo continua abrindo durante a migração.
13. Preview/diff/apply/undo continuam.
14. Gemini e Z.ai continuam.
15. Um servidor continua.
16. BOM vira opcional.
17. PDF não pode ditar o schema.
18. LED é um caso de uso, não o limite da ferramenta.
19. O CAD desenha geometria, não materiais.
20. Qualquer geometria válida deve poder existir mesmo que o sistema não conheça seu significado.

## 20. RESULTADO FINAL ESPERADO

No final, o sistema deve poder receber:

```text
texto
imagem
PDF
croqui
JSON
```

e transformar em geometria livre.

A IA deve poder gerar algo nunca programado antes usando os primitives existentes.

Se necessário:
```text
mesh
```

resolve o restante.

O operador corrige a IA em linguagem natural.

A IA reescreve o JSON.

O CAD valida e renderiza.
