import { AUTONOMOUS_REASONING_SKILL } from './autonomousReasoning.js';
import { 
  AGENT_PA_SKILL, 
  SOVEREIGN_FIREWALL_SKILL, 
  SELF_HEALING_SKILL 
} from './agentPAScript.js';

// Export types
export type { AgentSkill } from './autonomousReasoning.js';

// Core Sovereign Reasoning Skills
export { AUTONOMOUS_REASONING_SKILL } from './autonomousReasoning.js';

// AgentPA Personal Assistant & Sovereign Defense Skills
export { 
  AGENT_PA_SKILL, 
  SOVEREIGN_FIREWALL_SKILL, 
  SELF_HEALING_SKILL 
} from './agentPAScript.js';

// Active Skills Map for Runtime Execution
export const ACTIVE_SKILLS = Object.freeze({
  autonomousReasoning: AUTONOMOUS_REASONING_SKILL,
  agentPaCore: AGENT_PA_SKILL,
  sovereignFirewall: SOVEREIGN_FIREWALL_SKILL,
  selfHealing: SELF_HEALING_SKILL,
});

// Combined Skill Registry Export for AgentPA Dynamic Integration
export const RYANAI_SKILL_REGISTRY = Object.freeze({
  autonomousReasoning: 'AUTONOMOUS_REASONING_SKILL',
  agentPaCore: 'AGENT_PA_SKILL',
  sovereignFirewall: 'SOVEREIGN_FIREWALL_SKILL',
  selfHealing: 'SELF_HEALING_SKILL',
});
