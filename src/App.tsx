import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Divider,
  Elevation,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
  TextArea
} from '@blueprintjs/core';
import {
  brokenInputsOfStep,
  brokenSteps,
  linkStateMeta,
  reconcileHandoffs,
  resolveInputLink,
  upstreamOutputGroups,
  type BrokenLink,
  type StepInput,
  type StepOutput
} from './handoff';

type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned';
type ProcessStatus = 'draft' | 'in-review' | 'frozen' | 'revising';
type ViewId = 'editor' | 'review' | 'compare';

interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface ProcessStep {
  id: string;
  title: string;
  purpose: string;
  materials: string;
  equipment: string;
  amount: string;
  duration: number;
  hazards: string[];
  controls: string;
  dependencies: string[];
  safetyNote: string;
  expectedResult: string;
  status: StepStatus;
  comments: ReviewComment[];
  outputs: StepOutput[];
  inputs: StepInput[];
}

interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  note: string;
  author: string;
  steps: ProcessStep[];
}

export interface ExperimentProcess {
  id: string;
  title: string;
  code: string;
  objective: string;
  principal: string;
  lab: string;
  status: ProcessStatus;
  version: string;
  steps: ProcessStep[];
  versions: VersionSnapshot[];
  frozenAt?: string;
  updatedAt: string;
}

interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v1';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function initialProcess(): ExperimentProcess {
  const baseSteps: ProcessStep[] = [
    {
      id: 'step-1', title: '核对试剂与实验区域', purpose: '确认所需物料、设备及区域状态符合实验方案。',
      materials: '无水乙醇、去离子水', equipment: '通风柜、防爆柜、标签打印机', amount: '乙醇 120 mL；去离子水 300 mL',
      duration: 15, hazards: ['易燃液体'], controls: '在通风柜内取用，远离点火源；使用接地金属容器。',
      dependencies: [], safetyNote: '操作人员需佩戴护目镜和防化手套。', expectedResult: '试剂标签、数量和有效期均核对无误。',
      status: 'confirmed', comments: [
        { id: 'c-1', author: '李明', role: '研究员', text: '已核对批号和有效期，防爆柜温度记录正常。', createdAt: '2026-09-24T09:10:00+08:00', resolved: true }
      ],
      outputs: [
        { id: 'out-1-1', name: '已核对试剂', spec: '无水乙醇 120 mL；去离子水 300 mL，批号与有效期已登记' }
      ],
      inputs: []
    },
    {
      id: 'step-2', title: '搭建恒温循环装置', purpose: '连接循环浴与反应夹套，检查密封和温控。',
      materials: '无', equipment: '恒温循环浴、硅胶管、反应夹套、扎带', amount: '循环液 800 mL',
      duration: 25, hazards: ['烫伤', '管路脱落'], controls: '管路双端固定；升温前完成 5 分钟试压并设置独立超温断电。',
      dependencies: ['step-1'], safetyNote: '高温表面设置警示标识，循环浴周围保持干燥。', expectedResult: '30 分钟内温度稳定在 55 ± 0.5 ℃。',
      status: 'confirmed', comments: [
        { id: 'c-2', author: '王颖', role: '安全复核员', text: '补充超温断电值，不能只依赖设备自带温控。', createdAt: '2026-09-24T10:05:00+08:00', resolved: true }
      ],
      outputs: [
        { id: 'out-2-1', name: '恒温循环装置', spec: '55 ± 0.5 ℃ 稳定运行，已完成 5 分钟试压，超温断电 65 ℃' }
      ],
      inputs: [
        { id: 'in-2-1', sourceStepId: 'step-1', outputId: 'out-1-1', snapshotName: '已核对试剂', snapshotSpec: '无水乙醇 120 mL；去离子水 300 mL，批号与有效期已登记', usage: '取用前再次核对标签' }
      ]
    },
    {
      id: 'step-3', title: '加入催化剂并启动反应', purpose: '按批次加入催化剂，记录起点并开始计时。',
      materials: '催化剂 A', equipment: '分析天平、加料漏斗、计时器', amount: '催化剂 A 2.50 ± 0.02 g',
      duration: 20, hazards: ['粉尘吸入', '放热反应'], controls: '在通风柜内称量，佩戴 N95 口罩；分三次少量加入并监测温度。',
      dependencies: ['step-2'], safetyNote: '反应温度超过 70 ℃ 时立即停止加料并启动冷却。', expectedResult: '温度缓慢升至 62–66 ℃，无明显冲料。',
      status: 'confirmed', comments: [],
      outputs: [
        { id: 'out-3-1', name: '反应混合液', spec: '催化剂 A 2.50 ± 0.02 g，62–66 ℃ 反应中，加料三次完成' }
      ],
      inputs: [
        // 上游产物规格后来改为 65 ℃ 超温断电，此处仍为旧快照，载入对账时断链并退回
        { id: 'in-3-1', sourceStepId: 'step-2', outputId: 'out-2-1', snapshotName: '恒温循环装置', snapshotSpec: '55 ± 0.5 ℃ 稳定运行，已完成 5 分钟试压', usage: '在稳定温控条件下加料' }
      ]
    },
    {
      id: 'step-4', title: '恒温反应与过程取样', purpose: '维持温度并定时取样观察反应转化。',
      materials: '样品瓶、惰性气体', equipment: '取样针、气相色谱、恒温循环浴', amount: '每点样品约 1 mL，共 6 点',
      duration: 90, hazards: ['高温液体', '挥发性气体'], controls: '取样前泄压；使用长针和防护屏；样品瓶及时封闭。',
      dependencies: ['step-3'], safetyNote: '取样时不得正对瓶口，样品瓶不得完全密封后加热。', expectedResult: '转化率达到 95% 以上且无异常副产物。',
      status: 'submitted', comments: [],
      outputs: [
        { id: 'out-4-1', name: '过程样品', spec: '每点约 1 mL，共 6 点，氮气封存，GC 编号 S1–S6' }
      ],
      inputs: [
        // 上游产物名称已由“反应液”更名为“反应混合液”，此处仍为旧名称，断链待重新确认
        { id: 'in-4-1', sourceStepId: 'step-3', outputId: 'out-3-1', snapshotName: '反应液', snapshotSpec: '催化剂 A 2.50 ± 0.02 g，62–66 ℃ 反应中，加料三次完成', usage: '维持搅拌并定时取样' }
      ]
    },
    {
      id: 'step-5', title: '停止加热并冷却', purpose: '终止反应并将体系降至安全温度。',
      materials: '无', equipment: '循环浴、温度探头', amount: '降温目标 ≤ 30 ℃', duration: 35,
      hazards: ['烫伤', '残余反应'], controls: '先停止加料并维持搅拌，再以不超过 1 ℃/min 的速率降温。',
      dependencies: ['step-4'], safetyNote: '确认温度连续 5 分钟低于 30 ℃ 后才能拆除装置。', expectedResult: '体系温度稳定低于 30 ℃。',
      status: 'draft', comments: [],
      outputs: [
        { id: 'out-5-1', name: '冷却反应液', spec: '≤ 30 ℃ 且连续稳定 5 分钟，搅拌维持' }
      ],
      inputs: [
        { id: 'in-5-1', sourceStepId: 'step-4', outputId: 'out-4-1', snapshotName: '过程样品', snapshotSpec: '每点约 1 mL，共 6 点，氮气封存，GC 编号 S1–S6', usage: '取样结束后继续维持体系冷却' }
      ]
    },
    {
      id: 'step-6', title: '废液分类与现场恢复', purpose: '按危险废物要求分类收集并恢复实验区域。',
      materials: '废液桶、吸附棉', equipment: '防化手套、护目镜、危废标签', amount: '按实际产生量记录', duration: 25,
      hazards: ['废液混装', '化学暴露'], controls: '有机废液单独收集，核对相容性后贴标签；泄漏吸附材料按危废处置。',
      dependencies: ['step-5'], safetyNote: '废液不得倒入下水道，现场恢复后完成双人确认。', expectedResult: '废液交接记录完整，台面无残留。',
      status: 'draft', comments: [],
      outputs: [
        { id: 'out-6-1', name: '危废交接记录', spec: '有机废液与吸附棉分类贴签，双人签字' }
      ],
      inputs: [
        { id: 'in-6-1', sourceStepId: 'step-5', outputId: 'out-5-1', snapshotName: '冷却反应液', snapshotSpec: '≤ 30 ℃ 且连续稳定 5 分钟，搅拌维持', usage: '确认降温到位后排入废液收集桶' }
      ]
    }
  ];

  const firstVersion: VersionSnapshot = {
    id: 'version-1-0', label: '首版批准流程', version: '1.0.0', createdAt: '2026-09-20T14:30:00+08:00',
    note: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };
  const secondVersion: VersionSnapshot = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', createdAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    status: 'in-review', version: '1.2.0-draft',
    steps: baseSteps, versions: [firstVersion, secondVersion], updatedAt: new Date().toISOString()
  };
}

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentProcess) => void }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentProcess }
): HistoryState {
  if (action.type === 'commit') {
    const next = clone(state.present);
    action.update(next);
    next.updatedAt = new Date().toISOString();
    reconcileHandoffs(next);
    return { past: [...state.past.slice(-59), clone(state.present)], present: next, future: [] };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    const restored = clone(previous);
    reconcileHandoffs(restored);
    return { past: state.past.slice(0, -1), present: restored, future: [clone(state.present), ...state.future].slice(0, 60) };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    const restored = clone(next);
    reconcileHandoffs(restored);
    return { past: [...state.past, clone(state.present)].slice(-60), present: restored, future: state.future.slice(1) };
  }
  return { past: [], present: action.value, future: [] };
}

/** 旧流程没有交接信息时迁移为空数组，照常编辑，不破坏本地已有数据。 */
function migrateProcess(raw: ExperimentProcess): ExperimentProcess {
  raw.steps.forEach((step) => {
    if (!Array.isArray(step.outputs)) step.outputs = [];
    if (!Array.isArray(step.inputs)) step.inputs = [];
    step.outputs.forEach((output) => {
      if (typeof output.removed !== 'boolean') output.removed = false;
    });
  });
  raw.versions?.forEach((version) => {
    version.steps?.forEach((step) => {
      if (!Array.isArray((step as ProcessStep).outputs)) (step as ProcessStep).outputs = [];
      if (!Array.isArray((step as ProcessStep).inputs)) (step as ProcessStep).inputs = [];
    });
  });
  reconcileHandoffs(raw);
  return raw;
}

function loadProcess(): ExperimentProcess {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return migrateProcess(initialProcess());
    const parsed = JSON.parse(value) as ExperimentProcess;
    return parsed.id && Array.isArray(parsed.steps) ? migrateProcess(parsed) : migrateProcess(initialProcess());
  } catch {
    return migrateProcess(initialProcess());
  }
}

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

function processStatusLabel(status: ProcessStatus): string {
  return status === 'frozen' ? '已冻结' : status === 'in-review' ? '复核中' : status === 'revising' ? '修订中' : '草稿';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: loadProcess(), future: [] }));
  const process = history.present;
  const [selectedStepId, setSelectedStepId] = useState(process.steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [compareBaseId, setCompareBaseId] = useState(process.versions[0]?.id ?? '');
  const [compareTargetId, setCompareTargetId] = useState(process.versions.at(-1)?.id ?? '');
  const initialSaveSkipped = useRef(false);

  const selectedStep = process.steps.find((step) => step.id === selectedStepId) ?? process.steps[0];
  const downstreamIds = useMemo(() => collectDownstream(process.steps, lastModifiedId), [process.steps, lastModifiedId]);
  const impactedSteps = process.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = process.steps.filter(hasMissingSafety);
  const brokenList = useMemo(() => brokenSteps(process.steps), [process.steps]);
  const brokenStepIds = useMemo(() => new Set(brokenList.map((item) => item.step.id)), [brokenList]);
  const selectedBroken: BrokenLink[] = selectedStep ? brokenInputsOfStep(process.steps, selectedStep) : [];
  const [pendingInputRef, setPendingInputRef] = useState('');
  const pendingReviewCount = process.steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  const confirmedCount = process.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = process.steps.length ? Math.round((confirmedCount / process.steps.length) * 100) : 0;
  const versionDiff = useMemo(() => compareVersions(process, compareBaseId, compareTargetId), [process, compareBaseId, compareTargetId]);

  const selectedStepIndex = selectedStep ? process.steps.indexOf(selectedStep) : -1;
  const upstreamGroups = useMemo(
    () => (selectedStep ? upstreamOutputGroups(process.steps, selectedStepIndex) : []),
    [process.steps, selectedStep, selectedStepIndex]
  );

  useEffect(() => {
    if (!initialSaveSkipped.current) {
      initialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
    setSavedLabel(`自动保存 · ${formatDate(new Date().toISOString())}`);
  }, [process]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? dispatch({ type: 'redo' }) : dispatch({ type: 'undo' });
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
        setSavedLabel(`手动保存 · ${formatDate(new Date().toISOString())}`);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [process]);

  const commitProcess = (update: (draft: ExperimentProcess) => void): void => {
    dispatch({ type: 'commit', update });
  };

  const updateProcessField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    commitProcess((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    setLastModifiedId(id);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (step) (step as unknown as Record<string, unknown>)[field] = value;
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const addStep = (): void => {
    if (process.status === 'frozen') return;
    const id = uid('step');
    commitProcess((draft) => {
      draft.steps.push({
        id, title: '新的实验步骤', purpose: '', materials: '', equipment: '', amount: '', duration: 10,
        hazards: [], controls: '', dependencies: draft.steps.at(-1) ? [draft.steps.at(-1)!.id] : [],
        safetyNote: '', expectedResult: '', status: 'draft', comments: [], outputs: [], inputs: []
      });
      draft.status = 'draft';
    });
    setSelectedStepId(id);
    setLastModifiedId(id);
    setActiveView('editor');
  };

  const duplicateStep = (): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const copy: ProcessStep = clone(selectedStep);
    copy.id = uid('step');
    copy.title = `${copy.title}（副本）`;
    copy.status = 'draft';
    copy.comments = [];
    copy.dependencies = [...copy.dependencies];
    copy.outputs = copy.outputs.map((output) => ({ ...output, id: uid('output') }));
    // 交接引用仍指向上游产物；若复制后顺序越界，对账会标记并提示重新核对
    copy.inputs = copy.inputs.map((input) => ({ ...input, id: uid('input') }));
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === selectedStep.id);
      draft.steps.splice(index + 1, 0, copy);
    });
    setSelectedStepId(copy.id);
  };

  const deleteStep = (): void => {
    if (!selectedStep || process.steps.length <= 1 || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      draft.steps = draft.steps.filter((step) => step.id !== id);
      draft.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
    });
    setSelectedStepId(process.steps.find((step) => step.id !== id)?.id ?? '');
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const [step] = draft.steps.splice(index, 1);
      draft.steps.splice(nextIndex, 0, step);
    });
    setLastModifiedId(id);
  };

  const toggleDependency = (dependencyId: string, checked: boolean): void => {
    if (!selectedStep) return;
    const next = checked
      ? [...new Set([...selectedStep.dependencies, dependencyId])]
      : selectedStep.dependencies.filter((id) => id !== dependencyId);
    updateStep('dependencies', next);
  };

  const selectStep = (id: string): void => {
    setSelectedStepId(id);
    setPendingInputRef('');
  };

  const addOutput = (): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    setLastModifiedId(stepId);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === stepId);
      step?.outputs.push({ id: uid('output'), name: '新产物', spec: '', removed: false });
    });
  };

  const updateOutput = (outputId: string, field: 'name' | 'spec', value: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    setLastModifiedId(stepId);
    commitProcess((draft) => {
      const output = draft.steps.find((item) => item.id === stepId)?.outputs.find((item) => item.id === outputId);
      if (output) output[field] = value;
    });
  };

  const toggleOutputRemoved = (outputId: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    setLastModifiedId(stepId);
    commitProcess((draft) => {
      const output = draft.steps.find((item) => item.id === stepId)?.outputs.find((item) => item.id === outputId);
      if (output) output.removed = !output.removed;
    });
  };

  const addInput = (): void => {
    if (!selectedStep || !pendingInputRef || process.status === 'frozen') return;
    const [sourceStepId, outputId] = pendingInputRef.split('::');
    const source = process.steps.find((step) => step.id === sourceStepId);
    const output = source?.outputs.find((item) => item.id === outputId);
    if (!source || !output) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === stepId);
      if (!step) return;
      if (step.inputs.some((input) => input.sourceStepId === sourceStepId && input.outputId === outputId)) return;
      step.inputs.push({
        id: uid('input'), sourceStepId, outputId,
        snapshotName: output.name, snapshotSpec: output.spec, usage: ''
      });
    });
    setPendingInputRef('');
  };

  const changeInputSource = (inputId: string, ref: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const [sourceStepId, outputId] = ref.split('::');
    const source = process.steps.find((step) => step.id === sourceStepId);
    const output = source?.outputs.find((item) => item.id === outputId);
    if (!source || !output) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const input = draft.steps.find((item) => item.id === stepId)?.inputs.find((item) => item.id === inputId);
      if (!input) return;
      input.sourceStepId = sourceStepId;
      input.outputId = outputId;
      input.snapshotName = output.name;
      input.snapshotSpec = output.spec;
    });
  };

  const updateInputUsage = (inputId: string, value: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const input = draft.steps.find((item) => item.id === stepId)?.inputs.find((item) => item.id === inputId);
      if (input) input.usage = value;
    });
  };

  /** 按当前上游登记刷新快照，表示已重新核对名称与规格（复核人可在此复核页直接确认）。 */
  const reconfirmInput = (inputId: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === stepId);
      const input = step?.inputs.find((item) => item.id === inputId);
      const output = draft.steps.find((item) => item.id === input?.sourceStepId)
        ?.outputs.find((item) => item.id === input?.outputId);
      if (input && output && !output.removed) {
        input.snapshotName = output.name;
        input.snapshotSpec = output.spec;
      }
    });
  };

  const removeInput = (inputId: string): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === stepId);
      if (step) step.inputs = step.inputs.filter((item) => item.id !== inputId);
    });
  };

  const submitForReview = (): void => {
    if (process.status === 'frozen') return;
    commitProcess((draft) => {
      draft.status = 'in-review';
      draft.steps.forEach((step) => {
        if (step.status !== 'confirmed') step.status = 'submitted';
      });
    });
    setActiveView('review');
    setSavedLabel('流程已提交复核');
  };

  const addReviewComment = (): void => {
    if (!selectedStep || !commentText.trim()) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      step?.comments.push({
        id: uid('comment'), author: CURRENT_AUTHOR, role: CURRENT_ROLE,
        text: commentText.trim(), createdAt: new Date().toISOString(), resolved: false
      });
    });
    setCommentText('');
  };

  const setStepStatus = (status: StepStatus): void => {
    if (!selectedStep) return;
    if (status === 'confirmed' && brokenStepIds.has(selectedStep.id)) {
      setSavedLabel('交接断链未恢复，不能确认该步骤');
      return;
    }
    updateStep('status', status);
    setLastModifiedId(status === 'returned' ? selectedStep.id : null);
  };

  const resolveComment = (commentId: string): void => {
    if (!selectedStep) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const comment = draft.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  };

  const freezeVersion = (): void => {
    if (process.status === 'frozen') return;
    if (process.steps.some((step) => step.status !== 'confirmed') || missingSafetySteps.length) {
      setSavedLabel('冻结条件未满足');
      return;
    }
    if (brokenList.length) {
      setSavedLabel('存在交接断链，重新确认前不能冻结');
      return;
    }
    const nextNumber = nextMinorVersion(process.version);
    const previousVersionId = process.versions.at(-1)?.id ?? '';
    const frozenVersionId = uid('version');
    commitProcess((draft) => {
      draft.versions.push({
        id: frozenVersionId, label: '复核通过冻结版', version: nextNumber,
        createdAt: new Date().toISOString(), note: `${draft.steps.length} 个步骤全部确认，安全控制完整。`,
        author: CURRENT_AUTHOR, steps: clone(draft.steps)
      });
      draft.version = nextNumber;
      draft.status = 'frozen';
      draft.frozenAt = new Date().toISOString();
    });
    setSavedLabel(`版本 ${nextNumber} 已冻结`);
    setCompareBaseId(previousVersionId);
    setCompareTargetId(frozenVersionId);
  };

  const startRevision = (): void => {
    if (process.status !== 'frozen') return;
    commitProcess((draft) => {
      const nextNumber = nextMinorVersion(draft.version);
      draft.version = `${nextNumber}-revision`;
      draft.status = 'revising';
      draft.frozenAt = undefined;
      draft.steps.forEach((step) => {
        step.status = 'draft';
        step.comments = [];
      });
    });
    setActiveView('editor');
    setSavedLabel('已从冻结版本创建修订稿');
  };

  const addVersionSnapshot = (): void => {
    commitProcess((draft) => {
      draft.versions.push({
        id: uid('version'), label: '工作版本快照', version: draft.version.replace('-draft', ''),
        createdAt: new Date().toISOString(), note: '保存当前步骤与复核状态。',
        author: CURRENT_AUTHOR, steps: clone(draft.steps)
      });
    });
    setSavedLabel('已保存工作版本快照');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>步骤影响分析 · 逐条复核 · 冻结版本</p></div>
        </div>
        <div className="header-status">
          <span className={`network ${online ? 'online' : ''}`}></span>
          <span>{online ? '离线保存已启用' : '当前离线，修改仍会保存'}</span>
          <strong>{savedLabel}</strong>
        </div>
        <div className="header-actions">
          <Button icon="undo" text="撤销" minimal disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
          <Button icon="redo" text="重做" minimal disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
          <Button icon="floppy-disk" text="保存快照" onClick={addVersionSnapshot} />
          <Button icon="lock" text="冻结版本" intent="primary" onClick={freezeVersion} disabled={process.status === 'frozen' || brokenList.length > 0} />
        </div>
      </header>

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核和版本快照仍会保存在当前浏览器。</Callout>}

      <section className="process-banner">
        <div className="banner-main">
          <div className="code-line"><span>{process.code}</span><Tag minimal>{processStatusLabel(process.status)}</Tag></div>
          <h2>{process.title}</h2>
          <p>{process.objective}</p>
        </div>
        <div className="banner-meta">
          <div><span>负责人</span><strong>{process.principal}</strong></div>
          <div><span>实验区域</span><strong>{process.lab}</strong></div>
          <div><span>当前版本</span><strong>{process.version}</strong></div>
        </div>
        <div className="banner-progress">
          <div><span>复核进度</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
          <ProgressBar value={reviewProgress / 100} intent={reviewProgress === 100 ? 'success' : 'primary'} stripes={reviewProgress < 100} />
          <small>{pendingReviewCount ? `${pendingReviewCount} 条待处理` : '所有步骤已处理'} · {missingSafetySteps.length} 条安全缺口 · {brokenList.length ? <b className="broken-text">{brokenList.length} 个步骤交接断链</b> : '交接链完整'}</small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {pendingReviewCount > 0 && <b className="tab-badge">{pendingReviewCount}</b>}</span>} />
        <Tab id="compare" title={<span><Icon icon="comparison" /> 版本比较</span>} />
      </Tabs>

      {activeView === 'editor' && selectedStep && (
        <main className="editor-layout">
          <aside className="step-panel">
            <div className="panel-heading">
              <div><span>PROCESS STEPS</span><h3>实验步骤</h3></div>
              <Button icon="add" minimal small onClick={addStep} disabled={process.status === 'frozen'} />
            </div>
            <div className="step-list">
              {process.steps.map((step, index) => (
                <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => selectStep(step.id)}>
                  <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}{brokenStepIds.has(step.id) ? ' · 交接断链' : ''}</small></span>
                  {brokenStepIds.has(step.id)
                    ? <Icon icon="offline" intent="danger" size={13} />
                    : hasMissingSafety(step)
                      ? <Icon icon="warning-sign" intent="danger" size={13} />
                      : null}
                </button>
              ))}
            </div>
            <div className="step-actions">
              <Button icon="arrow-up" small minimal disabled={process.steps[0]?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(-1)} />
              <Button icon="arrow-down" small minimal disabled={process.steps.at(-1)?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(1)} />
              <Button icon="duplicate" small minimal text="复制" disabled={process.status === 'frozen'} onClick={duplicateStep} />
              <Button icon="trash" small minimal intent="danger" disabled={process.status === 'frozen'} onClick={deleteStep} />
            </div>
          </aside>

          <section className="editor-main">
            <Card elevation={Elevation.ONE} className="process-meta-card">
              <div className="card-title"><div><span>PROCESS INFO</span><h3>实验基本信息</h3></div><Tag minimal intent="primary">{process.steps.length} 个步骤</Tag></div>
              <div className="meta-grid">
                <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill value={process.title} onChange={(event) => updateProcessField('title', event.target.value)} /></FormGroup>
                <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill value={process.code} onChange={(event) => updateProcessField('code', event.target.value)} /></FormGroup>
                <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill value={process.principal} onChange={(event) => updateProcessField('principal', event.target.value)} /></FormGroup>
                <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill value={process.lab} onChange={(event) => updateProcessField('lab', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill value={process.objective} onChange={(event) => updateProcessField('objective', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(process.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
              </div>
              <FormGroup label="步骤名称" labelFor="step-title"><InputGroup id="step-title" fill value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
              <FormGroup label="操作目的" labelFor="step-purpose"><TextArea id="step-purpose" fill value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
              <div className="form-grid">
                <FormGroup label="材料" labelFor="materials"><TextArea id="materials" fill value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label="设备" labelFor="equipment"><TextArea id="equipment" fill value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label="用量 / 参数" labelFor="amount"><TextArea id="amount" fill value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label="预计时间（分钟）" labelFor="duration"><InputGroup id="duration" type="number" min={1} fill value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards"><TextArea id="hazards" fill value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label="控制措施" labelFor="controls"><TextArea id="controls" fill value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label="预期结果" labelFor="expected"><TextArea id="expected" fill value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="handoff-card">
              <div className="card-title">
                <div><span>HANDOFF TRACE</span><h3>步骤交接 · 产物输入输出</h3></div>
                <Tag minimal intent={selectedBroken.length ? 'danger' : 'success'}>{selectedBroken.length ? `${selectedBroken.length} 条断链` : '交接正常'}</Tag>
              </div>
              <p className="muted">每步先登记产物，后续步骤从上游步骤选用产物。上游改名、改规格或移除产物时，引用处会断链并自动退回复核；重新确认前该步骤不能确认，流程不能冻结。</p>

              {selectedBroken.length > 0 && (
                <Callout intent="danger" icon="offline" className="handoff-break-callout">
                  <strong>{selectedBroken.length} 条交接断链，本步骤已退回复核</strong>
                  {selectedBroken.map(({ input, status }) => (
                    <p key={input.id}>· {status.reasons.join('；')}</p>
                  ))}
                </Callout>
              )}

              <div className="handoff-section-head">
                <h4>本步骤登记的产物</h4>
                <Button small minimal icon="add" text="登记产物" onClick={addOutput} disabled={process.status === 'frozen'} />
              </div>
              <div className="handoff-outputs">
                {selectedStep.outputs.map((output) => (
                  <div className={`handoff-row ${output.removed ? 'removed-output' : ''}`} key={output.id}>
                    <div className="handoff-row-main">
                      <InputGroup
                        small fill placeholder="产物名称（如：反应混合液）" value={output.name}
                        onChange={(event) => updateOutput(output.id, 'name', event.target.value)}
                        disabled={process.status === 'frozen' || output.removed}
                      />
                      <InputGroup
                        small fill placeholder="规格 / 数量 / 状态（如：2.50 g，62–66 ℃）" value={output.spec}
                        onChange={(event) => updateOutput(output.id, 'spec', event.target.value)}
                        disabled={process.status === 'frozen' || output.removed}
                      />
                    </div>
                    <Button
                      small minimal
                      icon={output.removed ? 'undo' : 'cross'}
                      text={output.removed ? '恢复' : '移除'}
                      intent={output.removed ? 'none' : 'danger'}
                      onClick={() => toggleOutputRemoved(output.id)}
                      disabled={process.status === 'frozen'}
                    />
                  </div>
                ))}
                {!selectedStep.outputs.length && <p className="muted handoff-empty">尚未登记产物。登记后下游步骤才能选用并建立可追溯交接。</p>}
              </div>

              <Divider />

              <div className="handoff-section-head">
                <h4>选用的上游产物（{selectedStep.inputs.length}）</h4>
                <div className="handoff-add">
                  <HTMLSelect
                    className="handoff-select-small"
                    value={pendingInputRef}
                    disabled={process.status === 'frozen' || upstreamGroups.length === 0}
                    onChange={(event) => setPendingInputRef(event.target.value)}
                  >
                    <option value="">{upstreamGroups.length ? '选择上游产物…' : '暂无可选用的上游产物'}</option>
                    {upstreamGroups.map((group) => (
                      <optgroup key={group.stepId} label={`${String(group.index + 1).padStart(2, '0')} · ${group.title}`}>
                        {group.outputs.map((output) => (
                          <option key={`${group.stepId}::${output.id}`} value={`${group.stepId}::${output.id}`}>
                            {output.removed ? '（已移除）' : ''}{output.name}{output.spec ? ` · ${output.spec}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </HTMLSelect>
                  <Button small icon="link" text="选用" onClick={addInput} disabled={!pendingInputRef || process.status === 'frozen'} />
                </div>
              </div>
              <div className="handoff-inputs">
                {selectedStep.inputs.map((input) => {
                  const status = resolveInputLink(process.steps, selectedStep, input);
                  const meta = linkStateMeta(status.state);
                  const sourceIndex = status.source ? process.steps.indexOf(status.source) : -1;
                  const refValue = status.source ? `${input.sourceStepId}::${input.outputId}` : '';
                  const repairable = status.state === 'name-changed' || status.state === 'spec-changed';
                  const repointable = status.state !== 'linked' && status.state !== 'reordered' && status.source;
                  return (
                    <div className={`handoff-row input-row ${status.state === 'linked' ? '' : 'broken'}`} key={input.id}>
                      <div className="handoff-row-top">
                        <Tag minimal intent={meta.intent} icon={status.state === 'linked' ? 'link' : 'offline'}>{meta.label}</Tag>
                        {status.source && (
                          <HTMLSelect
                            className="handoff-select-small"
                            value={refValue}
                            disabled={process.status === 'frozen' || !repointable}
                            onChange={(event) => changeInputSource(input.id, event.target.value)}
                          >
                            {upstreamGroups.map((group) => (
                              <optgroup key={group.stepId} label={`${String(group.index + 1).padStart(2, '0')} · ${group.title}`}>
                                {group.outputs.map((output) => (
                                  <option key={`${group.stepId}::${output.id}`} value={`${group.stepId}::${output.id}`}>
                                    {output.removed ? '（已移除）' : ''}{output.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </HTMLSelect>
                        )}
                        {!status.source && <Tag minimal intent="danger">来源步骤已删除</Tag>}
                        <div className="handoff-row-actions">
                          {repairable && (
                            <Button small minimal icon="updated" intent="warning"
                              text="按当前登记重新确认"
                              onClick={() => reconfirmInput(input.id)}
                              disabled={process.status === 'frozen'} />
                          )}
                          <Button small minimal icon="trash" intent="danger"
                            onClick={() => removeInput(input.id)}
                            disabled={process.status === 'frozen'} />
                        </div>
                      </div>
                      <div className="handoff-snapshot">
                        <span>选用时：<b>{input.snapshotName || '（空）'}</b>{input.snapshotSpec ? ` · ${input.snapshotSpec}` : ''}</span>
                        {status.output && status.state !== 'removed' && (
                          <span className={repairable ? 'snapshot-current changed' : 'snapshot-current'}>
                            当前登记：<b>{status.output.name}</b>{status.output.spec ? ` · ${status.output.spec}` : ''}
                          </span>
                        )}
                        {sourceIndex >= 0 && <small>来源：步骤 {String(sourceIndex + 1).padStart(2, '0')}</small>}
                      </div>
                      {status.state !== 'linked' && (
                        <ul className="handoff-reasons">{status.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      )}
                      <InputGroup
                        small fill placeholder="本步骤如何使用该产物（用途、用量、操作要求）" value={input.usage}
                        onChange={(event) => updateInputUsage(input.id, event.target.value)}
                        disabled={process.status === 'frozen'}
                      />
                    </div>
                  );
                })}
                {!selectedStep.inputs.length && <p className="muted handoff-empty">尚未选用上游产物。可从上方下拉中选择前置步骤登记的产物。</p>}
              </div>
            </Card>

            <Card elevation={Elevation.ONE} className="dependency-card">
              <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
              <p className="muted">当前步骤只有在所选前置步骤完成后才能进入执行队列。</p>
              <div className="dependency-grid">
                {process.steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                  <Checkbox key={step.id} checked={selectedStep.dependencies.includes(step.id)} label={`${String(process.steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
                ))}
              </div>
            </Card>
          </section>

          <aside className="inspector-panel">
            <Card elevation={Elevation.ONE} className="impact-card">
              <div className="card-title"><div><span>IMPACT ANALYSIS</span><h3>变更影响提醒</h3></div><Icon icon="path-search" size={18} /></div>
              {lastModifiedId ? (
                <>
                  <Callout intent={impactedSteps.length ? 'warning' : 'primary'} icon={impactedSteps.length ? 'warning-sign' : 'tick'}>
                    <strong>{impactedSteps.length ? `${impactedSteps.length} 个后续步骤受影响` : '未发现下游步骤'}</strong>
                    <p>{impactedSteps.length ? '请重新核对依赖、用量、危险项和已确认内容。' : '当前修改没有影响其他步骤的安全条件。'}</p>
                  </Callout>
                  <div className="impact-list">
                    {impactedSteps.map((step) => (
                      <button key={step.id} onClick={() => selectStep(step.id)}>
                        <Icon icon={step.status === 'confirmed' ? 'endorsed' : 'circle'} intent={step.status === 'confirmed' ? 'success' : 'none'} size={13} />
                        <span><strong>{step.title}</strong><small>{step.status === 'confirmed' ? '已确认内容，需重新复核' : `当前状态：${statusLabel(step.status)}`}</small></span>
                        <Icon icon="chevron-right" size={12} />
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className="muted">编辑任一步骤后，这里会显示受影响的所有后续步骤和已确认内容。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="safety-card">
              <div className="card-title"><div><span>SAFETY GATE</span><h3>安全完整性</h3></div><Tag intent={missingSafetySteps.length ? 'danger' : 'success'} minimal>{missingSafetySteps.length ? `${missingSafetySteps.length} 项缺口` : '通过'}</Tag></div>
              {missingSafetySteps.length ? missingSafetySteps.map((step) => (
                <button className="safety-row" key={step.id} onClick={() => selectStep(step.id)}><Icon icon="warning-sign" intent="danger" size={14} /><span><strong>{step.title}</strong><small>危险项缺少控制措施或安全说明</small></span></button>
              )) : <p className="muted">所有存在危险项的步骤都已填写控制措施和安全说明。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="handoff-gate-card">
              <div className="card-title"><div><span>HANDOFF GATE</span><h3>交接链状态</h3></div><Tag intent={brokenList.length ? 'danger' : 'success'} minimal>{brokenList.length ? `${brokenList.length} 个断链` : '全部连通'}</Tag></div>
              {brokenList.length ? brokenList.map(({ step, links }) => (
                <button className="safety-row" key={step.id} onClick={() => selectStep(step.id)}>
                  <Icon icon="offline" intent="danger" size={14} />
                  <span><strong>{step.title}</strong><small>{links.length} 条上游交接断链，已退回复核</small></span>
                </button>
              )) : <p className="muted">所有步骤选用的上游产物均与当前登记一致，可进入冻结检查。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="gate-card">
              <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div></div>
              <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
              <div className="gate-row"><span>安全缺口</span><strong className={missingSafetySteps.length ? 'danger-text' : ''}>{missingSafetySteps.length}</strong></div>
              <div className="gate-row"><span>交接断链</span><strong className={brokenList.length ? 'danger-text' : ''}>{brokenList.length}</strong></div>
              <div className="gate-row"><span>流程状态</span><strong>{processStatusLabel(process.status)}</strong></div>
              <Divider />
              {process.status === 'frozen' ? <Button fill intent="warning" icon="git-branch" text="从冻结版创建修订" onClick={startRevision} /> : <Button fill intent="primary" icon="send-to" text="提交复核" onClick={submitForReview} />}
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'review' && (
        <main className="review-layout">
          <aside className="review-steps">
            <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>逐条复核</h3></div><Tag intent={pendingReviewCount ? 'warning' : 'success'}>{pendingReviewCount ? `${pendingReviewCount} 待处理` : '已完成'}</Tag></div>
            {process.steps.map((step, index) => (
              <button key={step.id} className={`${step.id === selectedStep.id ? 'selected' : ''} ${step.status}`} onClick={() => selectStep(step.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{statusLabel(step.status)}{brokenStepIds.has(step.id) ? ' · 交接断链' : ''}</small></div>
                {brokenStepIds.has(step.id)
                  ? <Icon icon="offline" intent="danger" size={15} />
                  : <Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} size={15} />}
              </button>
            ))}
          </aside>
          <section className="review-main">
            {selectedStep && (
              <>
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
                  <div className="review-facts">
                    <div><span>预计时间</span><strong>{selectedStep.duration} 分钟</strong></div>
                    <div><span>材料与用量</span><strong>{selectedStep.materials} / {selectedStep.amount}</strong></div>
                    <div><span>危险项</span><strong>{selectedStep.hazards.join('、') || '无'}</strong></div>
                  </div>
                  <div className="review-section"><h4>控制措施</h4><p>{selectedStep.controls || '未填写'}</p></div>
                  <div className="review-section"><h4>安全说明</h4><p className={hasMissingSafety(selectedStep) ? 'danger-text' : ''}>{selectedStep.safetyNote || '未填写'}</p></div>
                  {hasMissingSafety(selectedStep) && <Callout intent="danger" icon="warning-sign">当前步骤存在安全信息缺口，不能确认或冻结版本。</Callout>}
                </Card>

                <Card elevation={Elevation.ONE} className="review-handoff-card">
                  <div className="card-title">
                    <div><span>HANDOFF REVIEW</span><h3>步骤交接核对</h3></div>
                    <Tag minimal intent={selectedBroken.length ? 'danger' : 'success'}>{selectedBroken.length ? `${selectedBroken.length} 条断链` : '交接一致'}</Tag>
                  </div>
                  <div className="review-handoff-block">
                    <h4>本步骤登记产物（{selectedStep.outputs.filter((item) => !item.removed).length}）</h4>
                    {selectedStep.outputs.length ? selectedStep.outputs.map((output) => (
                      <div className={`review-handoff-line ${output.removed ? 'removed' : ''}`} key={output.id}>
                        <Icon icon={output.removed ? 'cross' : 'box'} intent={output.removed ? 'danger' : 'none'} size={13} />
                        <span><strong>{output.name || '（未命名产物）'}</strong>{output.spec ? ` · ${output.spec}` : ''}{output.removed ? <em>（已移除，下游交接将断链）</em> : null}</span>
                      </div>
                    )) : <p className="muted">未登记产物。</p>}
                  </div>
                  <div className="review-handoff-block">
                    <h4>选用的上游产物（{selectedStep.inputs.length}）</h4>
                    {selectedStep.inputs.length ? selectedStep.inputs.map((input) => {
                      const status = resolveInputLink(process.steps, selectedStep, input);
                      const meta = linkStateMeta(status.state);
                      const repairable = status.state === 'name-changed' || status.state === 'spec-changed';
                      return (
                        <div className={`review-handoff-line column ${status.state === 'linked' ? '' : 'broken'}`} key={input.id}>
                          <div className="review-handoff-line-head">
                            <Tag minimal intent={meta.intent} icon={status.state === 'linked' ? 'link' : 'offline'}>{meta.label}</Tag>
                            {repairable && (
                              <Button small minimal intent="warning" icon="updated" text="核对无误，按当前登记重新确认"
                                disabled={process.status === 'frozen'} onClick={() => reconfirmInput(input.id)} />
                            )}
                          </div>
                          <span className="handoff-snapshot-line">选用快照：<b>{input.snapshotName || '（空）'}</b>{input.snapshotSpec ? ` · ${input.snapshotSpec}` : ''}</span>
                          {status.output && status.state !== 'removed' && (
                            <span className={`handoff-snapshot-line ${repairable ? 'changed' : ''}`}>当前登记：<b>{status.output.name}</b>{status.output.spec ? ` · ${status.output.spec}` : ''}</span>
                          )}
                          {input.usage && <span className="handoff-snapshot-line muted-line">用途：{input.usage}</span>}
                          {status.state !== 'linked' && <ul className="handoff-reasons">{status.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                        </div>
                      );
                    }) : <p className="muted">未选用上游产物。</p>}
                  </div>
                  {selectedBroken.length > 0 && (
                    <Callout intent="danger" icon="offline">
                      <strong>交接断链未恢复，本步骤不能确认、流程不能冻结。</strong>
                      <p>名称/规格变化可由复核人核对后直接"重新确认"；产物移除或来源缺失需退回编写页，由研究员改选产物或删除该交接。</p>
                    </Callout>
                  )}
                </Card>
                <Card elevation={Elevation.ONE} className="comment-card">
                  <div className="card-title"><div><span>REVIEW COMMENTS</span><h3>复核批注</h3></div><Tag minimal>{selectedStep.comments.length} 条</Tag></div>
                  <div className="comment-compose">
                    <TextArea fill value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="填写具体依据、风险或修改建议…" />
                    <Button intent="primary" icon="comment" text="添加批注" disabled={!commentText.trim()} onClick={addReviewComment} />
                  </div>
                  <div className="comment-list">
                    {selectedStep.comments.map((comment) => (
                      <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                        <div className="comment-avatar">{comment.author.slice(0, 1)}</div>
                        <div><header><strong>{comment.author}</strong><span>{comment.role}</span><time>{formatDate(comment.createdAt)}</time></header><p>{comment.text}</p><Button minimal small text={comment.resolved ? '已解决' : '标记解决'} icon={comment.resolved ? 'tick' : 'circle'} onClick={() => resolveComment(comment.id)} /></div>
                      </article>
                    ))}
                    {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注。</p>}
                  </div>
                </Card>
              </>
            )}
          </section>
          <aside className="review-actions">
            <Card elevation={Elevation.ONE}>
              <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
              <p className="muted">确认后若修改该步骤，受影响的下游步骤会在编辑页重新提示。交接断链时该步骤已自动退回，恢复并重新确认前不能冻结。</p>
              <Button fill large intent="success" icon="tick" text={selectedBroken.length ? '存在交接断链，不能确认' : '逐条确认'}
                disabled={hasMissingSafety(selectedStep) || selectedBroken.length > 0} onClick={() => setStepStatus('confirmed')} />
              <Button fill large icon="undo" text="退回修改" intent="warning" onClick={() => setStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" onClick={() => setStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {process.steps.map((step) => <div key={step.id}><span>{brokenStepIds.has(step.id) ? '🔗 ' : ''}{step.title}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="全部确认后冻结" onClick={freezeVersion} disabled={process.status === 'frozen' || brokenList.length > 0} />
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title"><div><span>VERSION TIMELINE</span><h3>冻结版本</h3></div><Tag minimal>{process.versions.length} 个</Tag></div>
            <div className="version-timeline">
              {process.versions.map((version, index) => (
                <article key={version.id} className={index === process.versions.length - 1 ? 'latest' : ''}>
                  <span></span><div><b>{version.version}</b><strong>{version.label}</strong><p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.author}</p><small>{version.note}</small></div>
                </article>
              ))}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="diff-panel">
            <div className="card-title"><div><span>VERSION DIFF</span><h3>流程差异比较</h3></div><div className="diff-selects">
              <HTMLSelect value={compareBaseId} onChange={(event) => setCompareBaseId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 基准</option>)}</HTMLSelect>
              <Icon icon="arrow-right" />
              <HTMLSelect value={compareTargetId} onChange={(event) => setCompareTargetId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 目标</option>)}</HTMLSelect>
            </div></div>
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容</span></div>
              {versionDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!versionDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个版本没有差异</strong><p>请选择不同版本，或先冻结新的流程版本。</p></div>}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div></div>
            <div className={confirmedCount === process.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === process.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{process.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={!brokenList.length ? 'passed' : ''}><Icon icon={!brokenList.length ? 'tick-circle' : 'offline'} /><span><strong>交接链全部连通</strong><small>{brokenList.length} 个步骤断链，已退回复核</small></span></div>
            <div className={process.steps.every((step) => step.dependencies.every((id) => process.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{process.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <Button fill intent="primary" icon="lock" text="冻结当前版本" onClick={freezeVersion} disabled={process.status === 'frozen' || confirmedCount !== process.steps.length || missingSafetySteps.length > 0 || brokenList.length > 0} />
          </Card>
        </main>
      )}

      <footer className="app-footer">
        <span>所有实验数据仅保存在当前浏览器 localStorage。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

function collectDownstream(steps: ProcessStep[], sourceId: string | null): string[] {
  if (!sourceId) return [];
  const result = new Set<string>();
  const visit = (id: string) => {
    steps.filter((step) => step.dependencies.includes(id)).forEach((step) => {
      if (result.has(step.id)) return;
      result.add(step.id);
      visit(step.id);
    });
  };
  visit(sourceId);
  return [...result];
}

function nextMinorVersion(value: string): string {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.2.0';
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function compareVersions(process: ExperimentProcess, baseId: string, targetId: string): DiffItem[] {
  const base = process.versions.find((version) => version.id === baseId);
  const target = process.versions.find((version) => version.id === targetId);
  if (!base || !target) return [];
  const diffs: DiffItem[] = [];
  const targetMap = new Map(target.steps.map((step) => [step.id, step]));
  const baseMap = new Map(base.steps.map((step) => [step.id, step]));
  base.steps.forEach((step) => {
    if (!targetMap.has(step.id)) diffs.push({ id: step.id, title: step.title, kind: 'removed', detail: '目标版本已删除该步骤。' });
  });
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      diffs.push({ id: step.id, title: step.title, kind: 'added', detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}` });
      return;
    }
    const fields: string[] = [];
    if (before.title !== step.title) fields.push('名称');
    if (before.purpose !== step.purpose) fields.push('目的');
    if (before.materials !== step.materials || before.amount !== step.amount) fields.push('材料或用量');
    if (before.equipment !== step.equipment) fields.push('设备');
    if (before.duration !== step.duration) fields.push('预计时间');
    if (JSON.stringify(before.hazards) !== JSON.stringify(step.hazards)) fields.push('危险项');
    if (before.controls !== step.controls || before.safetyNote !== step.safetyNote) fields.push('安全控制');
    if (JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies)) fields.push('依赖关系');
    if (before.expectedResult !== step.expectedResult) fields.push('预期结果');
    if (JSON.stringify(before.outputs ?? []) !== JSON.stringify(step.outputs ?? [])) fields.push('登记产物');
    if (JSON.stringify(before.inputs ?? []) !== JSON.stringify(step.inputs ?? [])) fields.push('产物交接');
    if (fields.length) diffs.push({ id: step.id, title: step.title, kind: 'changed', detail: `变化字段：${fields.join('、')}。` });
  });
  return diffs;
}

export default App;
