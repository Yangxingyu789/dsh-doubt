import { type Claim } from './claims.js';
import type { DoubtConfig } from './config.js';
export interface DoubtAgent {
    id?: string;
    status?: string;
    session?: {
        id?: string;
        snapshotEvents?: () => unknown[];
        events?: unknown[];
    };
    inbox?: {
        hasPending?: () => boolean;
        size?: number;
        length?: number;
    };
    followup?: (message: unknown) => void;
}
export interface LoopOptions {
    getConfig: () => DoubtConfig;
    log?: (...args: unknown[]) => void;
    /** Terminal completion-review failures must not restart legacy checks or provenance. */
    skipTurn?: (agent: DoubtAgent, turn: number) => boolean;
    /** Reviewed prose needs no second assertion/Tier C pass; document provenance still applies. */
    reviewedTurn?: (agent: DoubtAgent, turn: number) => boolean;
    delayMs?: number;
    probe?: {
        state: () => Promise<{
            online: boolean;
        }>;
    };
    factoredHost?: (agent: DoubtAgent) => {
        subagents: any;
        parent: any;
    } | null;
}
export declare const SOURCE_KIND = "dsh-doubt";
export declare function toQuestion(claim: Claim): string | null;
export declare function installDoubtLoop(ctx: any, options: LoopOptions): {
    dispose: () => void;
};
