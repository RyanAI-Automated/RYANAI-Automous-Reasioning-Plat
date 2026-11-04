#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';

export function validateModelGovernance(policy) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const requireTrue = (object, key, label) => {
    require(object?.[key] === true, `${label} must be true`);
  };
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

  const acceptance = policy?.engineering_acceptance ?? {};
  for (const key of [
    'measurable_benefit',
    'security_compliance',
    'operational_reversibility',
    'economic_justification',
  ]) require(acceptance[key] === 'required', `engineering_acceptance.${key} must be required`);
  require(acceptance.cost_currency === 'ZAR', 'economic accounting must use ZAR');
  requireTrue(acceptance, 'baseline_required', 'a measured baseline');
  requireTrue(acceptance, 'held_out_evaluation_required', 'held-out evaluation');
  requireTrue(acceptance, 'exact_model_revision_required', 'exact model revision');
  requireTrue(acceptance, 'reproducible_evidence_required', 'reproducible evidence');

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
  ]) require(typeof authority[key] === 'boolean,', `authority.${key} must be an explicit boolean`);
  requireTrue(authority, 'model_outputs_are_untrusted', 'model outputs untrusted invariant');
  for (const key of [
    'models_may_authorize_actions',
    'models_may_change_own_permissions',
    'models_may_approve_own_changes',
    'models_may_promote_themselves',
    'models_may_merge_or_deploy',
  ]) require(authority[key] === false, `authority.${key} must remain false`);
  requireTrue(authority, 'consequential_actions_require_human_approval', 'human approval for consequential actions');
  requireTrue(authority, 'fail_closed_on_policy_or_identity_failure', 'fail-closed authorization');
  require(authority.authorization_enforcement_owner === 'Gen-X', 'Gen-X must remain the authorization enforcement owner');

  const operations = policy?.operations ?? {};
  for (const key of [
    'model_download_at_api_startup',
    'automatic_production_activation',
    'automatic_embedding_index_replacement',
    'provider_fallback_must_be_explicit',
    'preserve_known_good_revision',
    'rollback_test_required',
    'record_model_provenance',
    'redact_secrets_and_private_payloads_from_logs',
  ]) require(typeof operations[key] === 'boolean', `operations.${key} must be an explicit boolean`);
  for (const key of [
    'provider_fallback_must_be_explicit',
    'preserve_known_good_revision',
    'rollback_test_required',
    'record_model_provenance',
    'redact_secrets_and_private_payloads_from_logs',
  ]) requireTrue(operations, key, `operations.${key}`);
  for (const key of [
    'model_download_at_api_startup',
    'automatic_production_activation',
    'automatic_embedding_index_replacement',
  ]) require(operations[key] === false, `operations.${key} must remain false`);

  const evaluation = policy?.evaluation ?? {};
  for (const key of [
    'quality_non_inferiority_on_critical_slices',
    'report_latency_p50_p95',
    'report_failure_and_abstention_rates',
    'report_peak_resource_use',
    'report_cost_per_successful_task',
    'include_human_correction_cost',
    'security_and_licence_are_hard_gates',
  ]) requireTrue(evaluation, key, `evaluation.${key}`);
  require(Array.isArray(evaluation.language_slices), 'evaluation.language_slices must be an array');
  require(evaluation.language_slices?.includes('en-ZA') === true, 'en-ZA evaluation slice is required');
  require(evaluation.language_slices?.includes('ve-ZA') === true, 've-ZA evaluation slice is required');

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
    if (model.status === 'verified') {
      require(typeof model.revision === 'string' && model.revision.trim().length > 0, `${model.id}: verified models require an exact revision`);
      require(typeof model.evidence_reference === 'string' && model.evidence_reference.trim().length > 0, `${model.id}: verified models require reproducible evidence`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const policyPath = new URL('../governance/model-governance.yaml', import.meta.url);
  const policy = yaml.parse(readFileSync(policyPath, 'utf8'));
  const errors = validateModelGovernance(policy);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join('\\n'));
    process.exit(1);
  }
  console.log(`PASS RIIP model governance: ${policy.model_registry.length} registered model roles; authority, evidence, safety and rollback invariants valid`);
}
