import "dotenv/config";
import { Queue } from "bullmq";

export const NOME_FILA_ANALITICA = process.env.ANALYTICS_QUEUE_NAME ?? "relatorios-analiticos";
export const MAX_TENTATIVAS_ANALITICAS = 3;

const redisUrl = process.env.REDIS_URL;
const enderecoRedis = new URL(redisUrl ?? "redis://localhost:6380");
const opcoesConexao = {
  host: enderecoRedis.hostname,
  port: Number(enderecoRedis.port || 6379),
  ...(enderecoRedis.username ? { username: decodeURIComponent(enderecoRedis.username) } : {}),
  ...(enderecoRedis.password ? { password: decodeURIComponent(enderecoRedis.password) } : {}),
  ...(enderecoRedis.protocol === "rediss:" ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
} as const;

export function criarConexaoRedis() {
  return { ...opcoesConexao };
}

export const filaAnalitica = new Queue(NOME_FILA_ANALITICA, {
  connection: opcoesConexao,
  defaultJobOptions: {
    attempts: MAX_TENTATIVAS_ANALITICAS,
    backoff: { type: "custom" },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400, count: 5000 },
  },
});
