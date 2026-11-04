#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import yaml from 'yaml';

export function validateModelGovernance(policy) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const requiredDoctrine = {
    ownership: 'RyanAI owns its intelligence.',
    models: 'Models serve it.',
    security: 'Gen-X protects it.',
    authority: 'Human authority governs it.',
  };
  require(policy?.schema_version === 1, 'schema_version must be 1');
  require(policy?.standard === 'RIIP', 'standard must be RIIP');
  for (const [key, value] of Object.entries(requiredDoctrine)) {
    require(policy?.doctrine?.[key] === value, `doctrine.${key} must preserve the governing principle`);
  }

  for (const key of [
    'measurable_benefit',
    'security_compliance',
    'operational_reversibility',
    'economic_justification',
  ]) {
    require(policy?.engineering_acceptance?.[key] === 'required', `engineering_acceptance.${key} must be required`);
  }
  require(policy?.engineering_acceptance?.cost_currency === 'ZAR', 'economic accounting must use ZAR');
  require(policy?.engineering_acceptance?.baseline_required === true, 'a measured baseline is mandatory');
  require(policy?.engineering_acceptance?.held_out_evaluation_required === true, 'held-out evaluation is mandatory');

  const authority = policy?.authority ?? {};
  for (const key of [
    'model_outputs_are_untrusted',
    'models_may_authorize_actions',
    'models_may_change_own_permissions',
    'models_may_approve_own_changes',
    'models_may_promote_themselves',
    'models_may_merge_or_deploy',
    'consequential_actions_require_human_approval',
    'fail_closed_on_policy_or_identity_failure',
  ]) {
    require(typeof authority[key] === 'boolean', `authority.${key} must be an explicit boolean`);
  }
  require(authority.model_outputs_are_untrusted === true, 'model outputs must remain untrusted');
  for (const key of [
    'models_may_authorize_actions',
    'models_may_change_own_permissions',
    'models_may_approve_own_changes',
    'models_may_promote_themselves',
    'models_may_merge_or_deploy',
  ]) require(authority[key] === false, `authority.${key} must remain false`);
  require(authority.consequential_actions_require_human_approval === true, 'consequential actions require human approval');
  require(authority.authorization_enforcement_owner === 'Gen-X', 'Gen-X must remain the authorization enforcement owner');

  const operations = policy?.operations ?? {};
  for (const key of [
    'model_download_at_api_startup',
    'automatic_production_activation',
    'automatic_embedding_index_replacement',
    'preserve_known_good_revision',
    'rollback_test_required',
    'record_model_provenance',
    'redact_secrets_and_private_payloads_from_logs',
  ]) require(typeof operations[key] === 'boolean', `operations.${key} must be an explicit boolean`);
  require(operations.model_download_at_api_startup === false, 'models must not download at API startup');
  require(operations.automatic_production_activation === false, 'production activation must not be automatic');
  require(operations.automatic_embedding_index_replacement === false, 'embedding indexes must not be replaced automatically');
  require(operations.preserve_known_good_revision === true, 'known-good model revisions must be preserved');
  require(operations.rollback_test_required === true, 'rollback must be tested');
  require(operations.record_model_provenance === true, 'model provenance must be recorded');

  const models = policy?.model_registry;
  require(Array.isArray(models) && models.length > 0, 'model_registry must be a non-empty array');
  const ids = new Set();
  const statuses = new Set([
    'configured_unverified',
    'adapter_merged_runtime_unverified',
    'evaluation_only',
    'deferred_legal_review',
    'verified',
    'disabled',
  ]);
  for (const model of Array.isArray(models) ? models : []) {
    require(typeof model.id === 'string' && model.id.length > 0, 'every model needs an id');
    require(!ids.has(model.id), `duplicate model id: ${model.id}`);
    ids.add(model.id);
    require(typeof model.provider === 'string' && model.provider.length > 0, `${model.id}: provider is required`);
    require(typeof model.role === 'string' && model.role.length > 0, `${model.id}: role is required`);
    require(statuses.has(model.status), `${model.id}: unsupported status`);
    require(model.authority === 'none', `${model.id}: models must not receive authority`);
    require(Array.isArray(model.task_families) && model.task_families.length > 0, `${model.id}: task_families are required`);
    require(model.evaluation_required === true, `${model.id}: evaluation is mandatory`);
    require(typeof model.activation === 'string' && model.activation.length > 0, `${model.id}: activation boundary is required`);
    if (model.status === 'evaluation_only') {
      require(model.activation !== 'production' && model.activation !== 'automatic', `${model.id}: evaluation-only models cannot be production activated`);
    }
  }
  require(policy?.evaluation?.language_slices?.includes('en-ZA') === true, 'en-ZA evaluation slice is required');
  require(policy?.evaluation?.language_slices?.includes('ve-ZA') === true, 've-ZA evaluation slice is required');
  require(policy?.evaluation?.security_and_licence_are_hard_gates === true, 'security and licence must be hard gates');
  return errors;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const policyPath = new URL('../governance/model-governance.yaml', import.meta.url);
  const policy = yaml.parse(readFileSync(policyPath, 'utf8'));
  const errors = validateModelGovernance(policy);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join('\n'));
    process.exit(1);
  }
  console.log(`PASS RIIP model governance: ${policy.model_registry.length} registered model roles; authority, evidence, safety and rollback invariants valid`);
}
