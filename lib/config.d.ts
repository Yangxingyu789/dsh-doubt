export interface DoubtConfig {
    enabled: boolean;
    verifyTool: boolean;
    promptSection: boolean;
    autoVerify: boolean;
    requireSources: number;
    probeUrls: string[];
    registryUrls: string[];
    onlineTimeoutMs: number;
    factored: boolean;
    factoredVotes: number;
    factoredProvider: string;
    executeAnswerCommands: boolean;
    strictLabeling: boolean;
    requireProvenance: boolean;
    requireOperationEvidence: boolean;
    operationMaxRounds: number;
    reviewTimeoutMs: number;
    reviewMaxChars: number;
    segmentedReview: boolean;
    reviewReasoningEffort: 'off' | 'low' | 'high' | 'max' | 'default';
    guardLiveMutation: boolean;
    guardPreExecute: boolean;
    reviewNotice: 'banner' | 'short' | 'off';
    reviewMaterialOnly: boolean;
    liveMutationPaths: string[];
    workspace: string;
    maxRounds: number;
    minScore: number;
    maxFindings: number;
    minAnswerChars: number;
    detectors: Record<string, boolean>;
    verificationTools: string[];
    denyBinaries: string[];
    timeoutMs: number;
    language: 'auto' | 'zh' | 'en';
}
export declare const DEFAULT_CONFIG: DoubtConfig;
export declare function normalizeConfig(raw: unknown): DoubtConfig;
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: string;
        validate: (value: unknown) => {
            issues: {
                message: string;
            }[];
            value?: undefined;
        } | {
            value: DoubtConfig;
            issues?: undefined;
        };
        types: {
            input: unknown;
            output: DoubtConfig;
        } | undefined;
    };
};
