import { ActorRole, ClaimType } from "@prisma/client";
import { appendClaim } from "../../claims/service.js";
import { FIELD_DOCUMENT_EXTRACTED } from "./fieldKeys.js";

/**
 * Phase-C Lite: OCR pipeline. Structured extraction only; no interpretation or validation.
 * TODO: Google Vision (or stub interface). Use process.env for credentials only.
 */

export type DocumentExtracted = {
  business_name?: string;
  registration_number?: string;
  address?: string;
  export_license?: string;
};

export type OcrResult = {
  fields: DocumentExtracted;
  confidence: number;
};

/** OCR interface. TODO: replace with Google Vision API; credentials from process.env. */
export interface OcrProvider {
  extract(gcsPathOrEvidenceId: string): Promise<OcrResult>;
}

/** Stub: returns placeholder fields. TODO: Google Vision integration. */
export class StubOcrProvider implements OcrProvider {
  async extract(_gcsPathOrEvidenceId: string): Promise<OcrResult> {
    return {
      fields: {
        business_name: undefined,
        registration_number: undefined,
        address: undefined,
        export_license: undefined,
      },
      confidence: 0,
    };
  }
}

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

/**
 * Create sourcing_claims for document-extracted fields (HYPOTHESIS only).
 * One claim per field present; source_ref = evidence_id.
 */
export async function createDocumentExtractedClaims(
  projectId: string,
  versionId: string,
  evidenceId: string,
  result: OcrResult,
  requestId: string,
  idempotencyPrefix: string,
): Promise<void> {
  const { fields, confidence } = result;
  const entries = Object.entries(fields).filter(([, v]) => v != null && String(v).trim() !== "");
  for (let i = 0; i < entries.length; i++) {
    const [fieldKey, value] = entries[i];
    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_DOCUMENT_EXTRACTED,
      valueJson: { [fieldKey]: value },
      claimType: ClaimType.HYPOTHESIS,
      confidence: confidence > 0 ? confidence : undefined,
      sourceType: "document",
      sourceRef: evidenceId,
      versionId,
      idempotencyKey: `${idempotencyPrefix}:doc:${evidenceId}:${i}`,
      requestId,
    });
  }
}
