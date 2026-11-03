import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadSupabaseRootCa,
  postgresClientOptions,
  prismaTlsOptions,
} from './postgresTls.js';

const expectedFingerprint =
  '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';

describe('Supabase PostgreSQL TLS policy', () => {
  it('ships the official root CA with the expected DER fingerprint', () => {
    const certificate = new X509Certificate(loadSupabaseRootCa());
    expect(
      createHash('sha256').update(certificate.raw).digest('hex'),
    ).toBe(expectedFingerprint);
    expect(certificate.subject).toContain('CN=Supabase Root 2021 CA');
    expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.now());
  });

  it('rejects a missing or malformed CA instead of weakening TLS', () => {
    expect(() => new X509Certificate('not a certificate')).toThrow();
  });

  it('configures node-postgres with the CA and strict hostname validation', () => {
    const result = postgresClientOptions(
      'postgresql://user:password@db.example.supabase.co:5432/postgres?sslmode=require&sslrootcert=ignored',
    );
    expect(result.connectionString).not.toContain('sslmode');
    expect(result.connectionString).not.toContain('sslrootcert');
    expect((result as { ssl?: unknown }).ssl).toEqual({
      ca: expect.stringContaining('-----BEGIN CERTIFICATE-----'),
      rejectUnauthorized: true,
    });
  });

  it('leaves local PostgreSQL development connections unchanged', () => {
    expect(
      postgresClientOptions('postgresql://postgres:postgres@localhost:5432/ryanai'),
    ).toEqual({
      connectionString: 'postgresql://postgres:postgres@localhost:5432/ryanai',
    });
    expect(prismaTlsOptions('postgresql://postgres:postgres@localhost:5432/ryanai')).toEqual({});
  });

  it('uses Prisma 6 strict certificate acceptance and the bundled root path', () => {
    const result = prismaTlsOptions(
      'postgresql://user:password@db.example.supabase.co:5432/postgres?schema=public',
    ) as { datasources: { db: { url: string } } };
    const url = new URL(result.datasources.db.url);
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('sslaccept')).toBe('strict');
    expect(url.searchParams.get('sslcert')).toBe('certs/supabase-root-ca-2021.crt');
  });

  it('rejects malformed URLs without echoing credentials', () => {
    expect(() => postgresClientOptions('not a url')).toThrow('Invalid PostgreSQL connection URL');
  });
});
