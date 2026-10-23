import { type Claim } from './claims.js';
import type { DoubtConfig } from './config.js';
import type { NetState } from './network.js';
export type Verdict = 'confirmed' | 'refuted' | 'inconclusive' | 'unverifiable';
export interface Evidence {
    claimId: string;
    kind: string;
    claim: string;
    verdict: Verdict;
    agreeing: number;
    contradicting: number;
    provenance: string[];
    note?: string;
}
interface RawSource {
    label: string;
    value: string;
    ok: boolean;
    weak?: boolean;
}
export declare function verdictOf(sources: readonly RawSource[], cfg: DoubtConfig, online: boolean): {
    verdict: Verdict;
    agreeing: number;
    contradicting: number;
    note?: string;
};
export declare function gatherEvidence(claims: readonly Claim[], cfg: DoubtConfig, net: NetState, workspace?: string): Promise<Evidence[]>;
export {};
