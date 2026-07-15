import {
  JudgmentTraceViewer,
  judgmentTraceView,
  parseJudgmentTrace,
  validateJudgmentTrace,
  type JudgmentTrace,
  type JudgmentTraceView,
} from '@aikdna/kdna-web-client';

declare const trace: JudgmentTrace;
declare const container: Element;

const parsed: JudgmentTrace = parseJudgmentTrace(JSON.stringify(trace));
const view: JudgmentTraceView = judgmentTraceView(parsed);
const validation: { valid: boolean; errors: string[] } = validateJudgmentTrace(parsed);
const viewer = new JudgmentTraceViewer(container);
viewer.render(parsed);

void view;
void validation;
