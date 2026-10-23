import type { DoubtConfig } from './config.js';
import { type ToolTrace } from './operations.js';
import type { PlainToolDefinition } from './tool.js';
export declare function hasMaterialClaim(text: string): boolean;
type Chunk = Record<string, any>;
type Message = Record<string, any>;
export interface ReviewPacket {
    requests: string[];
    draft: string;
    evidence: ToolTrace[];
    evidenceContext?: {
        currentTurn: number;
        currentCalls: number;
        historicalCalls: number;
        omittedCalls: number;
        truncatedCalls: number;
        complete: boolean;
    };
}
export interface ReviewDecision {
    approved: boolean;
    issues: string[];
    /** Reviewer/protocol failure is NOT an evidence gap in the user's task. */
    failure?: {
        code: string;
        finish?: string;
        inputChars?: number;
        outputChars?: number;
        detail?: string;
    };
}
export interface ReviewAttempt {
    attempt: number;
    phase: 'initial' | 'retry' | 'repair' | 'compact';
    inputChars: number;
    outputChars: number;
    elapsedMs: number;
    finish: string;
    failureCode?: string;
    /** Provider-reported counters only; absent usage is unknown, never zero. */
    usage?: Record<string, number>;
}
interface ReviewRun {
    attempts: number;
    omitReasoningEffort: boolean;
    observe?: (attempt: ReviewAttempt) => void;
}
export declare const REVIEW_TOOL = "doubt_review";
export declare function draftParts(draft: string): {
    id: number;
    text: string;
}[];
/** Do not send the draft twice: numbered parts already contain its exact text. */
export declare function reviewPayload(packet: ReviewPacket): string;
export declare function buildReviewPacket(events: readonly any[], turn: number, messages: readonly Message[], draft: string, maxChars: number): ReviewPacket;
/** Validate grounding and full coverage, independently of the reviewer's verdict. */
export declare function validateReview(raw: unknown, packet: ReviewPacket): ReviewDecision;
export interface ReviewPlanChunk {
    id: number;
    text: string;
    partIds: number[];
}
export declare function planReviewChunks(draft: string, maxChars: number, maxChunks?: number): ReviewPlanChunk[];
export interface ReviewOutcome {
    decision: ReviewDecision;
    uncovered: {
        id: number;
        preview: string;
        code?: string;
    }[];
}
export declare function reviewDraft(events: readonly any[], turn: number, messages: readonly Message[], draft: string, request: any, llm: any, cfg: DoubtConfig, observe?: (attempt: ReviewAttempt) => void): Promise<ReviewOutcome>;
/** Choose the trailing notice for an unreviewed release.
 *  'banner' = full review notice + issues, 'short' = one line, 'off' = no notice.
 *  The review failure itself is still logged; this only controls the user-visible tail. */
export declare function reviewNotice(cfg: DoubtConfig, detailed: string): string;
/** Tool execution must proceed, but accompanying unchecked assertions must not
 * reach the UI. Keep tool calls and thinking, remapping native block metadata. */
export declare function toolOnlyChunks(chunks: readonly Chunk[], excludedTools?: readonly string[]): Chunk[];
/** Test seam is a real tool-less model call in production, not a heuristic verdict. */
export declare function reviewPacket(packet: ReviewPacket, request: any, llm: any, cfg: DoubtConfig, retry?: boolean, repairNote?: string, compact?: boolean, omitReasoningEffort?: boolean, run?: ReviewRun): Promise<ReviewDecision>;
export declare function createCompletionGuard(getConfig: () => DoubtConfig, log?: (...args: unknown[]) => void): {
    install: (ctx: any, llm: any) => {
        dispose: () => void;
    };
    reviewTool: PlainToolDefinition;
    failedTurn(agent: any, turn: number): boolean;
    reviewedTurn(agent: any, turn: number): boolean;
};
export {};
