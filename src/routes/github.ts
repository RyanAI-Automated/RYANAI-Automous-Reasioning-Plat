import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GitHubShipper, CommitAndPushOptions, CreatePullRequestOptions, CreateReleaseOptions } from '../services/githubShipper';

const shipper = new GitHubShipper();

/**
 * Register endpoints that create GitHub commits, pull requests, and releases.
 * Caught provider failures become HTTP 500 responses.
 */
export async function githubRoutes(fastify: FastifyInstance) {
  // Direct multi-file commit & shipping route
  fastify.post('/api/v1/github/ship', async (req: FastifyRequest<{ Body: CommitAndPushOptions }>, reply: FastifyReply) => {
    try {
      const payload = req.body;
      const result = await shipper.commitAndPushFiles(payload);

      return reply.send({
        success: true,
        action: 'COMMITTED_AND_PUSHED',
        commitSha: result.commitSha,
        branch: payload.branch,
        filesPushed: payload.files.length,
      });
    } catch (error: unknown) {
      fastify.log.error(error, 'GitHub ship operation failed');
      return reply.status(500).send({
        error: 'GITHUB_SHIP_FAILED',
        message: (error instanceof Error ? error.message : String(error)),
      });
    }
  });

  // Open PR route
  fastify.post('/api/v1/github/pull-request', async (req: FastifyRequest<{ Body: CreatePullRequestOptions }>, reply: FastifyReply) => {
    try {
      const pr = await shipper.createPullRequest(req.body);
      return reply.send({ success: true, pr });
    } catch (error: unknown) {
      return reply.status(500).send({ error: (error instanceof Error ? error.message : String(error)) });
    }
  });

  // Tag Release route
  fastify.post('/api/v1/github/release', async (req: FastifyRequest<{ Body: CreateReleaseOptions }>, reply: FastifyReply) => {
    try {
      const release = await shipper.createRelease(req.body);
      return reply.send({ success: true, release });
    } catch (error: unknown) {
      return reply.status(500).send({ error: (error instanceof Error ? error.message : String(error)) });
    }
  });
}