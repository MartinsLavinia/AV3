import type { FastifyInstance } from "fastify";
import { PapelUsuario } from "../generated/prisma/enums.js";
import { permitirPapeis } from "../plugins/jwt.js";
import { ChaveApiParceiroController } from "../controllers/ChaveApiParceiroController.js";

const padraoUuid = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const schemaParamsOrganizacao = {
  type: "object",
  additionalProperties: false,
  required: ["organizacaoId"],
  properties: { organizacaoId: { type: "string", pattern: padraoUuid } },
} as const;
const schemaParamsChave = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", pattern: padraoUuid } },
} as const;
const schemaQuery = {
  type: "object",
  additionalProperties: false,
  properties: { organizacaoId: { type: "string", pattern: padraoUuid } },
} as const;
const schemaCriacao = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "permissoes", "expiraEm"],
  properties: {
    nome: { type: "string", minLength: 3, maxLength: 80 },
    permissoes: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: ["RASTREAMENTO_LEITURA", "LOTES_CRIACAO", "RELATORIOS_LEITURA"] },
    },
    expiraEm: { type: "string", minLength: 10, maxLength: 35 },
  },
} as const;
const schemaRevogacao = {
  type: "object",
  additionalProperties: false,
  required: ["motivo"],
  properties: { motivo: { type: "string", minLength: 5, maxLength: 300 } },
} as const;
const schemaRenovacao = {
  type: "object",
  additionalProperties: false,
  required: ["expiraEm"],
  properties: { expiraEm: { type: "string", minLength: 10, maxLength: 35 } },
} as const;

export async function chaveApiParceiroRoutes(app: FastifyInstance) {
  const controller = new ChaveApiParceiroController();
  const somenteAdministrador = permitirPapeis(PapelUsuario.ADMINISTRADOR);

  app.get("/chaves-api", { schema: { querystring: schemaQuery }, preHandler: somenteAdministrador }, controller.listar);
  app.post("/organizacoes/:organizacaoId/chaves-api", {
    schema: { params: schemaParamsOrganizacao, body: schemaCriacao },
    preHandler: somenteAdministrador,
  }, controller.criar);
  app.post("/chaves-api/:id/revogar", {
    schema: { params: schemaParamsChave, body: schemaRevogacao },
    preHandler: somenteAdministrador,
  }, controller.revogar);
  app.post("/chaves-api/:id/renovar", {
    schema: { params: schemaParamsChave, body: schemaRenovacao },
    preHandler: somenteAdministrador,
  }, controller.renovar);
}
