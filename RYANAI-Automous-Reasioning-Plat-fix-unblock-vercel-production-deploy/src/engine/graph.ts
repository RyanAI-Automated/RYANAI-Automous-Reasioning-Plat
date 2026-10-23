// src/engine/graph.ts
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { primaryBrain, secondaryBrain, logicBrain } from "../config/brains";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 1. Define the internal State for the graph
export const GraphState = Annotation.Root({
  task: Annotation<string>(),
  executionPlan: Annotation<string>(),
  primaryOutput: Annotation<string>(),
  finalValidation: Annotation<string>(),
  errors: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});

// 2. Logic Node: lmstudio-community
const structureLogic = async (state: typeof GraphState.State) => {
  console.log("[Graph] Executing Logic Brain...");
  const prompt = new SystemMessage("Break this task down into a strict execution plan.");
  const res = await logicBrain.invoke([prompt, new HumanMessage(state.task)]);
  return { executionPlan: res.content.toString() };
};

// 3. Primary Node: nvidia
const primaryReasoning = async (state: typeof GraphState.State) => {
  console.log("[Graph] Executing Primary Brain (Nvidia)...");
  const prompt = new SystemMessage("Execute this plan with high precision.");
  const res = await primaryBrain.invoke([prompt, new HumanMessage(state.executionPlan)]);
  return { primaryOutput: res.content.toString() };
};

// 4. Secondary Node: qwen
const validateOutput = async (state: typeof GraphState.State) => {
  console.log("[Graph] Executing Secondary Brain (Qwen)...");
  const prompt = new SystemMessage("Review the Primary output against the original task. Fix any logical errors or missing context.");
  const msg = `Original Task: ${state.task}\n\nPrimary Output: ${state.primaryOutput}`;
  const res = await secondaryBrain.invoke([prompt, new HumanMessage(msg)]);
  return { finalValidation: res.content.toString() };
};

// 5. Compile the Workflow Pipeline
const workflow = new StateGraph(GraphState)
  .addNode("logic", structureLogic)
  .addNode("primary", primaryReasoning)
  .addNode("secondary", validateOutput)
  .addEdge(START, "logic")
  .addEdge("logic", "primary")
  .addEdge("primary", "secondary")
  .addEdge("secondary", END);

export const ryanAiGraph = workflow.compile();