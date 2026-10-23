import { Pool, PoolClient } from 'pg';

export interface TenantContext {
  organizationId: string;
  userId: string;
  role: 'ADMIN' | 'ENGINEER' | 'AUDITOR';
}

export class MultiTenantIsolationEngine {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }

  /**
   * Execute scoped database queries within an isolated session context
   */
  async executeScopedQuery<T>(
    context: TenantContext,
    queryFn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');

      // Enforce Row Level Security session variables
      await client.query(`SET LOCAL app.current_org_id = '${context.organizationId}';`);
      await client.query(`SET LOCAL app.current_user_id = '${context.userId}';`);
      await client.query(`SET LOCAL app.current_user_role = '${context.role}';`);

      const result = await queryFn(client);

      await client.query('COMMIT;');
      return result;
    } catch (error) {
      await client.query('ROLLBACK;');
      throw error;
    } finally {
      client.release();
    }
  }
}