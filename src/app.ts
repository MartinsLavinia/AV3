import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import { organizacaoRoutes } from "./routes/organizacaoRoutes.js";
import { usuarioRoutes } from "./routes/usuarioRoutes.js";
import { loteRoutes } from "./routes/loteRoutes.js";
import { equipamentoRoutes } from "./routes/equipamentoRoutes.js";
import { contratoRoutes } from "./routes/contratoRoutes.js";
import { configuracaoRoutes } from "./routes/configuracaoRoutes.js";
import { auditoriaRoutes } from "./routes/auditoriaRoutes.js";
import { analiseOperacionalRoutes } from "./routes/analiseOperacionalRoutes.js";
import { analiseRecuperacaoRoutes } from "./routes/analiseRecuperacaoRoutes.js";
import { analiseVidaUtilRoutes } from "./routes/analiseVidaUtilRoutes.js";
import { historicoAnaliticoRoutes } from "./routes/historicoAnaliticoRoutes.js";
import { referenciaRecuperacaoRoutes } from "./routes/referenciaRecuperacaoRoutes.js";
import { chaveApiParceiroRoutes } from "./routes/chaveApiParceiroRoutes.js";
import { apiParceiroRoutes } from "./routes/apiParceiroRoutes.js";
import { chaveParaRateLimit } from "./plugins/apiParceiro.js";
import { prisma } from "./infrastructure/prisma.js";

const tagsOpenApi = [
  { name: "Saúde", description: "Verificações básicas da API e do PostgreSQL." },
  { name: "Autenticação", description: "Provisionamento inicial e autenticação de usuários internos." },
  { name: "Usuários", description: "Administração de contas e papéis internos." },
  { name: "Organizações", description: "Cadastro e consulta das organizações parceiras." },
  { name: "Contratos", description: "Gestão dos contratos das organizações." },
  { name: "Lotes", description: "Recebimento e acompanhamento de lotes." },
  { name: "Equipamentos", description: "Cadastro, triagem, condição física e movimentação de equipamentos." },
  { name: "Configurações", description: "Parâmetros globais do sistema." },
  { name: "Auditoria", description: "Rastreamento, movimentações e consultas de auditoria." },
  { name: "Análises", description: "Relatórios analíticos internos para usuários auditores." },
  { name: "Histórico analítico", description: "Consulta de execuções e snapshots de relatórios." },
  { name: "Referências de recuperação", description: "Catálogo administrável de estimativas de recuperação." },
  { name: "Chaves de parceiros", description: "Criação, consulta, renovação e revogação de chaves de API." },
  { name: "Parceiros v1", description: "Operações públicas autenticadas por chave de API e limitadas à organização da chave." },
];

function metadadosOpenApi(url: string, method: string) {
  const caminho = url.split("?")[0] ?? url;
  let tag = "Saúde";
  if (caminho.startsWith("/api/v1/public/")) tag = "Parceiros v1";
  else if (caminho.startsWith("/auth/")) tag = "Autenticação";
  else if (caminho.startsWith("/usuarios")) tag = "Usuários";
  else if (caminho.startsWith("/organizacoes/") && caminho.includes("/chaves-api")) tag = "Chaves de parceiros";
  else if (caminho.startsWith("/organizacoes")) tag = "Organizações";
  else if (caminho.startsWith("/contratos")) tag = "Contratos";
  else if (caminho.startsWith("/lotes")) tag = "Lotes";
  else if (caminho.startsWith("/equipamentos")) tag = "Equipamentos";
  else if (caminho.startsWith("/configuracoes")) tag = "Configurações";
  else if (caminho.startsWith("/auditoria")) tag = "Auditoria";
  else if (caminho.startsWith("/analises/execucoes")) tag = "Histórico analítico";
  else if (caminho.startsWith("/analises/")) tag = "Análises";
  else if (caminho.startsWith("/referencias-recuperacao")) tag = "Referências de recuperação";
  else if (caminho.startsWith("/chaves-api")) tag = "Chaves de parceiros";

  const descricoes: Record<string, string> = {
    "GET /": "Verificar saúde da API",
    "GET /teste-banco": "Verificar conexão com PostgreSQL",
    "GET /auth/status": "Consultar estado da configuração inicial",
    "POST /auth/setup": "Configurar administrador inicial",
    "POST /auth/login": "Autenticar usuário interno",
    "GET /auditoria/equipamentos/:identificador/rastreamento": "Consultar rastreamento de equipamento",
    "GET /auditoria/historico": "Consultar histórico de movimentações",
    "GET /auditoria/relatorio": "Gerar relatório geral de auditoria",
    "GET /analises/eficiencia-operacional": "Gerar relatório de eficiência operacional",
    "GET /analises/valor-recuperacao": "Gerar relatório de valor estimado de recuperação",
    "GET /analises/vida-util-remanescente": "Gerar previsão de vida útil remanescente",
    "GET /analises/execucoes": "Consultar histórico de execuções analíticas",
    "GET /chaves-api": "Listar chaves de API de parceiros",
    "POST /chaves-api/:id/revogar": "Revogar chave de API",
    "POST /chaves-api/:id/renovar": "Renovar chave de API",
    "POST /organizacoes/:organizacaoId/chaves-api": "Criar chave de API para uma organização",
    "POST /equipamentos/:identificador/triagem/iniciar": "Iniciar triagem de equipamento",
    "POST /equipamentos/:identificador/triagem/concluir": "Concluir triagem e encaminhar para desmontagem",
    "POST /equipamentos/:identificador/movimentacoes": "Registrar movimentação de equipamento",
    "PATCH /equipamentos/:identificador/estado-fisico": "Registrar alteração do estado físico",
    "GET /analises/execucoes/:id": "Consultar execução analítica salva",
    "GET /configuracoes": "Consultar configurações do sistema",
    "PATCH /configuracoes": "Atualizar configurações do sistema",
    "GET /referencias-recuperacao": "Listar referências de recuperação",
    "POST /referencias-recuperacao": "Cadastrar referência de recuperação",
    "POST /referencias-recuperacao/:id/revisoes": "Revisar valor de uma referência",
    "POST /referencias-recuperacao/:id/encerrar": "Encerrar referência de recuperação",
  };
  const chave = `${method.toUpperCase()} ${caminho}`;
  let summary = descricoes[chave];
  if (!summary) {
    const nomes: Record<string, [singular: string, plural: string]> = {
      Usuários: ["usuário", "usuários"],
      Organizações: ["organização", "organizações"],
      Contratos: ["contrato", "contratos"],
      Lotes: ["lote", "lotes"],
      Equipamentos: ["equipamento", "equipamentos"],
      "Chaves de parceiros": ["chave de API", "chaves de API"],
      "Referências de recuperação": ["referência de recuperação", "referências de recuperação"],
    };
    const [singular, plural] = nomes[tag] ?? [tag.toLowerCase(), tag.toLowerCase()];
    const acao = method.toUpperCase() === "GET"
      ? (caminho.includes(":") ? "Consultar" : "Listar")
      : method.toUpperCase() === "POST" ? "Criar" : method.toUpperCase() === "PATCH" ? "Atualizar" : "Excluir";
    summary = `${acao} ${method.toUpperCase() === "GET" && caminho.includes(":") || method.toUpperCase() !== "GET" ? singular : plural}`;
  }

  const papelPorTag: Record<string, string> = {
    Usuários: "ADMINISTRADOR",
    "Configurações": "ADMINISTRADOR",
    "Referências de recuperação": "ADMINISTRADOR",
    "Chaves de parceiros": "ADMINISTRADOR",
    Organizações: "OPERADOR_CADASTRO",
    Contratos: "OPERADOR_CADASTRO",
    Lotes: "GESTOR_ALMOXARIFADO",
    Equipamentos: "GESTOR_ALMOXARIFADO",
    Auditoria: "AUDITOR",
    Análises: "AUDITOR",
    "Histórico analítico": "AUDITOR",
  };
  const papel = papelPorTag[tag];

  const semAutenticacao = [
    "GET /", "GET /teste-banco", "GET /auth/status", "POST /auth/setup", "POST /auth/login",
  ].includes(chave);
  return { tag, summary, semAutenticacao, papel };
}

export function criarAplicacao(logger = true): FastifyInstance {
  const app = Fastify({ logger });
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET precisa estar configurado e ter pelo menos 32 caracteres.");
  }

  app.register(jwt, { secret: jwtSecret });

  app.addHook("onRoute", (route) => {
    const metodo = Array.isArray(route.method) ? route.method[0] : route.method;
    const metadados = metadadosOpenApi(route.url, metodo ?? "GET");
    const schema = (route.schema ??= {});
    schema.tags ??= [metadados.tag];
    schema.summary ??= metadados.summary;
    schema.description ??= metadados.semAutenticacao
      ? "Endpoint público da API."
      : metadados.tag === "Parceiros v1"
        ? "Operação de integração pública; a chave restringe o acesso à organização vinculada."
        : `Operação interna protegida por JWT${metadados.papel ? `; requer o papel ${metadados.papel}` : ""}.`;
    schema.security ??= metadados.semAutenticacao
      ? []
      : metadados.tag === "Parceiros v1"
        ? [{ apiKeyAuth: [] }]
        : [{ bearerAuth: [] }];
  });

  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "GreenCode API",
        description: "API interna e integração pública versionada para parceiros GreenCode.",
        version: "1.0.0",
      },
      servers: [{ url: "/", description: "Servidor atual" }],
      tags: tagsOpenApi,
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        },
      },
    },
  });
  app.register(async (health) => {
    health.get("/", async () => ({ mensagem: "API GreenCode AV3 funcionando!" }));
    health.get("/teste-banco", async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { mensagem: "Conexão com PostgreSQL funcionando!" };
    });
  });

  app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: false },
    staticCSP: true,
  });
  app.decorateRequest("apiParceiro", null);

  app.register(organizacaoRoutes);
  app.register(usuarioRoutes);
  app.register(loteRoutes);
  app.register(equipamentoRoutes);
  app.register(contratoRoutes);
  app.register(configuracaoRoutes);
  app.register(auditoriaRoutes);
  app.register(analiseOperacionalRoutes);
  app.register(analiseRecuperacaoRoutes);
  app.register(analiseVidaUtilRoutes);
  app.register(historicoAnaliticoRoutes);
  app.register(referenciaRecuperacaoRoutes);
  app.register(chaveApiParceiroRoutes);
  app.register(async (apiPublica) => {
    apiPublica.register(rateLimit, {
      max: 60,
      timeWindow: "1 minute",
      keyGenerator: chaveParaRateLimit,
    });
    apiPublica.register(apiParceiroRoutes);
  }, { prefix: "/api/v1/public" });

  return app;
}
