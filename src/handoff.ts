import type { ExperimentProcess, ProcessStep } from './App';

/** 步骤登记的产物（输出）。移除采用软删除，保留追溯链。 */
export interface StepOutput {
  id: string;
  name: string;
  spec: string;
  removed?: boolean;
}

/** 后续步骤选用的上游产物（输入），快照记录选用确认时的名称与规格。 */
export interface StepInput {
  id: string;
  sourceStepId: string;
  outputId: string;
  snapshotName: string;
  snapshotSpec: string;
  usage: string;
}

export type LinkState =
  | 'linked'
  | 'name-changed'
  | 'spec-changed'
  | 'removed'
  | 'output-missing'
  | 'source-missing'
  | 'reordered';

export interface LinkStatus {
  state: LinkState;
  reasons: string[];
  source?: ProcessStep;
  output?: StepOutput;
}

export interface BrokenLink {
  input: StepInput;
  status: LinkStatus;
}

export interface OutputGroup {
  stepId: string;
  index: number;
  title: string;
  outputs: StepOutput[];
}

export const HANDOFF_SYSTEM_AUTHOR = '系统';
export const HANDOFF_SYSTEM_ROLE = '交接追溯';

export const systemBreakCommentId = (stepId: string): string => `sys-break-${stepId}`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** 依据当前步骤数据解析一条交接引用的链路状态（派生，不持久化状态本身）。 */
export function resolveInputLink(steps: ProcessStep[], owner: ProcessStep, input: StepInput): LinkStatus {
  const ownerIndex = steps.findIndex((step) => step.id === owner.id);
  const source = steps.find((step) => step.id === input.sourceStepId);
  if (!source) {
    return { state: 'source-missing', reasons: ['来源步骤已删除，交接链无法继续追溯，请改选其他产物或删除该交接'] };
  }
  const sourceIndex = steps.findIndex((step) => step.id === source.id);
  if (ownerIndex !== -1 && sourceIndex > ownerIndex) {
    return { state: 'reordered', source, reasons: [`来源步骤已移动到本步骤之后（现为步骤 ${pad(sourceIndex + 1)}），请重新核对交接顺序`] };
  }
  const output = source.outputs.find((item) => item.id === input.outputId);
  if (!output) {
    return { state: 'output-missing', source, reasons: ['上游步骤已删除该产物登记，请改选其他产物或移除本交接'] };
  }
  if (output.removed) {
    return { state: 'removed', source, output, reasons: [`产物「${output.name}」已被上游移除，请恢复登记、改选其他产物或删除本交接`] };
  }
  const reasons: string[] = [];
  if (input.snapshotName.trim() !== output.name.trim()) {
    reasons.push(`产物名称已变更：登记「${input.snapshotName || '（空）'}」→ 当前「${output.name}」`);
  }
  if (input.snapshotSpec.trim() !== output.spec.trim()) {
    reasons.push(`产物规格已变更：登记「${input.snapshotSpec || '（空）'}」→ 当前「${output.spec || '（空）'}」`);
  }
  if (reasons.length) {
    return { state: input.snapshotName.trim() !== output.name.trim() ? 'name-changed' : 'spec-changed', source, output, reasons };
  }
  return { state: 'linked', source, output, reasons: [] };
}

export function brokenInputsOfStep(steps: ProcessStep[], owner: ProcessStep): BrokenLink[] {
  return owner.inputs
    .map((input) => ({ input, status: resolveInputLink(steps, owner, input) }))
    .filter((item) => item.status.state !== 'linked');
}

export function brokenSteps(steps: ProcessStep[]): Array<{ step: ProcessStep; links: BrokenLink[] }> {
  return steps
    .map((step) => ({ step, links: brokenInputsOfStep(steps, step) }))
    .filter((item) => item.links.length > 0);
}

/** 可供某步骤选用的上游产物（只包含排在它之前的步骤，含已移除产物用于展示）。 */
export function upstreamOutputGroups(steps: ProcessStep[], ownerIndex: number): OutputGroup[] {
  if (ownerIndex <= 0) return [];
  return steps.slice(0, ownerIndex).map((step, index) => ({
    stepId: step.id,
    index,
    title: step.title,
    outputs: step.outputs
  })).filter((group) => group.outputs.length > 0);
}

export function linkStateMeta(state: LinkState): { label: string; intent: 'success' | 'warning' | 'danger' } {
  switch (state) {
    case 'linked':
      return { label: '交接一致', intent: 'success' };
    case 'name-changed':
      return { label: '名称已变更', intent: 'warning' };
    case 'spec-changed':
      return { label: '规格已变更', intent: 'warning' };
    case 'removed':
      return { label: '产物已移除', intent: 'danger' };
    case 'output-missing':
      return { label: '产物登记缺失', intent: 'danger' };
    case 'source-missing':
      return { label: '来源步骤缺失', intent: 'danger' };
    case 'reordered':
      return { label: '交接顺序变化', intent: 'warning' };
  }
}

/**
 * 交接对账：任何编辑/撤销/重做/载入后执行。
 * 断链步骤自动退回（confirmed → returned）并维护一条系统批注；链路恢复后移除批注。
 * 退回状态不会自动升级，必须由复核人重新确认。
 */
export function reconcileHandoffs(process: ExperimentProcess): void {
  process.steps.forEach((step) => {
    const broken = brokenInputsOfStep(process.steps, step);
    const commentId = systemBreakCommentId(step.id);
    const index = step.comments.findIndex((comment) => comment.id === commentId);

    if (broken.length === 0) {
      if (index >= 0) step.comments.splice(index, 1);
      return;
    }

    const lines = broken.map(({ input, status }) => {
      const sourceLabel = status.source
        ? `步骤 ${pad(process.steps.indexOf(status.source) + 1)}「${status.source.title}」`
        : '已删除的来源步骤';
      const target = input.snapshotName || '未命名产物';
      return `${sourceLabel} 的产物「${target}」：${status.reasons.join('；')}`;
    });
    const text = [
      `交接断链 · ${broken.length} 条上游交接需要重新核对：`,
      ...lines.map((line) => `· ${line}`),
      '请核对上下游产物并重新确认；交接恢复前该步骤不能确认，流程也不能冻结。'
    ].join('\n');

    if (index >= 0) {
      step.comments[index].text = text;
    } else {
      step.comments.push({
        id: commentId,
        author: HANDOFF_SYSTEM_AUTHOR,
        role: HANDOFF_SYSTEM_ROLE,
        text,
        createdAt: new Date().toISOString(),
        resolved: false
      });
    }
    if (step.status === 'confirmed') step.status = 'returned';
  });
}
