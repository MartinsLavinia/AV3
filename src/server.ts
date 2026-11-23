
import "dotenv/config";
import { prisma } from "./infrastructure/prisma.js";
import { filaAnalitica } from "./infrastructure/filaAnalitica.js";
import { criarAplicacao } from "./app.js";

const app = criarAplicacao();

let encerramentoEmAndamento = false;

async function encerrarServidor(sinal: NodeJS.Signals) {
  if (encerramentoEmAndamento) return;
  encerramentoEmAndamento = true;
  app.log.info({ sinal }, "Encerrando servidor de forma graciosa.");

  try {
    // Fastify para de aceitar conexões e aguarda as requisições em andamento.
    await app.close();
  } catch (erro) {
    app.log.error(erro, "Erro ao fechar o servidor HTTP.");
    process.exitCode = 1;
  } finally {
    try {
      // A fila global mantém uma conexão Redis independente da instância HTTP.
      await filaAnalitica.close();
    } catch (erro) {
      app.log.error(erro, "Erro ao fechar a fila analítica.");
      process.exitCode = 1;
    }

    // Desconecta do banco somente depois de encerrar as requisições.
    try {
      await prisma.$disconnect();
    } catch (erro) {
      app.log.error(erro, "Erro ao desconectar o Prisma.");
      process.exitCode = 1;
    }
  }
}

const iniciarServidor = async () => {
  try {
    await app.listen({
      port: Number(process.env.PORT) || 3000,
      host: "0.0.0.0",
    });
    process.once("SIGINT", () => void encerrarServidor("SIGINT"));
    process.once("SIGTERM", () => void encerrarServidor("SIGTERM"));
  } catch (erro) {
    app.log.error(erro);
    await filaAnalitica.close().catch((erroFechamento) => {
      app.log.error(erroFechamento, "Erro ao fechar a fila analítica após falha de inicialização.");
    });
    await prisma.$disconnect();
    process.exitCode = 1;
  }
};

iniciarServidor();
