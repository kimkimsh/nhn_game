/**
 * 09 §4.7의 실행 시나리오 표 — 무엇을 어떤 조건으로 재는가.
 *
 * **시드와 함께 커밋한다. 재현할 수 없는 리포트는 근거가 아니다.** 그래서 이 표가 `dev/headless.ts`
 * 안이 아니라 자기 파일에 있다 — 시나리오를 고치는 diff와 시뮬 루프를 고치는 diff가 갈려야
 * "측정을 통과시키려고 조건을 바꿨는가"가 보인다.
 */
import type { StageId } from '../config/ids';
import type { CardInventory } from '../sim/cards';
import type { StageEntry } from '../sim/run';

export interface ScenarioSpec {
  readonly id: string;
  readonly seed: number;
  readonly stageId: StageId;
  readonly at: StageEntry;
  /** §18.4 치트 지정. 비면 카드 0장 — §14.4 검산표의 전제다 */
  readonly cards: CardInventory;
  readonly maxSimSec: number;
  /** 참이면 카드 화면마다 §11.2 추첨에서 한 장을 뽑아 다음 스테이지로 넘어간다 */
  readonly autoPickCards: boolean;
  readonly timingSigmaU: number;
  /**
   * 09 §2.1의 계약은 「가드가 던지면 런을 중단하고 리포트를 guard-violation으로 표시한다」이고
   * 기본값이 그것이다. 거짓으로 두면 위반을 전부 적어 두고 계속 돈다.
   *
   * **이 스위치가 필요한 이유는 지금 HR-03이 정상 플레이에서 걸리기 때문이다.** S1 W1은 조총병
   * 4기뿐인데(§9.3) 봇이 그 넷을 웨이브가 끝나기 전에 정리하면 W2의 진입 궤적 + 예비동작 동안
   * 적 탄환이 0인 구간이 2초를 넘는다. 진짜 고침은 §9.1의 웨이브 시작 시각이나 HR-03 조문이고
   * `dev/`가 할 수 있는 일이 아니다 — 끄고 잰 값은 그 사실과 함께 읽어야 한다.
   */
  readonly stopOnGuardViolation: boolean;
}

/**
 * T-05의 검사 대상 빌드 — §11.1의 획득 회차와 같은 4장이고 전부 EPIC이다. 넷 다 maxStack 1이라
 * §18.4의 "치트로 만들 수 있는 빌드의 범위는 정상 플레이의 범위와 정확히 같다"를 지킨다.
 * E05(영점 패리)와 E07(무한 검로)이 §14.4가 T-02의 전제를 벗어난다고 직접 지목한 둘이다.
 */
const T05_BUILD: CardInventory = [
  { id: 'E05', stack: 1 }, { id: 'E07', stack: 1 }, { id: 'E02', stack: 1 }, { id: 'E01', stack: 1 },
];

/** 보스 하나를 만나고 격파까지 보기에 넉넉한 길이 (s). 웨이브를 실제로 지나야 하므로 길다 */
const BOSS_SCENARIO_SEC = 240;
/** 다섯 스테이지 전체. §9.2의 목표 합계 450초에 T-04의 여유와 카드 화면 몫을 얹었다 */
const FULL_RUN_SEC = 700;

/** 09 §4.7의 시나리오 표. 시드와 함께 커밋한다 — 재현할 수 없는 리포트는 근거가 아니다 */
export function scenarios(
  seed: number,
  timingSigmaU: number,
  stopOnGuardViolation: boolean,
): readonly ScenarioSpec[] {
  const bossPhaseOne: StageEntry = { kind: 'bossPhase', phaseIndex: 0 };
  const bossRuns: ScenarioSpec[] = ([1, 2, 3, 4, 5] as const).map((stageId) => ({
    id: `boss-${stageId}-nocard`,
    seed,
    stageId,
    at: bossPhaseOne,
    cards: [],
    maxSimSec: BOSS_SCENARIO_SEC,
    autoPickCards: false,
    timingSigmaU,
    stopOnGuardViolation,
  }));
  return [
    {
      id: 'baseline-full', seed, stageId: 1, at: { kind: 'stageStart' },
      cards: [], maxSimSec: FULL_RUN_SEC, autoPickCards: true, timingSigmaU, stopOnGuardViolation,
    },
    ...bossRuns,
    {
      id: 't05-max-build', seed, stageId: 5, at: bossPhaseOne,
      cards: T05_BUILD, maxSimSec: BOSS_SCENARIO_SEC, autoPickCards: false, timingSigmaU,
      stopOnGuardViolation,
    },
    {
      // §7.1이 추격이 실제로 일어나는 유일한 구간이라고 적은 자리 — T-06이 여기서 제일 크게 나온다
      id: 't06-chase', seed, stageId: 3, at: bossPhaseOne,
      cards: [], maxSimSec: BOSS_SCENARIO_SEC, autoPickCards: false, timingSigmaU,
      stopOnGuardViolation,
    },
    {
      // W4의 잔존이 있어야 피크가 성립한다(09 §4.4). W5 편성 16기만으로는 18에 닿지 않는다
      id: 's5w5-density', seed, stageId: 5, at: { kind: 'wave', waveIndex: 3 },
      cards: [], maxSimSec: BOSS_SCENARIO_SEC, autoPickCards: false, timingSigmaU,
      stopOnGuardViolation,
    },
  ];
}
