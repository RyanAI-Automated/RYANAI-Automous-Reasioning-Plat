import type { FastifyPluginAsync } from 'fastify';
import { UUID_PATTERN } from '../../scheduler/schedule.js';
import { cancelTask, listTasks } from '../../scheduler/taskStore.js';

/**
 * Let a signed-in user read the results of scheduled tasks and cancel tasks.
 * The global authentication hook runs first. Each handler checks the user
 * again, and every query is limited to that user.
 */
export const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/tasks', async (request, reply) => {
    const user = request.authUser;
    if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { tasks: await listTasks(user.id) };
  });

  fastify.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const user = request.authUser;
    if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) {
      return reply.code(400).send({ error: 'The task id is not valid.' });
    }
    if (!(await cancelTask(user.id, id))) {
      return reply.code(404).send({ error: 'No active task with this id.' });
    }
    return { cancelled: true };
  });
};
