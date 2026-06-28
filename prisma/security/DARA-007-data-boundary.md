# DARA-007 — CUI → LLM data boundary

_2026-06-28 · interim controls + target architecture_

DARA sends extracted solicitation/proposal text to a commercial LLM during
evaluation. That text is likely **FCI/CUI**, so this is a NIST 800-171 SC-7/AC-4 /
DFARS 252.204-7012 boundary concern. This document records the data flow, the
interim controls now in place, and the target remediation. **Chosen path: phased.**

---

## 1. Data flow (today)

```
dara_sol_documents / dara_response_files.extracted_text   (encrypted at rest, DARA-009)
   │  decrypted at point of use (utils/dara/evaluator.ts → concatDocs)
   ▼
utils/dara/providers.ts → complete()  → HTTPS POST (TLS) to one of:
   • https://api.anthropic.com/v1/messages
   • https://api.openai.com/v1/chat/completions
   • https://generativelanguage.googleapis.com/.../generateContent
```

- **Platform mode** (`aiKeyMode = 'platform'`) → sent under DARA's vendor account
  (`PLATFORM_*_KEY`).
- **BYOK mode** (`aiKeyMode = 'byok'`) → sent under the customer's own account/key.
- Provider/model are per-company (`Company.activeProvider` / `activeModel`).

## 2. Why it's a finding
Standard commercial LLM endpoints are **not FedRAMP-authorized**, and default
commercial terms may retain inputs (e.g., abuse monitoring) absent a **zero-retention
agreement**. So CUI can leave the protected boundary into a third party without a
verified covered agreement. (Verify each vendor's current terms — they change.)

## 3. Interim controls (in place now)
1. **Explicit boundary notice/consent** in the UI at the egress point:
   `components/dara/CuiBoundaryNotice.tsx`, shown on the **Offerors** tab (by "Run
   evaluation") and on **Settings → AI Configuration**, naming the active provider
   and platform/BYOK mode.
2. **Egress is audited** — `evaluation.run` audit records (DARA-013) include the
   `provider` and `mode` the CUI was sent to, giving a per-run boundary trail.
3. **CUI encrypted at rest** (DARA-009) and **in transit** (TLS to the endpoint;
   DB TLS in DARA-014), so exposure is limited to the LLM vendor boundary itself.
4. **This document** records the flow and the decision.

## 4. Decided approach — risk-managed acceptance on the current model
**Decision (2026-06-28):** keep the current commercial-LLM hosting model. No
FedRAMP/GovCloud or self-hosted migration. The residual risk of CUI on commercial
endpoints is **accepted** with the compensating controls in §3, plus:

- **BYOK is offered as the option** so a customer can run CUI under their own
  provider account and their own data terms.
- **Zero-Data-Retention (ZDR) agreements are being pursued offline** for the
  platform keys (provider-side contract action, not code):
  - **Anthropic** (primary): ZDR agreement signed alongside the commercial
    agreement + DPA (per Anthropic org; not self-service).
  - **OpenAI**: ZDR / Modified Abuse Monitoring on approval via OpenAI sales.
  - **Google**: ensure the Gemini *Developer API* key is on a **paid/billed**
    project (the free AI Studio tier trains on inputs); pursue ZDR (Gemini API ZDR
    or Vertex AI DPA amendment).

  ZDR closes the *retention/training* concern; it does **not** make the endpoints
  FedRAMP-authorized — which is acceptable under this decision.

**When ZDR is executed:** update the platform-mode wording in
`components/dara/CuiBoundaryNotice.tsx` to state the platform keys are covered by a
zero-data-retention agreement, and note it here + on the Security page.

## 5. Status
DARA-007 → **Risk accepted** (commercial hosting retained; compensating controls
in place: boundary notices, BYOK option, encryption at rest/in transit, per-run
provider/mode audit). ZDR agreements on the platform keys are pending offline.
