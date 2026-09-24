# Deploy na VPS — LED CAD

Kit de deploy para Ubuntu 22.04/24.04 **do zero**. A versão canônica é sempre a branch `main` no GitHub (`Liboreiroduh/led-cad2`).

## Arquitetura do deploy

| Componente | Escolha |
|---|---|
| Runtime | [Bun](https://bun.sh) (install/build/start) |
| App | Next.js `output: standalone` → `bun run start` na porta **3000** |
| Proxy | Caddy (porta 80/443, HTTPS automático se houver domínio) |
| Serviço | systemd (`ledcad.service`) com restart automático |
| Banco | SQLite via Prisma → `/opt/ledcad/db/custom.db` (schema versionado em `prisma/migrations/`) |
| Dados runtime | `/opt/ledcad/data/` (projeto, revisões, presets, chaves de IA) |

> `data/` e `db/` estão no `.gitignore` → **nunca são sobrescritos** por `git pull` nos updates.

## 1. Primeiro deploy (VPS virgem)

SSH na VPS como root e rode **uma linha**:

```bash
# Com domínio (recomendado — aponte o DNS A record para o IP antes):
GITHUB_TOKEN=ghp_seuToken DOMAIN=app.seudominio.com bash <(curl -fsSL URL_DO_RAW/deploy/setup-vps.sh)

# Ou em 2 passos (recomendado): clonar e rodar o script localmente
GITHUB_TOKEN=ghp_seuToken git clone --depth 1 https://github.com/Liboreiroduh/led-cad2.git /tmp/ledcad && bash /tmp/ledcad/deploy/setup-vps.sh

# Sem domínio (acesso por IP, HTTP puro):
GITHUB_TOKEN=ghp_seuToken bash /tmp/ledcad/deploy/setup-vps.sh
```

- **`GITHUB_TOKEN`**: obrigatório se o repo for privado (PAT com escopo `repo` — GitHub → Settings → Developer settings → Personal access tokens). Se o repo for público, pode omitir.
- **`DOMAIN`**: opcional. Com domínio, o Caddy emite certificado HTTPS automaticamente (Let's Encrypt).

O script faz: pacotes base → swap 2G → usuário `ledcad` → Bun → clone → `.env` → `bun install` → Prisma → `build` → systemd → Caddy → firewall (ufw: 22/80/443).

## 2. Updates (deploy de versões futuras)

No PC: commit + push na `main` (fluxo normal). Na VPS:

```bash
bash /opt/ledcad/deploy/update.sh
```

## 3. Chaves de IA (opcional)

Duas opções:
- **Pela UI** (recomendado): configure no app — fica salvo em `/opt/ledcad/data/ai_config.json` (nunca vai ao frontend).
- **Via `.env`**: edite `/opt/ledcad/.env` e adicione `ZAI_API_KEY=...` e/ou `GEMINI_API_KEY=...`, depois `systemctl restart ledcad`. Também é possível descomentar as linhas `Environment=` do [deploy/ledcad.service](ledcad.service).

## 4. Comandos úteis

```bash
systemctl status ledcad          # status do app
journalctl -u ledcad -f          # logs em tempo real
systemctl restart ledcad         # reiniciar app
systemctl reload caddy           # recarregar proxy
tail -f /var/log/caddy/*.log     # logs do proxy
```

## 5. Banco de dados

- **Chave de conexão (`DATABASE_URL`)**: definida em `/opt/ledcad/.env` (`file:/opt/ledcad/db/custom.db`) e também no [deploy/ledcad.service](ledcad.service). Não há login/usuários por design — o app é single-tenant.
- **Schema versionado**: [prisma/schema.prisma](../prisma/schema.prisma) com migrações em `prisma/migrations/`. O deploy aplica com `prisma migrate deploy` (idempotente — só aplica o que falta).
- **Modelos**: `project_state` (estado canônico do projeto), `revisions` (histórico/undo), `ai_provider_config` (chaves de IA, server-side only), `custom_presets`, `examples`.
- **Nova migração** (no PC, após editar o schema): `bunx prisma migrate dev --name descricao` → commit + push → `bash /opt/ledcad/deploy/update.sh` na VPS.
- **Verificação pós-deploy**: `curl -s http://127.0.0.1:3000/api/health` → deve responder `"database":"ok"`.

## 6. Backup

```bash
# Tudo que importa (dados + banco):
tar czf backup-$(date +%F).tgz -C /opt/ledcad data db .env
```

## 7. Health check

```bash
curl -s http://127.0.0.1:3000/api/health   # deve responder ok + "database":"ok"
```
