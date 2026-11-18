import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
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
import { prisma } from "./infrastructure/prisma.js";

export function criarAplicacao(logger = true): FastifyInstance {
  const app = Fastify({ logger });
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET precisa estar configurado e ter pelo menos 32 caracteres.");
  }

  app.register(jwt, { secret: jwtSecret });
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

  app.get("/", async () => ({ mensagem: "API GreenCode AV3 funcionando!" }));
  app.get("/teste-banco", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { mensagem: "Conexão com PostgreSQL funcionando!" };
  });

  return app;
}
