import { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket from 'ws';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-10-01';

/**
 * Register a WebSocket relay for OpenAI Realtime audio and text.
 * Missing API credentials send an error and close the client connection.
 * The advertised pipeline tool returns an acknowledgment without running a pipeline.
 */
export async function voiceRealtimeGateway(fastify: FastifyInstance) {
  // Register Fastify WebSocket endpoint
  fastify.get('/api/v1/realtime/voice', { websocket: true }, (connection, _req: FastifyRequest) => {
    const ws = connection;
    fastify.log.info('Client connected to Realtime Voice Stream Gateway');

    if (!OPENAI_API_KEY) {
      ws.send(
        JSON.stringify({ error: 'OPENAI_API_KEY missing on server environment' })
      );
      ws.close();
      return;
    }

    // Connect to OpenAI Realtime WebSocket
    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    // 1. OpenAI Connection Open Handler
    openAiWs.on('open', () => {
      fastify.log.info('Connected to OpenAI Realtime Upstream Engine');

      // Configure Session Instructions & Capabilities
      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions:
            'You are RyanAI, an intelligent voice agent engineered by Ntsiyeni Ganyane. Respond clearly, concisely, and execute systems queries accurately.',
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          tools: [
            {
              type: 'function',
              name: 'trigger_pipeline',
              description: 'Triggers the 5-phase deployment pipeline for a given branch',
              parameters: {
                type: 'object',
                properties: {
                  branch: { type: 'string', description: 'Branch name (e.g., main)' },
                  ship: { type: 'boolean', description: 'Whether to push to GitHub' },
                },
                required: ['branch'],
              },
            },
          ],
        },
      };

      openAiWs.send(JSON.stringify(sessionUpdate));
    });

    // 2. Relay Messages from OpenAI -> Client
    openAiWs.on('message', async (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());

        // Handle Function Calling Execution
        if (event.type === 'response.function_call_arguments.done') {
          const { call_id, name, arguments: argsJson } = event;
          fastify.log.info(`Realtime Voice Function Call Triggered: ${name}`);

          let functionResult = { success: true, message: 'Executed successfully' };
          if (name === 'trigger_pipeline') {
            const parsedArgs = JSON.parse(argsJson);
            functionResult = {
              success: true,
              message: `Pipeline triggered for branch ${parsedArgs.branch}. Execution queued.`,
            };
          }

          // Return tool execution output back to OpenAI
          const toolResponse = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id,
              output: JSON.stringify(functionResult),
            },
          };
          openAiWs.send(JSON.stringify(toolResponse));

          // Prompt OpenAI to synthesize audio response after function completion
          openAiWs.send(JSON.stringify({ type: 'response.create' }));
        }

        // Relay Audio Deltas & Audio Transcription directly to Client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data.toString());
        }
      } catch (err) {
        fastify.log.error(err, 'Error handling OpenAI WebSocket payload');
      }
    });

    // 3. Relay Messages from Client -> OpenAI
    ws.on('message', (data: WebSocket.Data) => {
      try {
        if (openAiWs.readyState === WebSocket.OPEN) {
          openAiWs.send(data.toString());
        }
      } catch (err) {
        fastify.log.error(err, 'Error forwarding client audio payload to OpenAI');
      }
    });

    // 4. Handle Disconnections
    ws.on('close', () => {
      fastify.log.info('Client disconnected from Realtime Stream');
      if (openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.close();
      }
    });

    openAiWs.on('close', () => {
      fastify.log.info('OpenAI Realtime Upstream connection closed');
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    openAiWs.on('error', (err) => {
      fastify.log.error(err, 'OpenAI Realtime WebSocket Error');
    });
  });
}