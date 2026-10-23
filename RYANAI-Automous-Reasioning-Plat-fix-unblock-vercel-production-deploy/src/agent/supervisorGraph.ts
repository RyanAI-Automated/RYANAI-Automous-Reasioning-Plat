import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { commsSubAgent, complianceSubAgent } from './subAgents.js';
import { checkpointer } from './approvalEngine.js';

// 1. Extend MessagesAnnotation to track the routing target key
export const SupervisorStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  next: Annotation<string>({
    reducer: (_, y) => y,
    default: () => 'FINISH',
  }),
});

const members = ['complianceWorker', 'commsWorker'] as const;

// Structured output schema for type-safe LLM routing
const routeSchema = z.object({
  next: z.enum([...members, 'FINISH'] as const).describe(
    'The next specialist worker to execute, or FINISH if the user request is completely fulfilled.'
  ),
  reasoning: z.string().describe('Reasoning behind the delegation or termination decision.'),
});

const supervisorLlm = new ChatOpenAI({
  modelName: 'gpt-4o',
  temperature: 0,
}).withStructuredOutput(routeSchema, { name: 'supervisor_route' });

// 2. Supervisor decision node
async function supervisorNode(state: typeof SupervisorStateAnnotation.State) {
  const prompt = [
    {
      role: 'system',
      content: `You are an enterprise multi-agent supervisor managing two worker agents:
- "complianceWorker": Evaluates policy reviews, security audits, deployment status, and data validation.
- "commsWorker": Handles sending messages, notifications, WhatsApp alerts, and external communications.

Evaluate the entire conversation history. 
If the user query requires multiple actions (e.g., verifying compliance AND sending a message), select the appropriate worker for the next pending step.
Once all steps are completed and the workers have fulfilled the task, return "FINISH".`,
    },
    ...state.messages,
  ];

  const response = await supervisorLlm.invoke(prompt);
  return { next: response.next };
}

// 3. Worker Node Wrappers
async function runCommsWorker(state: typeof SupervisorStateAnnotation.State) {
  const result = await commsSubAgent.invoke({ messages: state.messages });
  return { messages: result.messages };
}

async function runComplianceWorker(state: typeof SupervisorStateAnnotation.State) {
  const result = await complianceSubAgent.invoke({ messages: state.messages });
  return { messages: result.messages };
}

// 4. Construct Supergraph Workflow
const workflow = new StateGraph(SupervisorStateAnnotation)
  .addNode('supervisor', supervisorNode)
  .addNode('commsWorker', runCommsWorker)
  .addNode('complianceWorker', runComplianceWorker)

  // Start at supervisor
  .addEdge(START, 'supervisor')

  // Route supervisor decisions
  .addConditionalEdges('supervisor', (state) => state.next, {
    commsWorker: 'commsWorker',
    complianceWorker: 'complianceWorker',
    FINISH: END,
  })

  // Loop back to supervisor to allow sequential multi-agent execution
  .addEdge('commsWorker', 'supervisor')
  .addEdge('complianceWorker', 'supervisor');

// Compile with persistent checkpointer and human-in-the-loop interrupt breakpoints
export const enterpriseMultiAgent = workflow.compile({
  checkpointer,
  interruptBefore: ['commsWorker', 'complianceWorker'], // Pauses before executing workers
});

/**
 * Runnable helper function
 */
export async function runEnterpriseRequest(prompt: string, threadId = 'enterprise_session_999') {
  const config = { configurable: { thread_id: threadId } };

  const result = await enterpriseMultiAgent.invoke(
    {
      messages: [{ role: 'user', content: prompt }],
    },
    config
  );

  return result;
}