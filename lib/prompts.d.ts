import type { Evidence } from './evidence.js';
import type { FactoredOutcome } from './factored.js';
export type Lang = 'zh' | 'en';
export declare function detectLanguage(text: string, preferred?: 'auto' | Lang): Lang;
export interface EvidenceSectionInput {
    evidence: readonly Evidence[];
    factored?: Readonly<Record<string, FactoredOutcome>>;
    strictLabeling: boolean;
    requireSources: number;
    online: boolean;
}
export declare function buildEvidenceText(input: EvidenceSectionInput, lang: Lang): string;
export declare function buildRecheckText(claims: readonly {
    kind: string;
    text: string;
    unmechanizable?: string;
}[], score: number, lang: Lang, maxFindings: number): string;
export interface ProvenanceSectionInput {
    files: readonly string[];
    score: number;
    findings: readonly {
        kind: string;
        snippet: string;
    }[];
}
export declare function buildProvenanceText(input: ProvenanceSectionInput, lang: Lang): string;
export declare function promptSection(lang: Lang, opts?: {
    requireSources: number;
    guardLiveMutation?: boolean;
}): string;
