// File path: ./src/gateway/websocket.ts

import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { primaryBrain } from '../config/brains';
import { HumanMessage } from '@langchain/core/messages';

/**
 * Register the WebSocket plugin and a route that streams primary-brain tokens.
 * Malformed requests and provider failures are sent to the client as error messages.
 */
export async function registerWebsocketGateway(fastify: FastifyInstance) {
  await fastify.register(fastifyWebsocket);

  fastify.get('/api/v1/stream', { websocket: true }, (connection, _req) => {
    console.log("[WebSocket] Client connected to live reasoning stream.");

    connection.on('message', async (message: Buffer) => {
      try {
        if (!message || message.length === 0) {
          connection.send(JSON.stringify({ error: "Task payload missing" }));
          return;
        }

        const payload = JSON.parse(message.toString());
        const task = payload.task;

        if (!task) {
          connection.send(JSON.stringify({ error: "Task payload missing" }));
          return;
        }

        connection.send(JSON.stringify({ status: "streaming_started", brain: "nvidia" }));

        // Stream tokens from Primary Brain
        const stream = await primaryBrain.stream([new HumanMessage(task)]);

        for await (const chunk of stream) {
          connection.send(JSON.stringify({
            token: chunk.content,
            done: false
          }));
        }

        connection.send(JSON.stringify({ done: true }));

      } catch (error: unknown) {
        connection.send(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }));
      }
    });

    connection.on('close', () => {
      console.log("[WebSocket] Client disconnected from stream.");
    });
  });
}