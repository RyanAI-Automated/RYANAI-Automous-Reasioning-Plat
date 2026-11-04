# RyanAI Open Data Fabric
## Architecture specification and isolated proof-of-concept plan

**Status:** Approved architecture direction; implementation gated  
**Target branch:** `architecture/open-data-fabric-spec`  
**Production status:** Not implemented; no production data or credentials touched

## 1. Purpose

RyanAI should own its data architecture rather than depend permanently on one database vendor, storage provider, catalog, or analytical engine. The Open Data Fabric (ODF) introduces explicit portability boundaries while preserving the existing operational database architecture.

The ODF is an optional analytical data plane. It is not a replacement for PostgreSQL, Prisma, pgvector, Redis, the durable task queue, or LangGraph checkpoint storage.

## 2. Design principles

1. **Operational/analytical separation.** PostgreSQL remains authoritative for transactional application state, permissions, queues, conversations, and operational memory. Iceberg is evaluated for large analytical and historical datasets.
2. **Open formats first.** Prefer Apache Iceberg table metadata and Parquet data files. Avoid proprietary table encodings and engine-specific application contracts.
3. **Storage portability.** Keep table metadata and data access behind storage interfaces. Support local disposable object storage for the proof of concept; production storage providers are future adapters.
4. **Catalog independence.** Catalog-specific behavior is isolated behind adapters. Do not assume all catalogs implement identical registration, locking, authorization, or commit semantics.
5. **Single-writer ownership.** At most one catalog may hold the active write lease for a table. Read-only sharing is permitted only when metadata and authorization semantics are understood.
6. **Fail closed.** Unknown ownership, stale metadata, expired fencing tokens, or failed integrity checks stop writes and transfers.
7. **No-copy handoff where supported.** Catalog transfer changes metadata ownership/pointers; it does not copy underlying data files. This is not a promise that every catalog pair supports a compatible zero-copy transfer.
8. **Auditable operations.** Every ownership change, policy decision, validation result, and recovery action produces structured audit evidence without logging credentials or sensitive row contents.
9. **Human approval for consequential operations.** Production registration, unregistration, catalog migration, storage relocation, and destructive cleanup require explicit authorization.
10. **No vendor lock-in by abstraction alone.** Adapters must expose capabilities and limitations; unsupported semantics must not be silently emulated.

## 3. Current-state boundary

Existing operational data services remain unchanged:

- PostgreSQL and Prisma: transactional platform data and durable application records.
- pgvector: existing vector-backed memory/search workloads.
- Redis: caching and coordination where already used.
- Existing task, communication, and checkpoint schemas: remain owned by their current migration lifecycle.

The ODF proof of concept uses synthetic disposable datasets and isolated infrastructure only. It must not connect to production databases, production buckets, provider credentials, or live user data.

## 4. Logical architecture

```text
RyanAI services (Quant Lab / Knowledge / Inspector / Jarvis)
                         |
             Data access & governance API
                         |
       +-----------------+-------------------+
       |                                     |
Operational adapters                 Analytical adapters
PostgreSQL / pgvector                Iceberg table interface
       |                                     |
Existing transactional DB            Catalog adapter + object store
                                             |
                                  Parquet data + Iceberg metadata
                                             |
                                Spark / Trino / DuckDB / other
                                capability-tested engines
```

The analytical engines are optional consumers, not mandatory runtime dependencies. Engine compatibility is tested per operation (read, append, overwrite, schema evolution, deletes, time travel); a successful read does not imply support for every write or metadata operation.

## 5. Proposed interfaces

The following are conceptual TypeScript contracts. They are not yet production code and must be refined against the selected Iceberg REST/catalog implementations during the isolated prototype.

```ts
type TableIdentifier = {
  namespace: string;
  name: string;
};

type TableLocation = {
  uri: string;
  format: "iceberg";
};

type CatalogCapabilities = {
  registerExistingTable: boolean;
  unregisterTable: boolean;
  atomicCommit: boolean;
  conditionalMetadataUpdate: boolean;
  serverSideAuthorization: boolean;
};

type TableOwnership = {
  table: TableIdentifier;
  catalogId: string;
  fencingToken: bigint;
  leaseExpiresAt: string;
  metadataLocation: string;
};

interface DataCatalogAdapter {
  readonly catalogId: string;
  capabilities(): Promise<CatalogCapabilities>;
  load(table: TableIdentifier): Promise<TableLocation | null>;
  registerExisting(
    table: TableIdentifier,
    metadataLocation: string,
    fencingToken: bigint
  ): Promise<void>;
  unregister(
    table: TableIdentifier,
    fencingToken: bigint
  ): Promise<void>;
}

interface TableIntegrityVerifier {
  verifyMetadata(metadataLocation: string): Promise<{
    valid: boolean;
    snapshotId?: string;
    schemaFingerprint?: string;
    dataFilesChecked: number;
    errors: string[];
  }>;
}

interface OwnershipCoordinator {
  acquire(table: TableIdentifier, catalogId: string): Promise<TableOwnership>;
  renew(ownership: TableOwnership): Promise<TableOwnership>;
  release(ownership: TableOwnership): Promise<void>;
  assertCurrent(ownership: TableOwnership): Promise<void>;
}

interface CatalogTransferCoordinator {
  transfer(input: {
    table: TableIdentifier;
    sourceCatalog: DataCatalogAdapter;
    destinationCatalog: DataCatalogAdapter;
    approvalReference: string;
  }): Promise<{
    transferred: boolean;
    metadataLocation?: string;
    verificationReport: string;
  }>;
}
```

Adapters must reject unsupported capabilities rather than returning optimistic success. Fencing tokens must be monotonically increasing and checked at the commit/ownership boundary; a process-local mutex is not sufficient for distributed writer safety.

## 6. Safe catalog handoff protocol

A transfer is a controlled state machine, not a pair of uncoordinated API calls.

1. **Authorize:** verify caller, table scope, approval reference, and source/destination capabilities.
2. **Acquire transfer fence:** obtain a durable monotonically increasing fencing token and mark the table as transferring.
3. **Quiesce writers:** stop new writes and wait for in-flight commits to finish. If writers cannot be proven stopped, abort.
4. **Capture authoritative metadata:** read the final committed metadata pointer and snapshot from the source catalog.
5. **Verify source:** validate metadata, referenced manifests, schema fingerprint, and data-file availability.
6. **Unregister source:** relinquish source catalog ownership using the current fence. Do not delete data files or perform orphan cleanup.
7. **Register destination:** register the exact verified metadata pointer at the destination using the same transfer operation and fencing context.
8. **Verify destination:** reload table, compare metadata pointer/snapshot/schema, and perform read-only validation.
9. **Commit ownership:** atomically mark destination as sole writer and release the transfer fence.
10. **Resume writers:** allow writes only after ownership verification succeeds.

If any step after source unregistration fails, keep the table fenced/read-only and execute a controlled recovery: verify the last authoritative metadata pointer, then re-register at the source or complete destination registration. Never permit both catalogs to accept writes during recovery. Never delete data as part of rollback.

This protocol depends on catalog-specific conditional operations and durable coordination. If the catalog pair cannot guarantee these semantics, the adapter must report transfer as unsupported.

## 7. Consistency and split-brain controls

- Durable per-table ownership record with monotonically increasing fencing token.
- Writer commits must validate the current token at the catalog/commit boundary.
- Lease expiration alone does not authorize a new writer until stale writers are fenced.
- No dual-writer mode.
- Idempotency key for each transfer operation.
- Compare source and destination metadata pointer, snapshot ID, schema fingerprint, and referenced file set.
- Treat timeout/unknown response as indeterminate; reconcile catalog state before retry.
- Block writes on ambiguous ownership or catalog unavailability.
- Record state transitions and actor/approval references in an append-only audit trail.

## 8. Security model

- Least-privilege catalog and object-store identities.
- Separate read and write permissions.
- No secrets in logs, audit payloads, CI artifacts, or test output.
- Per-dataset authorization and tenant boundary checks.
- TLS for remote catalog/storage connections.
- Credential injection only through approved runtime secret facilities; no committed credentials.
- No production credential creation or provider connection as part of the proof of concept.
- Explicit allow-list of catalog endpoints and storage locations in any future deployed adapter.
- Validate table identifiers and metadata locations to prevent path traversal and SSRF-style endpoint abuse.
- Retain audit evidence for registration, unregistration, ownership changes, failed authorization, and recovery.

## 9. Isolated proof-of-concept plan

The proof of concept begins only after the repository's existing required validation gates have completed successfully on the exact relevant commit.

**Isolation requirements**
- Disposable local/CI environment only.
- Synthetic generated records only.
- Local object storage emulator or filesystem-backed test store.
- Two catalog instances only if both are open-source and locally runnable without paid subscriptions.
- No production DB URLs, buckets, credentials, network routes, or user data.
- Teardown must remove only resources created by the test harness.

**Demonstrations**
1. Create an Iceberg table and write synthetic records.
2. Read the same table through at least two compatible engines.
3. Register an existing table in a second compatible catalog without copying data files.
4. Verify source unregistration and destination registration.
5. Compare data-file object identities/checksums and metadata/snapshot identity before and after handoff.
6. Prove stale writer rejection using fencing tokens.
7. Prove concurrent transfer attempts serialize or fail closed.
8. Inject failures after each transfer state transition and verify safe recovery.
9. Verify schema evolution and snapshot/time-travel behavior where supported.
10. Verify access denial, audit completeness, and absence of secret leakage.

## 10. Acceptance criteria

| Area | Required evidence |
|---|---|
| Architecture/interface docs | Reviewed contracts, state machine, capability matrix, threat model |
| Catalog portability | Demonstrated table handoff between two compatible disposable catalogs |
| Data preservation | Matching data-file identities/checksums and readable records; no copy operation |
| Concurrent writes | Stale fencing token rejected; no dual-writer window |
| Split-brain | Conflicting ownership and ambiguous metadata fail closed |
| Recovery/rollback | Failure-injection results for each transfer stage; no data deletion |
| Security/access | Least-privilege tests, denied unauthorized actions, sanitized logs |
| Reproducible CI | Deterministic isolated test workflow and retained non-secret reports |
| PR review | Dedicated PR, independent review, all required checks green |

## 11. Rollout gates

- **Gate 0 — Existing platform verification:** database migration, pgvector upgrade, API regression, CI, CodeQL, secret scanning, dependency/security scans, and branch protection evidence.
- **Gate 1 — Specification review:** approve exact adapter contracts, catalog candidates, threat model, and test matrix.
- **Gate 2 — Isolated prototype:** implement only in the isolated branch/environment and run the acceptance tests.
- **Gate 3 — Dedicated PR:** publish documentation, code, reproducible test evidence, limitations, and rollback instructions for review.
- **Gate 4 — Integration decision:** only after review and explicit approval; no automatic production enablement.

No gate authorizes a subscription, paid service, cloud deployment, production migration, credential change, or main-branch ruleset modification.

## 12. Open decisions for prototype evaluation

These are evaluation questions, not assumptions:
- Which two catalog implementations provide compatible existing-table registration and safe conditional ownership semantics?
- Which local object store/test fixture best demonstrates portable object identity?
- Which pair of analytical engines has the smallest reproducible local footprint?
- Which Iceberg REST/catalog capabilities are required versus optional?
- How will durable fencing be enforced when a catalog does not natively understand RyanAI's lease token?

The prototype must answer these questions with test evidence before selecting a production design.

## 13. Definition of done

The ODF is ready for an integration decision only when every acceptance criterion is backed by reproducible evidence, limitations are documented, the dedicated PR has independent review, and all repository-required checks pass. Until then, the existing PostgreSQL/pgvector operational architecture remains unchanged.
