import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    cppEngine?: {
      evaluate: (prompt: string) => unknown;
    };
    transcend?: {
      evaluate: (payload: Record<string, unknown>) => { allow: boolean; requires_human_approval: boolean; violations: string[] };
    };
  }
}