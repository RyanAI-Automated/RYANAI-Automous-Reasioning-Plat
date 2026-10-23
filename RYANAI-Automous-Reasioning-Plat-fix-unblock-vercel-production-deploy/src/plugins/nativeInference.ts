import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { runCppInference } from '../native/bridge.js';

const nativeInferencePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('cppEngine', {
    evaluate: (prompt: string) => runCppInference(prompt)
  });

  fastify.log.info('⚡ [NATIVE C++] RyanAI C++ Tensor Engine registered on Fastify pipeline.');
};

export default fp(nativeInferencePlugin, {
  name: 'ryanai-native-inference'
});