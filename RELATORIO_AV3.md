# Relatório de análise — GreenCode AV3

## Objetivo deste relatório

Este documento separa os requisitos descritos no enunciado da AV3 das recomendações de implementação para evoluir o código da AV2. O enunciado é tratado como especificação da atividade; as escolhas abaixo são propostas técnicas e podem ser ajustadas conforme os critérios do professor.

**Fontes analisadas:** `C:\Users\mlavi\Downloads\AV3.pdf` (5 páginas), documentação, schema Prisma, serviços, repositórios e rotas da AV2 em `C:\Users\mlavi\OneDrive\Documentos\FATEC\AV2`.

## Resumo executivo

A AV3 adiciona três capacidades ao backend GreenCode:

1. **Camada analítica:** métricas de eficiência operacional, rentabilidade estimada por tipo de equipamento e previsão de vida útil remanescente; resultados anteriores devem poder ser consultados.
2. **API pública para parceiros:** endpoints documentados, versionados, com chaves de API, permissões por parceiro e limite de requisições.
3. **Processamento assíncrono:** solicitação de relatório pesado cria um job, retorna um identificador e permite consultar o estado e obter o resultado depois.

Também exige um relatório técnico que justifique bibliotecas, persistência analítica, política de retry e evolução para muitos parceiros, além da compatibilidade Windows 10+ e Ubuntu 24.04.03+ e derivados.

## O que já existe na AV2 e pode ser aproveitado

- **Base tecnológica:** Node.js, TypeScript, Fastify, Prisma 7 e PostgreSQL já estão configurados.
- **Arquitetura em camadas:** rotas, controllers, services e repositories permitem incluir módulos sem concentrar regras na camada HTTP.
- **Domínio e dados operacionais:** organização, contrato, lote, equipamento, movimentação e configuração já cobrem parte das dimensões analíticas.
- **Autenticação interna:** JWT, papéis de usuário e plugin de autorização existentes servem às rotas internas. A chave de parceiro deve ser uma credencial separada, para limitar escopo e permitir revogação independente.
- **Relatório atual:** auditoria já calcula totais, distribuições, peso e estimativas financeiras contratuais. Pode continuar como relatório operacional simples; a nova camada analítica complementa-o com métricas temporais, agregações por tipo e previsões.
- **Atomicidade:** movimentações e transições de status usam transações Prisma, padrão que deve continuar para consistência de dados.

## Requisitos da AV3

### 1. Camada analítica

O enunciado pede serviços analíticos independentes, acessíveis por endpoints e/ou tarefas agendadas, usando Node.js, TypeScript e Prisma. As saídas mínimas são:

- **Eficiência operacional:** tempo médio entre entrada do lote e conclusão da triagem; identificação de gargalos e variações por operador/período.
- **Rentabilidade estimada por tipo:** valor médio de recuperação de materiais, considerando estado físico, marca e modelo.
- **Vida útil remanescente:** projeção de quando tipos de equipamento provavelmente atingirão estado inservível, usando regressão simples ou suavização exponencial e histórico de depreciação/falhas.
- **Histórico de análises:** salvar previsões/relatórios para consulta e comparação posterior com realizações.

O PDF cita `simple-statistics` ou `mathjs` como opções. Não exige ambas; a seleção deve decorrer da complexidade dos cálculos realmente implementados.

### 2. API pública documentada

- Endpoints destinados a parceiros, separados das rotas internas/administrativas.
- Autenticação com chave única por parceiro, gerada e administrada por módulo próprio.
- Permissões por chave, por exemplo somente leitura de rastreabilidade ou leitura e escrita de lotes.
- Limite de taxa por cliente, com `@fastify/rate-limit` sugerido.
- Documentação interativa OpenAPI/Swagger via `@fastify/swagger` e interface associada.
- Documentação de parâmetros, exemplos de requisição/resposta e erros possíveis.
- Versionamento explícito, preferencialmente no caminho, por exemplo `/api/v1/public/...`.

### 3. Jobs e relatórios assíncronos

- Uma requisição de relatório demorado publica um job em fila.
- A API responde sem esperar o processamento, entregando identificador da tarefa.
- O parceiro consulta status e obtém o arquivo/resultado quando concluído.
- O enunciado sugere BullMQ com Redis; retry deve ser definido e justificado no relatório técnico.
- O fluxo pode ser polling ou webhook; polling é o caminho inicial mais simples.

### 4. Entrega técnica, escala e compatibilidade

- Código-fonte completo da nova camada analítica e da API pública documentada.
- Relatório técnico justificando biblioteca estatística, tabelas analíticas, política de retry e evolução com centenas/milhares de parceiros.
- Compatibilidade com Windows 10+ e Ubuntu 24.04.03+ (e distribuições derivadas).

## Lacunas de dados encontradas na AV2

Estas limitações afetam a validade das análises e devem ser resolvidas ou explicitadas no relatório:

1. **Duração da triagem:** `Lote` tem `dataEntrada` e um status agregado, mas não possui `triagemIniciadaEm`/`triagemConcluidaEm`. A AV2 não registra transições de triagem como `Movimentacao`; o serviço muda status diretamente. Assim, não há histórico confiável para medir duração nem atribuir conclusão a operador.
2. **Ciclo físico e falhas:** `Equipamento` guarda somente estado físico atual. Alterações de estado físico não geram evento; portanto, não é possível reconstruir quando ocorreu uma falha ou quando o equipamento se tornou inservível.
3. **Preço/valor recuperado:** schema não contém valor de componentes recuperados, composição de materiais, preços unitários ou receita de venda. “Rentabilidade” só pode ser uma estimativa se forem adicionados parâmetros/tabelas de referência ou registros de recuperação. O relatório financeiro atual usa mensalidade de contratos, que não equivale à rentabilidade por equipamento.
4. **Dimensão de operador:** movimentações têm `responsavel` como texto e podem atribuir o usuário autenticado, mas os eventos de início/conclusão de triagem não são gravados. Agrupar por operador requer registrar o usuário e o evento em cada etapa.
5. **Tamanho do histórico:** dados antigos da AV2 não podem ser retroativamente inventados. Métricas temporais ficarão completas a partir da migração e coleta novas; a API deve indicar quantidade de amostras e limitações.

**Consequência:** antes de construir modelos preditivos, implementar eventos históricos e definições explícitas de valor. Um cálculo numérico sobre dados insuficientes não deve ser apresentado como previsão confiável.

## Arquitetura recomendada

Manter o monólito modular da AV2 nesta entrega. Separar módulos por responsabilidade, sem introduzir microsserviços prematuramente:

```text
src/
  analytics/       métricas, agregações e modelos estatísticos puros
  services/        regras e orquestração dos casos analíticos e de parceiros
  repositories/    consultas Prisma e persistência dos resultados/jobs
  routes/internal/ rotas já existentes da AV2
  routes/public/v1 rotas versionadas para parceiros
  plugins/         autenticação de parceiro, autorização por escopo,
                   rate limit e Swagger/OpenAPI
  workers/         consumidor BullMQ para relatórios demorados
```

Manter funções de cálculo sem dependência de Fastify ou Prisma facilita validar a matemática isoladamente. Services coordenam leitura, cálculo e gravação; repositories limitam consultas ao banco. O worker e o servidor HTTP podem iniciar como processos distintos usando os mesmos módulos e schema.

## Modelo de dados a considerar

Os nomes são sugestões, não exigências literais do enunciado.

### Parceiros e credenciais

- `Parceiro`: organização externa, estado ativo, limites/plano e timestamps.
- `ChaveApi`: parceiro, prefixo identificável, hash da chave, permissões/escopos, expiração/revogação, criadaEm e últimoUsoEm.
- Guardar somente hash da chave (ex.: SHA-256 de token aleatório de alta entropia); exibir o segredo completo apenas na criação. Não guardar chave em texto puro nem colocá-la em logs.

### Eventos para análises

- Adicionar timestamps de início/conclusão da triagem no lote, se a regra de negócio for uma única triagem por lote; alternativamente, preferir tabela append-only `EventoOperacional` com tipo de evento, lote/equipamento, usuário, timestamp e atributos necessários.
- Criar histórico append-only de mudanças de estado físico/falhas do equipamento, com estado anterior/novo, autor e data.
- Definir origem e valor dos materiais recuperados: por exemplo `RecuperacaoMaterial` e uma tabela de preços de referência versionada com vigência. Sem uma fonte de valores, nomear o indicador como estimativa ilustrativa, não lucro realizado.

### Resultados e jobs

- `ExecucaoAnalitica`: tipo de análise, parâmetros/escopo, versão do algoritmo, período da amostra, quantidade de amostras, resumo JSON, início/conclusão, status e erro sanitizado.
- `JobRelatorio`: UUID, parceiro solicitante, tipo/parâmetros, status, tentativas, timestamps e referência ao resultado/arquivo. Evitar guardar arquivos grandes como JSON no registro; armazenar artefato externo ou resultado compacto e devolver URL temporária, conforme infraestrutura disponível.
- Índices nas colunas de filtro frequente (`parceiroId`, status, data de criação, lote/equipamento e timestamp dos eventos). Retenção/expurgo deve ser definida para resultados e arquivos.

## Proposta de etapas de desenvolvimento

### Etapa 0 — Fechar definições de negócio e critérios de aceite

- Confirmar o que significa “conclusão da triagem”: conclusão por equipamento ou lote inteiro.
- Definir o evento que atribui operador, como lidar com reabertura e quais estados contam como falha/inservível.
- Definir fonte/fórmula para valor recuperável por equipamento e se valores são estimados ou realizados.
- Definir o escopo dos dados do parceiro: próprios dados da organização, dados agregados ou ambos.
- Fixar exemplos de entrada/saída e sucesso para cada endpoint público.

**Saída:** critérios documentados e decisões que evitam retrabalho no schema.

### Etapa 1 — Preparar fundação e compatibilidade

- Criar branch/backup lógico de trabalho da AV2 e iniciar a evolução dentro da AV3, preservando AV2 como referência/entrega anterior.
- Copiar/adaptar a base e rever scripts, `.env.example`, migrations e README sem copiar segredos ou dados locais.
- Adicionar dependências necessárias em versões compatíveis com Node/Fastify em uso; avaliar `simple-statistics`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `bullmq` e cliente Redis.
- Registrar configuração de Redis e chaves secretas em ambiente, com validação no boot e instruções de desenvolvimento.
- Manter migrações pequenas e reversíveis sempre que possível.

**Saída:** AV3 inicia localmente com configuração clara e schema migrado.

### Etapa 2 — Coletar fatos históricos necessários

- Registrar início/conclusão de triagem com data, usuário e lote/equipamentos segundo a definição aprovada.
- Registrar transições de estado físico/falhas como eventos imutáveis, em vez de sobrescrever o único estado conhecido.
- Adicionar dados de valor recuperável ou tabela de referência com origem, moeda, vigência e versão.
- Fazer alterações de estado e criação de evento na mesma transação Prisma.
- Definir quais registros legados ficam sem duração/valor e representá-los como ausentes, não como zero.

**Saída:** eventos futuros permitem calcular indicadores com rastreabilidade e amostras identificáveis.

### Etapa 3 — Implementar análises síncronas e persistência

- Começar por eficiência: duração `triagemConcluidaEm - dataEntrada` ou evento de lote, definindo tratamento de lotes abertos, cancelados e outliers.
- Agregar média, mediana, dispersão e contagem por período e operador; mediana ajuda quando poucos casos extremos distorcem a média.
- Estimar retorno por tipo/estado/marca/modelo apenas com uma fórmula e fonte de preço documentadas; mostrar moeda, intervalo temporal, amostra e incerteza.
- Construir previsão de vida útil com regressão simples apenas quando houver pontos históricos por tipo suficientes e variação observada. Limitar projeções a domínio plausível, informar horizonte e não projetar para fora da faixa de dados sem sinalização.
- Iniciar com `simple-statistics` caso regressão linear e estatística descritiva bastem; cálculos elementares podem ser funções próprias. `mathjs` é mais amplo e só se justifica se surgirem operações matriciais/numéricas adicionais.
- Persistir cada execução com versão do algoritmo, parâmetros, período e número de observações para permitir comparação e reprodutibilidade.

**Saída:** endpoints analíticos rápidos retornam resultados atuais e anteriores, com indicadores de qualidade/amostra.

### Etapa 4 — Criar API de parceiros versionada e documentada

- Preservar rotas AV2 como internas; registrar rotas públicas sob prefixo versionado, como `/api/v1/public`.
- Implementar criação/revogação/rotação de credenciais em área administrativa interna; nunca retornar segredo novamente após a emissão inicial.
- Validar chave por hash em tempo constante, verificar status/expiração e escopos da rota, associando cada chamada a parceiro.
- Aplicar autorização por escopo e isolamento por parceiro na consulta ao banco; não confiar em `organizacaoId` arbitrário enviado pelo cliente.
- Aplicar limite por chave/parceiro com resposta `429` e `Retry-After`; configurar armazenamento Redis do rate limit se múltiplas instâncias precisarem compartilhar contadores.
- Gerar OpenAPI a partir dos schemas Fastify e publicar Swagger UI em ambiente controlado; esconder ou restringir documentação conforme decisão do projeto, sem expor exemplos de segredos reais.
- Incluir idempotência na submissão de lote se retries do cliente puderem duplicar operações (chave de idempotência persistida e escopo por parceiro).

**Saída:** contrato público `/v1` navegável, autenticado, autorizado e limitado por parceiro.

### Etapa 5 — Executar relatórios pesados em fila

- Criar endpoint de solicitação que valida autorização/escopo, registra job e publica mensagem BullMQ; responder `202 Accepted` com `jobId` e URL de consulta.
- Implementar worker separado para consumir job, calcular dados, persistir execução/artefato e atualizar estado.
- Estados mínimos: `PENDENTE`, `PROCESSANDO`, `CONCLUIDO`, `FALHOU` (e opcionalmente `CANCELADO`). Endpoint de status deve confirmar que o job pertence ao parceiro autenticado.
- Usar retries limitados para falhas transitórias, com backoff exponencial e jitter; não repetir erros permanentes de validação. Registrar erro resumido sem dados sensíveis.
- Tornar o processamento idempotente para que reentrega da fila não gere resultados duplicados. Definir timeout, concorrência, retenção de jobs concluídos e limpeza de jobs antigos.
- Implementar polling no primeiro corte (`GET /jobs/:id` e endpoint/download de resultado); webhook pode ser uma evolução com assinatura e política de reenvio.

**Saída:** relatórios grandes não bloqueiam requisições HTTP e têm ciclo de vida consultável.

### Etapa 6 — Documentar, validar e preparar entrega

- Completar OpenAPI com exemplos, autenticação, escopos, limites, códigos `400/401/403/404/409/429/500` e respostas assíncronas.
- Atualizar README para Windows e Ubuntu: versões, instalação, PostgreSQL, Redis, variáveis de ambiente, migrations, execução de API/worker e fluxo de chave.
- Criar massa de desenvolvimento com eventos suficientes e valores explicitamente fictícios; não misturar seed com dados reais.
- Verificar cenários de chave inválida/revogada, permissão insuficiente, isolamento entre parceiros, rate limit, retentativa e idempotência; comparar cálculo analítico com casos conhecidos.
- Documentar limitações estatísticas, tamanho de amostra, semântica de estimativas e plano de escala.

**Saída:** código, documentação interativa e relatório técnico coerentes com os dados que realmente existem.

## Decisões eficientes e boas práticas

- **Não duplicar a lógica da AV2:** reaproveitar serviços/regras já existentes e manter a API pública como adaptador com escopos próprios.
- **Consultas no banco:** selecionar apenas colunas necessárias, agregar no PostgreSQL quando fizer sentido e paginar grandes conjuntos; evitar carregar todas as movimentações para memória sem limite.
- **Análises reprodutíveis:** guardar versão do algoritmo, janela temporal, filtros e quantidade da amostra junto ao resultado.
- **Previsões honestas:** retornar `insufficient_data`/amostra insuficiente quando faltarem observações. Não inferir falhas a partir do estado atual isolado.
- **Segurança de credenciais:** gerar token aleatório forte, guardar hash, suportar rotação/revogação, restringir escopos e nunca registrar headers de autenticação.
- **Separação de dados:** todas as leituras/escritas públicas devem ser escopadas ao parceiro no servidor; aplicar rate limit por identidade autenticada, não apenas IP.
- **Fila resiliente:** Redis/BullMQ não substitui persistência de negócio; banco guarda estado consultável, fila coordena execução. Tratar publicação e registro de job com padrão confiável, como outbox, caso seja necessário eliminar a janela entre gravar no banco e publicar no Redis.
- **Escala gradual:** começar com uma instância Fastify e worker separado; usar Redis compartilhado, métricas e limites. Com crescimento, escalar workers horizontalmente, particionar filas por tipo/prioridade, controlar concorrência, cachear consultas agregadas e arquivar resultados antigos. Só extrair serviços quando volume/isolamento operacional justificarem.

## Riscos e pontos para decidir cedo

| Ponto | Risco se ficar indefinido | Recomendação inicial |
|---|---|---|
| Fonte do valor de recuperação | “Rentabilidade” sem preço vira número inventado | Criar tabela versionada de referência ou registrar valor realizado; expor estimativa com premissas claras |
| Eventos de triagem | Não há duração nem operador históricos | Gravar timestamps e usuário em transição, na mesma transação |
| Histórico de falhas/estado físico | Modelo preditivo não tem série temporal | Eventos imutáveis de estado/falha; começar previsão apenas após acumular amostras |
| Escopo do parceiro | Vazamento entre organizações | Vincular credencial a organização/escopos e forçar filtro no backend |
| Fila e Redis | Dependência operacional nova em Windows/Linux | Documentar instalação/configuração e manter processo HTTP inicializável sem executar worker no mesmo ciclo de vida |
| Compatibilidade de plugins | Incompatibilidade de versões Fastify | Fixar versões compatíveis com Fastify 5 e registrar versões no lockfile |

## Sequência visual do fluxo assíncrono

```text
Parceiro -> API pública -> valida chave/escopo -> persiste Job -> fila Redis
    ^                                                  |             |
    |                                                  |             v
    +--- consulta status/download <--- PostgreSQL <--- Worker BullMQ
```

## Critério de conclusão por etapa

1. **Definições:** métricas, fonte de valor, escopo do parceiro e estados aprovados.
2. **Histórico:** novos eventos são gravados atomicamente e dados legados ausentes são identificados.
3. **Análises:** cada indicador tem fórmula, amostra, período e limitações claros; resultados persistem.
4. **API pública:** OpenAPI navegável; chaves e escopos validados; isolamento e rate limit funcionam.
5. **Fila:** job retorna rápido, muda de estado, respeita retry e entrega resultado ao parceiro dono.
6. **Entrega:** guia de Windows/Ubuntu e relatório técnico cobrem arquitetura, dependências, modelo de dados, retry e escala.

## Conclusão

A AV3 aproveita uma base arquitetural adequada da AV2, mas não é apenas uma expansão de endpoints. O trabalho crítico é adicionar histórico de eventos e definir a fonte dos valores usados nas análises; depois, construir a fronteira de confiança para parceiros e o worker assíncrono. A ordem recomendada reduz retrabalho: fechar semântica, instrumentar o domínio, produzir análises verificáveis, abrir API pública com autorização/isolamento e então expor relatórios pesados por fila.
