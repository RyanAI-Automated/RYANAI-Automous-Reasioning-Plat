# RyanAI Research and Reference Catalogue

**Status:** Curated research reference; learning and offline evaluation only  
**Last reviewed:** 2026-11-04

This catalogue records external technical references that inform RyanAI architecture. Inclusion is not an endorsement, implementation decision, model-health claim, or licence approval. Every proposed implementation must pass the RyanAI Intelligence Improvement Protocol (RIIP).

## Foundational language-model reference

### Foundations of Large Language Models

- **Authors:** Tong Xiao and Jingbo Zhu
- **Canonical identifier:** arXiv:2501.09223
- **Pinned edition for this study:** v4
- **Version date:** 2026-10-08
- **Primary record:** https://arxiv.org/abs/2501.09223
- **Version-pinned record:** https://arxiv.org/abs/2501.09223v4
- **PDF:** https://arxiv.org/pdf/2501.09223v4
- **DOI:** https://doi.org/10.48550/arXiv.2501.09223
- **Format:** Open-access educational book / preprint
- **Scope:** Six chapters covering pre-training, generative models, prompting, alignment, inference, and reasoning.

**Why RyanAI tracks it:** It provides a structured foundation for understanding model behaviour and the trade-offs involved in training, adapting, prompting, aligning, serving, and evaluating LLMs. It can inform the reasoning-provider adapters and offline evaluation design without dictating a vendor or replacing existing architecture.

**Version policy:** Keep the canonical arXiv identifier and an explicit version. Re-check the arXiv record before revising study material; do not silently overwrite the version studied. Record the date and substantive differences when a newer version is adopted.

**Use constraints:**
- Treat the book as educational background, not as a RyanAI benchmark report.
- Do not infer that a model supports a language, task, hardware target, or licence from this reference.
- Do not copy third-party model weights or add runtime dependencies as a consequence of reading it.
- Cite the relevant chapter/concept in any engineering proposal derived from it.
- Record uncertainty and distinguish source claims from RyanAI measurements.

## Research-to-engineering workflow

1. Register the source, authors, canonical URL, pinned version, access date, and intended relevance.
2. Extract concepts into the chapter-by-chapter study plan.
3. Convert only relevant concepts into falsifiable hypotheses.
4. Define a held-out benchmark and a current implementation baseline before testing.
5. Run offline and isolated experiments with synthetic or redacted, access-controlled data.
6. Record quality, safety, reliability, latency, resource use, and cost per accepted successful task in ZAR.
7. Submit any proposed implementation as a separate reviewable change with rollback and human approval.

## Related RyanAI policy

- [Specialist Model Fit and Adoption Standard](../architecture/SPECIALIST_MODEL_FIT_AND_ADOPTION.md)
- [RIIP Universal Model Governance](../architecture/RIIP-UNIVERSAL-MODEL-GOVERNANCE.md)
- [Machine-readable model governance](../../governance/model-governance.yaml)

Research references do not override these policies. Gen-X remains the independent authorization enforcement boundary; consequential actions require human approval.
