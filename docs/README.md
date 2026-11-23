# Guia de desenvolvimento e operação

Este guia cobre configuração local, inicialização, migrações, teste integrado e operação do GreenCode AV3. A API é um backend REST/JSON; a interface Swagger serve para explorar e testar os endpoints, mas não é um frontend de negócio.

## Requisitos

- Node.js 22 e npm.
- Docker Desktop com Docker Compose v2 no Windows, ou Docker Engine e Compose v2 em Ubuntu 24.04.03+.
- Se executar sem Docker: PostgreSQL 16 e Redis 7 acessíveis localmente.

O repositório usa Prisma ORM 7 e contém migrações PostgreSQL. Não conecte este projeto aos bancos da AV2.

## Opção recomendada: Docker Compose

Na raiz do repositório, crie o arquivo de ambiente a partir do exemplo:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Em Linux/macOS:

```bash
test -f .env || cp .env.example .env
```

Edite `.env` e substitua `JWT_SECRET` por um segredo aleatório com pelo menos 32 caracteres. As credenciais PostgreSQL do exemplo são apenas para desenvolvimento local. Nunca compartilhe `.env` nem o segredo de uma chave de parceiro.

Suba os serviços em segundo plano:

```powershell
docker compose up --build -d
docker compose ps -a
```

O Compose inicializa PostgreSQL 16, Redis 7, a migração e a API e worker em containers separados. São criados os bancos `AV3` e `AV3TESTES`; as portas publicadas são `3000` para API, `5433` para PostgreSQL e `6380` para Redis, limitadas à máquina local. O serviço `migrate` pode aparecer como `Exited (0)`: isso significa que aplicou as migrações e terminou normalmente.

Para logs e encerramento:

```powershell
docker compose logs -f api worker
docker compose down
```

Os volumes preservam PostgreSQL e Redis ao parar os containers. `docker compose down -v` apaga esses volumes e os dados locais; use somente se a intenção for realmente limpar o ambiente.

## Execução sem Docker

Crie bancos locais vazios `AV3` e `AV3TESTES`; configure a URL de cada banco no `.env`. Defina também `REDIS_URL`, `JWT_SECRET` e, se necessário, `PORT` e `ANALYTICS_WORKER_CONCURRENCY`.

Exemplo para desenvolvimento local:

```env
DATABASE_URL="postgresql://usuario:senha@localhost:5432/AV3?schema=public"
JOURNEY_DATABASE_URL="postgresql://usuario:senha@localhost:5432/AV3TESTES?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="segredo-aleatorio-de-pelo-menos-32-caracteres"
PORT=3000
ANALYTICS_WORKER_CONCURRENCY=2
SEED_DEMO_DATA=false
```

Instale, gere o cliente Prisma e aplique as migrações:

```bash
npm ci
npm exec -- prisma generate --config prisma7.config.ts
npm exec -- prisma migrate deploy --config prisma7.config.ts
```

Em terminais separados, inicie API e worker:

```bash
npm run dev
```

```bash
npm run build
npm run start:worker
```

`npm start` inicia a API compilada. O worker é um processo necessário para relatórios de parceiros e schedulers; sem ele, relatórios ficam aguardando na fila.

## Primeira configuração da API

Depois de iniciar a API, acesse:

- API: <http://localhost:3000>
- Swagger UI: <http://localhost:3000/documentation>
- OpenAPI JSON: <http://localhost:3000/documentation/json>
- Saúde básica: `GET /`
- Conexão PostgreSQL: `GET /teste-banco`

Consulte `GET /auth/status`. Se não houver administrador cadastrado, faça o provisionamento único por `POST /auth/setup` com nome, e-mail e senha. Depois autentique por `POST /auth/login`; use o JWT como `Authorization: Bearer <token>`. O token expira em 30 minutos. O seed não cria administrador.

## Teste de jornada

Configure `JOURNEY_DATABASE_URL` apontando para um PostgreSQL **local de desenvolvimento/teste** e `REDIS_URL` para um Redis local. A jornada recusa hosts remotos. O usuário do PostgreSQL precisa criar e remover schemas.

```bash
npm run build
npm run test:journey
```

O teste cria um schema aleatório, aplica nele as migrações e remove somente esse schema ao final. Não aponta a URL de jornada para produção. A bateria cobre fluxos internos, relatórios, API pública, isolamento entre organizações, idempotência, retries, parada/retomada do worker e scheduler; uma execução local recente no Windows passou com 324 verificações. No Windows, a verificação de encerramento do processo com `SIGTERM` é ignorada porque esse sinal não é entregue ao filho como em Unix.

O workflow [testes-linux.yml](../.github/workflows/testes-linux.yml) executa build e jornada no runner Ubuntu 24.04 com PostgreSQL e Redis como serviços. Consulte a aba **Actions** do GitHub para verificar o resultado do commit que será entregue.

## Seed de demonstração

O seed é somente para desenvolvimento e é opt-in:

```env
SEED_DEMO_DATA=true
```

Depois execute `npm run db:seed`. O seed cria contas de demonstração, organização, contrato, lote, equipamentos e referências fictícias. Ele não cria administrador. Reexecutá-lo pode redefinir senha e papel das contas demo; não o execute em banco produtivo.

## Operação e recuperação de tarefas assíncronas

O Redis do Compose usa AOF (`appendonly yes`), política `noeviction` e volume nomeado. Um job aguardando foi testado através de reinício controlado do Redis: o AOF preservou a tarefa e um worker voltou a processá-la. Durante indisponibilidade do Redis, novas solicitações podem falhar temporariamente. Se a tarefa já foi persistida, o parceiro pode repetir a solicitação com a mesma `Idempotency-Key` para tentar enfileirá-la novamente.

Inspecione ou reinicie serviços sem remover os volumes:

```powershell
docker compose ps -a
docker compose logs --tail 100 redis api worker
docker compose restart worker
docker compose restart redis
```

Depois da recuperação, aguarde Redis em estado `healthy`, confira os logs do worker e consulte `consultarStatus` com a chave da própria organização. Uma tarefa em `FALHA` exige novo pedido e nova chave de idempotência. Não use `docker compose down -v` como procedimento de recuperação.

O worker processa duas tarefas simultaneamente por padrão (`ANALYTICS_WORKER_CONCURRENCY`). Jobs concluídos são retidos no Redis por até 24 horas (limite de 1.000); jobs falhos, até 7 dias (limite de 5.000). O histórico de negócio dos pedidos concluídos fica em PostgreSQL.

## Documentos relacionados

- [Referência de endpoints, autenticação e exemplos](API.md)
- [Relatório técnico: arquitetura, decisões, métricas e limites](DECISOES_TECNICAS.md)
