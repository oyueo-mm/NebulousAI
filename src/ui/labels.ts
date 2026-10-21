import { t } from '../i18n';
import type { AgentSummary } from '../worker/protocol';

/** Localised policy label of an agent ("탐욕형 AI (Greedy)", "강화학습 AI (PPO · ppo-v4)"). */
export const agentLabel = (a: Pick<AgentSummary, 'kind' | 'modelId'>) => t.policy.label(a.kind, a.modelId);
