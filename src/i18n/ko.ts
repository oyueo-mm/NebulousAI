/**
 * 한국어 UI 문구 (기본 언어).
 *
 * 화면에 보이는 모든 문구는 여기에서만 정의한다. 다른 언어를 추가할 때는 같은 구조(`Messages`)의
 * 객체를 만들어 `src/i18n/index.ts`에서 선택하면 된다. 모델 ID, JSON 키, 저장 스키마, 로그 식별자
 * 같은 기술적 식별자는 번역하지 않는다.
 */
import type { PolicyKind } from '../ai/types';

type ControllerKind = PolicyKind | 'human' | 'external';

const POLICY_NAMES: Record<PolicyKind, { name: string; short: string; en: string }> = {
  random: { name: '무작위 AI', short: '무작위', en: 'Random' },
  greedy: { name: '탐욕형 AI', short: '탐욕형', en: 'Greedy' },
  survival: { name: '생존형 AI', short: '생존형', en: 'Survival' },
  aggressive: { name: '공격형 AI', short: '공격형', en: 'Aggressive' },
  hybrid: { name: '혼합형 AI', short: '혼합형', en: 'Hybrid' },
  ppo: { name: '강화학습 AI', short: '강화학습', en: 'PPO' },
};

const MOVES = ['정지', '동', '남동', '남', '남서', '서', '북서', '북', '북동'];
const SPECIALS = ['없음', '분열', '방출'];

/** 휴리스틱 판단 모드 식별자(`HeuristicTrace.mode`) → 표시 문구. */
const MODES: Record<string, string> = {
  'random walk': '무작위 이동',
  wander: '탐색 이동',
  flee: '도주',
  evade: '회피',
  chase: '추격',
  hunt: '사냥',
  'split attack': '분열 공격',
  forage: '먹이 수집',
  'cautious forage': '조심스러운 먹이 수집',
  'safe forage': '안전한 먹이 수집',
  'escape split': '탈출 분열',
  survive: '생존 우선',
  'neural policy': '신경망 정책',
  human: '사람',
  dead: '탈락',
};

const fmt = (v: number, digits = 0) => v.toFixed(digits);

export const ko = {
  locale: 'ko-KR',
  app: {
    title: 'NebulousAI — 다중 에이전트 게임 AI 실험실',
    home: 'NebulousAI 처음 화면',
    loading: '불러오는 중…',
    modes: { play: '직접 플레이', watch: 'AI 관전', tournament: 'AI 토너먼트', lab: '강화학습 실험실' },
    modesShort: { play: '플레이', watch: '관전', tournament: '토너먼트', lab: '실험실' },
    status: { running: '실행 중', paused: '일시정지', finished: '경기 종료' },
    alive: (alive: number, total: number) => `생존 ${alive}/${total}`,
    saved: '현재 상태를 JSON 파일로 저장했습니다.',
    loadedState: '저장된 상태를 불러왔습니다(일시정지됨). 재생을 누르면 이어서 진행합니다.',
    loadedSettings: '설정을 불러왔습니다.',
    loadFailed: (reason: string) => `파일을 불러올 수 없습니다: ${reason}`,
    simError: (reason: string) => `시뮬레이션 오류: ${reason}`,
    workerFailed: (reason: string) => `시뮬레이션 작업자(Worker)를 실행하지 못했습니다: ${reason}`,
    unknownError: '알 수 없는 오류',
  },
  policy: {
    name: (kind: ControllerKind) =>
      kind === 'human' ? '사람' : kind === 'external' ? '외부 제어' : `${POLICY_NAMES[kind].name} (${POLICY_NAMES[kind].en})`,
    short: (kind: ControllerKind) => (kind === 'human' ? '나' : kind === 'external' ? '외부' : POLICY_NAMES[kind].short),
    /** 경기 안의 에이전트 이름: "탐욕형 3", 사람은 "나". */
    agentName: (kind: ControllerKind, index: number) => (kind === 'human' ? '나' : `${kind === 'external' ? '학습자' : POLICY_NAMES[kind].short} ${index}`),
    label: (kind: ControllerKind, modelId: string | null) =>
      kind === 'ppo' ? `강화학습 AI (PPO · ${modelId ?? '?'})` : kind === 'human' ? '사람' : kind === 'external' ? '외부 제어' : `${POLICY_NAMES[kind].name} (${POLICY_NAMES[kind].en})`,
    /** 차트용 짧은 이름: 'greedy' → '탐욕형', 'ppo:ppo-v4' → 'ppo-v4'. */
    entryShort: (label: string) => (label.startsWith('ppo:') ? label.slice(4) : POLICY_NAMES[label as PolicyKind]?.short ?? label),
    /** 토너먼트 항목 식별자('greedy', 'ppo:ppo-v4') → 표시 이름. */
    entry: (label: string) => {
      if (label.startsWith('ppo:')) return `강화학습 AI (${label.slice(4)})`;
      const k = label as PolicyKind;
      return POLICY_NAMES[k] ? `${POLICY_NAMES[k].short} (${POLICY_NAMES[k].en})` : label;
    },
  },
  models: {
    /** 모델 ID → 한국어 표시 이름(모델 파일은 수정하지 않는다). */
    label: (id: string, fallback: string) => ({
      'ppo-v4': 'PPO v4 (모방+강화)',
      'ppo-v3': 'PPO v3 (장기 학습)',
      'ppo-v2': 'PPO v2 (마스킹)',
      'ppo-v1': 'PPO v1 (기본)',
      'ppo-untrained': 'PPO (학습 전)',
    } as Record<string, string>)[id] ?? fallback,
    untrainedSuffix: ' (학습 전)',
    indexFailed: (reason: string) => `모델 목록(models/index.json)을 불러오지 못했습니다: ${reason}`,
    fileFailed: (file: string, reason: string) => `${file} 모델을 불러오지 못했습니다: ${reason}`,
    http: (status: number) => `HTTP ${status}`,
  },
  action: {
    describe: (index: number) => `${MOVES[Math.floor(index / 3)]} · ${SPECIALS[index % 3]}`,
  },
  mode: (key: string) => key.split(' · ').map((k) => MODES[k] ?? k).join(' · '),
  trace: {
    note: (note: { key: string; values: Record<string, number> } | null): string => {
      if (!note) return '';
      const v = note.values;
      switch (note.key) {
        case 'randomWalk': return '무작위 방향으로 이동하며, 판단할 때마다 10% 확률로 방향을 다시 고릅니다.';
        case 'threatGap': return `가장 가까운 위협까지 간격 ${fmt(v.gap)} wu`;
        case 'safePath': return '가장 좋은 먹이 무리까지 직선 경로가 안전하다고 예측했습니다.';
        case 'headings': return `16개 방향 중 최선을 선택 · 예측 위험도 ${fmt(v.danger, 2)}`;
        case 'foodHeading': return `먹이 가중 방향 선택 · 예측 위험도 ${fmt(v.danger, 2)}`;
        case 'intercept': return `${fmt(v.tau, 1)}초 후 요격 예상 · 분열 공격 성공 확률 ${fmt(v.odds * 100)}%`;
        default: return '';
      }
    },
    targetKind: { food: '먹이', prey: '사냥감', flee: '도주 방향', wander: '탐색', regroup: '재집결' } as Record<string, string>,
  },
  log: {
    eliminated: (killer: string, victim: string) => `${killer}이(가) ${victim}을(를) 탈락시킴`,
    died: (victim: string) => `${victim} 탈락`,
    ateCell: (predator: string, mass: number, prey: string) => `${predator}이(가) ${prey}의 세포(질량 ${fmt(mass)})를 흡수`,
    thorn: (agent: string, pieces: number) => `${agent}이(가) 가시에 닿아 ${pieces}조각으로 분열`,
    respawned: (agent: string) => `${agent} 부활`,
    at: (seconds: number) => `${fmt(seconds, 1)}초`,
  },
  hud: {
    mass: '총 질량', rank: '순위', cells: '세포', kills: '처치', eaten: '흡수', alive: '생존 시간', speed: '이동 속도', split: '분열', eject: '질량 방출',
    paused: '일시정지',
    split_ready: '분열 가능', split_cooldown: '분열 대기 중', split_mass: '분열: 질량 부족', split_maxCells: '분열: 세포 수 최대',
    eject_ready: '방출 가능', eject_cooldown: '방출 대기 중', eject_mass: '방출: 질량 부족',
    splitWhy: {
      cooldown: '분열 대기 중입니다. 잠시 후 다시 시도하세요(0.5초).',
      mass: (need: number, have: number) => `분열하려면 가장 큰 세포의 질량이 ${need} 이상이어야 합니다(현재 ${fmt(have)}).`,
      maxCells: (max: number) => `세포가 이미 최대(${max}개)입니다. 다시 합쳐질 때까지 분열할 수 없습니다.`,
    },
    ejectWhy: {
      cooldown: '질량 방출 대기 중입니다.',
      mass: (need: number, have: number) => `질량을 방출하려면 세포 질량이 ${need} 이상이어야 합니다(현재 ${fmt(have)}).`,
    },
  },
  leaderboard: { title: '순위표' },
  gameOver: {
    title: '세포가 흡수되었습니다',
    by: (name: string, label: string) => `${name} · ${label}에게 흡수됨`,
    over: '게임 종료',
    survived: '생존 시간', peak: '최고 질량', kills: '처치',
    again: '다시 시작 (R)',
    note: '경기는 계속 진행되며, 카메라는 1위를 따라갑니다.',
  },
  matchOver: (name: string, label: string) => `경기 종료 — 우승: ${name} (${label})`,
  dock: {
    play: '재생 (P)', resume: '계속하기 (P)', pause: '일시정지 (P)', step: '한 틱 진행 (.)', restart: '다시 시작 (R)',
    camera: '카메라', followLeader: '1위 추적', freeCamera: '자유 카메라', follow: (name: string) => `${name} 추적`,
    fit: '화면 맞춤', analytics: '분석 패널', settings: '설정', controls: '조작법', more: '더 보기',
  },
  speed: {
    label: '배속', aria: '시뮬레이션 배속', max: '최대 속도', maxShort: 'MAX', reset: '1×로', target: '목표', actual: '실제',
    value: (s: number) => `${s >= 10 ? s.toFixed(1) : s.toFixed(2)}×`,
    behind: (actual: number) => `성능 한계로 목표 배속에 못 미칩니다(실제 ${actual >= 10 ? actual.toFixed(1) : actual.toFixed(2)}×).`,
    maxNote: '최대 속도는 고정 배속이 아니라, 이 기기에서 가능한 만큼 빠르게 시뮬레이션하는 모드입니다.',
    pausedNote: '일시정지 중에도 배속을 바꿀 수 있습니다. 재생하면 적용됩니다.',
    sheetTitle: '배속 조절',
    close: '닫기',
  },
  hints: {
    play: '마우스: 이동 · Space: 분열 · E: 질량 방출 · WASD/방향키: 키보드 이동 · P/Esc: 일시정지 · R: 다시 시작',
    watch: '세포를 클릭해 AI 행동 분석 · 자유 카메라에서 드래그로 이동, 휠로 확대/축소 · Space/P: 일시정지 · .: 한 틱 진행',
    inspectPrompt: '지도나 순위표에서 에이전트를 선택하면 무엇을 보고 왜 그렇게 행동하는지 확인할 수 있습니다.',
  },
  controls: {
    title: '조작법',
    pc: 'PC 조작',
    mobile: '모바일 조작',
    pcItems: [
      ['마우스 이동', '세포 이동 (마우스 쪽으로 이동, 멀수록 빠르게)'],
      ['W A S D', '방향 이동'],
      ['방향키', '방향 이동'],
      ['Space', '분열'],
      ['E', '질량 방출'],
      ['P / Esc', '일시정지'],
      ['R', '다시 시작'],
    ] as [string, string][],
    mobileItems: [
      ['가상 조이스틱 (왼쪽 아래)', '이동'],
      ['분열 버튼', '세포 분열'],
      ['방출 버튼', '질량 방출'],
      ['일시정지 버튼 (아래 가운데)', '게임 정지 / 계속하기'],
    ] as [string, string][],
    rules: '규칙 요약',
    close: '닫기',
  },
  onboarding: {
    title: 'NebulousAI에 오신 것을 환영합니다',
    intro: '세포를 키워 오래 살아남는 게임입니다.',
    steps: [
      '작은 먹이를 먹으며 성장하세요.',
      '자신보다 작은 세포를 흡수할 수 있습니다(1.25배 이상 커야 합니다).',
      '자신보다 큰 세포는 피하세요.',
      '분열로 상대를 공격하거나 빠르게 이동할 수 있습니다.',
      '질량 방출은 자신의 질량을 소모합니다.',
    ],
    start: '시작하기',
    never: '다시 보지 않기',
    controlsLink: '조작법 자세히 보기',
  },
  touch: { joystick: '이동 조이스틱', split: '분열', eject: '방출', splitAria: '세포 분열', ejectAria: '질량 방출' },
  settings: {
    inspector: 'AI 행동 분석',
    opponents: '상대 AI', agents: 'AI 에이전트', plusYou: ' + 나',
    fewer: (label: string) => `${label} 줄이기`, more: (label: string) => `${label} 늘리기`,
    ppoModel: '강화학습 모델', untrained: ' (학습 전)',
    deterministic: '결정적 PPO 행동', deterministicHint: '확률 샘플링 대신 가장 높은 확률의 행동(argmax)을 선택',
    noModels: '내보낸 PPO 모델이 없어 강화학습 AI를 사용할 수 없습니다.',
    world: '경기장', seed: '시드', worldSize: '경기장 크기', maxFood: '최대 먹이 수', thorns: '가시 수', timeLimit: '제한 시간',
    respawn: 'AI 부활', respawnHint: '플레이어는 부활하지 않습니다. 흡수되면 게임이 끝납니다.', decisionInterval: 'AI 판단 간격',
    unitSeconds: '초', unitTicks: '틱',
    physics: '고급 물리 설정', speedBase: '기본 이동 속도', eatRatio: '흡수 질량비', splitSpeed: '분열 발사 속도', decayRate: '질량 감쇠율',
    ejectEfficiency: '방출 효율', mergeBase: '기본 재결합 시간', startMass: '시작 질량', resetPhysics: 'rules-v1 기본값으로 되돌리기',
    overlays: '화면 표시', targets: 'AI 목표와 위협', vision: '시야 반경', heatmap: '위험도 지도', heatmapHint: '선택한 에이전트의 휴리스틱 위험도(dangerAt) — 신경망 예측이 아님',
    names: '이름과 질량',
    experiment: '저장 / 불러오기', save: '상태 저장', load: '불러오기…',
    experimentHint: '설정, 시드, 규칙 버전, 전체 게임 상태(위치, 난수 상태)를 JSON으로 저장합니다.',
    apply: '적용하고 다시 시작', restart: '이 설정으로 다시 시작',
    quick: '빠른 조작',
    close: '설정 닫기',
  },
  inspector: {
    close: 'AI 행동 분석 닫기', untrained: '학습 전 (무작위 초기화)', trained: '학습 완료', eliminated: '탈락',
    mass: '질량', cells: '세포', rank: '순위', rankValue: (n: number) => `${n}위`, kills: '처치', alive: '생존', split: '분열', ready: '가능',
    mode: '현재 행동', target: '목표', threats: '보이는 위협', risk: '예상 위험도', action: '행동',
    actionMove: '이동', actionSplit: '이동 + 분열', actionEject: '이동 + 질량 방출', cell: (id: number) => `세포 ${id}`,
    heuristicNote: '휴리스틱 판단 기록: 위 값은 모두 이 정책의 실제 판단 코드가 계산한 것입니다. 화살표 = 선택한 목표, 빨간 고리 = 반응한 위협, 초록 고리 = 선택한 사냥감, 파란 원 = 가장 가까운 먹이.',
    chosen: '선택한 행동', selection: '선택 방식', argmax: 'argmax (최고 확률)', sampled: 'π(a|s)에서 샘플링', value: '가치 추정 V(s)',
    topProbs: '상위 행동 확률', obs: (n: number) => `관측 벡터 (obs-v1, ${n}개 값)`, obsHidden: 'self.* 이후의 0인 항목(빈 슬롯, valid = 0)은 숨겼습니다.',
    neuralNote: '신경망 정책에는 명시적인 목표가 없으므로 표시하지 않습니다. 보라색 화살표는 실제로 선택한 이동 방향이고, #k는 관측 슬롯 cell0…cell7에 들어간 세포를 뜻합니다. 위협/사냥감 고리는 신경망이 계산하지 않으므로 그리지 않으며, 위험도 지도를 켜면 표시되는 값은 휴리스틱 dangerAt() 추정이지 신경망 예측이 아닙니다.',
    reward: 'reward-v1 (마지막 판단)', growth: '성장', kill: '처치', cellLost: '세포 손실', actions: '행동 비용', episodeReturn: '누적 보상',
  },
  analytics: {
    tabs: { leaderboard: '순위표', mass: '질량 변화', policies: '정책별 통계', log: '이벤트 로그', performance: '성능' },
    cols: { rank: '#', agent: '에이전트', policy: '정책', mass: '질량', cells: '세포', kills: '처치', eaten: '흡수', alive: '생존', ret: '누적 보상', mode: '현재 행동', agents: '수', aliveNow: '생존', avgMass: '평균 질량', deaths: '탈락', bestRank: '최고 순위' },
    noEvents: '아직 이벤트가 없습니다.',
    collecting: '데이터를 모으는 중…',
    seconds: '초',
    policyNote: '이 경기 하나의 실시간 수치입니다. 경기 하나로는 어떤 정책이 더 나은지 알 수 없으니, 여러 시드와 신뢰구간으로 비교하려면 AI 토너먼트를 사용하세요.',
    perf: {
      fps: { label: '렌더링 FPS', hint: '메인 스레드, requestAnimationFrame' },
      ups: { label: '시뮬레이션 UPS', hint: 'Worker의 초당 고정 틱 수' },
      speed: { label: '실제 시뮬레이션 배속', hint: '실제 1초당 진행한 시뮬레이션 시간' },
      world: { label: '월드 계산', hint: '이동, 충돌, 흡수' },
      ai: { label: 'AI 정책 계산', hint: (n: number) => `에이전트 ${n}명, 판단 비용을 틱당으로 환산` },
      frame: { label: 'Worker 프레임', hint: '프레임당 틱 계산 + 데이터 전송 준비' },
      msTick: 'ms/틱', msFrame: 'ms',
    },
  },
  tournament: {
    presets: '프리셋', lineup: '참가 구성', protocol: '경기 방식',
    presetNames: { all: '휴리스틱 전체', rvg: '무작위 vs 탐욕형', gvs: '탐욕형 vs 생존형', sva: '생존형 vs 공격형', hvp: '혼합형 vs 강화학습', everything: '전체 참가' },
    ppoModel: '강화학습 모델', seeds: '시드 수', firstSeed: '첫 시드', rotations: '시작 위치 교대 횟수', timeLimit: '제한 시간', unitSeconds: '초',
    protocolNote: '각 시드를 시작 위치 교대 횟수만큼 반복하므로(에이전트가 시작 위치를 바꿔 가며) 모든 정책이 같은 세계를 경험합니다. 경기는 제한 시간이 되거나 한 명만 남으면 끝납니다. 화면 렌더링 없이 백그라운드 Worker에서 실행됩니다.',
    run: (n: number) => `${n}경기 실행`, progress: (done: number, total: number) => `${done}/${total} 경기`, cancel: '취소',
    empty: '참가 구성을 정하고 토너먼트를 실행하세요. 경기가 끝날 때마다 결과가 표시됩니다.',
    reference: '기준 결과 (저장소에 포함된 헤드리스 CLI 실행 결과)',
    running: '(진행 중…)',
    meta: (matches: number, seeds: number, seconds: number, rules: string) => `${matches}경기 · 시드 ${seeds}개 · 제한 ${seconds}초 · ${rules}`,
    reportNames: {
      'browser-tournament': '브라우저 토너먼트', heuristics: '휴리스틱 전체 대결', 'greedy-vs-random': '탐욕형 vs 무작위',
      'greedy-vs-survival': '탐욕형 vs 생존형', 'survival-vs-aggressive': '생존형 vs 공격형', 'ppo-generations': 'PPO 세대 대결 (v1–v4)',
      'ppo-mixed.ppo-v4': 'PPO v4 + 휴리스틱 전체', 'hybrid-vs-ppo.ppo-v4': '혼합형 vs PPO v4', 'ppo-vs-ppo.ppo-v4': 'PPO v4 vs 학습 전 PPO',
    } as Record<string, string>,
    cols: { policy: '정책', n: '표본', win: '승률 [95% CI]', rank: '평균 순위', survival: '생존 시간(초)', mass: '최종 질량', peak: '최고 질량', kills: '처치', eaten: '흡수한 세포', splits: '분열', splitHit: '분열 성공', exchange: '교환비', aliveEnd: '끝까지 생존' },
    charts: { win: '승률 (%)', survival: '평균 생존 시간 (초)', mass: '평균 최종 질량', errorBars: '오차 막대 = 95% CI' },
    note: '승리 = 1위(끝까지 살아남은 에이전트 중 질량이 가장 크거나, 아니면 가장 오래 생존). 분열 성공 = 분열 후 3초 안에 상대 세포를 흡수한 비율. 교환비 = 흡수한 상대 세포 ÷ (흡수한 세포 + 잃은 세포). 평균은 정규근사 95% 신뢰구간, 승률은 Wilson 구간입니다. 구간이 겹치면 이 실행만으로는 차이가 입증되지 않습니다.',
  },
  lab: {
    title: '강화학습 실험실',
    intro: '정책은 Python(Stable-Baselines3 PPO / sb3-contrib MaskablePPO)에서 이 페이지와 똑같은 TypeScript 엔진을 상대로 학습했습니다. Python 환경은 Node 브리지로 이 엔진을 직접 구동하므로 규칙이 서로 달라질 수 없습니다. 학습한 가중치는 JSON으로 내보내 이곳의 TypeScript MLP가 실행하며, 출력은 PyTorch와 1e-5 이내로 일치하는지 테스트합니다. 보류 시드 평가에서 PyTorch와 TypeScript 추론으로 플레이한 에피소드는 완전히 같았습니다. 신경망이 휴리스틱에 진 경우를 포함한 전체 결과는 docs/EXPERIMENTS.md에 있습니다.',
    floats: (n: number) => `${n}개 실수`, actions: (n: number) => `${n}개 행동`,
    shipped: '이 빌드에 포함된 모델', none: 'models/index.json에서 모델을 찾지 못했습니다.',
    actionSpace: (v: string) => `행동 공간 (${v})`,
    actionNote: '인덱스 = 이동 × 3 + 특수 행동. 이동: 정지 또는 경기장 기준 8방향(+y가 남쪽). 불가능한 분열/방출은 엔진이 무시하고 −0.01의 비용을 줍니다(v2 이후 모델은 행동 마스킹으로 아예 고르지 않음).',
    reward: (v: string) => `보상 (${v})`,
    rewardNote: '판단 1회(2틱 = 1/15초)마다 계산합니다. 성장은 Δ ln(질량)을 사용하므로 큰 세포가 같은 먹이로 더 많은 보상을 받지 않습니다. 평가 지표(승률, 생존, 질량)는 보상과 별도로 계산합니다.',
    rewardRows: {
      growth: '× Δ ln(총 질량), 살아 있는 동안', kill: '상대 에이전트를 탈락시킬 때마다', death: '탈락 시 1회, 에피소드 종료', cellLost: '자기 세포를 잃을 때마다',
      eject: '질량 방출 1회마다', split: '분열 1회마다', invalid: '거부된 분열/방출 요청마다', alive: '살아 있는 판단마다 (0: 숨기만 하는 행동에 보상하지 않음)',
    } as Record<string, string>,
    observation: (v: string, n: number) => `관측 (${v}, ${n}개 실수)`,
    obsNote: '에이전트 질량 중심 기준 상대 좌표를 시야 반경으로 나눈 값입니다. 시야 안의 대상만 포함하며, 빈 슬롯은 0이고 valid = 0으로 표시합니다. 자기 상태 12 · 가까운 세포 8×10 · 가까운 먹이 8×3 · 먹이 밀도 8구역 · 가시 3×5.',
    obsRepeat: '… cell1–7, food1–7, thorn1–2 반복',
    reproduce: '학습 재현 방법',
    trained: '학습 완료', untrained: '학습 전 · 무작위 초기화',
    network: '신경망', params: '파라미터 수', algorithm: '알고리즘', timesteps: '학습 스텝', wall: '학습 시간', wallValue: (min: number, device: string) => `${min.toFixed(1)}분 (${device})`,
    initFrom: '초기화 출처', masking: '불가능 행동 마스킹', maskingYes: '사용 (불가능한 분열/방출을 가림)', maskingNo: '사용 안 함',
    obsNorm: '관측 정규화', noNorm: '없음', versions: '버전',
    curriculum: '커리큘럼', steps: (n: number) => `${n.toLocaleString('ko-KR')} 스텝`,
    stageDescriptions: {
      'A-forage': '혼자서 먹이를 찾아 수집',
      'B-evade': '큰 탐욕형·공격형 포식자를 피하며 성장',
      'C-hunt': '작은 사냥감을 추격·분열 공격',
      'D-mixed': '전체 게임: 모든 휴리스틱 2명씩, 같은 시작 질량',
      'E-selfplay': '휴리스틱 + 고정된 자기 복제본과 대결',
      'F-mixed-long': '전체 게임 장기 학습: 휴리스틱 혼합(4) · 사냥(1) · 회피(1)',
      'G-selfplay-long': '고정 스냅샷과의 셀프플레이 + 휴리스틱(2) · 혼합(2)',
      'H-mixed-from-bc': '모방 정책에서 출발한 전체 게임 학습: 휴리스틱 혼합(4) · 사냥(1) · 회피(1)',
      'I-selfplay-from-bc': '고정 스냅샷과의 셀프플레이 + 휴리스틱(2) · 혼합(2)',
    } as Record<string, string>,
    imitation: '모방학습 초기화',
    imitationText: (samples: number, teachers: string, rounds: number) =>
      `휴리스틱 교사(${teachers})가 라벨을 붙인 상태 ${samples.toLocaleString('ko-KR')}개로 행동 복제(BC)를 한 뒤, 신경망이 직접 플레이하고 교사는 라벨만 붙이는 DAgger를 ${rounds}회 반복했습니다. 휴리스틱은 학습 데이터로만 쓰였고, 실제로는 신경망 혼자 행동합니다.`,
    teacherIn: (teacher: string, scenario: string) => `${teacher}: ${scenario}`,
    curve: '학습 곡선 (롤아웃 에피소드)', curveReturn: '에피소드 보상', curveLength: '에피소드 길이',
    evaluation: 'Python 평가 (보류 시드)',
    evalCols: { scenario: '시나리오', policy: '정책', return: '보상', 'final mass': '최종 질량', 'survival s': '생존(초)', death: '사망률', win: '승률', n: '표본' } as Record<string, string>,
    scenarios: { forage: '먹이 수집', evade: '포식자 회피', hunt: '사냥', mixed: '전체 게임', selfplay: '셀프플레이 혼합' } as Record<string, string>,
    untrainedNote: '이 신경망은 무작위 초기 가중치 그대로이며 학습하지 않았습니다. "학습 전" 기준선으로 포함했습니다.',
    algorithmNames: {
      'PPO (Stable-Baselines3)': 'PPO (Stable-Baselines3)',
      'MaskablePPO (sb3-contrib)': 'MaskablePPO (sb3-contrib)',
      'random initialisation, not trained': '무작위 초기화, 학습하지 않음',
    } as Record<string, string>,
  },
  errors: {
    tooLarge: '파일이 25 MB보다 큽니다.',
    notJson: '올바른 JSON 파일이 아닙니다.',
    notExperiment: 'NebulousAI 실험 파일이 아닙니다.',
    unknownFormat: '알 수 없는 실험 파일 형식 또는 버전입니다.',
    invalidMode: '모드 값이 올바르지 않습니다.',
    missingArena: '경기장 설정이 없습니다.',
    range: (name: string, lo: number, hi: number) => `${name} 값은 ${lo}~${hi} 범위의 숫자여야 합니다.`,
    missingBots: 'AI 수 설정이 없습니다.',
    tooManyBots: (max: number) => `AI는 최대 ${max}명까지 가능합니다.`,
    invalidModel: '강화학습 모델 ID가 올바르지 않습니다.',
    missingPhysics: '물리 설정이 없습니다.',
    invalidSnapshot: '게임 상태(snapshot)가 올바르지 않습니다.',
  },
};

export type Messages = typeof ko;
