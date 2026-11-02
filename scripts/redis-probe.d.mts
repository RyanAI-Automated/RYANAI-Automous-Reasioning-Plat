export interface RedisProbeOptions {
  timeoutMs?: number;
  tls?: import('node:tls').ConnectionOptions;
}
export function redisPing(connectionUrl: string, options?: RedisProbeOptions): Promise<void>;
