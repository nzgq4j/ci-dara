// Canonical solicitation-knowledge-base schema (the §5 structure from the prompt architecture),
// encoded as an Anthropic tool input_schema so a single structured call must emit exactly this
// shape. Enums are aligned to the existing dara_requirements vocabulary where they overlap
// (source/disposition) and extended with the architecture's richer fields (requirement_force,
// response_action, primary_category, evaluation criteria, mappings, citations, ontology, QC).
//
// PROOF NOTE: this is the full canonical shape on purpose — the point of the one-call proof is to
// see whether a single model call can emit this entire object for a real solicitation before the
// output-token ceiling truncates it.

export const CANONICAL_TOOL = {
  name: 'record_solicitation_knowledge_base',
  description:
    'Record the complete, quality-controlled solicitation knowledge base: document inventory, atomic ' +
    'requirements with full classification and citations, the evaluation-criteria model, requirement→' +
    'evaluation mappings, the citation register, the evaluation ontology, open issues, and the quality-' +
    'control report. Populate every field; use null/empty arrays where a value genuinely does not apply. ' +
    'Do not invent requirements; preserve exact source text; keep enumerations to the allowed values.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      analysis_metadata: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schema_version: { type: 'string' },
          document_count: { type: 'integer' },
          requirement_count: { type: 'integer' },
          evaluation_criterion_count: { type: 'integer' },
          quality_status: { type: 'string', enum: ['pending', 'passed', 'passed_with_warnings', 'failed'] }
        },
        required: ['schema_version', 'document_count', 'requirement_count', 'evaluation_criterion_count', 'quality_status']
      },
      documents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            document_id: { type: 'string' },
            filename: { type: 'string' },
            title: { type: 'string' },
            document_type: { type: 'string', enum: ['solicitation', 'pws', 'sow', 'soo', 'section_l', 'section_m', 'attachment', 'amendment', 'qa', 'clause', 'pricing_schedule', 'other'] },
            amendment_number: { type: ['string', 'null'] },
            authority_rank: { type: 'integer' },
            status: { type: 'string', enum: ['active', 'superseded', 'draft', 'reference', 'unknown'] },
            supersedes_document_ids: { type: 'array', items: { type: 'string' } },
            extraction_quality: { type: 'string', enum: ['high', 'medium', 'low'] }
          },
          required: ['document_id', 'filename', 'title', 'document_type', 'authority_rank', 'status', 'supersedes_document_ids', 'extraction_quality']
        }
      },
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requirement_id: { type: 'string' },
            requirement_family_id: { type: 'string' },
            status: { type: 'string', enum: ['active', 'superseded', 'withdrawn', 'ambiguous'] },
            requirement_title: { type: 'string' },
            normalized_requirement: { type: 'string' },
            source_text: { type: 'string' },
            primary_category: { type: 'string', enum: ['administrative', 'operational', 'advisory'] },
            secondary_types: { type: 'array', items: { type: 'string' } },
            requirement_force: { type: 'string', enum: ['mandatory', 'conditional_mandatory', 'prohibited', 'permitted', 'advisory', 'informational', 'ambiguous'] },
            response_action: { type: 'string', enum: ['direct_response_required', 'evidence_required', 'acknowledgment_required', 'pricing_response_required', 'form_completion_required', 'incorporate_into_solution', 'contract_performance_only', 'no_proposal_action', 'clarification_required'] },
            responsible_party: { type: 'string', enum: ['offeror', 'contractor', 'government', 'subcontractor', 'key_personnel', 'joint', 'unspecified'] },
            required_action: { type: ['string', 'null'] },
            required_output: { type: ['string', 'null'] },
            condition: { type: ['string', 'null'] },
            deadline: { type: ['string', 'null'] },
            frequency: { type: ['string', 'null'] },
            threshold: { type: ['string', 'null'] },
            standard: { type: ['string', 'null'] },
            verification_method: { type: ['string', 'null'] },
            proposal_volume: { type: ['string', 'null'] },
            proposal_section: { type: ['string', 'null'] },
            evaluation_criterion_ids: { type: 'array', items: { type: 'string' } },
            citation_ids: { type: 'array', items: { type: 'string' } },
            classification_confidence: { type: 'number' },
            ambiguity_flags: { type: 'array', items: { type: 'string' } }
          },
          required: ['requirement_id', 'requirement_family_id', 'status', 'requirement_title', 'normalized_requirement', 'source_text', 'primary_category', 'secondary_types', 'requirement_force', 'response_action', 'responsible_party', 'evaluation_criterion_ids', 'citation_ids', 'classification_confidence']
        }
      },
      evaluation_criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            evaluation_criterion_id: { type: 'string' },
            parent_evaluation_criterion_id: { type: ['string', 'null'] },
            factor_number: { type: ['string', 'null'] },
            factor_name: { type: 'string' },
            criterion_name: { type: 'string' },
            source_text: { type: 'string' },
            criterion_type: { type: 'string', enum: ['factor', 'subfactor', 'element', 'rating_definition', 'evaluation_method', 'comparative_rule', 'pass_fail_rule'] },
            evaluation_method: { type: 'string', enum: ['qualitative', 'quantitative', 'pass_fail', 'comparative', 'tradeoff', 'lowest_price_technically_acceptable', 'best_value', 'unknown'] },
            relative_importance: { type: ['string', 'null'] },
            evaluated_subject: { type: 'string' },
            required_evidence: { type: 'array', items: { type: 'string' } },
            linked_requirement_ids: { type: 'array', items: { type: 'string' } },
            citation_ids: { type: 'array', items: { type: 'string' } },
            classification_confidence: { type: 'number' }
          },
          required: ['evaluation_criterion_id', 'factor_name', 'criterion_name', 'source_text', 'criterion_type', 'evaluation_method', 'evaluated_subject', 'required_evidence', 'linked_requirement_ids', 'citation_ids', 'classification_confidence']
        }
      },
      evaluation_mappings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mapping_id: { type: 'string' },
            requirement_id: { type: 'string' },
            evaluation_criterion_id: { type: 'string' },
            relationship_type: { type: 'string', enum: ['directly_evaluated_by', 'provides_evidence_for', 'supports', 'constrains', 'qualifies', 'gates', 'not_evaluated'] },
            mapping_basis: { type: 'string', enum: ['explicit_text', 'shared_subject', 'shared_terminology', 'proposal_structure', 'evaluation_logic', 'analytical_inference'] },
            confidence: { type: 'string', enum: ['explicit', 'high', 'medium', 'low', 'none'] },
            rationale: { type: 'string' }
          },
          required: ['mapping_id', 'requirement_id', 'evaluation_criterion_id', 'relationship_type', 'mapping_basis', 'confidence', 'rationale']
        }
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            citation_id: { type: 'string' },
            document_id: { type: 'string' },
            page: { type: ['integer', 'null'] },
            section: { type: ['string', 'null'] },
            paragraph: { type: ['string', 'null'] },
            anchor_text: { type: 'string' },
            source_excerpt: { type: 'string' }
          },
          required: ['citation_id', 'document_id', 'anchor_text', 'source_excerpt']
        }
      },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            issue_id: { type: 'string' },
            issue_type: { type: 'string', enum: ['ambiguity', 'conflict', 'omission_risk', 'citation_error', 'classification_dispute', 'mapping_dispute', 'supersession_issue', 'source_quality_issue'] },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            affected_object_ids: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            recommended_resolution: { type: 'string' }
          },
          required: ['issue_id', 'issue_type', 'severity', 'description', 'recommended_resolution']
        }
      },
      quality_control: {
        type: 'object',
        additionalProperties: false,
        properties: {
          citation_coverage_pct: { type: 'number' },
          omission_scan_completed: { type: 'boolean' },
          final_findings: { type: 'array', items: { type: 'string' } },
          unresolved_exceptions: { type: 'array', items: { type: 'string' } }
        },
        required: ['citation_coverage_pct', 'omission_scan_completed', 'final_findings', 'unresolved_exceptions']
      }
    },
    required: ['analysis_metadata', 'documents', 'requirements', 'evaluation_criteria', 'evaluation_mappings', 'citations', 'issues', 'quality_control']
  }
} as const;
