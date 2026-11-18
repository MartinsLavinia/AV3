import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "./generated/prisma/client.js";
import { EstadoFisico, TipoRelatorioAnalitico } from "./generated/prisma/enums.js";
import { ValidadorCNPJ } from "./domain/validators/ValidadorCNPJ.js";

const databaseUrlOriginal = process.env.JOURNEY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrlOriginal) {
  throw new Error("Configure JOURNEY_DATABASE_URL no .env para executar a jornada em um schema temporário.");
}
const hostBanco = new URL(databaseUrlOriginal).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "::1"].includes(hostBanco)) {
  throw new Error("Por segurança, o teste de jornada aceita somente PostgreSQL local; configure JOURNEY_DATABASE_URL.");
}

const nomeSchema = `av3_jornada_${randomUUID().replaceAll("-", "")}`;
const urlBase = new URL(databaseUrlOriginal);
urlBase.searchParams.delete("schema");
const urlTeste = new URL(databaseUrlOriginal);
urlTeste.searchParams.set("schema", nomeSchema);
const pool = new Pool({ connectionString: urlBase.toString() });
const senhaTeste = "JornadaSegura@2026";
const validadorCNPJ = new ValidadorCNPJ();
let app: FastifyInstance | undefined;
let prisma: PrismaClient | undefined;
let schemaCriado = false;
let verificacoes = 0;

type Metodo = "GET" | "POST" | "PATCH" | "DELETE";
type Resposta = { status: number; json: () => any };
type RespostaFastify = { statusCode: number; body: string; json: () => any };

async function requisitar(
  metodo: Metodo,
  url: string,
  esperado: number,
  descricao: string,
  opcoes: { token?: string; corpo?: unknown } = {},
): Promise<Resposta> {
  const headers: Record<string, string> = {};
  if (opcoes.token) headers.authorization = `Bearer ${opcoes.token}`;
  if (opcoes.corpo !== undefined) headers["content-type"] = "application/json";
  const resposta = await (app!.inject({
    method: metodo,
    url,
    headers,
    ...(opcoes.corpo === undefined ? {} : { payload: JSON.stringify(opcoes.corpo) }),
  }) as unknown as Promise<RespostaFastify>);
  if (resposta.statusCode !== esperado) {
    throw new Error(
      `${descricao}: esperado HTTP ${esperado}, recebido ${resposta.statusCode}: ${resposta.body}`,
    );
  }
  verificacoes += 1;
  console.log(`[OK] ${descricao} (${esperado})`);
  return { status: resposta.statusCode, json: () => resposta.json() };
}

function iniciarProcessoNode(arquivo: string, argumentos: string[], ambiente = process.env) {
  const resultado = spawnSync(
    process.execPath,
    [resolve(arquivo), ...argumentos],
    { cwd: process.cwd(), env: ambiente, encoding: "utf8" },
  );
  if (resultado.stdout) process.stdout.write(resultado.stdout);
  if (resultado.stderr) process.stderr.write(resultado.stderr);
  if (resultado.status !== 0) {
    throw new Error(`Comando falhou (${arquivo} ${argumentos.join(" ")}).`);
  }
}

function cnpjValido(indice: number): string {
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calcular = (base: string, pesos: number[]) => {
    const soma = [...base].reduce((total, digito, i) => total + Number(digito) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  for (let n = indice; n < indice + 10000; n += 1) {
    const base = String(n).padStart(12, "0");
    const primeiro = calcular(base, pesos1);
    const cnpj = `${base}${primeiro}${calcular(`${base}${primeiro}`, pesos2)}`;
    if (validadorCNPJ.validar(cnpj)) return cnpj;
  }
  throw new Error("Não foi possível gerar um CNPJ de teste válido.");
}

function organizacao(cnpj: string, sufixo: string) {
  return {
    razaoSocial: `Organização Jornada ${sufixo}`,
    cnpj,
    inscricaoEstadual: "ISENTO",
    enderecoCompleto: `Rua de Teste, ${sufixo} - São Paulo/SP`,
    telefone: "11999990000",
    email: `contato.${sufixo}@jornada.local`,
  };
}

function dataFutura(anos: number) {
  const data = new Date();
  data.setFullYear(data.getFullYear() + anos);
  return data.toISOString().slice(0, 10);
}

function dataPassada(dias: number) {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  return data.toISOString().slice(0, 10);
}

async function executarJornada() {
  await pool.query(`CREATE SCHEMA "${nomeSchema}"`);
  schemaCriado = true;
  process.env.DATABASE_URL = urlTeste.toString();
  process.env.JWT_SECRET = randomBytes(48).toString("hex");
  process.env.NODE_ENV = "test";

  console.log(`Schema de teste isolado criado: ${nomeSchema}`);
  iniciarProcessoNode("node_modules/prisma/build/index.js", ["migrate", "deploy"]);

  const banco = await import("./infrastructure/prisma.js");
  prisma = banco.prisma;
  const aplicacao = await import("./app.js");
  app = aplicacao.criarAplicacao(false);
  await app.ready();

  await requisitar("GET", "/", 200, "endpoint de saúde responde");
  await requisitar("GET", "/teste-banco", 200, "endpoint confirma conexão com o banco");

  // Provisionamento, autenticação e autorização básica.
  let resposta = await requisitar("GET", "/auth/status", 200, "setup começa necessário");
  assert.equal(resposta.json().configuracaoInicialNecessaria, true);
  await requisitar("GET", "/organizacoes", 401, "rota protegida exige token");
  await requisitar("POST", "/auth/setup", 201, "provisionar administrador inicial", {
    corpo: { nomeCompleto: "Admin Jornada", email: "admin@jornada.local", senha: senhaTeste },
  });
  resposta = await requisitar("GET", "/auth/status", 200, "setup concluído após administrador inicial");
  assert.equal(resposta.json().configuracaoInicialNecessaria, false);
  await requisitar("POST", "/auth/setup", 409, "setup inicial bloqueado após primeiro uso", {
    corpo: { nomeCompleto: "Outro Admin", email: "outro@jornada.local", senha: senhaTeste },
  });
  await requisitar("POST", "/auth/login", 401, "login rejeita senha incorreta", {
    corpo: { email: "admin@jornada.local", senha: "senha-incorreta" },
  });

  resposta = await requisitar("POST", "/auth/login", 200, "login do administrador", {
    corpo: { email: "admin@jornada.local", senha: senhaTeste },
  });
  const adminToken = resposta.json().token as string;
  const adminInicialId = resposta.json().usuario.id as string;
  assert.ok(adminToken);
  const claims = JSON.parse(Buffer.from(adminToken.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(claims.exp - claims.iat, 30 * 60);
  verificacoes += 1;
  console.log("[OK] JWT expira em 30 minutos");
  await requisitar("GET", "/organizacoes", 401, "token inválido rejeitado", { token: "token.invalido" });

  const papeis = [
    { papel: "ADMINISTRADOR", email: "admin2@jornada.local", nome: "Admin Auxiliar" },
    { papel: "OPERADOR_CADASTRO", email: "operador@jornada.local", nome: "Operador Jornada" },
    { papel: "GESTOR_ALMOXARIFADO", email: "gestor@jornada.local", nome: "Gestor Jornada" },
    { papel: "AUDITOR", email: "auditor@jornada.local", nome: "Auditor Jornada" },
  ] as const;
  const tokens: Record<string, string> = { ADMINISTRADOR: adminToken };
  const idsUsuarios: Record<string, string> = {};
  for (const usuario of papeis) {
    resposta = await requisitar("POST", "/usuarios", 201, `administrador cria ${usuario.papel}`, {
      token: adminToken,
      corpo: { nomeCompleto: usuario.nome, email: usuario.email, senha: senhaTeste, papel: usuario.papel },
    });
    idsUsuarios[usuario.papel] = resposta.json().usuario.id;
    const login = await requisitar("POST", "/auth/login", 200, `login do papel ${usuario.papel}`, {
      corpo: { email: usuario.email, senha: senhaTeste },
    });
    tokens[usuario.papel] = login.json().token;
  }
  resposta = await requisitar("POST", "/usuarios", 201, "criar usuário para testar desativação", {
    token: adminToken,
    corpo: { nomeCompleto: "Conta Inativa", email: "inativo@jornada.local", senha: senhaTeste, papel: "AUDITOR" },
  });
  const usuarioInativoId = resposta.json().usuario.id as string;
  await requisitar("PATCH", `/usuarios/${usuarioInativoId}`, 200, "administrador desativa usuário", {
    token: adminToken,
    corpo: { ativo: false },
  });
  await requisitar("POST", "/auth/login", 401, "login de usuário inativo rejeitado", {
    corpo: { email: "inativo@jornada.local", senha: senhaTeste },
  });
  await requisitar("DELETE", `/usuarios/${usuarioInativoId}`, 204, "administrador exclui usuário inativo", { token: adminToken });
  await requisitar("POST", "/usuarios", 409, "e-mail de usuário duplicado rejeitado", {
    token: adminToken,
    corpo: { nomeCompleto: "Duplicado", email: "operador@jornada.local", senha: senhaTeste, papel: "AUDITOR" },
  });
  resposta = await requisitar("GET", "/usuarios", 200, "administrador lista usuários", { token: adminToken });
  assert.equal(resposta.json().usuarios.length, 5);
  assert.equal("senhaHash" in resposta.json().usuarios[0], false);
  await requisitar("GET", "/usuarios", 403, "operador não acessa administração de usuários", { token: tokens.OPERADOR_CADASTRO });
  await requisitar("DELETE", `/usuarios/${adminInicialId}`, 409, "administrador inicial protegido contra exclusão", { token: tokens.ADMINISTRADOR });
  await requisitar("DELETE", `/usuarios/${adminInicialId}`, 403, "usuário não pode excluir a própria conta", { token: adminToken });
  await requisitar("DELETE", `/usuarios/${idsUsuarios.ADMINISTRADOR}`, 204, "administrador exclui conta auxiliar", { token: adminToken });
  tokens.ADMINISTRADOR = adminToken;

  // Matriz de papéis para as áreas principais.
  const matriz = [
    ["/configuracoes", "ADMINISTRADOR"],
    ["/referencias-recuperacao", "ADMINISTRADOR"],
    ["/usuarios", "ADMINISTRADOR"],
    ["/organizacoes", "OPERADOR_CADASTRO"],
    ["/contratos", "OPERADOR_CADASTRO"],
    ["/lotes", "GESTOR_ALMOXARIFADO"],
    ["/equipamentos", "GESTOR_ALMOXARIFADO"],
    ["/auditoria/historico", "AUDITOR"],
    ["/auditoria/relatorio", "AUDITOR"],
    ["/analises/eficiencia-operacional", "AUDITOR"],
    ["/analises/valor-recuperacao", "AUDITOR"],
    ["/analises/vida-util-remanescente", "AUDITOR"],
    ["/analises/execucoes", "AUDITOR"],
  ] as const;
  for (const [rota, papelPermitido] of matriz) {
    for (const papel of ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"]) {
      const permitido = papel === papelPermitido;
      await requisitar("GET", rota, permitido ? 200 : 403, `${papel} ${permitido ? "acessa" : "não acessa"} ${rota}`, {
        token: tokens[papel],
      });
    }
  }

  // Configuração global e validações.
  await requisitar("PATCH", "/configuracoes", 403, "operador não altera configurações", {
    token: tokens.OPERADOR_CADASTRO,
    corpo: { aliquotaImposto: 8.5 },
  });
  await requisitar("PATCH", "/configuracoes", 400, "alíquota fora do intervalo rejeitada", {
    token: adminToken,
    corpo: { aliquotaImposto: 101 },
  });
  resposta = await requisitar("PATCH", "/configuracoes", 200, "administrador configura percentuais", {
    token: adminToken,
    corpo: { aliquotaImposto: 8.5, coeficienteDepreciacaoAnual: 12.5 },
  });
  assert.equal(resposta.json().aliquotaImposto, 8.5);
  await requisitar("GET", "/configuracoes", 200, "administrador consulta configuração salva", { token: adminToken });

  // Catálogo de referências: permissões, validação, revisão append-only e encerramento.
  resposta = await requisitar("GET", "/referencias-recuperacao", 200, "administrador lista referências de recuperação", { token: adminToken });
  assert.deepEqual(resposta.json().referencias, []);
  await requisitar("POST", "/referencias-recuperacao", 403, "operador não cadastra referências de recuperação", {
    token: tokens.OPERADOR_CADASTRO,
    corpo: { tipo: "NOTEBOOK", estadoFisico: "BOM_ESTADO", valorEstimado: 300, fonte: "Teste", justificativa: "Teste" },
  });
  await requisitar("POST", "/referencias-recuperacao", 400, "valor com mais de duas casas decimais rejeitado", {
    token: adminToken,
    corpo: { tipo: "NOTEBOOK", estadoFisico: "BOM_ESTADO", valorEstimado: 300.123, fonte: "Cotação teste", justificativa: "Base de teste" },
  });
  resposta = await requisitar("POST", "/referencias-recuperacao", 201, "administrador cadastra referência específica", {
    token: adminToken,
    corpo: {
      tipo: "NOTEBOOK",
      estadoFisico: "BOM_ESTADO",
      marca: "Apple",
      modelo: "Air",
      valorEstimado: 320,
      fonte: "Cotação de demonstração",
      justificativa: "Valor fornecido para validar a jornada.",
    },
  });
  const referenciaId = resposta.json().referencia.id as string;
  assert.equal(resposta.json().referencia.criadaPor, "admin@jornada.local");
  await requisitar("POST", "/referencias-recuperacao", 409, "critérios ativos duplicados rejeitados sem diferenciar maiúsculas", {
    token: adminToken,
    corpo: {
      tipo: "NOTEBOOK", estadoFisico: "BOM_ESTADO", marca: "APPLE", modelo: "air",
      valorEstimado: 310, fonte: "Outra cotação", justificativa: "Duplicata intencional.",
    },
  });
  resposta = await requisitar("POST", `/referencias-recuperacao/${referenciaId}/revisoes`, 201, "administrador cria nova versão sem sobrescrever anterior", {
    token: adminToken,
    corpo: { versao: 1, valorEstimado: 345.5, fonte: "Cotação revisada", justificativa: "Atualização da referência." },
  });
  const referenciaVersao2 = resposta.json().referencia;
  assert.equal(referenciaVersao2.versao, 2);
  assert.equal(referenciaVersao2.valorEstimado, "345.5");
  assert.equal(referenciaVersao2.moeda, "BRL");
  const referenciaVersao1 = await prisma!.referenciaRecuperacao.findUniqueOrThrow({ where: { id: referenciaId } });
  assert.equal(referenciaVersao1.ativa, false);
  assert.equal(referenciaVersao1.encerradaPor, "admin@jornada.local");
  await requisitar("POST", `/referencias-recuperacao/${referenciaVersao2.id}/revisoes`, 409, "versão antiga de referência rejeitada", {
    token: adminToken,
    corpo: { versao: 1, valorEstimado: 360, fonte: "Cotação", justificativa: "Tentativa desatualizada." },
  });
  resposta = await requisitar("POST", `/referencias-recuperacao/${referenciaVersao2.id}/encerrar`, 200, "administrador encerra referência preservando histórico", {
    token: adminToken,
    corpo: { versao: 2, motivo: "Referência substituída para validar o encerramento." },
  });
  assert.equal(resposta.json().referencia.ativa, false);
  assert.equal(resposta.json().referencia.encerradaPor, "admin@jornada.local");
  resposta = await requisitar("GET", "/referencias-recuperacao", 200, "catálogo mantém versões encerradas para consulta", { token: adminToken });
  assert.equal(resposta.json().referencias.length, 2);

  // Organização e contrato: CRUD, CNPJ, unicidade, versões e vínculos.
  const operador = tokens.OPERADOR_CADASTRO!;
  const orgBody = organizacao(cnpjValido(101), "principal");
  await requisitar("POST", "/organizacoes", 400, "CNPJ inválido rejeitado", {
    token: operador,
    corpo: { ...orgBody, cnpj: "11222333000100" },
  });
  resposta = await requisitar("POST", "/organizacoes", 201, "criar organização", { token: operador, corpo: orgBody });
  const orgId = resposta.json().id as string;
  const orgVersao1 = resposta.json().versao as number;
  await requisitar("POST", "/organizacoes", 409, "CNPJ duplicado rejeitado", { token: operador, corpo: orgBody });
  await requisitar("GET", "/organizacoes", 200, "listar organizações", { token: operador });
  await requisitar("GET", `/organizacoes/${orgId}`, 200, "consultar organização", { token: operador });
  await requisitar("PATCH", `/organizacoes/${orgId}`, 400, "CNPJ inválido na edição rejeitado", {
    token: operador,
    corpo: { cnpj: "11222333000100", versao: orgVersao1 },
  });
  resposta = await requisitar("PATCH", `/organizacoes/${orgId}`, 200, "editar organização", {
    token: operador,
    corpo: { razaoSocial: "Organização Jornada Atualizada", versao: orgVersao1 },
  });
  const orgVersaoAtual = resposta.json().versao as number;
  await requisitar("PATCH", `/organizacoes/${orgId}`, 409, "versão antiga de organização rejeitada", {
    token: operador,
    corpo: { telefone: "11888887777", versao: orgVersao1 },
  });

  const orgLivreBody = organizacao(cnpjValido(202), "livre");
  resposta = await requisitar("POST", "/organizacoes", 201, "criar organização sem vínculos", { token: operador, corpo: orgLivreBody });
  const orgLivreId = resposta.json().id as string;
  const orgLivreVersao = resposta.json().versao as number;
  resposta = await requisitar("PATCH", `/organizacoes/${orgLivreId}`, 200, "desativar organização", {
    token: operador,
    corpo: { ativo: false, versao: orgLivreVersao },
  });
  const orgLivreVersaoInativa = resposta.json().versao as number;
  await requisitar("POST", "/contratos", 409, "contrato em organização inativa rejeitado", {
    token: operador,
    corpo: { organizacaoId: orgLivreId, dataVencimento: dataFutura(1), valorMensal: 100 },
  });

  const contratoBody = {
    organizacaoId: orgId,
    dataVencimento: dataFutura(1),
    valorMensal: 1250.5,
    renovacaoAutomatica: true,
    clausulas: ["Contrato de teste da jornada"],
  };
  resposta = await requisitar("POST", "/contratos", 201, "criar contrato", { token: operador, corpo: contratoBody });
  const contratoId = resposta.json().id as string;
  const contratoVersao1 = resposta.json().versao as number;
  await requisitar("POST", "/contratos", 409, "segundo contrato para organização rejeitado", { token: operador, corpo: contratoBody });
  await requisitar("GET", "/contratos", 200, "listar contratos", { token: operador });
  await requisitar("GET", `/contratos/${contratoId}`, 200, "consultar contrato", { token: operador });
  resposta = await requisitar("PATCH", `/contratos/${contratoId}`, 200, "editar contrato", {
    token: operador,
    corpo: { valorMensal: 1250.5, renovacaoAutomatica: true, versao: contratoVersao1 },
  });
  const contratoVersaoAtual = resposta.json().versao as number;
  await requisitar("PATCH", `/contratos/${contratoId}`, 409, "versão antiga de contrato rejeitada", {
    token: operador,
    corpo: { valorMensal: 900, versao: contratoVersao1 },
  });

  // Lote, datas, CRUD e bloqueio de exclusão por dependências.
  const gestor = tokens.GESTOR_ALMOXARIFADO!;
  const loteBody = {
    organizacaoId: orgId,
    notaFiscal: "NF-JORNADA-001",
    transportadora: "Transportadora Jornada",
    dataEntrada: dataPassada(7),
    observacoes: "Lote criado pelo teste de jornada",
  };
  await requisitar("POST", "/lotes", 400, "data futura de lote rejeitada", {
    token: gestor,
    corpo: { ...loteBody, dataEntrada: dataFutura(1) },
  });
  await requisitar("POST", "/lotes", 400, "lote com mais de 90 dias rejeitado", {
    token: gestor,
    corpo: { ...loteBody, dataEntrada: dataPassada(91) },
  });
  await requisitar("POST", "/lotes", 409, "lote em organização inativa rejeitado", {
    token: gestor,
    corpo: { ...loteBody, organizacaoId: orgLivreId },
  });
  resposta = await requisitar("POST", "/lotes", 201, "criar lote", { token: gestor, corpo: loteBody });
  const loteId = resposta.json().id as string;
  const loteVersao1 = resposta.json().versao as number;
  assert.equal(resposta.json().statusProcessamento, "RECEBIDO");
  await requisitar("GET", "/lotes", 200, "listar lotes", { token: gestor });
  await requisitar("GET", `/lotes/${loteId}`, 200, "consultar lote", { token: gestor });
  resposta = await requisitar("PATCH", `/lotes/${loteId}`, 200, "editar lote", {
    token: gestor,
    corpo: { observacoes: "Observação atualizada", versao: loteVersao1 },
  });
  const loteVersaoAtual = resposta.json().versao as number;
  await requisitar("PATCH", `/lotes/${loteId}`, 409, "versão antiga de lote rejeitada", {
    token: gestor,
    corpo: { notaFiscal: "NF-ANTIGA", versao: loteVersao1 },
  });
  // Equipamentos, transições, justificativa, concorrência e agregado do lote.
  const equipamentoBody = (marca: string, posicao: number) => ({
    loteId,
    tipo: posicao === 1 ? "NOTEBOOK" : "MONITOR",
    marca,
    modelo: `Modelo Jornada ${posicao}`,
    anoFabricacao: 2022,
    pesoQuilogramas: posicao === 1 ? 2.4 : 3.1,
  });
  await requisitar("POST", "/equipamentos", 400, "tipo de equipamento inválido rejeitado", {
    token: gestor,
    corpo: { ...equipamentoBody("Marca Inválida", 1), tipo: "TABLET" },
  });
  resposta = await requisitar("POST", "/equipamentos", 201, "cadastrar primeiro equipamento", { token: gestor, corpo: equipamentoBody("Dell", 1) });
  const equipamento1 = resposta.json();
  resposta = await requisitar("POST", "/equipamentos", 201, "cadastrar segundo equipamento", { token: gestor, corpo: equipamentoBody("Samsung", 2) });
  const equipamento2 = resposta.json();
  const loteComEquipamentos = await requisitar("GET", `/lotes/${loteId}`, 200, "consultar versão do lote com equipamentos", { token: gestor });
  await requisitar("DELETE", `/lotes/${loteId}?versao=${loteComEquipamentos.json().versao}`, 409, "lote com equipamentos não pode ser excluído", { token: gestor });
  assert.equal(equipamento1.statusRastreamento, "AGUARDANDO_TRIAGEM");
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "lote continua recebido antes da triagem", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "RECEBIDO");
  await requisitar("GET", "/equipamentos", 200, "listar equipamentos", { token: gestor });
  await requisitar("GET", `/equipamentos/${equipamento1.id}`, 200, "consultar equipamento", { token: gestor });
  resposta = await requisitar("PATCH", `/equipamentos/${equipamento1.id}`, 200, "editar equipamento", {
    token: gestor,
    corpo: { marca: "Dell Jornada", versao: equipamento1.versao },
  });
  const equipamento1Versao = resposta.json().versao as number;
  await requisitar("PATCH", `/equipamentos/${equipamento1.id}`, 409, "versão antiga de equipamento rejeitada", {
    token: gestor,
    corpo: { marca: "Marca Antiga", versao: equipamento1.versao },
  });
  await requisitar("POST", `/equipamentos/${equipamento1.id}/triagem/concluir`, 409, "não conclui triagem antes de iniciar", {
    token: gestor,
    corpo: { versao: equipamento1Versao },
  });
  await requisitar("POST", `/equipamentos/${equipamento1.id}/movimentacoes`, 409, "não encaminha para desmonte antes da triagem", {
    token: gestor,
    corpo: { destino: "EM_DESMONTE", versao: equipamento1Versao },
  });
  await requisitar("PATCH", `/equipamentos/${equipamento1.id}/estado-fisico`, 400, "piora grande sem justificativa rejeitada", {
    token: gestor,
    corpo: { estadoFisico: "DANIFICADO_GRAVE", versao: equipamento1Versao },
  });
  assert.equal(await prisma!.historicoEstadoFisico.count({ where: { equipamentoId: equipamento1.id } }), 0);
  verificacoes += 1;
  console.log("[OK] tentativa inválida não cria histórico físico");
  resposta = await requisitar("PATCH", `/equipamentos/${equipamento1.id}/estado-fisico`, 200, "piora de estado com justificativa aceita", {
    token: gestor,
    corpo: { estadoFisico: "DANIFICADO_GRAVE", justificativa: "Dano constatado na inspeção", versao: equipamento1Versao },
  });
  let e1 = resposta.json().equipamento;
  const eventoEstadoFisico = await prisma!.historicoEstadoFisico.findFirst({
    where: { equipamentoId: equipamento1.id },
  });
  assert.ok(eventoEstadoFisico);
  assert.equal(eventoEstadoFisico.estadoAnterior, "USADO_LEVE");
  assert.equal(eventoEstadoFisico.estadoNovo, "DANIFICADO_GRAVE");
  assert.equal(eventoEstadoFisico.responsavel, "gestor@jornada.local");
  assert.equal(eventoEstadoFisico.justificativa, "Dano constatado na inspeção");
  const versaoAposMudanca = e1.versao;
  await requisitar("PATCH", `/equipamentos/${equipamento1.id}/estado-fisico`, 400, "estado físico sem mudança rejeitado", {
    token: gestor,
    corpo: { estadoFisico: "DANIFICADO_GRAVE", versao: versaoAposMudanca },
  });
  assert.equal(await prisma!.historicoEstadoFisico.count({ where: { equipamentoId: equipamento1.id } }), 1);
  assert.equal((await prisma!.equipamento.findUniqueOrThrow({ where: { id: equipamento1.id } })).versao, versaoAposMudanca);
  verificacoes += 1;
  console.log("[OK] mudança de estado registra autoria e justificativa sem duplicar evento em no-op");
  resposta = await requisitar("POST", `/equipamentos/${e1.id}/triagem/iniciar`, 200, "iniciar triagem do equipamento 1", {
    token: gestor,
    corpo: { versao: e1.versao },
  });
  e1 = resposta.json().equipamento;
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "lote passa para em triagem", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "EM_TRIAGEM");
  resposta = await requisitar("POST", `/equipamentos/${e1.id}/triagem/concluir`, 200, "concluir triagem do equipamento 1", {
    token: gestor,
    corpo: { versao: e1.versao },
  });
  e1 = resposta.json().equipamento;
  resposta = await requisitar("POST", `/equipamentos/${equipamento2.id}/triagem/iniciar`, 200, "iniciar triagem do equipamento 2", {
    token: gestor,
    corpo: { versao: equipamento2.versao },
  });
  let e2 = resposta.json().equipamento;
  resposta = await requisitar("POST", `/equipamentos/${e2.id}/triagem/concluir`, 200, "concluir triagem do equipamento 2", {
    token: gestor,
    corpo: { versao: e2.versao },
  });
  e2 = resposta.json().equipamento;
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "todos triados atualizam o lote", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "TRIAGEM_CONCLUIDA");

  resposta = await requisitar("GET", "/analises/eficiencia-operacional", 200, "auditor gera análise de eficiência operacional", { token: tokens.AUDITOR });
  const relatorioOperacional = resposta.json();
  assert.ok(relatorioOperacional.lotes.some((lote: { loteId: string }) => lote.loteId === loteId));
  const loteAnalisado = relatorioOperacional.lotes.find((lote: { loteId: string }) => lote.loteId === loteId);
  assert.equal(loteAnalisado.equipamentos, 2);
  assert.ok(relatorioOperacional.porOperador.some((item: { responsavel: string; equipamentosTriados: number }) => item.responsavel === "gestor@jornada.local" && item.equipamentosTriados === 2));
  assert.equal(typeof relatorioOperacional.resumo.tempoMedianoHoras, "number");
  assert.equal(typeof relatorioOperacional.resumo.desvioPadraoPopulacionalHoras, "number");
  const agregadoOperador = relatorioOperacional.porOperador.find((item: { responsavel: string }) => item.responsavel === "gestor@jornada.local");
  assert.equal(typeof agregadoOperador.duracaoMedianaTriagemHoras, "number");
  assert.equal(typeof agregadoOperador.desvioPadraoPopulacionalTriagemHoras, "number");
  const execucaoOperacional = await prisma!.execucaoAnalitica.findUniqueOrThrow({ where: { id: relatorioOperacional.execucaoAnaliticaId } });
  assert.equal(execucaoOperacional.tipo, "EFICIENCIA_OPERACIONAL");
  assert.equal(execucaoOperacional.quantidadeAmostras, relatorioOperacional.resumo.lotesConcluidos);
  assert.equal(execucaoOperacional.solicitadoPor, "auditor@jornada.local");
  assert.equal((execucaoOperacional.resultado as { lotes: Array<{ loteId: string }> }).lotes.some((lote) => lote.loteId === loteId), true);
  resposta = await requisitar("GET", "/analises/execucoes?tipo=EFICIENCIA_OPERACIONAL&pagina=1&limite=10", 200, "auditor lista histórico filtrado de relatórios", { token: tokens.AUDITOR });
  assert.ok(resposta.json().execucoes.some((item: { id: string }) => item.id === execucaoOperacional.id));
  assert.equal("resultado" in resposta.json().execucoes[0], false);
  resposta = await requisitar("GET", `/analises/execucoes/${execucaoOperacional.id}`, 200, "auditor consulta detalhe histórico do relatório", { token: tokens.AUDITOR });
  assert.deepEqual(resposta.json().resultado, execucaoOperacional.resultado);
  await requisitar("GET", `/analises/execucoes/${execucaoOperacional.id}`, 403, "gestor não consulta histórico analítico", { token: tokens.GESTOR_ALMOXARIFADO });
  await requisitar("GET", `/analises/execucoes/${randomUUID()}`, 404, "execução histórica inexistente retorna não encontrado", { token: tokens.AUDITOR });
  await requisitar("GET", "/analises/execucoes?limite=101", 400, "limite excessivo do histórico analítico rejeitado", { token: tokens.AUDITOR });
  await requisitar("GET", "/analises/execucoes?dataInicio=2026-12-01&dataFim=2026-01-01", 400, "período invertido do histórico analítico rejeitado", { token: tokens.AUDITOR });
  verificacoes += 1;
  console.log("[OK] relatório operacional agrega, persiste e pode ser consultado no histórico");

  resposta = await requisitar("GET", "/analises/vida-util-remanescente", 200, "auditor gera análise de vida útil remanescente", { token: tokens.AUDITOR });
  const relatorioVidaUtil = resposta.json();
  const vidaUtilEquipamento = relatorioVidaUtil.equipamentos.find((item: { equipamentoId: string }) => item.equipamentoId === e1.id);
  assert.equal(vidaUtilEquipamento.previsao, null);
  assert.equal(vidaUtilEquipamento.motivoSemPrevisao, "AMOSTRA_HISTORICA_INSUFICIENTE");

  const historicoSinteticoVidaUtil = [
    { estadoAnterior: EstadoFisico.USADO_LEVE, estadoNovo: EstadoFisico.USADO_MODERADO, dataHora: new Date("2023-01-01T00:00:00.000Z") },
    { estadoAnterior: EstadoFisico.USADO_MODERADO, estadoNovo: EstadoFisico.DANIFICADO_LEVE, dataHora: new Date("2024-01-01T00:00:00.000Z") },
    { estadoAnterior: EstadoFisico.DANIFICADO_LEVE, estadoNovo: EstadoFisico.DANIFICADO_GRAVE, dataHora: new Date("2025-01-01T00:00:00.000Z") },
  ];
  await prisma!.$transaction(async (tx) => {
    await tx.equipamento.update({ where: { id: e2.id }, data: { estadoFisico: EstadoFisico.DANIFICADO_GRAVE } });
    await tx.historicoEstadoFisico.createMany({
      data: historicoSinteticoVidaUtil.map((evento) => ({
        equipamentoId: e2.id,
        ...evento,
        responsavel: "gestor@jornada.local",
        justificativa: "Série histórica determinística para testar regressão na jornada.",
      })),
    });
  });
  resposta = await requisitar("GET", "/analises/vida-util-remanescente", 200, "regressão calcula previsão com histórico suficiente", { token: tokens.AUDITOR });
  const previsaoVidaUtil = resposta.json().equipamentos.find((item: { equipamentoId: string }) => item.equipamentoId === e2.id).previsao;
  assert.ok(previsaoVidaUtil.anosEstimados > 0 && previsaoVidaUtil.anosEstimados < 2);
  assert.ok(previsaoVidaUtil.coeficienteDeterminacao > 0.99);
  const grupoVidaUtil = resposta.json().porTipo.find((item: { tipo: string }) => item.tipo === "MONITOR");
  assert.equal(grupoVidaUtil.equipamentosComPrevisao, 1);
  assert.equal(typeof grupoVidaUtil.vidaUtilMedianaAnosRestantes, "number");
  assert.equal(grupoVidaUtil.desvioPadraoPopulacionalAnosRestantes, null);
  verificacoes += 1;
  console.log("[OK] simple-statistics prevê vida útil e resume a distribuição por tipo");
  const execucaoVidaUtil = await prisma!.execucaoAnalitica.findUniqueOrThrow({ where: { id: relatorioVidaUtil.execucaoAnaliticaId } });
  assert.equal(execucaoVidaUtil.tipo, "VIDA_UTIL_REMANESCENTE");
  assert.equal(execucaoVidaUtil.solicitadoPor, "auditor@jornada.local");
  verificacoes += 1;
  console.log("[OK] análise de vida útil sinaliza amostra insuficiente e persiste execução");

  await requisitar("POST", "/referencias-recuperacao", 201, "administrador cria referência exata para relatório de recuperação", {
    token: adminToken,
    corpo: {
      tipo: "NOTEBOOK", estadoFisico: "DANIFICADO_GRAVE", marca: "Dell Jornada", modelo: "Modelo Jornada 1",
      valorEstimado: 234, moeda: "BRL", fonte: "Cotação simulada para teste", justificativa: "Validação do nível de modelo exato.",
    },
  });
  await requisitar("POST", "/referencias-recuperacao", 201, "administrador cria referência por marca para relatório de recuperação", {
    token: adminToken,
    corpo: {
      tipo: "MONITOR", estadoFisico: "DANIFICADO_GRAVE", marca: "Samsung",
      valorEstimado: 125, moeda: "BRL", fonte: "Cotação simulada para teste", justificativa: "Validação do nível de marca.",
    },
  });
  resposta = await requisitar("GET", "/analises/valor-recuperacao", 200, "auditor gera análise de valor de recuperação", { token: tokens.AUDITOR });
  const relatorioRecuperacao = resposta.json();
  assert.equal(relatorioRecuperacao.resumo.equipamentosElegiveis, 2);
  assert.equal(relatorioRecuperacao.resumo.equipamentosComReferencia, 2);
  assert.equal(relatorioRecuperacao.resumo.equipamentosSemReferencia, 0);
  assert.deepEqual(relatorioRecuperacao.resumo.valoresPorMoeda, [{ moeda: "BRL", valorTotalEstimado: "359.00", valorMedioPorEquipamentoComReferencia: "179.50", valorMedianoPorEquipamentoComReferencia: "179.50" }]);
  assert.equal(relatorioRecuperacao.equipamentos.find((item: { equipamentoId: string }) => item.equipamentoId === e1.id).correspondencia.nivel, "MODELO_EXATO");
  assert.equal(relatorioRecuperacao.equipamentos.find((item: { equipamentoId: string }) => item.equipamentoId === e2.id).correspondencia.nivel, "MARCA");
  const execucaoRecuperacao = await prisma!.execucaoAnalitica.findUniqueOrThrow({ where: { id: relatorioRecuperacao.execucaoAnaliticaId } });
  assert.equal(execucaoRecuperacao.tipo, "VALOR_RECUPERACAO");
  assert.equal(execucaoRecuperacao.quantidadeAmostras, 2);
  assert.equal(execucaoRecuperacao.solicitadoPor, "auditor@jornada.local");
  assert.equal((execucaoRecuperacao.referenciasUsadas as unknown[]).length, 2);
  verificacoes += 1;
  console.log("[OK] relatório de recuperação aplica referências específicas e persiste snapshot com autoria");

  async function movimentar(id: string, destino: string, versao: number) {
    const movimento = await requisitar("POST", `/equipamentos/${id}/movimentacoes`, 201, `movimentar equipamento para ${destino}`, {
      token: gestor,
      corpo: { destino, versao, observacao: "Etapa verificada pelo teste de jornada" },
    });
    return movimento.json().equipamento;
  }
  e1 = await movimentar(e1.id, "EM_DESMONTE", e1.versao);
  e1 = await movimentar(e1.id, "PECAS_REAPROVEITADAS", e1.versao);
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "empate mantém etapa menos avançada", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "TRIAGEM_CONCLUIDA");
  e2 = await movimentar(e2.id, "EM_DESMONTE", e2.versao);
  e2 = await movimentar(e2.id, "MATERIAL_RECICLAVEL", e2.versao);
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "maioria encaminhada avança status do lote", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "ENCAMINHADO");
  await requisitar("DELETE", `/equipamentos/${e1.id}?versao=${e1.versao}`, 409, "equipamento com movimentações não pode ser excluído", { token: gestor });
  e1 = await movimentar(e1.id, "BAIXA_DEFINITIVA", e1.versao);
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "um equipamento finalizado não finaliza o lote", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "ENCAMINHADO");
  e2 = await movimentar(e2.id, "BAIXA_DEFINITIVA", e2.versao);
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "lote finaliza quando todos os equipamentos finalizam", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "FINALIZADO");

  resposta = await requisitar("POST", "/equipamentos", 201, "novo equipamento reabre processamento do lote", {
    token: gestor,
    corpo: equipamentoBody("Lenovo", 3),
  });
  const equipamento3 = resposta.json();
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "lote retorna a triagem com novo item", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "EM_TRIAGEM");
  await requisitar("DELETE", `/equipamentos/${equipamento3.id}?versao=${equipamento3.versao}`, 204, "excluir equipamento sem movimentações", { token: gestor });
  resposta = await requisitar("GET", `/lotes/${loteId}`, 200, "remoção recalcula e restaura finalização", { token: gestor });
  assert.equal(resposta.json().statusProcessamento, "FINALIZADO");

  // Auditoria somente consulta rastreamento, movimentos e relatório.
  const auditor = tokens.AUDITOR!;
  resposta = await requisitar("GET", `/auditoria/equipamentos/${e1.id}/rastreamento`, 200, "auditor consulta rastreamento", { token: auditor });
  assert.equal(resposta.json().movimentacoes.length, 3);
  resposta = await requisitar("GET", "/auditoria/historico?pagina=1&limite=2", 200, "auditor consulta histórico paginado", { token: auditor });
  assert.equal(resposta.json().limite, 2);
  assert.ok(resposta.json().total >= 6);
  await requisitar("GET", "/auditoria/historico?pagina=0", 400, "filtro inválido de histórico rejeitado", { token: auditor });
  resposta = await requisitar("GET", "/auditoria/relatorio", 200, "auditor gera relatório geral", { token: auditor });
  const financeiro = resposta.json().financeiroContratos;
  assert.equal(financeiro.contratosConsiderados, 1);
  assert.equal(financeiro.receitaMensalContratadaBruta, "1250.50");
  assert.equal(financeiro.aliquotaImpostoPercentual, 8.5);
  assert.equal(financeiro.impostoMensalEstimado, "106.29");
  assert.equal(financeiro.receitaMensalLiquidaEstimada, "1144.21");
  assert.ok("pesoEquivalenteDepreciadoKg" in resposta.json());
  assert.ok("descricaoPesoEquivalenteDepreciado" in resposta.json());
  await requisitar("POST", "/organizacoes", 403, "auditor não pode alterar cadastros", {
    token: auditor,
    corpo: orgBody,
  });

  // Bloqueios de exclusão por relações e exclusões permitidas sem dependências.
  await requisitar("DELETE", `/organizacoes/${orgId}?versao=${orgVersaoAtual}`, 409, "organização vinculada não pode ser excluída", { token: operador });
  await requisitar("DELETE", `/contratos/${contratoId}?versao=${contratoVersaoAtual}`, 204, "excluir contrato", { token: operador });
  await requisitar("DELETE", `/organizacoes/${orgId}?versao=${orgVersaoAtual}`, 409, "organização com lote permanece protegida", { token: operador });
  resposta = await requisitar("POST", "/lotes", 201, "criar lote vazio para testar exclusão", {
    token: gestor,
    corpo: { ...loteBody, notaFiscal: "NF-JORNADA-VAZIO" },
  });
  await requisitar("DELETE", `/lotes/${resposta.json().id}?versao=${resposta.json().versao}`, 204, "excluir lote vazio", { token: gestor });
  await requisitar("PATCH", `/organizacoes/${orgLivreId}`, 200, "reativar organização livre", {
    token: operador,
    corpo: { ativo: true, versao: orgLivreVersaoInativa },
  });
  resposta = await requisitar("POST", "/contratos", 201, "criar contrato para testar exclusão", {
    token: operador,
    corpo: { organizacaoId: orgLivreId, dataVencimento: dataFutura(1), valorMensal: 50 },
  });
  await requisitar("DELETE", `/contratos/${resposta.json().id}?versao=${resposta.json().versao}`, 204, "excluir contrato sem dependências", { token: operador });
  const orgLivreVersaoAtual = (await prisma!.organizacao.findUniqueOrThrow({ where: { id: orgLivreId }, select: { versao: true } })).versao;
  await requisitar("DELETE", `/organizacoes/${orgLivreId}?versao=${orgLivreVersaoAtual}`, 204, "excluir organização sem dependências", { token: operador });

  // Confere persistência das tabelas analíticas.
  const historicoFisico = await prisma!.historicoEstadoFisico.create({
    data: {
      equipamentoId: equipamento1.id,
      estadoAnterior: EstadoFisico.USADO_LEVE,
      estadoNovo: EstadoFisico.DANIFICADO_GRAVE,
      responsavel: "gestor@jornada.local",
      justificativa: "Histórico criado pela jornada de teste.",
    },
  });
  const execucaoAnalitica = await prisma!.execucaoAnalitica.create({
    data: {
      tipo: TipoRelatorioAnalitico.EFICIENCIA_OPERACIONAL,
      quantidadeAmostras: 1,
      versaoAlgoritmo: "teste-1",
      parametros: { periodo: "teste" },
      resultado: { tempoMedioHoras: 2.5 },
      solicitadoPor: "auditor@jornada.local",
    },
  });
  assert.equal(await prisma!.historicoEstadoFisico.count({ where: { id: historicoFisico.id } }), 1);
  assert.equal(await prisma!.execucaoAnalitica.count({ where: { id: execucaoAnalitica.id } }), 1);
  verificacoes += 1;
  console.log("[OK] tabelas de histórico físico e resultados analíticos persistem registros");

  // Confere que o seed pode ser executado mais de uma vez sem duplicar massa.
  const contagemAntes = await contarDados();
  const ambienteSeed = { ...process.env, SEED_DEMO_DATA: "true" };
  iniciarProcessoNode("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], ambienteSeed);
  iniciarProcessoNode("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], ambienteSeed);
  const contagemDepois = await contarDados();
  assert.deepEqual(contagemDepois, {
    organizacoes: contagemAntes.organizacoes + 1,
    contratos: contagemAntes.contratos + 1,
    lotes: contagemAntes.lotes + 1,
    equipamentos: contagemAntes.equipamentos + 2,
    movimentacoes: contagemAntes.movimentacoes + 1,
    usuarios: contagemAntes.usuarios + 3,
    referenciasRecuperacao: contagemAntes.referenciasRecuperacao + 5,
    historicosEstadosFisicos: contagemAntes.historicosEstadosFisicos,
    execucoesAnaliticas: contagemAntes.execucoesAnaliticas,
  });
  verificacoes += 1;
  console.log("[OK] seed repetido sem duplicar registros");

  await verificarEncerramentoGracioso();

  console.log(`\nJornada concluída: ${verificacoes} verificações passaram.`);
}

async function contarDados() {
  const [organizacoes, contratos, lotes, equipamentos, movimentacoes, usuarios, referenciasRecuperacao, historicosEstadosFisicos, execucoesAnaliticas] = await Promise.all([
    prisma!.organizacao.count(),
    prisma!.contrato.count(),
    prisma!.lote.count(),
    prisma!.equipamento.count(),
    prisma!.movimentacao.count(),
    prisma!.usuario.count(),
    prisma!.referenciaRecuperacao.count(),
    prisma!.historicoEstadoFisico.count(),
    prisma!.execucaoAnalitica.count(),
  ]);
  return { organizacoes, contratos, lotes, equipamentos, movimentacoes, usuarios, referenciasRecuperacao, historicosEstadosFisicos, execucoesAnaliticas };
}

async function verificarEncerramentoGracioso() {
  if (process.platform === "win32") {
    console.log("[SKIP] teste de SIGTERM externo: Windows não entrega esse sinal ao processo filho como Unix.");
    return;
  }
  const porta = await escolherPortaLivre();
  const filho = spawn(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "src/server.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(porta) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let saida = "";
  filho.stdout.setEncoding("utf8").on("data", (trecho) => { saida += trecho; });
  filho.stderr.setEncoding("utf8").on("data", (trecho) => { saida += trecho; });
  const encerrado = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    filho.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  let servidorRespondeu = false;
  for (let tentativa = 0; tentativa < 100; tentativa += 1) {
    if (filho.exitCode !== null) break;
    try {
      const resposta = await fetch(`http://127.0.0.1:${porta}/`);
      if (resposta.status === 200) {
        servidorRespondeu = true;
        break;
      }
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  if (!servidorRespondeu) {
    filho.kill("SIGTERM");
    await Promise.race([encerrado, new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
    throw new Error(`Servidor não iniciou para o teste de encerramento gracioso. Saída: ${saida}`);
  }

  filho.kill("SIGTERM");
  const resultado = await Promise.race([
    encerrado,
    new Promise<null>((resolveTimeout) => setTimeout(() => resolveTimeout(null), 10000)),
  ]);
  if (!resultado) {
    filho.kill("SIGKILL");
    throw new Error("Servidor não encerrou em 10 segundos após SIGTERM.");
  }
  assert.equal(resultado.code, 0, `Servidor encerrou com saída inesperada: ${saida}`);
  assert.ok(saida.includes("Encerrando servidor de forma graciosa."));
  verificacoes += 1;
  console.log("[OK] servidor encerra com SIGTERM e fecha recursos graciosamente");
}

async function escolherPortaLivre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolveListen, reject) => {
    servidor.once("error", reject);
    servidor.listen(0, "127.0.0.1", () => resolveListen());
  });
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string") throw new Error("Não foi possível obter porta local livre.");
  const porta = endereco.port;
  await new Promise<void>((resolveClose, reject) => {
    servidor.close((erro) => erro ? reject(erro) : resolveClose());
  });
  return porta;
}

async function main() {
  try {
    await executarJornada();
  } catch (erro) {
    console.error("\nJornada falhou:", erro);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch((erro) => console.error("Erro fechando Fastify:", erro));
    if (prisma) await prisma.$disconnect().catch((erro) => console.error("Erro desconectando Prisma:", erro));
    await pool.end();
    if (schemaCriado && /^av3_jornada_[0-9a-f]{32}$/.test(nomeSchema)) {
      const poolLimpeza = new Pool({ connectionString: urlBase.toString() });
      try {
        await poolLimpeza.query(`DROP SCHEMA "${nomeSchema}" CASCADE`);
        console.log(`Schema temporário removido: ${nomeSchema}`);
      } finally {
        await poolLimpeza.end();
      }
    }
  }
}

void main();
