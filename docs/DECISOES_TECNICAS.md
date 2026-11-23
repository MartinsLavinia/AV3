# Relatório técnico e decisões de arquitetura — GreenCode AV3

## 1. Objetivo e escopo

O GreenCode AV3 evolui o backend REST da AV2 para apoiar a operação de logística reversa e expor análises a usuários internos e organizações parceiras. Esta entrega é uma API HTTP/JSON, sem frontend de negócio. Swagger UI oferece uma interface interativa para consulta e teste do contrato OpenAPI.

O sistema permanece um monólito modular: API e worker são processos independentes, compartilham os módulos de domínio e persistem em PostgreSQL; BullMQ usa Redis para transportar os jobs. A separação por processo atende às tarefas demoradas sem introduzir a complexidade operacional de microsserviços.

```text
Cliente interno -- JWT --> Fastify API -- services/repositories --> Prisma --> PostgreSQL
Parceiro ------- API key -> rotas públicas /v1 ---------------------> PostgreSQL
                                       |                                ^
                                       +--> BullMQ --> Redis --> Worker-+
```

## 2. Organização do código

- `routes`: caminhos HTTP, validação de entrada, schemas OpenAPI e autorização da rota.
- `controllers`: conversão entre requisições/respostas HTTP e chamadas de serviços.
- `services`: regras de negócio, análises e orquestração.
- `repositories`: consultas e gravações por Prisma.
- `domain`: validações independentes de transporte, como CNPJ.
- `infrastructure`: conexões com PostgreSQL e Redis.
- `worker.ts`: consumo dos relatórios assíncronos e registro dos schedulers.

Essa organização mantém as regras fora da camada HTTP, facilita testes e aproveita o comportamento e os dados da AV2.

## 3. Usuários, autenticação e autorização

Usuários internos autenticam por e-mail e senha. A senha é protegida com `bcryptjs`; a API emite JWT com validade de 30 minutos. A configuração inicial do administrador ocorre uma única vez por `POST /auth/setup`, evitando uma conta privilegiada padrão no seed.

| Papel | Responsabilidade |
|---|---|
| `ADMINISTRADOR` | Contas, parâmetros globais, catálogo de referências e chaves de parceiros. |
| `OPERADOR_CADASTRO` | Organizações e contratos. |
| `GESTOR_ALMOXARIFADO` | Lotes, equipamentos, triagem, movimentações e estado físico. |
| `AUDITOR` | Consulta rastreamento, movimentações e relatórios; não altera dados. |

Chaves de API são credenciais de integração separadas de JWT e de papéis internos. Cada chave pertence a uma organização ativa, pode receber escopos específicos, tem expiração/revogação e só revela o segredo na criação ou renovação. O banco armazena hash SHA-256 de um segredo aleatório de alta entropia, não o segredo em texto puro. Uma organização pode ter várias chaves para separar sistemas ou setores.

As permissões públicas são `RASTREAMENTO_LEITURA`, `LOTES_CRIACAO` e `RELATORIOS_LEITURA`. Todas as leituras e relatórios públicos são limitados no servidor ao `organizacaoId` da chave; a submissão de lote deriva sua organização da credencial e ignora um ID de organização enviado pelo cliente.

O limite é 60 requisições por minuto por chave e retorna `429` com `Retry-After`. Atualmente o contador do plugin fica em memória, adequado a uma instância local. Em múltiplas instâncias ele deverá usar armazenamento compartilhado (por exemplo Redis) para aplicar uma cota única.

## 4. Camada analítica

As análises ficam em serviços/repositórios próprios. Auditores podem executá-las por endpoints internos síncronos; parceiros podem solicitar os mesmos tipos pela API pública assíncrona. O worker também gera snapshots globais agendados.

### 4.1 Eficiência operacional

O projeto define triagem de equipamento como concluída quando seu rastreamento passa de `EM_TRIAGEM` para `AGUARDANDO_DESMONTE`. Um lote só participa da análise quando todos os equipamentos têm ciclo de triagem completo. O tempo total do lote vai de `dataEntrada` até a conclusão do último equipamento; a duração por operador mede cada ciclo individual e atribui o responsável pelo evento de conclusão.

`TriagemEvento` registra início/conclusão com data/hora e responsável, na mesma transação que atualiza o equipamento. O relatório agrega quantidade, média, mediana e desvio padrão populacional por lote, operador e mês. Lotes antigos sem eventos não recebem datas ou operadores inventados; ficam fora da amostra e a resposta expõe a quantidade considerada.

### 4.2 Valor estimado de recuperação

`ReferenciaRecuperacao` é o catálogo administrável pelo `ADMINISTRADOR`. Guarda tipo, estado físico, marca/modelo opcionais, valor decimal, moeda, fonte, justificativa e vigência. O seed fornece referências explicitamente fictícias para demonstração; valores reais precisam de fontes atualizadas cadastradas pela organização.

O relatório seleciona a melhor referência ativa na ordem: tipo + estado + marca + modelo; tipo + estado + marca; tipo + estado sem marca/modelo. Equipamentos sem correspondência continuam no resultado sem valor estimado. Agrega por tipo e estado, calcula totais, médias e medianas por moeda e grava snapshot das referências usadas. A mediana usa `simple-statistics`; operações monetárias principais usam centavos inteiros/Decimal para evitar erros de ponto flutuante.

O nome da análise no sistema é `VALOR_RECUPERACAO`. É uma estimativa de recuperação baseada no catálogo, **não** lucro, margem líquida, receita realizada ou valor de venda confirmado. Não subtrai custos de coleta, triagem ou desmontagem porque esses custos não existem nos dados atuais.

### 4.3 Vida útil remanescente

`HistoricoEstadoFisico` registra transições imutáveis com equipamento, estado anterior/novo, data, responsável e justificativa; o evento é gravado na mesma transação da mudança do estado atual.

A regressão linear é calculada individualmente por equipamento sobre o índice ordinal de estado, de `NOVO` (0) a `INSERVIVEL` (6), usando datas observadas. São exigidos pelo menos três eventos em datas distintas, sequência consistente, estado atual igual ao último evento e tendência de deterioração positiva. A previsão tem horizonte máximo configurado de 30 anos. Sem dados suficientes ou coerentes, o relatório retorna motivo de ausência de previsão. O ano de fabricação não é tratado como um estado físico histórico, e a estimativa não é garantia de falha.

Por tipo de equipamento, o relatório apresenta quantidades com/sem projeção, média, mediana e desvio padrão dos horizontes estimados. `simple-statistics` fornece regressão, linha ajustada, R² e estatísticas descritivas.

### 4.4 Biblioteca estatística

Foi escolhida `simple-statistics`, citada no enunciado, porque as necessidades atuais são medidas descritivas e regressão linear simples. `mathjs` teria uma superfície maior do que os cálculos presentes justificam. Cálculos elementares e valores monetários em centavos continuam explícitos em TypeScript para manter as regras visíveis e a precisão financeira.

## 5. Persistência analítica e histórico

| Modelo | Finalidade |
|---|---|
| `TriagemEvento` | Histórico append-only de inícios e conclusões da triagem. |
| `HistoricoEstadoFisico` | Histórico append-only de alterações de condição física. |
| `ReferenciaRecuperacao` | Catálogo de valores estimados com fonte, vigência e versões. |
| `ExecucaoAnalitica` | Snapshot de cada relatório: tipo, data, parâmetros, amostra, versão do algoritmo, resultado e referências aplicadas quando pertinente. |
| `TarefaAnalitica` | Solicitação pública: organização/chave, tipo, parâmetros, idempotência, estado, tentativas e erro sanitizado. |

O histórico de execuções é paginado para listar metadados sem carregar todos os resultados; o detalhe devolve o snapshot salvo, sem recalcular usando valores atuais. A relação única entre tarefa e execução impede duas execuções persistidas para o mesmo pedido em reentregas normais do job.

Os snapshots históricos permitem comparação e auditoria manual de previsões passadas. A versão atual ainda não calcula automaticamente erro de previsão versus estado futuro nem ajusta o modelo a partir desse erro; esse ciclo pode ser adicionado quando houver volume e observações de realizações suficientes.

## 6. API REST e OpenAPI

As rotas internas existentes mantêm os caminhos e JWT da AV2. As rotas para integração externa ficam separadas em `/api/v1/public`, autenticadas por `x-api-key`. O prefixo versionado permite evoluir o contrato público sem surpreender parceiros que ainda usem uma versão anterior.

`@fastify/swagger` gera OpenAPI; `@fastify/swagger-ui` oferece a interface interativa em `/documentation`. O documento JSON fica em `/documentation/json`. As operações são agrupadas por domínio, têm resumos e indicam o esquema de autenticação: JWT nas rotas internas, chave de API nas rotas públicas e sem autenticação no provisionamento inicial e verificações de saúde. Schemas publicados detalham validações e exemplos implementados; `docs/API.md` complementa o contrato com campos, permissões por papel, estados, erros e respostas. A documentação de respostas internas ainda não é um catálogo OpenAPI completo; consultar `docs/API.md` para o contrato detalhado dessas operações.

Os endpoints públicos disponíveis são rastreamento de equipamento da própria organização, submissão de lote e solicitação/consulta de relatórios analíticos. Não há frontend de negócio nesta entrega; Swagger é uma ferramenta para desenvolvedores e parceiros explorarem o contrato.

## 7. Processamento assíncrono

O parceiro envia `POST /api/v1/public/relatorios` com um relatório e `Idempotency-Key`. A API persiste `TarefaAnalitica`, publica um job BullMQ e responde `202 Accepted` com ID e URLs para consultar status e resultado. O parceiro usa polling com a mesma chave de API. O resultado só é disponibilizado em `CONCLUIDA`; tarefa de outra organização não é revelada.

Estados de negócio: `AGUARDANDO`, `PROCESSANDO`, `CONCLUIDA` e `FALHA`. A chave de idempotência é única por organização e guarda hash do pedido: reenvio igual recupera a mesma tarefa; reutilização com outro conteúdo retorna conflito.

### Retry adotado

Uma tarefa pode ter três tentativas totais: processamento inicial e até duas repetições, após aproximadamente 3 e 5 segundos. A política é deliberadamente limitada e simples para o escopo local; o primeiro intervalo evita repetição imediata e o segundo permite breve recuperação de falha transitória sem alongar demais a resposta ao parceiro. Erros de processamento ficam resumidos e não revelam mensagens internas ao cliente.

Esta versão **não adiciona jitter nem backoff exponencial**. Para carga distribuída maior, atrasos fixos podem sincronizar reexecuções; o passo recomendado é introduzir jitter/backoff, classificar erros recuperáveis e permanentes e monitorar tentativas/fila. Essa limitação está registrada para não confundir a política implementada com a evolução futura.

### Redis, agendamento e limites de garantia

O worker é um processo/container separado, com concorrência padrão de dois jobs. BullMQ registra três schedulers globais diários às 02:00 em `America/Sao_Paulo`, um para cada tipo de relatório. Redis usa AOF, `noeviction` e volume nomeado. Jobs concluídos são retidos por até 24 horas (limite de 1.000) e falhos por até 7 dias (limite de 5.000); os registros históricos analíticos ficam em PostgreSQL.

O Redis foi reiniciado em validação com um job pendente em fila descartável; o AOF preservou o job e um consumidor posterior o concluiu. A jornada também verifica parada/retomada de worker, retries, falha final e disparo de scheduler temporário em um minuto. Isso valida recuperação de job pendente e cron, mas não simula interrupção de worker no meio do cálculo nem indisponibilidade prolongada.

A gravação da tarefa no PostgreSQL e a publicação no Redis não são uma transação distribuída. Se a publicação falhar depois da gravação, repetir a mesma `Idempotency-Key` tenta publicar novamente. O sistema ainda não tem outbox nem varredura periódica de tarefas sem job; para garantia automática sem depender do cliente repetir, essa é uma melhoria recomendada.

## 8. Escala: situação atual e evolução planejada

### Situação atual

- Uma API e um worker com concorrência padrão 2.
- PostgreSQL e Redis únicos via Docker Compose.
- Rate limit em memória por processo.
- Consultas analíticas processam as amostras carregadas pelos repositórios; históricos crescentes ainda precisam de controle de tamanho e observabilidade.
- Resultado e tarefa são persistidos em PostgreSQL; jobs transitórios têm retenção limitada no Redis.

Essa topologia é suficiente para desenvolvimento, demonstração e carga pequena. Ainda não representa operação comprovada para centenas ou milhares de integrações simultâneas.

### Próximas medidas se a adoção crescer

1. Executar várias instâncias da API atrás de balanceador e mover o rate limit para Redis compartilhado.
2. Escalar workers horizontalmente, ajustando concorrência com medições de CPU, memória, duração e profundidade da fila; se necessário, separar filas por prioridade/tipo.
3. Adicionar métricas e alertas para jobs aguardando/ativos/falhos, idade da tarefa mais antiga, tempo de execução, retries e saúde de Redis/PostgreSQL.
4. Adotar outbox ou reconciliação periódica para publicar tarefas persistidas ainda sem job e tratar tarefas que fiquem `PROCESSANDO` após encerramento abrupto.
5. Definir retenção/arquivamento para snapshots antigos, paginar consultas, otimizar agregações com índices/SQL e revisar pool/conexões do banco.
6. Avaliar cache de agregados somente quando a medição indicar gargalo; manter snapshots com versão e parâmetros para reprodutibilidade.

Essas medidas são um plano, não capacidades já implantadas. Microsserviços só devem ser considerados quando isolamento, volume ou equipes independentes justificarem a complexidade adicional.

## 9. Execução, compatibilidade e validação

O projeto usa Node.js 22, TypeScript, Fastify 5, Prisma ORM 7, PostgreSQL 16, Redis 7 e Docker Compose v2. A configuração Compose é usada no Windows com Docker Desktop e no Linux com Docker Engine/Compose. O workflow [testes-linux.yml](../.github/workflows/testes-linux.yml) prepara PostgreSQL e Redis no runner Ubuntu 24.04, gera Prisma Client, compila e executa a jornada; deve-se confirmar o check verde do commit na aba Actions antes de declarar validada a execução Linux.

A jornada integrada local mais recente no Windows passou com 324 verificações; ela aplica migrações em schema temporário e remove esse schema ao final. O teste de `SIGTERM` externo é ignorado no Windows devido à diferença de sinalização do processo filho. A verificação não deve ser executada apontando para banco de produção.

## 10. Materiais de consulta

- [Guia de desenvolvimento e operação](README.md)
- [Contrato REST, exemplos e respostas](API.md)
- [Schema e migrações Prisma](../prisma/schema.prisma)
- [Worker BullMQ](../src/worker.ts)
