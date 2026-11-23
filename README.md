# GreenCode — API REST AV3

API REST para logística reversa de equipamentos eletrônicos. O projeto evolui a base da AV2 com análises operacionais, integração autenticada para organizações parceiras e geração assíncrona de relatórios.

## Começar

Recomendado para desenvolvimento local: Windows 10+ com Docker Desktop e Docker Compose v2. O Compose sobe API, worker BullMQ, PostgreSQL e Redis.

Crie o arquivo `.env` copiando `.env.example` e renomeando a cópia para `.env`. Você pode fazer isso pelo Explorador de Arquivos; não é necessário executar um script para copiar o arquivo.

`JWT_SECRET` deve ser uma chave aleatória mantida fora do controle de versão. Não reutilize a chave de exemplo em produção.

Gere uma chave aleatória no terminal, dentro da pasta do projeto:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie a chave gerada e cole no `.env`, substituindo o valor de exemplo. Depois execute:

```powershell
docker compose up --build -d
docker compose ps
```

- API: <http://localhost:3000>
- Swagger UI: <http://localhost:3000/documentation>
- OpenAPI JSON: <http://localhost:3000/documentation/json>

Consulte o [guia de instalação e operação](docs/README.md) para comandos Windows/Linux, migrações, testes e recuperação dos serviços.

## O que a API oferece

- Autenticação de usuários internos por JWT e autorização por papel.
- Gestão de organizações, contratos, lotes, equipamentos, movimentações e triagem.
- Análise operacional da triagem, valor estimado de recuperação e vida útil remanescente.
- Histórico persistido das execuções analíticas para auditoria.
- API pública versionada para parceiros, autenticada por chave e limitada à organização vinculada.
- Solicitação assíncrona de relatórios com BullMQ, Redis, polling e idempotência.

Esta entrega é um backend HTTP/JSON; não inclui frontend. Parceiros e ferramentas de teste usam a API REST e sua documentação OpenAPI.

## Documentação

- [Instalação, configuração e operação](docs/README.md)
- [Referência da API REST e exemplos](docs/API.md)
- [Relatório técnico e decisões de arquitetura](docs/DECISOES_TECNICAS.md)
- [Workflow de validação Linux](.github/workflows/testes-linux.yml)

## Tecnologias principais

Node.js 22, TypeScript, Fastify 5, Prisma ORM 7, PostgreSQL 16, Redis 7, BullMQ e `simple-statistics`.

## Estado de validação

A jornada integrada mais recente executada localmente no Windows passou com 324 verificações, incluindo geração de relatórios, isolamento dos parceiros, retries, retomada do worker, scheduler e recuperação de job após reinício controlado do Redis. A validação Linux é executada pelo workflow do GitHub Actions; confira o resultado do commit na aba **Actions** do repositório.
