# Referência da API GreenCode AV3

Esta referência descreve as rotas herdadas da AV2 e as análises operacionais adicionadas à AV3. A API usa JSON e, por padrão, fica disponível em `http://localhost:3000`.

## Convenções

- Envie `Content-Type: application/json` quando a requisição tiver corpo JSON.
- Rotas protegidas exigem `Authorization: Bearer <token>` obtido em `/auth/login`.
- UUIDs identificam registros. Para equipamento, o parâmetro pode ser o UUID ou o código de barras interno.
- Datas devem usar formato ISO, normalmente `AAAA-MM-DD` ou timestamp ISO UTC.
- Erros de autorização retornam `401` para token ausente/inválido/expirado ou conta inativa, e `403` para papel sem permissão.
- Erros comuns: `400` validação/regra de negócio, `404` registro inexistente, `409` conflito de unicidade, vínculo ou versão. Uma exclusão bem-sucedida retorna `204`.

## Inicialização e autenticação

| Método | Rota | Acesso | Uso |
|---|---|---|---|
| `GET` | `/auth/status` | Público | Verifica se a configuração inicial já foi feita. |
| `POST` | `/auth/setup` | Público, somente antes do primeiro administrador | Cria o administrador inicial. |
| `POST` | `/auth/login` | Público | Valida e-mail/senha e retorna JWT e dados públicos do usuário. |

Exemplo de configuração inicial:

```json
{
  "nomeCompleto": "Administradora GreenCode",
  "email": "admin@greencode.local",
  "senha": "SenhaSegura@2026"
}
```

Exemplo de login:

```json
{
  "email": "admin@greencode.local",
  "senha": "SenhaSegura@2026"
}
```

Use o campo `token` da resposta em chamadas protegidas:

```http
Authorization: Bearer eyJ...
```

O token expira em 30 minutos. O cliente deve autenticar novamente após a expiração.

## Usuários — administrador

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/usuarios` | Cria usuário. Campos: `nomeCompleto`, `email`, `senha`, `papel`. |
| `GET` | `/usuarios` | Lista usuários. |
| `GET` | `/usuarios/:id` | Consulta usuário. |
| `PATCH` | `/usuarios/:id` | Altera um ou mais campos: `nomeCompleto`, `email`, `senha`, `papel`, `ativo`. |
| `DELETE` | `/usuarios/:id` | Exclui usuário, sujeito à regra de proteção do administrador inicial. |

Papéis válidos: `ADMINISTRADOR`, `OPERADOR_CADASTRO`, `GESTOR_ALMOXARIFADO` e `AUDITOR`. A senha precisa ter pelo menos 8 caracteres. A senha armazenada é um hash; ela não é devolvida nas respostas.

## Organizações — operador de cadastro

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/organizacoes` | Cadastra organização. |
| `GET` | `/organizacoes` | Lista organizações. |
| `GET` | `/organizacoes/:id` | Consulta organização. |
| `PATCH` | `/organizacoes/:id` | Edita os campos informados e exige `versao`. |
| `DELETE` | `/organizacoes/:id?versao=N` | Exclui se não houver contrato nem lote vinculado. |

Exemplo de cadastro:

```json
{
  "razaoSocial": "Empresa Exemplo Ltda.",
  "cnpj": "11222333000181",
  "inscricaoEstadual": "123456789",
  "enderecoCompleto": "Rua Exemplo, 100 - São Paulo/SP",
  "telefone": "11999990000",
  "email": "contato@exemplo.com"
}
```

O CNPJ é normalizado e validado pelos dígitos verificadores; não pode ser duplicado.

## Contratos — operador de cadastro

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/contratos` | Cria contrato para uma organização ativa sem contrato existente. |
| `GET` | `/contratos` | Lista contratos. |
| `GET` | `/contratos/:id` | Consulta contrato. |
| `PATCH` | `/contratos/:id` | Edita `dataVencimento`, `valorMensal`, `renovacaoAutomatica` e/ou `clausulas`, exigindo `versao`. |
| `DELETE` | `/contratos/:id?versao=N` | Exclui contrato com versão atual. |

Exemplo de cadastro:

```json
{
  "organizacaoId": "UUID_DA_ORGANIZACAO",
  "dataVencimento": "2027-10-22",
  "valorMensal": 1234.56,
  "renovacaoAutomatica": true,
  "clausulas": ["Coleta conforme cronograma acordado"]
}
```

`dataAssinatura` é gerada pelo sistema. A organização só pode ter um contrato; a data de vencimento precisa ser futura.

## Lotes — gestor de almoxarifado

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/lotes` | Registra lote de organização ativa. |
| `GET` | `/lotes` | Lista lotes. |
| `GET` | `/lotes/:id` | Consulta lote e seus dados relacionados. |
| `PATCH` | `/lotes/:id` | Edita `notaFiscal`, `transportadora`, `dataEntrada` e/ou `observacoes`, exigindo `versao`. |
| `DELETE` | `/lotes/:id?versao=N` | Exclui apenas lote sem equipamentos. |

Exemplo de cadastro:

```json
{
  "organizacaoId": "UUID_DA_ORGANIZACAO",
  "notaFiscal": "NF-2026-001",
  "transportadora": "Transportadora Exemplo",
  "dataEntrada": "2026-10-25",
  "observacoes": "Recebido no depósito principal"
}
```

`dataEntrada` pode ser omitida (o sistema usa a data atual) e, quando informada, deve estar entre hoje e os últimos 90 dias.

## Equipamentos — gestor de almoxarifado

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/equipamentos` | Adiciona equipamento a um lote. |
| `GET` | `/equipamentos` | Lista equipamentos. |
| `GET` | `/equipamentos/:identificador` | Consulta por UUID ou código de barras. |
| `PATCH` | `/equipamentos/:identificador` | Edita `tipo`, `marca`, `modelo`, `anoFabricacao` e/ou `pesoQuilogramas`; exige `versao`. |
| `DELETE` | `/equipamentos/:identificador?versao=N` | Exclui apenas equipamento sem movimentações. |
| `POST` | `/equipamentos/:identificador/triagem/iniciar` | Inicia triagem; corpo `{"versao": N}`. |
| `POST` | `/equipamentos/:identificador/triagem/concluir` | Conclui triagem; corpo `{"versao": N}`. |
| `POST` | `/equipamentos/:identificador/movimentacoes` | Registra movimentação e, se destino for status válido, transiciona o rastreamento. |
| `PATCH` | `/equipamentos/:identificador/estado-fisico` | Altera estado físico sem criar movimentação. |

Exemplo de inclusão:

```json
{
  "loteId": "UUID_DO_LOTE",
  "tipo": "NOTEBOOK",
  "marca": "Dell",
  "modelo": "Latitude",
  "anoFabricacao": 2022,
  "pesoQuilogramas": 2.4
}
```

O sistema gera o código de barras interno e a posição no lote. Tipos válidos: `COMPUTADOR_MESA`, `NOTEBOOK`, `MONITOR`, `IMPRESSORA`, `SERVIDOR`, `ROTEADOR`, `CABO_ESTRUTURADO`, `FONTE_ALIMENTACAO`.

Para movimentação, envie `destino`, `versao` e, opcionalmente, `observacao`. O responsável é derivado do usuário autenticado. Destinos livres registram local; destinos que correspondem a um status válido também alteram o rastreamento, respeitando as transições permitidas.

```json
{
  "destino": "EM_DESMONTE",
  "observacao": "Triagem concluída e encaminhado à bancada",
  "versao": 2
}
```

Estados físicos: `NOVO`, `BOM_ESTADO`, `USADO_LEVE`, `USADO_MODERADO`, `DANIFICADO_LEVE`, `DANIFICADO_GRAVE`, `INSERVIVEL`. Mudanças mais distantes na escala exigem justificativa. A versão é obrigatória. Cada mudança aceita grava estado anterior/novo, data/hora, responsável autenticado e justificativa em `HistoricoEstadoFisico`, atomicamente com a atualização. Reenviar o estado atual é rejeitado e não cria evento.

## Configurações — administrador

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/configuracoes` | Consulta parâmetros globais. |
| `PATCH` | `/configuracoes` | Altera um ou ambos os parâmetros. |

```json
{
  "aliquotaImposto": 12.5,
  "coeficienteDepreciacaoAnual": 0.1
}
```

Ambos aceitam números entre `0` e `100`. O patch exige ao menos um campo.

## Referências de recuperação — administrador

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/referencias-recuperacao` | Lista versões atuais e encerradas do catálogo. |
| `POST` | `/referencias-recuperacao` | Cadastra uma referência ativa. |
| `POST` | `/referencias-recuperacao/:id/revisoes` | Encerra a versão indicada e cria a próxima versão do mesmo critério. |
| `POST` | `/referencias-recuperacao/:id/encerrar` | Encerra a referência sem apagá-la. |

Todas as rotas exigem o papel `ADMINISTRADOR`. O corpo de criação inclui `tipo`, `estadoFisico`, `valorEstimado`, `fonte` e `justificativa`; `marca`, `modelo` e `moeda` são opcionais (`BRL` por padrão). O valor aceita até duas casas decimais e não pode ser negativo. Modelo específico exige marca. Referências gerais usam marca/modelo omitidos. Não pode haver duas referências ativas com os mesmos critérios, ignorando diferenças de maiúsculas/minúsculas.

A revisão exige `versao`, novo `valorEstimado`, `fonte` e `justificativa`. Se `moeda` for omitida, mantém-se a moeda anterior. A referência antiga é encerrada com responsável e motivo da substituição, e uma nova linha recebe a versão seguinte. O encerramento exige `versao` e `motivo`. Não há exclusão física; conflitos de versão retornam `409`.

## Auditoria — auditor

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/auditoria/equipamentos/:identificador/rastreamento` | Consulta equipamento e sua linha de rastreamento/movimentações. |
| `GET` | `/auditoria/historico` | Lista movimentações com paginação e filtros. |
| `GET` | `/auditoria/relatorio` | Gera relatório geral operacional e financeiro estimado. |

### Análise operacional — auditor

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/analises/eficiencia-operacional` | Calcula média, mediana e desvio padrão populacional dos tempos de triagem por lote, operador e mês; salva um snapshot histórico. |
| `GET` | `/analises/valor-recuperacao` | Estima valores de recuperação para equipamentos em processamento, com detalhamento por tipo, estado, marca e modelo e mediana por grupo/moeda; salva um snapshot histórico. |
| `GET` | `/analises/vida-util-remanescente` | Projeta quando equipamentos podem atingir `INSERVIVEL`, usando regressão linear do histórico de estados físicos; salva um snapshot histórico. |

Filtros opcionais: `dataInicio` e `dataFim` no formato `AAAA-MM-DD` ou timestamp ISO UTC; o recorte seleciona lotes pela data de entrada. A triagem de um equipamento é considerada concluída quando muda de `EM_TRIAGEM` para `AGUARDANDO_DESMONTE`. Um lote entra na análise após todos os seus equipamentos terem eventos de início e conclusão da triagem. O tempo do lote é calculado entre `dataEntrada` e a conclusão do último equipamento; o tempo por operador mede cada intervalo individual entre início e conclusão. O resumo, cada operador e cada mês informam quantidade, média, mediana e desvio padrão populacional em horas; a mediana reduz a influência de durações extremas e o desvio mostra a dispersão dos registros observados. Grupos sem observações retornam `null` para essas medidas. Cada resposta inclui `execucaoAnaliticaId`; o snapshot do resultado, parâmetros, período, versão do algoritmo, quantidade de amostras e auditor solicitante fica em `ExecucaoAnalitica`. Eventos anteriores à implantação da AV3 não são inferidos.

O relatório de recuperação não recebe filtros. Considera equipamentos em `AGUARDANDO_TRIAGEM`, `EM_TRIAGEM`, `AGUARDANDO_DESMONTE` ou `EM_DESMONTE`; estados posteriores de reaproveitamento, reciclagem, descarte e baixa ficam fora para evitar dupla contagem potencial. Para cada equipamento, seleciona a referência ativa mais específica compatível: tipo + estado + marca + modelo exatos; depois tipo + estado + marca; por fim tipo + estado sem marca/modelo. Sem correspondência, lista o equipamento sem estimativa. Totais, médias e medianas são separados por moeda; média e mediana consideram apenas equipamentos com referência. A mediana descreve o centro dos valores estimados, mas não quantifica incerteza de mercado. A soma e a média monetária continuam calculadas em centavos inteiros para preservar precisão. O detalhamento inclui a fonte, versão e critério da referência. Esses valores são estimativas, não receita realizada. Apenas `AUDITOR` pode gerar os relatórios.

A previsão de vida útil usa regressão linear simples da biblioteca `simple-statistics` por equipamento sobre o índice ordinal de estado físico (`NOVO` = 0 até `INSERVIVEL` = 6), com os eventos de `HistoricoEstadoFisico`. Só há projeção com pelo menos três eventos em datas distintas, sequência consistente e tendência positiva; o estado atual precisa coincidir com o último estado histórico. Projeções acima de 30 anos são omitidas. Para os demais casos, `motivoSemPrevisao` informa a limitação, em vez de inferir datas a partir de `anoFabricacao`. A resposta traz taxa de deterioração, R², horizonte estimado e data prevista, além de médias e medianas por tipo; também informa desvio padrão populacional quando há pelo menos duas projeções no tipo. Por ser extrapolação estatística de um histórico ainda limitado, a data é estimativa, não garantia de falha.

### Histórico de relatórios analíticos — auditor

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/analises/execucoes` | Lista execuções anteriores com paginação e filtros opcionais por tipo e período de geração. Retorna metadados, sem o JSON completo do resultado. |
| `GET` | `/analises/execucoes/:id` | Consulta todos os metadados e o snapshot completo de uma execução específica. |

As duas rotas são exclusivas do auditor. Na listagem, `pagina` inicia em 1 (padrão 1), `limite` vai de 1 a 100 (padrão 50), `tipo` aceita `EFICIENCIA_OPERACIONAL`, `VALOR_RECUPERACAO` ou `VIDA_UTIL_REMANESCENTE`, e `dataInicio`/`dataFim` filtram `geradoEm` em `AAAA-MM-DD` ou timestamp ISO UTC. A resposta inclui total e quantidade de páginas. A rota de detalhe retorna `404` quando o ID não existe e permite recuperar o resultado e as referências congeladas naquela execução, sem recalcular com dados ou parâmetros atuais.

Antes de iniciar a aplicação AV3, configure `DATABASE_URL` para um banco PostgreSQL próprio da AV3 (não reutilize o banco da AV2) e aplique a migration com `npm exec -- prisma migrate deploy`; depois gere o cliente com `npm exec -- prisma generate`.

Parâmetros opcionais de `/auditoria/historico`: `pagina` (padrão 1), `limite` (padrão 50, máximo 100), `equipamentoId` (UUID), `dataInicio` e `dataFim` (data `AAAA-MM-DD` ou timestamp ISO UTC). A resposta informa página, limite, total, total de páginas e movimentações.

O relatório inclui totais e distribuições operacionais, peso equivalente depreciado em quilogramas e estimativas mensais com imposto conforme contratos ativos. Não representa apuração fiscal nem receita efetivamente recebida.

## Saúde

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/` | Público | Confirma que a API está respondendo. |
| `GET` | `/teste-banco` | Público | Executa uma consulta simples no PostgreSQL. |
