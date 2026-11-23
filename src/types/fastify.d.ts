import type { EscopoChaveApi } from "../generated/prisma/enums.js";
import type { PapelUsuario } from "../generated/prisma/enums.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; papel: PapelUsuario };
    user: { sub: string; email: string; papel: PapelUsuario };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    apiParceiro: {
      chaveId: string;
      organizacaoId: string;
      permissoes: EscopoChaveApi[];
    } | null;
  }
}
