import { type DoubtConfig } from './config.js';
export type LiveMutationKind = 'install' | 'write' | 'delete' | 'process' | 'service' | 'registry';
export interface LiveMutationFinding {
    callId: string;
    name: string;
    kind: LiveMutationKind;
    target: string;
    rule: string;
}
export interface LiveMutationAssessment {
    mutated: boolean;
    findings: LiveMutationFinding[];
    requirements: {
        rollback: boolean;
        confirm: boolean;
        healthCheck: boolean;
    };
    present: {
        rollback: boolean;
        confirm: boolean;
        healthCheck: boolean;
    };
    gaps: string[];
    satisfied: boolean;
}
export declare function detectLiveMutations(events: readonly unknown[], turn: number, config: DoubtConfig): LiveMutationFinding[];
export declare function rollbackDisclosed(draft: string): boolean;
export declare function confirmationSeen(events: readonly unknown[], findings: readonly LiveMutationFinding[], messages?: readonly any[]): boolean;
/** A human message that explicitly authorizes one dangerous action.
 *  Either a short standalone confirmation, or a confirmation word together with
 *  the kind of action. Used for the post-hoc confirmation point AND (with the
 *  last human message only) for the pre-execution approval seam. */
export declare function explicitAuthorization(text: string): boolean;
/** Pre-execution classification for one tool call (same rules as the post-hoc trace scan).
 *  Exported so the pre-execute gate and its tests use exactly one set of rules. */
export declare function classifyToolCall(name: string, args: unknown, config: DoubtConfig): LiveMutationFinding | undefined;
export declare function healthChecked(events: readonly unknown[], turn: number, findings: readonly LiveMutationFinding[]): {
    ok: boolean;
    callIds: string[];
};
export declare function assessLiveMutation(input: {
    events: readonly unknown[];
    turn: number;
    draft: string;
    config: DoubtConfig;
    messages?: readonly any[];
}): LiveMutationAssessment;
