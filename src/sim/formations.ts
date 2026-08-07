/**
 * 진입 궤적 6종 — 스펙 §8.2. 05_시스템_설계.md §1의 5번이 이 결과 위에 적을 놓는다.
 *
 * config/formations.ts가 형태마다의 파라미터를 갖고, 이 파일은 그것을 「어디서 나타나 어디로
 * 가는가」로 바꾼다. 실제로 움직이는 것은 sim/enemies.ts다 — 궤적과 행동을 한 파일에 두면
 * 형태 6종과 행동 6종의 분기가 한 함수 안에서 곱해진다.
 *
 * planEntry는 순수 함수다. 같은 인자에 언제나 같은 결과를 내므로, waves.ts가 진입 지연을 읽으려
 * 미리 부르고 sim/enemies.ts가 스폰 시점에 다시 불러도 두 값이 갈라지지 않는다.
 *
 * ── 색인 공간은 형태마다 하나다 ────────────────────────────────────────────────
 *
 * memberIndex는 「한 웨이브가 같은 형태로 내보내는 개체 전부」 안의 순번이고, memberCount는 그
 * 총수다. 편성(squads)이 둘로 갈려도 색인은 형태마다 하나여야 한다 — 편성마다 0부터 세면
 * 한 형태를 두 편성이 나눠 쓰는 웨이브에서 두 편성이 통째로 같은 자리에 겹친다.
 *
 * ── 넘치는 개체는 줄을 늘려 받는다 ─────────────────────────────────────────────
 *
 * 정지 좌표가 §3.1의 적 활동 영역을 벗어나면 그 개체는 죽일 방법이 없다. 반사탄은 플레이필드
 * 밖 despawnMarginU에서 소멸하므로 화면 위에 주차한 적에는 닿지 못하고, 그 한 기가 웨이브를
 * 끝나지 않게 만든다. 그래서 형태마다 「한 줄에 몇 기까지」를 활동 영역에서 계산하고, 넘치면
 * 줄을 늘린다. 한 줄로 늘어세우는 쪽이 짧지만 편성이 커지는 순간 그 실패로 들어간다.
 *
 * ── 종대·사인 강하는 선두가 가장 깊다 ──────────────────────────────────────────
 *
 * 마지막 개체가 stopYU에 서고 앞 개체가 그만큼씩 아래에 선다. config/formations.ts 머리말의
 * 검산식이 그 배치를 전제하고 있고(선두 정지 y = stopYU + spacingU × (기수 − 1)), 반대로 놓으면
 * 세 기째부터 화면 위로 벗어나 위 문단의 「죽일 수 없는 적」이 된다.
 */
import { FORMATIONS } from '../config/formations';
import type { FormationId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { clamp } from '../core/math';
import { lengthOf } from '../core/vec';

const FULL_TURN_RAD = Math.PI * 2;

/**
 * 측면 형태가 화면 밖에서 나타나고 반대쪽 밖으로 빠지는 여백 (u).
 * 목업 실측(진입 x = −60 / 1140)이고, 스펙은 측면 경계를 정하지 않았다.
 */
export const FIELD_EXIT_MARGIN_U = 60;

/**
 * 정지 좌표를 적 활동 영역에서 안쪽으로 들이는 여백 (u).
 * 9종 중 가장 넓은 실루엣의 절반보다 커서, 주차한 개체가 화면에 온전히 남는다.
 */
const PARKED_MARGIN_U = 60;

/**
 * F-5가 짝수 번째를 아래로 내리는 오프셋 (u). 목업 실측이고 FormationDef에 담을 칸이 없다.
 * 0으로 두면 성벽 한 줄이 완전한 직선이 되어 목업의 성곽 실루엣과 어긋난다.
 */
const ZIGZAG_OFFSET_U = 46;

/**
 * F-4 사인 곡선의 한 주기가 걸리는 이동 거리 (u). §8.2는 진폭만 주고 주기를 주지 않았다.
 * 거리로 잡아야 이동 속도가 다른 아키타입이 같은 형태로 들어와도 같은 모양으로 감긴다 —
 * 시간으로 잡으면 느린 아키타입이 한 번도 못 감고 내려온다.
 */
const SINE_WAVELENGTH_U = 300;

/**
 * 한 개체의 진입 계획. 위치는 `spawn + dir × 이동거리 + 수직방향 × 사인오프셋`이고,
 * 그 적분은 sim/enemies.ts가 한다.
 */
export interface FormationEntry {
  readonly spawnXU: number;
  readonly spawnYU: number;
  /** 진입 진행 방향 단위 벡터 */
  readonly dirXU: number;
  readonly dirYU: number;
  /** 경로 전체 길이 (u). 0이면 이동 없이 그 자리에 배치된다(§8.2 F-5) */
  readonly pathLengthU: number;
  /** 경로 끝에서 정지하는가. 거짓이면 통과 후 소멸이다(§8.2 F-6 · 10_스펙_목업_불일치.md A8) */
  readonly stops: boolean;
  /** 진입 중 진행 방향에 수직인 진폭 (u). 0이면 곧게 간다 */
  readonly amplitudeU: number;
  /** 이 개체가 나타날 때까지의 대기 (s). 웨이브가 스폰을 예약할 때 읽는다 */
  readonly delaySec: number;
}

/** 진행 방향에 수직인 좌우 흔들림 (u). 이동한 거리의 함수라 속도와 무관하게 모양이 같다 */
export function sineOffsetU(amplitudeU: number, traveledU: number): number {
  if (amplitudeU === 0) {
    return 0;
  }
  return amplitudeU * Math.sin((traveledU / SINE_WAVELENGTH_U) * FULL_TURN_RAD);
}

/** 한 줄에 몇 기까지 세로로 세울 수 있나 — 마지막 기가 활동 영역 바닥을 넘지 않는 최대 수 */
function depthCapacity(stopYU: number, spacingU: number): number {
  return Math.floor((PLAYFIELD.enemyBounds.maxYU - stopYU) / spacingU) + 1;
}

/** 한 줄에 몇 기까지 가로로 세울 수 있나 */
function rowCapacity(spacingU: number): number {
  const bounds = PLAYFIELD.enemyBounds;
  const spanU = bounds.maxXU - bounds.minXU - PARKED_MARGIN_U * 2;
  return Math.floor(spanU / spacingU) + 1;
}

/** 활동 영역 가로 중심 */
function fieldCenterXU(): number {
  return (PLAYFIELD.enemyBounds.minXU + PLAYFIELD.enemyBounds.maxXU) / 2;
}

/** count개를 중심 기준 등간격으로 놓았을 때 index번째의 좌표. 경계를 넘으면 접는다 */
function centeredSpread(
  index: number,
  count: number,
  gapU: number,
  minU: number,
  maxU: number,
): number {
  return clamp(fieldCenterXU() + (index - (count - 1) / 2) * gapU, minU, maxU);
}

/** 몇 번째 줄의 몇 번째 자리인가, 그리고 그 줄이 실제로 몇 기를 받았나 */
interface LinePlace {
  readonly line: number;
  readonly lineCount: number;
  readonly along: number;
  readonly fill: number;
}

function placeInLines(memberIndex: number, memberCount: number, capacity: number): LinePlace {
  const perLine = Math.max(1, capacity);
  const line = Math.floor(memberIndex / perLine);
  return {
    line,
    lineCount: Math.max(1, Math.ceil(memberCount / perLine)),
    along: memberIndex % perLine,
    fill: Math.min(perLine, memberCount - line * perLine),
  };
}

/** 스폰 좌표와 정지 좌표에서 방향·길이를 유도한다. 두 점이 같으면 즉시 배치다 */
function pathBetween(
  spawnXU: number,
  spawnYU: number,
  stopXU: number,
  stopYU: number,
  amplitudeU: number,
  delaySec: number,
): FormationEntry {
  const deltaXU = stopXU - spawnXU;
  const deltaYU = stopYU - spawnYU;
  const pathLengthU = lengthOf(deltaXU, deltaYU);
  if (pathLengthU === 0) {
    return {
      spawnXU,
      spawnYU,
      dirXU: 0,
      dirYU: 1,
      pathLengthU: 0,
      stops: true,
      amplitudeU,
      delaySec,
    };
  }
  return {
    spawnXU,
    spawnYU,
    dirXU: deltaXU / pathLengthU,
    dirYU: deltaYU / pathLengthU,
    pathLengthU,
    stops: true,
    amplitudeU,
    delaySec,
  };
}

interface ColumnSpec {
  readonly spacingU: number;
  readonly stopYU: number;
  readonly spawnIntervalSec: number;
  readonly amplitudeU: number;
}

/**
 * 상단에서 세로로 내려와 서는 형태(F-1 · F-4). 줄이 늘면 가로로 벌린다.
 *
 * 사인 곡선(F-4)은 열 간격을 진폭의 두 배로 잡아 옆 열의 궤적과 겹치지 않게 하고, 열 중심을
 * 진폭만큼 안으로 들여 흔들림이 화면 밖으로 나가지 않게 한다.
 */
function columnEntry(spec: ColumnSpec, memberIndex: number, memberCount: number): FormationEntry {
  const place = placeInLines(memberIndex, memberCount, depthCapacity(spec.stopYU, spec.spacingU));
  const bounds = PLAYFIELD.enemyBounds;
  const insetU = spec.amplitudeU > 0 ? spec.amplitudeU : PARKED_MARGIN_U;
  const gapU = spec.amplitudeU > 0 ? spec.amplitudeU * 2 : spec.spacingU;
  const centerXU = centeredSpread(
    place.line,
    place.lineCount,
    gapU,
    bounds.minXU + insetU,
    bounds.maxXU - insetU,
  );
  const stopYU = clamp(
    spec.stopYU + spec.spacingU * (place.fill - 1 - place.along),
    spec.stopYU,
    bounds.maxYU,
  );
  return pathBetween(
    centerXU,
    bounds.minYU,
    centerXU,
    stopYU,
    spec.amplitudeU,
    spec.spawnIntervalSec * memberIndex,
  );
}

interface RowSpec {
  readonly spacingU: number;
  readonly stopYU: number;
  readonly spawnIntervalSec: number;
}

/**
 * 상단에서 가로로 펼쳐져 서는 형태(F-3 · F-5).
 *
 * F-3은 화면 중앙에서 나와 제 자리로 갈라지고(§8.2 「좌우로 펼쳐지며」), F-5는 이동 없이 제
 * 자리에 나타난다 — 그 차이가 스폰 x 하나로 갈린다.
 */
function rowEntry(
  spec: RowSpec,
  memberIndex: number,
  memberCount: number,
  isInstant: boolean,
): FormationEntry {
  const place = placeInLines(memberIndex, memberCount, rowCapacity(spec.spacingU));
  const bounds = PLAYFIELD.enemyBounds;
  const stopXU = centeredSpread(
    place.along,
    place.fill,
    spec.spacingU,
    bounds.minXU + PARKED_MARGIN_U,
    bounds.maxXU - PARKED_MARGIN_U,
  );
  const zigzagU = isInstant ? (place.along % 2) * ZIGZAG_OFFSET_U : 0;
  const stopYU = clamp(spec.stopYU + spec.spacingU * place.line + zigzagU, bounds.minYU, bounds.maxYU);
  const spawnXU = isInstant ? stopXU : fieldCenterXU();
  const spawnYU = isInstant ? stopYU : bounds.minYU;
  return pathBetween(spawnXU, spawnYU, stopXU, stopYU, 0, spec.spawnIntervalSec * memberIndex);
}

interface SideSpec {
  readonly spacingU: number;
  readonly stopYU: number;
  readonly spawnIntervalSec: number;
}

/**
 * 좌우에서 안으로 들어와 서는 형태(F-2). 개체를 좌우로 번갈아 배정하고, 같은 쪽 개체는
 * spacingU만큼 아래로 쌓는다. 정지 x는 표에 없으므로(FormationDef에 가로 칸이 없다) 활동 영역
 * 가장자리에서 spacingU만큼 들어온 자리로 잡고, 한 열이 차면 다시 그만큼 더 들어온다.
 *
 * 진입 지연은 memberIndex가 아니라 같은 쪽 순번에 걸린다 — §8.2가 좌우를 동시 진입으로 정했다.
 */
function sideEntry(spec: SideSpec, memberIndex: number): FormationEntry {
  const bounds = PLAYFIELD.enemyBounds;
  const isLeft = memberIndex % 2 === 0;
  const sideIndex = Math.floor(memberIndex / 2);
  const perColumn = Math.max(1, depthCapacity(spec.stopYU, spec.spacingU));
  const column = Math.floor(sideIndex / perColumn);
  const depth = sideIndex % perColumn;
  const inwardU = spec.spacingU * (column + 1);
  const stopXU = isLeft
    ? clamp(bounds.minXU + inwardU, bounds.minXU + PARKED_MARGIN_U, fieldCenterXU() - PARKED_MARGIN_U)
    : clamp(bounds.maxXU - inwardU, fieldCenterXU() + PARKED_MARGIN_U, bounds.maxXU - PARKED_MARGIN_U);
  const stopYU = clamp(spec.stopYU + spec.spacingU * depth, bounds.minYU, bounds.maxYU);
  const spawnXU = isLeft ? bounds.minXU - FIELD_EXIT_MARGIN_U : bounds.maxXU + FIELD_EXIT_MARGIN_U;
  return pathBetween(spawnXU, stopYU, stopXU, stopYU, 0, spec.spawnIntervalSec * sideIndex);
}

interface CrossSpec {
  readonly spacingU: number;
  readonly spawnIntervalSec: number;
}

/**
 * 한쪽에서 들어와 반대쪽으로 빠지는 형태(F-6). **정지하지 않는다** — 화면 끝에서 되돌아오면
 * 측면 위협이 아니라 상주 적이 되고 §9의 동시 잡몹 도달치가 통째로 어긋난다(A8).
 *
 * 첫 레인 y도 표에 없다(stopYU가 null이라 담을 칸이 없다). 플레이어 이동 영역 상단에서
 * 시작해 spacingU만큼씩 내려 잡고, 활동 영역 바닥을 넘으면 첫 레인으로 되돌아온다 —
 * 통과하는 개체라 같은 레인을 다시 쓰는 것이 진입 간격만큼 시간으로 갈라진다.
 */
function crossEntry(spec: CrossSpec, memberIndex: number): FormationEntry {
  const bounds = PLAYFIELD.enemyBounds;
  const firstLaneYU = PLAYFIELD.playerBounds.minYU;
  const laneCount = Math.max(1, Math.floor((bounds.maxYU - firstLaneYU) / spec.spacingU) + 1);
  const isLeft = memberIndex % 2 === 0;
  const laneYU = firstLaneYU + spec.spacingU * (Math.floor(memberIndex / 2) % laneCount);
  const spanU = bounds.maxXU - bounds.minXU + FIELD_EXIT_MARGIN_U * 2;
  return {
    spawnXU: isLeft ? bounds.minXU - FIELD_EXIT_MARGIN_U : bounds.maxXU + FIELD_EXIT_MARGIN_U,
    spawnYU: laneYU,
    dirXU: isLeft ? 1 : -1,
    dirYU: 0,
    pathLengthU: spanU,
    stops: false,
    amplitudeU: 0,
    delaySec: spec.spawnIntervalSec * memberIndex,
  };
}

/**
 * §8.2의 여섯 형태. formationId로 분기하고 default가 never로 끝난다 — 형태가 늘었는데 여기를
 * 안 고치면 컴파일이 막힌다. 없으면 그 형태의 적이 원점에 조용히 쌓인다.
 *
 * 각 case가 FORMATIONS를 직접 첨자한다. 공통 변수로 뽑으면 stopYU가 `number | null`로 넓어져
 * F-6 하나 때문에 나머지 다섯이 전부 단언을 달아야 한다.
 */
export function planEntry(
  formationId: FormationId,
  memberIndex: number,
  memberCount: number,
): FormationEntry {
  switch (formationId) {
    case 'F-1':
      return columnEntry(FORMATIONS['F-1'], memberIndex, memberCount);
    case 'F-2':
      return sideEntry(FORMATIONS['F-2'], memberIndex);
    case 'F-3':
      return rowEntry(FORMATIONS['F-3'], memberIndex, memberCount, false);
    case 'F-4':
      return columnEntry(FORMATIONS['F-4'], memberIndex, memberCount);
    case 'F-5':
      return rowEntry(FORMATIONS['F-5'], memberIndex, memberCount, true);
    case 'F-6':
      return crossEntry(FORMATIONS['F-6'], memberIndex);
    default: {
      const unreachable: never = formationId;
      throw new Error(`알 수 없는 진입 형태: ${String(unreachable)}`);
    }
  }
}
