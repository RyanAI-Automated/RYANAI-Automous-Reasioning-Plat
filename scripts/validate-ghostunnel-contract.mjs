#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';

export function validateGhostunnelContract(contract) {
  const errors = [];
  const requireTrue = (object, key, label) => {
    if (object?.[key] !== true) errors.push(`${label} must be true`);
  };
  const requireFalse = (object, key, label) => {
    if (object?.[key] !== false) errors.push(`${label} must be false`);
  };

  if (contract?.component !== 'ghostunnel') errors.push('component must be ghostunnel');
  if (contract?.status !== 'evaluation_only') errors.push('Ghostunnel must remain evaluation_only');
  if (contract?.release?.version !== 'v1.11.5') errors.push('Ghostunnel release must remain pinned to v1.11.5');
  if (contract?.release?.image !== 'ghostunnel/ghostunnel:v1.11.5-distroless') errors.push('Ghostunnel image must use the pinned distroless release');
  requireTrue(contract?.release, 'version_pinning_required', 'release.version_pinning_required');
  requireTrue(contract?.release, 'mutable_tags_forbidden', 'release.mutable_tags_forbidden');

  requireFalse(contract?.rollout, 'enabled_by_default', 'rollout.enabled_by_default');
  requireFalse(contract?.rollout, 'production_activation_allowed', 'rollout.production_activation_allowed');
  requireFalse(contract?.rollout, 'runtime_wiring_allowed_in_this_phase', 'rollout.runtime_wiring_allowed_in_this_phase');
  requireTrue(contract?.rollout, 'staging_pilot_requires_separate_approval', 'rollout.staging_pilot_requires_separate_approval');
  requireFalse(contract?.rollout, 'deployment_changes_authorized', 'rollout.deployment_changes_authorized');

  for (const key of ['mutual_tls_required', 'client_certificate_required', 'certificate_authority_required']) {
    requireTrue(contract?.identity, key, `identity.${key}`);
  }
  for (const key of ['allow_all_forbidden', 'disable_authentication_forbidden', 'common_name_only_identity_forbidden', 'certificate_private_keys_in_repository_forbidden']) {
    requireTrue(contract?.identity, key, `identity.${key}`);
  }
  for (const key of ['public_listener_forbidden', 'host_port_publication_forbidden', 'unsafe_listen_override_forbidden', 'unsafe_target_override_forbidden', 'status_endpoint_loopback_only']) {
    requireTrue(contract?.network, key, `network.${key}`);
  }
  for (const key of ['gen_x_remains_authority', 'certificate_identity_is_not_action_authorization', 'fail_closed_on_missing_or_invalid_identity']) {
    requireTrue(contract?.authorization, key, `authorization.${key}`);
  }
  for (const key of ['certificate_rotation_required', 'certificate_expiry_monitoring_required', 'revocation_or_trust_bundle_replacement_test_required', 'connection_failure_metrics_required', 'secret_and_payload_redaction_required', 'rollback_plan_required']) {
    requireTrue(contract?.operations, key, `operations.${key}`);
  }
  for (const key of ['negative_certificate_tests_required', 'unknown_identity_rejected', 'expired_certificate_rejected', 'wrong_ca_rejected', 'client_without_certificate_rejected', 'positive_mtls_handshake_required', 'application_protocol_smoke_test_required', 'measured_latency_and_resource_baseline_required', 'rollback_test_required', 'evidence_commit_sha_required', 'human_approval_required_before_staging_or_production']) {
    requireTrue(contract?.acceptance, key, `acceptance.${key}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const policyUrl = new URL('../infra/ghostunnel/ghostunnel-contract.yaml', import.meta.url);
  const contract = yaml.parse(readFileSync(policyUrl, 'utf8'));
  const errors = validateGhostunnelContract(contract);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join(String.fromCharCode(10)));
    process.exit(1);
  }
  console.log('PASS Ghostunnel mTLS foundation contract: pinned release, disabled rollout, identity, network and acceptance gates valid');
}
