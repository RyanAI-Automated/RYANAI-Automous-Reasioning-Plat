import {
  createPluginRegistry,
  type PluginManifest,
} from './pluginRegistry.js';

/**
 * Provider catalogue metadata only. No provider in this list is connected or
 * executable until a separately reviewed adapter and authorization flow exist.
 */
export const DEFAULT_PLUGIN_MANIFESTS: readonly PluginManifest[] = Object.freeze([
  {
    id: 'github', displayName: 'GitHub', version: '1.0.0',
    categories: ['engineering', 'workflows'],
    description: 'Repository, issue and pull-request engineering workflows.',
    capabilities: [
      { id: 'repositories.read', risk: 'read', requiresHumanApproval: false },
      { id: 'pull_requests.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['repository_metadata', 'user_content'],
  },
  {
    id: 'google-calendar', displayName: 'Google Calendar', version: '1.0.0',
    categories: ['pa_agent', 'workflows'],
    description: 'Calendar availability, events and scheduling.',
    capabilities: [
      { id: 'events.read', risk: 'read', requiresHumanApproval: false },
      { id: 'events.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data'],
  },
  {
    id: 'microsoft-365-calendar', displayName: 'Microsoft 365 Calendar', version: '1.0.0',
    categories: ['pa_agent', 'workflows'],
    description: 'Microsoft 365 calendar availability and scheduling.',
    capabilities: [
      { id: 'events.read', risk: 'read', requiresHumanApproval: false },
      { id: 'events.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data'],
  },
  {
    id: 'gmail', displayName: 'Gmail', version: '1.0.0',
    categories: ['communications', 'pa_agent', 'workflows'],
    description: 'Email search, drafting and governed sending.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.draft', risk: 'write', requiresHumanApproval: false },
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'outlook-mail', displayName: 'Outlook Mail', version: '1.0.0',
    categories: ['communications', 'pa_agent', 'workflows'],
    description: 'Outlook email search, drafting and governed sending.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.draft', risk: 'write', requiresHumanApproval: false },
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'slack', displayName: 'Slack', version: '1.0.0',
    categories: ['communications', 'workflows'],
    description: 'Workspace conversations, notifications and governed posting.',
    capabilities: [
      { id: 'conversations.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.post', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'communication_content'],
  },
  {
    id: 'microsoft-teams', displayName: 'Microsoft Teams', version: '1.0.0',
    categories: ['communications', 'workflows'],
    description: 'Teams conversations, meetings and governed posting.',
    capabilities: [
      { id: 'conversations.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.post', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'communication_content'],
  },
  {
    id: 'whatsapp-business', displayName: 'WhatsApp Business', version: '1.0.0',
    categories: ['communications'],
    description: 'WhatsApp Business messaging with owner approval.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'twilio', displayName: 'Twilio', version: '1.0.0',
    categories: ['communications'],
    description: 'SMS and voice channel operations with explicit dispatch approval.',
    capabilities: [
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
      { id: 'calls.initiate', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'notion', displayName: 'Notion', version: '1.0.0',
    categories: ['knowledge', 'pa_agent', 'workflows'],
    description: 'Knowledge pages, notes and workspace documentation.',
    capabilities: [
      { id: 'pages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'pages.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'user_content'],
  },
  {
    id: 'dropbox', displayName: 'Dropbox', version: '1.0.0',
    categories: ['knowledge', 'workflows'],
    description: 'User-authorized file discovery and document storage.',
    capabilities: [
      { id: 'files.read', risk: 'read', requiresHumanApproval: false },
      { id: 'files.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['user_content', 'personal_data'],
  },
  {
    id: 'sharepoint', displayName: 'SharePoint', version: '1.0.0',
    categories: ['knowledge', 'workflows'],
    description: 'Organization-authorized SharePoint documents and sites.',
    capabilities: [
      { id: 'files.read', risk: 'read', requiresHumanApproval: false },
      { id: 'files.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'personal_data'],
  },
  {
    id: 'asana', displayName: 'Asana', version: '1.0.0',
    categories: ['workflows', 'pa_agent'],
    description: 'Project tasks, assignments and team workflows.',
    capabilities: [
      { id: 'tasks.read', risk: 'read', requiresHumanApproval: false },
      { id: 'tasks.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content'],
  },
  {
    id: 'linear', displayName: 'Linear', version: '1.0.0',
    categories: ['engineering', 'workflows', 'pa_agent'],
    description: 'Engineering issues, projects and workflow automation.',
    capabilities: [
      { id: 'issues.read', risk: 'read', requiresHumanApproval: false },
      { id: 'issues.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'repository_metadata'],
  },
  {
    id: 'trello', displayName: 'Trello', version: '1.0.0',
    categories: ['workflows', 'pa_agent'],
    description: 'Boards, cards and task coordination.',
    capabilities: [
      { id: 'boards.read', risk: 'read', requiresHumanApproval: false },
      { id: 'cards.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content'],
  },
  {
    id: 'zapier', displayName: 'Zapier', version: '1.0.0',
    categories: ['workflows'],
    description: 'External workflow triggers and automation handoffs.',
    capabilities: [
      { id: 'triggers.read', risk: 'read', requiresHumanApproval: false },
      { id: 'actions.execute', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['user_content', 'workspace_content'],
  },
  {
    id: 'firecrawl', displayName: 'Firecrawl', version: '1.0.0',
    categories: ['research', 'knowledge'],
    description: 'User-authorized web research and content extraction.',
    capabilities: [
      { id: 'pages.fetch', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['public_metadata', 'user_content'],
  },
]);

export function createDefaultPluginRegistry() {
  return createPluginRegistry(DEFAULT_PLUGIN_MANIFESTS);
}
