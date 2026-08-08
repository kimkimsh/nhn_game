/**
 * 타이틀 어트랙트 루프 — 08 §6.2 · §6.2.1 · 12 §1 C-03
 *
 * ── 자동 패리가 아니라 기록된 입력의 재생이다 ──────────────────────────────────
 *
 * 목업은 `HW.autoParry`(`00_title/scene.js:56`)로 패리를 성립시켰지만 **그 방법은 이식하지
 * 않았다.** 그 함수가 남으면 「자동 패리」라는 규칙 밖 경로가 코드에 상주하고, 타이틀에서 도는
 * 것이 진짜 플레이가 아니게 되며, §17이 요구한 신호들도 그만큼 가짜가 된다.
 *
 * 대신 **고정 시드 위에서 미리 녹화한 입력을 재생한다.** D-05의 결정론이 같은 시드 + 같은
 * 입력 → 같은 결과를 보장하므로 매번 같은 장면이 나온다. 재생 대상은 진짜 `core/input.ts`
 * 인스턴스이고 이 파일이 하는 일은 그 위에서 키를 눌렀다 떼는 것뿐이라, `sim/`이 받는 것은
 * 사람이 친 것과 **구별되지 않는다.** 병렬 입력 구현이 없으므로 어긋날 자리도 없다.
 *
 * 녹화는 이 파일에 **리터럴로 박는다.** 외부 파일을 읽으면 D-03의 단일 파일 빌드가 깨진다.
 *
 * ── 녹화를 만드는 자리 ─────────────────────────────────────────────────────────
 *
 * `tests/attract/record.ts`다. `src/dev/`에 못 두는 것은 eslint가 `dev/ → screens/`를 막기
 * 때문이고(03 §5), `tests/perf`·`tests/visual`이 같은 이유로 같은 자리에 산다. 규칙이나 §14.1의
 * 수치가 바뀌면 그 파일을 다시 돌려 아래 리터럴을 갈아 끼운다. **같은 녹화가 제출 영상의 소스다.**
 *
 * `ATTRACT_RECORDING`이 비면 `createAttractLoop`는 null을 내고 타이틀은 정적 화면으로 선다 —
 * 어트랙트 루프가 없는 것이 잘못된 어트랙트 루프보다 낫다.
 *
 * ── 스텝 누산을 여기서 또 하는 이유 ────────────────────────────────────────────
 *
 * `core/loop.ts`가 고정 스텝 누산을 갖고 있지만 `screens/manager.ts`는 전투 화면일 때만 그
 * 스텝을 `play.ts`로 흘린다(`simRunning()`). 타이틀은 화면 계약상 `paint`와 `update`만 받으므로
 * 자기 몫의 누산을 자기가 든다. 정책은 loop.ts와 같다 — 프레임당 상한 `MAX_STEPS_PER_FRAME`,
 * 넘치면 따라잡기를 포기하고 잔여를 버린다.
 *
 * **재생 위치는 벽시계가 아니라 스텝 번호다.** 프레임 간격이 흔들려도 스텝 N이 받는 입력은
 * 언제나 같으므로, 60Hz에서 보든 144Hz에서 보든 같은 런이 나온다.
 */

import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import type { StageId } from '../config/ids';
import { bus } from '../core/bus';
import { createInput, type Input } from '../core/input';
import { FIXED_DT_SEC, MAX_STEPS_PER_FRAME } from '../core/loop';
import { deriveStream } from '../core/rng';
import { prefersReducedMotion, watchReducedMotion } from '../boot/platform-guard';
import {
  bakeStageBackground, disposeStageBackground, isStageBackgroundBaked,
} from '../render/backgrounds/index';
import { createCamera, type Camera } from '../render/camera';
import { bakeEnemyBodies, discardEnemyBodyBakes } from '../render/enemy';
import { drawFrame, type FrameView } from '../render/frame';
import { createHudAnim, type HudAnim } from '../render/hud';
import { createImpactLayer, type ImpactLayer } from '../render/impact';
import { createParticleLayer, type ParticleLayer } from '../render/particles';
import { createPlayerFx, notifyPlayerFx, type PlayerFxState } from '../render/player';
import { createRun, disposeRun, stepRun, type Run } from '../sim/run';
import type { StageEntry } from '../sim/waves';
import { buildFrameView, createBatch, stageBakeSpecs, type MutableBatch } from './play-view';

const MS_PER_SEC = 1000;
const FIXED_DT_MS = FIXED_DT_SEC * MS_PER_SEC;
const SEED_RANGE = 0x1_0000_0000;

/**
 * 어트랙트 고정 시드 (D-05). **값을 바꾸면 녹화된 입력이 다른 런 위에서 재생되어 장면이
 * 통째로 달라진다.** 녹화와 시드는 한 쌍이므로 둘 중 하나만 고치지 않는다.
 */
export const ATTRACT_SEED = 0x48_57_41_4e;

/**
 * 목업이 `stage: 'busanjin'`으로 못 박았다(`00_title/scene.js:31`). S1에는 패리 불가 요소가
 * 없어서(§14.1) 첫 화면에서 규칙이 하나로 읽힌다. 녹화가 없는 동안 `title.ts`가 그리는
 * 정적 배경도 이 스테이지의 것이어야 하므로 export한다 — 둘이 갈리면 녹화가 들어오는 순간
 * 하늘이 바뀐다.
 */
export const ATTRACT_STAGE_ID: StageId = 1;

/**
 * 어트랙트가 들어가는 지점 — S1의 **둘째 웨이브**(0:13)다. 0:00이 아닌 이유가 하나 있고
 * 그것은 취향이 아니라 규칙의 결과다.
 *
 * 위 `TITLE_PLAYER_DRAW_YU`의 구도가 플레이어를 이동 영역의 위쪽 끝(620u)에 세우는데, 그
 * 자리는 W1의 궁수들이 내려오는 길과 가까워 §6.2의 HR-09가 그 발사원을 계속 억제한다. 그래서
 * W1 13초 동안 패리할 탄이 **한 발도 안 나온다** — 규칙대로 동작한 결과이고, 첫 화면에서
 * 13초 동안 아무 일도 안 일어난다는 뜻이기도 하다. 08 §6.2가 어트랙트에 요구한 것은
 * 「이 게임이 무엇인지 보여 주는 것」이므로 그 13초를 보여 줄 이유가 없다.
 *
 * 진입 지점을 옮기는 것은 `waves.ts`의 `applyStageEntry` 한 곳이고 규칙은 하나도 안 바뀐다.
 * **녹화와 한 쌍이다** — 값을 바꾸면 `tests/attract/record.ts`를 다시 돌려야 한다.
 */
export const ATTRACT_ENTRY: StageEntry = { kind: 'wave', waveIndex: 1 };

/** 08 §6.2.1 재생 길이. 끝에 닿으면 같은 시드로 처음부터 다시 돈다 */
export const ATTRACT_LENGTH_SEC = 30;
const ATTRACT_LENGTH_STEPS = Math.round(ATTRACT_LENGTH_SEC / FIXED_DT_SEC);

/**
 * 녹화 한 점 — **누른 키의 집합이 바뀌는 순간만** 적는다.
 *
 * 눌림(press)이 아니라 눌린 상태(held)를 적는 이유는 §16.5다. 이동은 누르고 있는 동안 반복
 * 발동하고 패리는 눌림 순간에만 접수되는데, held 집합의 변화만 있으면 양쪽을 다 복원할 수
 * 있다 — 새로 들어온 코드가 곧 눌림이고, 남아 있는 코드가 곧 isDown이다. 반대로 눌림만
 * 적으면 이동 키를 언제 뗐는지가 사라진다.
 *
 * `code`는 `KeyboardEvent.code`(물리 위치)다. `core/input.ts`의 표가 그것으로 매핑한다.
 */
export interface AttractKeyframe {
  /** 이 상태가 적용되는 첫 스텝 번호. 0부터이고 오름차순이어야 한다 */
  readonly step: number;
  /** 이 시점에 눌려 있는 키 전부. 빈 배열은 아무것도 안 누른 상태다 */
  readonly codes: readonly string[];
}

/**
 * `tests/attract/record.ts`가 낸 리터럴이다. **손으로 고치지 않는다** — 한 줄만 바꿔도 그
 * 뒤가 전부 다른 판이 되고, 다시 만들 방법은 그 파일을 다시 돌리는 것뿐이다.
 *
 * 이 녹화가 담은 판: 29.7초 · 패리 30회(GREAT 29 · GOOD 1) · 빈 패리 0 · 잡몹 6기 처치 ·
 * 점수 13,474 · 가드 위반 0건. 끝에서 라이프가 0이 되고 그 자리에서 다음 바퀴가 시작한다.
 * 규칙이나 §14.1의 수치가 바뀌면 낡으므로 다시 돌린다.
 *
 * 마지막 키프레임 뒤로도 재생은 `ATTRACT_LENGTH_SEC`까지 이어지고, 끝에 닿으면 `restart`가
 * `input.reset()`으로 눌린 키를 전부 놓으므로 마지막 줄에 키가 남아 있어도 다음 바퀴로 안 샌다.
 */
export const ATTRACT_RECORDING: readonly AttractKeyframe[] = [
  { step: 0, codes: ['KeyW'] },
  { step: 135, codes: [] },
  { step: 474, codes: ['KeyA'] },
  { step: 513, codes: [] },
  { step: 515, codes: ['KeyD'] },
  { step: 546, codes: ['KeyD', 'KeyJ'] },
  { step: 547, codes: ['KeyD'] },
  { step: 566, codes: ['KeyA'] },
  { step: 576, codes: ['KeyD'] },
  { step: 583, codes: [] },
  { step: 584, codes: ['KeyA'] },
  { step: 622, codes: [] },
  { step: 625, codes: ['KeyD'] },
  { step: 668, codes: ['KeyD', 'KeyJ'] },
  { step: 669, codes: ['KeyD'] },
  { step: 688, codes: ['KeyA'] },
  { step: 698, codes: ['KeyD'] },
  { step: 714, codes: [] },
  { step: 716, codes: ['KeyJ'] },
  { step: 717, codes: ['KeyA'] },
  { step: 754, codes: ['KeyD'] },
  { step: 784, codes: [] },
  { step: 787, codes: ['KeyA'] },
  { step: 811, codes: ['KeyJ'] },
  { step: 812, codes: ['KeyA'] },
  { step: 831, codes: ['KeyD'] },
  { step: 841, codes: ['KeyA'] },
  { step: 848, codes: [] },
  { step: 900, codes: ['KeyD'] },
  { step: 934, codes: ['KeyD', 'KeyJ'] },
  { step: 935, codes: [] },
  { step: 964, codes: ['KeyD'] },
  { step: 986, codes: [] },
  { step: 999, codes: ['KeyA'] },
  { step: 1000, codes: [] },
  { step: 1002, codes: ['KeyA'] },
  { step: 1003, codes: [] },
  { step: 1004, codes: ['KeyJ'] },
  { step: 1005, codes: ['KeyA'] },
  { step: 1039, codes: [] },
  { step: 1045, codes: ['KeyD'] },
  { step: 1050, codes: ['KeyA'] },
  { step: 1067, codes: [] },
  { step: 1070, codes: ['KeyD'] },
  { step: 1076, codes: ['KeyA'] },
  { step: 1103, codes: [] },
  { step: 1212, codes: ['KeyD'] },
  { step: 1283, codes: [] },
  { step: 1286, codes: ['KeyD'] },
  { step: 1319, codes: [] },
  { step: 1324, codes: ['KeyA'] },
  { step: 1325, codes: [] },
  { step: 1326, codes: ['KeyA'] },
  { step: 1328, codes: [] },
  { step: 1329, codes: ['KeyA'] },
  { step: 1332, codes: [] },
  { step: 1333, codes: ['KeyA'] },
  { step: 1335, codes: ['KeyJ'] },
  { step: 1336, codes: ['KeyA'] },
  { step: 1393, codes: [] },
  { step: 1395, codes: ['KeyA'] },
  { step: 1405, codes: [] },
  { step: 1524, codes: ['KeyD'] },
  { step: 1550, codes: ['KeyD', 'KeyJ'] },
  { step: 1551, codes: ['KeyD'] },
  { step: 1562, codes: [] },
  { step: 1566, codes: ['KeyA'] },
  { step: 1581, codes: ['KeyD'] },
  { step: 1603, codes: [] },
  { step: 1622, codes: ['KeyA'] },
  { step: 1623, codes: [] },
  { step: 1627, codes: ['KeyA', 'KeyJ'] },
  { step: 1628, codes: ['KeyA'] },
  { step: 1658, codes: ['KeyA', 'KeyJ'] },
  { step: 1659, codes: ['KeyA'] },
  { step: 1664, codes: ['KeyD'] },
  { step: 1678, codes: ['KeyA'] },
  { step: 1680, codes: [] },
  { step: 1794, codes: ['KeyD'] },
  { step: 1822, codes: [] },
  { step: 1825, codes: ['KeyA'] },
  { step: 1841, codes: ['KeyD'] },
  { step: 1866, codes: ['KeyD', 'KeyJ'] },
  { step: 1867, codes: ['KeyA'] },
  { step: 1886, codes: [] },
  { step: 1896, codes: ['KeyD'] },
  { step: 1926, codes: [] },
  { step: 1934, codes: ['KeyA'] },
  { step: 1935, codes: [] },
  { step: 1936, codes: ['KeyA'] },
  { step: 1937, codes: [] },
  { step: 1938, codes: ['KeyA'] },
  { step: 1939, codes: [] },
  { step: 1940, codes: ['KeyA'] },
  { step: 1941, codes: [] },
  { step: 1942, codes: ['KeyA'] },
  { step: 1943, codes: [] },
  { step: 1944, codes: ['KeyA'] },
  { step: 1945, codes: ['KeyJ'] },
  { step: 1946, codes: ['KeyA'] },
  { step: 1965, codes: [] },
  { step: 1975, codes: ['KeyA'] },
  { step: 2010, codes: [] },
  { step: 2014, codes: ['KeyD'] },
  { step: 2017, codes: [] },
  { step: 2058, codes: ['KeyD'] },
  { step: 2089, codes: [] },
  { step: 2092, codes: ['KeyA'] },
  { step: 2133, codes: ['KeyJ'] },
  { step: 2134, codes: ['KeyA'] },
  { step: 2151, codes: ['KeyD'] },
  { step: 2153, codes: [] },
  { step: 2163, codes: ['KeyD'] },
  { step: 2237, codes: [] },
  { step: 2244, codes: ['KeyA'] },
  { step: 2246, codes: [] },
  { step: 2247, codes: ['KeyA'] },
  { step: 2248, codes: [] },
  { step: 2249, codes: ['KeyA'] },
  { step: 2250, codes: [] },
  { step: 2251, codes: ['KeyA'] },
  { step: 2252, codes: [] },
  { step: 2253, codes: ['KeyA'] },
  { step: 2254, codes: [] },
  { step: 2255, codes: ['KeyA'] },
  { step: 2256, codes: [] },
  { step: 2257, codes: ['KeyA'] },
  { step: 2258, codes: [] },
  { step: 2259, codes: ['KeyA', 'KeyJ'] },
  { step: 2260, codes: ['KeyA'] },
  { step: 2279, codes: [] },
  { step: 2289, codes: ['KeyA'] },
  { step: 2315, codes: [] },
  { step: 2319, codes: ['KeyD'] },
  { step: 2332, codes: ['KeyA'] },
  { step: 2376, codes: [] },
  { step: 2380, codes: ['KeyD'] },
  { step: 2386, codes: [] },
  { step: 2401, codes: ['KeyD'] },
  { step: 2426, codes: [] },
  { step: 2427, codes: ['KeyA'] },
  { step: 2435, codes: [] },
  { step: 2458, codes: ['KeyD'] },
  { step: 2459, codes: [] },
  { step: 2460, codes: ['KeyJ'] },
  { step: 2461, codes: ['KeyA'] },
  { step: 2464, codes: [] },
  { step: 2469, codes: ['KeyA'] },
  { step: 2475, codes: ['KeyD'] },
  { step: 2480, codes: ['KeyA'] },
  { step: 2485, codes: ['KeyD'] },
  { step: 2486, codes: ['KeyA'] },
  { step: 2487, codes: ['KeyD'] },
  { step: 2488, codes: ['KeyA'] },
  { step: 2489, codes: ['KeyD'] },
  { step: 2495, codes: [] },
  { step: 2504, codes: ['KeyJ'] },
  { step: 2505, codes: ['KeyD'] },
  { step: 2506, codes: ['KeyA'] },
  { step: 2524, codes: ['KeyD'] },
  { step: 2534, codes: ['KeyA'] },
  { step: 2537, codes: [] },
  { step: 2544, codes: ['KeyD'] },
  { step: 2546, codes: [] },
  { step: 2547, codes: ['KeyD'] },
  { step: 2549, codes: [] },
  { step: 2550, codes: ['KeyD'] },
  { step: 2552, codes: ['KeyJ'] },
  { step: 2553, codes: ['KeyD'] },
  { step: 2572, codes: ['KeyA'] },
  { step: 2582, codes: ['KeyD'] },
  { step: 2583, codes: [] },
  { step: 2588, codes: ['KeyA'] },
  { step: 2590, codes: [] },
  { step: 2591, codes: ['KeyA'] },
  { step: 2595, codes: ['KeyJ'] },
  { step: 2596, codes: [] },
  { step: 2598, codes: ['KeyD'] },
  { step: 2601, codes: [] },
  { step: 2602, codes: ['KeyD'] },
  { step: 2605, codes: ['KeyA'] },
  { step: 2615, codes: [] },
  { step: 2623, codes: ['KeyA'] },
  { step: 2641, codes: [] },
  { step: 2644, codes: ['KeyD'] },
  { step: 2684, codes: [] },
  { step: 2686, codes: ['KeyA'] },
  { step: 2693, codes: [] },
  { step: 2733, codes: ['KeyD'] },
  { step: 2734, codes: [] },
  { step: 2743, codes: ['KeyD'] },
  { step: 2744, codes: [] },
  { step: 2752, codes: ['KeyD'] },
  { step: 2753, codes: [] },
  { step: 2761, codes: ['KeyD'] },
  { step: 2762, codes: [] },
  { step: 2770, codes: ['KeyD'] },
  { step: 2771, codes: ['KeyJ'] },
  { step: 2772, codes: ['KeyA'] },
  { step: 2789, codes: [] },
  { step: 2791, codes: ['KeyA'] },
  { step: 2796, codes: ['KeyD'] },
  { step: 2797, codes: ['KeyA'] },
  { step: 2798, codes: ['KeyD'] },
  { step: 2799, codes: ['KeyA'] },
  { step: 2800, codes: ['KeyD'] },
  { step: 2817, codes: [] },
  { step: 2818, codes: ['KeyJ'] },
  { step: 2819, codes: ['KeyA'] },
  { step: 2838, codes: ['KeyD'] },
  { step: 2841, codes: ['KeyA'] },
  { step: 2842, codes: ['KeyD'] },
  { step: 2843, codes: ['KeyA'] },
  { step: 2844, codes: ['KeyD'] },
  { step: 2845, codes: ['KeyA'] },
  { step: 2846, codes: ['KeyD'] },
  { step: 2847, codes: ['KeyA'] },
  { step: 2888, codes: [] },
  { step: 2891, codes: ['KeyD'] },
  { step: 2904, codes: ['KeyA'] },
  { step: 2917, codes: ['KeyA', 'KeyJ'] },
  { step: 2918, codes: ['KeyD'] },
  { step: 2962, codes: ['KeyJ'] },
  { step: 2963, codes: [] },
  { step: 2996, codes: ['KeyA'] },
  { step: 3018, codes: [] },
  { step: 3082, codes: ['KeyJ'] },
  { step: 3083, codes: ['KeyD'] },
  { step: 3086, codes: ['KeyA'] },
  { step: 3089, codes: ['KeyD'] },
  { step: 3101, codes: [] },
  { step: 3102, codes: ['KeyD'] },
  { step: 3110, codes: ['KeyA'] },
  { step: 3111, codes: ['KeyD'] },
  { step: 3116, codes: [] },
  { step: 3124, codes: ['KeyJ'] },
  { step: 3125, codes: ['KeyA'] },
  { step: 3144, codes: ['KeyD'] },
  { step: 3155, codes: [] },
  { step: 3156, codes: ['KeyD'] },
  { step: 3158, codes: [] },
  { step: 3159, codes: ['KeyD'] },
  { step: 3160, codes: [] },
  { step: 3161, codes: ['KeyD'] },
  { step: 3163, codes: [] },
  { step: 3164, codes: ['KeyD'] },
  { step: 3165, codes: [] },
  { step: 3166, codes: ['KeyD'] },
  { step: 3168, codes: [] },
  { step: 3169, codes: ['KeyD'] },
  { step: 3170, codes: ['KeyJ'] },
  { step: 3171, codes: ['KeyA'] },
  { step: 3175, codes: ['KeyD'] },
  { step: 3188, codes: [] },
  { step: 3190, codes: ['KeyA'] },
  { step: 3200, codes: [] },
  { step: 3206, codes: ['KeyA'] },
  { step: 3207, codes: [] },
  { step: 3208, codes: ['KeyA'] },
  { step: 3212, codes: [] },
  { step: 3213, codes: ['KeyA'] },
  { step: 3214, codes: ['KeyA', 'KeyJ'] },
  { step: 3215, codes: ['KeyA'] },
  { step: 3224, codes: ['KeyD'] },
  { step: 3226, codes: [] },
  { step: 3308, codes: ['KeyD'] },
  { step: 3339, codes: [] },
  { step: 3367, codes: ['KeyA'] },
  { step: 3368, codes: [] },
  { step: 3375, codes: ['KeyA'] },
  { step: 3376, codes: [] },
  { step: 3382, codes: ['KeyA'] },
  { step: 3383, codes: [] },
  { step: 3390, codes: ['KeyA'] },
  { step: 3391, codes: [] },
  { step: 3396, codes: ['KeyJ'] },
  { step: 3397, codes: ['KeyA'] },
  { step: 3416, codes: ['KeyD'] },
  { step: 3418, codes: ['KeyA'] },
  { step: 3419, codes: ['KeyD'] },
  { step: 3420, codes: ['KeyA'] },
  { step: 3421, codes: ['KeyD'] },
  { step: 3422, codes: ['KeyA'] },
  { step: 3423, codes: ['KeyD'] },
  { step: 3424, codes: ['KeyA'] },
  { step: 3425, codes: ['KeyD'] },
  { step: 3426, codes: ['KeyA'] },
  { step: 3427, codes: [] },
  { step: 3428, codes: ['KeyJ'] },
  { step: 3429, codes: ['KeyA'] },
  { step: 3436, codes: ['KeyD'] },
  { step: 3446, codes: [] },
  { step: 3448, codes: ['KeyA'] },
  { step: 3451, codes: ['KeyD'] },
  { step: 3452, codes: ['KeyA'] },
  { step: 3453, codes: ['KeyD'] },
  { step: 3454, codes: ['KeyA'] },
  { step: 3455, codes: ['KeyD'] },
  { step: 3456, codes: ['KeyA'] },
  { step: 3457, codes: ['KeyD'] },
  { step: 3458, codes: ['KeyA'] },
  { step: 3464, codes: ['KeyA', 'KeyJ'] },
  { step: 3465, codes: ['KeyA'] },
  { step: 3482, codes: ['KeyD'] },
  { step: 3496, codes: ['KeyD', 'KeyJ'] },
  { step: 3497, codes: ['KeyD'] },
  { step: 3501, codes: [] },
  { step: 3502, codes: ['KeyD'] },
  { step: 3503, codes: ['KeyA'] },
  { step: 3516, codes: ['KeyD'] },
  { step: 3526, codes: ['KeyA'] },
  { step: 3541, codes: [] },
  { step: 3545, codes: ['KeyD'] },
  { step: 3550, codes: [] },
  { step: 3551, codes: ['KeyD'] },
];

/** 정적 화면 갈래와 어트랙트 갈래를 가르는 유일한 조건 */
export function hasAttractRecording(): boolean {
  return ATTRACT_RECORDING.length > 0;
}

/**
 * §3.1 클램프를 **우회하는 그리기 좌표** — 08 §6.5 · 10 A12 · 12 §8-7
 *
 * 목업은 플레이어를 `y = 545 ± 55`에 놓았고(`00_title/scene.js:31`·`:47-48`) 그 궤적은 전
 * 구간이 §3.1의 이동 가능 영역 `y ∈ [620, 1830]` **밖**이다. 이유는 명확하다 — 타이틀 스크림이
 * `y ≈ 749`에서 이미 불투명도 0.88에 도달하므로, 정상 위치에 있는 플레이어는 로고 판 뒤에
 * 통째로 묻힌다.
 *
 * 판정은 승인된 목업 구도를 그대로 세우는 쪽이다. 그래서 **이 화면에서만** 그리는 y를
 * 위로 민다. 아래 둘을 혼동하지 말 것:
 *
 *   · sim은 정상이다. `sim/player.ts`가 §3.1대로 클램프하고 패리 판정도 그 좌표에서 난다.
 *   · 예외는 **그리는 위치 하나**다. 게임 플레이의 플레이어 위치는 언제나 sim이 정하며 이
 *     우회는 타이틀 한 곳에서 끝난다.
 *
 * 「플레이어가 왜 여기 있지」를 조사하러 온 사람이 클램프 버그를 찾아 헤매지 않도록 적는다.
 * 이동 영역 상단(620u)을 목업의 중심(545u)에 맞추는 평행이동이라 상수 하나로 끝난다.
 */
const TITLE_PLAYER_DRAW_YU = 545;
const PLAYER_DRAW_OFFSET_YU = TITLE_PLAYER_DRAW_YU - PLAYFIELD.playerBounds.minYU;

export interface AttractLoop {
  /** 프레임당 1회. 고정 스텝을 여기서 돌린다 — 그리기와 갈라야 정지 프레임에서도 그림이 나온다 */
  advance(realDtSec: number): void;
  /** 층 1~11. 스크림과 로고타입은 `screens/title.ts`가 이 위에 얹는다 */
  draw(ctx: CanvasRenderingContext2D, realDtSec: number): void;
  dispose(): void;
}

/** 녹화가 없으면 null이다. 호출부의 갈래가 「루프가 있나」 하나로 끝나게 한다 */
export function createAttractLoop(): AttractLoop | null {
  return hasAttractRecording() ? startAttract() : null;
}

function startAttract(): AttractLoop {
  const stage = STAGES[ATTRACT_STAGE_ID];
  const renderSeed = deriveStream(ATTRACT_SEED, 'render').int(0, SEED_RANGE);
  const input: Input = createInput();

  // 전역 버스를 쓴다 — core/bus.ts가 팩토리를 export하지 않아 사설 버스를 만들 수 없다.
  // 08 §6.2가 타이틀에서 도는 것을 「진짜 플레이」로 정의했으므로 방향은 맞지만, 어트랙트의
  // 전투음이 타이틀에서 그대로 난다는 뜻이기도 하다 — 녹화가 오는 P7에서 믹서와 함께 정한다
  const camera: Camera = createCamera({ bus, rng: deriveStream(renderSeed, 'render/camera') });
  const particles: ParticleLayer = createParticleLayer({ bus, rng: deriveStream(renderSeed, 'render/particles') });
  const impact: ImpactLayer = createImpactLayer({ bus, rng: deriveStream(renderSeed, 'render/impact') });
  const playerFx: PlayerFxState = createPlayerFx();
  const hudAnim: HudAnim = createHudAnim();

  function applyReducedMotion(reduced: boolean): void {
    camera.setReducedMotion(reduced);
    impact.setReducedMotion(reduced);
  }
  applyReducedMotion(prefersReducedMotion());
  const stopWatchingMotion = watchReducedMotion(applyReducedMotion);

  let run: Run = createRun({ seed: ATTRACT_SEED, stageId: ATTRACT_STAGE_ID, at: ATTRACT_ENTRY });
  let batch: MutableBatch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
  let offs = subscribePlayerFx(run, playerFx);
  let held = new Set<string>();
  /** 문구별 1회 보고용. 런을 다시 만들어도 유지한다 — 매 바퀴 같은 줄이 콘솔을 채우면 안 된다 */
  const reportedGuards = new Set<string>();
  let keyframeIndex = 0;
  let stepIndex = 0;
  let accumulatorSec = 0;
  let backgroundTimeSec = 0;

  /**
   * 이미 이 스테이지·이 시드로 구워져 있으면 아무것도 안 한다.
   *
   * `restart()`가 두 경로에서 불린다 — 굽기 슬롯을 다른 화면이 가져갔을 때와, 30초 재생이 한
   * 바퀴 돌았을 때다. 뒤쪽은 굽힌 것이 그대로 살아 있는데, 무조건 다시 구우면 타이틀이
   * 30초마다 1080×1920 한 장을 다시 그려 눈에 보이는 프레임 하나를 잃는다.
   */
  function bake(): void {
    if (isStageBackgroundBaked(stage.background, renderSeed)) {
      return;
    }
    bakeStageBackground(stage.background, renderSeed);
    discardEnemyBodyBakes();
    bakeEnemyBodies(stageBakeSpecs(stage));
  }

  /** 재생이 끝났거나, 런이 끝났거나, 다른 화면이 굽기 슬롯을 가져갔을 때 처음부터 다시 */
  function restart(): void {
    for (const off of offs) {
      off();
    }
    disposeRun(run);
    input.reset();
    held = new Set<string>();
    keyframeIndex = 0;
    stepIndex = 0;
    accumulatorSec = 0;
    backgroundTimeSec = 0;
    run = createRun({ seed: ATTRACT_SEED, stageId: ATTRACT_STAGE_ID, at: ATTRACT_ENTRY });
    offs = subscribePlayerFx(run, playerFx);
    batch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
    camera.reset();
    bake();
  }

  /**
   * 녹화된 held 집합을 진짜 `Input` 위에 재현한다. 집합에서 빠진 코드는 떼고 새로 들어온 코드는
   * 누르며, 그 「새로 들어옴」이 곧 §16.5의 눌림이다. `atMs`는 스텝의 시작 시각이라 그 스텝의
   * `takePressesUntil` 상한 안에 반드시 들어온다.
   */
  function applyKeyframe(codes: readonly string[], atMs: number): void {
    for (const code of held) {
      if (!codes.includes(code)) {
        input.releaseKey(code);
        held.delete(code);
      }
    }
    for (const code of codes) {
      if (!held.has(code)) {
        input.pressKey({ code, atMs, shiftHeld: false, repeat: false });
        held.add(code);
      }
    }
  }

  /**
   * 가드는 05 §1의 16번, 스텝의 거의 끝에서 던진다 — 뒤에 남은 것은 큐 배출뿐이라 월드는 온전하고
   * 재생을 이어 갈 수 있다. `dev/headless.ts`가 같은 이유로 같은 처리를 한다.
   *
   * **삼키는 것이 아니라 자리를 옮기는 것이다.** 여기서 걸리는 것은 HR-03의 적 탄환 공백 하나이고,
   * 그 원인은 §9.1의 웨이브 시작 시각과 HR-03 조문의 충돌이라 어트랙트가 만든 것이 아니다
   * (03_검토_기록.md §3.1 · §3.2, 스펙 개정 대기). 그것 때문에 타이틀 화면이 죽으면 개발 빌드에서
   * 게임을 열 수가 없다. 릴리스는 `GUARDS_ENABLED`가 false라 이 경로 자체가 없다.
   *
   * 새 위반이 조용히 묻히지 않도록 콘솔에 남기되 **가드 하나당 한 번**이다. 문구로 접으면
   * HR-03의 공백 길이가 스텝마다 늘어나 문구가 매번 달라지고, 30초에 200줄이 쌓여 로그가
   * 쓸모없어진다 — 접는 열쇠는 `guardId`여야 한다.
   *
   * `GuardViolation`을 import해서 `instanceof`로 가르지 않는 것은 그것이 **값 import**라
   * 릴리스 번들에 `sim/guards.ts`의 클래스가 그대로 남기 때문이다. 그 모듈은 호출부가 전부
   * `GUARDS_ENABLED` 안에 있어 통째로 트리 셰이킹되는 것이 설계이고(guards.ts 머리말),
   * 여기 한 줄이 그 조건을 깬다. 필드 하나만 보면 되므로 모양으로 가른다.
   */
  function reportGuard(cause: unknown): void {
    const guardId = (cause as { readonly guardId?: unknown }).guardId;
    const key = typeof guardId === 'string' ? guardId : String(cause);
    if (reportedGuards.has(key)) {
      return;
    }
    reportedGuards.add(key);
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[어트랙트] ${message} — 재생은 계속한다. 같은 가드는 다시 안 적는다`);
  }

  function stepOnce(): void {
    const startMs = stepIndex * FIXED_DT_MS;
    const untilMs = startMs + FIXED_DT_MS;
    while (keyframeIndex < ATTRACT_RECORDING.length) {
      const keyframe = ATTRACT_RECORDING[keyframeIndex];
      if (keyframe === undefined || keyframe.step > stepIndex) {
        break;
      }
      applyKeyframe(keyframe.codes, startMs);
      keyframeIndex += 1;
    }
    input.beginFrame(untilMs);
    try {
      stepRun(run, FIXED_DT_SEC, { input, untilMs });
    } catch (cause: unknown) {
      reportGuard(cause);
    }
    stepIndex += 1;
  }

  bake();

  return {
    advance(realDtSec: number): void {
      // 다른 화면이 자기 스테이지를 구우면 슬롯이 갈린다. 그대로 그리면 DEV에서 던진다
      if (!isStageBackgroundBaked(stage.background, renderSeed)) {
        restart();
      }
      backgroundTimeSec += realDtSec;
      accumulatorSec += realDtSec;
      let steps = 0;
      while (accumulatorSec >= FIXED_DT_SEC && steps < MAX_STEPS_PER_FRAME) {
        stepOnce();
        accumulatorSec -= FIXED_DT_SEC;
        steps += 1;
      }
      if (accumulatorSec >= FIXED_DT_SEC) {
        // loop.ts와 같은 정책 — 못 따라간 시간은 버린다. 어트랙트가 빚을 갚느라 빨리 감기면 안 된다
        accumulatorSec = 0;
      }
      if (stepIndex >= ATTRACT_LENGTH_STEPS || run.phase !== 'combat') {
        restart();
      }
    },

    /**
     * **HUD는 빠진다.** 목업 타이틀에 `hud` 칸이 없고(`00_title/scene.js`) 목업 엔진의
     * `drawHud`가 `if (!h) return`(`_shared/engine.js:1670`)으로 통째로 빠지기 때문이다.
     * 08 §6.1의 요소 표 13줄에도 HUD가 없다. 층 순서의 소유자는 `render/frame.ts` 하나이므로
     * 여기서 층을 다시 부르지 않고 `hudless`로 그 한 줄을 되살린다.
     */
    draw(ctx: CanvasRenderingContext2D, realDtSec: number): void {
      const view = buildFrameView({
        run,
        renderSeed,
        backgroundTimeSec,
        // 타이틀에는 HUD 음소거 표시가 없다. 상태는 `audio/mixer.ts`가 갖고 여기서는 안 읽는다
        muted: false,
        batch,
        shake: null,
        phaseTelegraphElapsedSec: 0,
        overlay: null,
        hudless: true,
      });
      drawFrame(ctx, shiftPlayer(view), { camera, particles, impact, playerFx, hudAnim, realDtSec });
    },

    dispose(): void {
      stopWatchingMotion();
      for (const off of offs) {
        off();
      }
      disposeRun(run);
      camera.dispose();
      particles.dispose();
      impact.dispose();
      discardEnemyBodyBakes();
      disposeStageBackground();
    },
  };
}

/** 위 `PLAYER_DRAW_OFFSET_YU` 주석이 이 함수의 계약 전부다. sim 좌표는 한 줄도 안 바뀐다 */
function shiftPlayer(view: FrameView): FrameView {
  return { ...view, player: { ...view.player, yU: view.player.yU + PLAYER_DRAW_OFFSET_YU } };
}

/**
 * `render/player.ts`는 버스를 직접 구독하지 않는다 — 화면마다 수명이 다른 상태라 소유자가
 * 넘긴다(`screens/play.ts`와 같은 규칙). 런이 갈리면 구독도 함께 갈아야 이전 런의 사건이
 * 새 런의 연출로 새지 않는다.
 */
function subscribePlayerFx(run: Run, playerFx: PlayerFxState): (() => void)[] {
  return (['parry', 'parryWhiff', 'cooldownReady', 'playerHit'] as const).map((kind) =>
    run.bus.on(kind, (event) => notifyPlayerFx(playerFx, event)),
  );
}

