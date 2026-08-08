/**
 * B2 왜장 사무라이 대장 — 스펙 §10.3
 *
 * HP 600 / 3페이즈 / 목표 격파 27초. 본체가 직접 접근하는 근접형이고, 패리 불가 위협(본체)과
 * 패리 가능 위협(참격파)을 동시에 다루게 하는 것이 §10.3의 설계 의도다.
 *
 * hp와 발수·간격은 체감으로 다시 세운 값이다 — 주석의 「원값」이 스펙 숫자이고 둘을 잇는 배율은 없다(difficulty.ts 헤더).
 *
 * 이 보스가 HR-05의 대응 관계를 처음 명확히 보여 준다 — 돌진에는 방향선이 붙고 참격파에는
 * 붙지 않는다. 그래서 arc의 `backswingSec`(예비동작)과 charge의 `telegraphSec`(예고 도형)은
 * 이름이 다르고, 둘을 같은 필드로 합치면 그 대비가 데이터에서 사라진다.
 *
 * 페이즈별 패턴 목록은 §10.3이 정한 그대로다. 목업 04_boss2_samurai/scene.js:33이 페이즈 2
 * 화면에 페이즈 1의 투척 수리검을 섞어 그렸지만 그것은 정지 프레임을 채우려던 것이고,
 * 페이즈 2에 수리검은 없다(10_스펙_목업_불일치.md A18).
 */
import type { BossDef, BossPattern } from '../types';
import {
  PATTERN_ARC_BACKSWING_SEC,
  PATTERN_CHARGE_TELEGRAPH_SEC,
  PATTERN_RING_START_ANGLE_DEG,
  PATTERN_SPREAD_TELL_SEC,
} from './patterns';

/**
 * §10.3 돌진 종료 지점의 링
 *
 * 페이즈 2 「돌진 베기」와 페이즈 3 「돌진 베기 + 수리검」이 같은 것을 쓴다. 페이즈 3 항목의
 * 이름이 `돌진 베기 + 수리검`이고 본문은 더해지는 것(돌진 중 수리검)만 적었으므로, 「돌진 베기」
 * 자체는 §10.3 페이즈 2가 정의한 형태 그대로다 — 종료 링을 포함한다.
 * 한 벌만 두는 이유는 그것이 하나의 패턴이기 때문이고, 두 벌로 적으면 한쪽만 고쳐 두 돌진의
 * 마무리가 조용히 갈린다.
 */
const DASH_END_RING = {
  name: '돌진 종료 링',
  kind: 'ring', bullet: 'P4', count: 8,        // 링 (발). §10.3 원값 12
  tellSec: PATTERN_SPREAD_TELL_SEC,            // §6.2 링의 예비동작은 스테이지와 무관하게 고정이다
  startAngleDeg: PATTERN_RING_START_ANGLE_DEG, // §10.3 스펙이 정하지 않은 자리. patterns.ts의 규약을 따른다
} as const satisfies BossPattern;

export const BOSS_2 = {
  id: 'B2',
  name: '왜장 사무라이 대장',
  hp: 600,                     // §10.3 · §10.7 요약표 원값 2250
  targetKillSec: 27,            // §10.3 목표 격파 시간 (s)
  shape: 'samurai',             // §10.3 render/boss.ts의 실루엣 키
  hitBox: { wU: 240, hU: 300 }, // §10.3 목업 04_boss2_samurai/scene.js:12 실측 (u). B1보다 좁고 높다

  phases: [
    {
      // §10.3 페이즈 1 (100% → 65%)
      hpThreshold: 1.00,          // §10.3 시작 페이즈
      onEnter: null,
      // §10.1 순환이다. 배열 순서가 곧 `참격파 → 투척 수리검 → 반복`이다.
      patterns: [
        {
          name: '참격파',
          // §10.3 백스윙 0.7초 → 초승달 참격탄(P5) 연발.
          // alternate가 false인 이유: 좌우 교차를 요구한 것은 페이즈 2의 참격파 강화부터이고,
          // 그 대비가 페이즈가 올라갔다는 유일한 신호다.
          kind: 'arc', bullet: 'P5', count: 5,   // 연발 (발). §10.3 원값 3
          backswingSec: PATTERN_ARC_BACKSWING_SEC, // §6.2 참격파 백스윙은 고정이다
          intervalSec: 0.5,       // 연발 간격 (s). §10.3 원값 0.5
          alternate: false,
        },
        {
          name: '투척 수리검',
          // §10.3 확산(P4, ±36°) 2세트.
          // 36은 반각이다 — 최외곽 탄이 조준선에서 몇 도 떨어지는가를 뜻한다. 목업
          // 04_boss2_samurai/scene.js:38의 k × 0.628 rad은 최외곽이 ±72°라 두 배로 틀렸다
          // (10_스펙_목업_불일치.md A5). 4발이면 간격이 24°가 되어야 ±36°에 맞는다.
          kind: 'spread', bullet: 'P4', count: 10, // 확산 (발). §10.3 원값 5
          halfAngleDeg: 60,       // §10.3 확산 반각 (deg)
          tellSec: PATTERN_SPREAD_TELL_SEC, // §6.2 확산의 예비동작은 스테이지와 무관하게 고정이다
          sets: 2,                // §10.3 2세트
          setIntervalSec: 1.0,    // 세트 간격 (s). §10.3 원값 1.0
        },
      ],
    },
    {
      // §10.3 페이즈 2 (65% → 30%)
      hpThreshold: 0.65,          // §10.3 진입 HP 비율
      onEnter: null,
      // §10.3이 이 페이즈에 준 패턴은 둘뿐이다. 투척 수리검은 여기 없다(A18).
      patterns: [
        {
          name: '돌진 베기',
          // §10.3 플레이어 위치로 돌진 방향선 1.0초 → 직선 돌진(본체 접촉 피해, 속도 900 u/s).
          // 돌진 종료 지점에서 링(P4).
          kind: 'charge',
          telegraphSec: PATTERN_CHARGE_TELEGRAPH_SEC, // §6.2 돌진 방향선은 고정이다. HR-05의 예고 도형 3종 중 하나
          speedUPerSec: 900,      // §10.3 돌진 속도 (u/s)
          safeCorridorU: 160,     // §10.3 · HR-04 돌진 경로 폭 (u). 이 폭 밖 전 영역이 안전 지대다
          targetYU: null,         // §10.3 목표 y가 아니라 플레이어 위치로 돌진한다
          holdSec: 0,             // §10.3 유지 시간 (s). 스펙이 주지 않았다 — 유지가 있는 것은 §10.4·§10.6의 충각 돌진뿐이다
          returnToStart: true,    // HR-08 보스는 항상 상단 영역에 머문다. 돌진은 그 예외이므로 끝나면 되돌아가야 한다
          onEnd: DASH_END_RING,
        },
        {
          name: '참격파 강화',
          // §10.3 참격파 연발, 좌우 교차.
          kind: 'arc', bullet: 'P5', count: 8,   // 연발 (발). §10.3 원값 4
          backswingSec: PATTERN_ARC_BACKSWING_SEC, // §6.2 강화되어도 백스윙은 그대로다
          intervalSec: 0.3,      // 연발 간격 (s). §10.3 원값 0.4
          alternate: true,
        },
      ],
    },
    {
      // §10.3 페이즈 3 (30% → 0%)
      hpThreshold: 0.30,          // §10.3 진입 HP 비율
      onEnter: null,
      patterns: [
        {
          name: '이도류 난무',
          // §10.3 참격파 연발을 좌우 교차로.
          kind: 'arc', bullet: 'P5', count: 12,   // 연발 (발). §10.3 원값 6
          backswingSec: PATTERN_ARC_BACKSWING_SEC, // §6.2 백스윙은 여기서도 고정이다
          intervalSec: 0.3,      // 연발 간격 (s). §10.3 원값 0.3
          alternate: true,
        },
        {
          name: '돌진 베기 + 수리검',
          // §10.3 돌진 중 일정 간격으로 수리검을 흘리며 이동. 돌진 자체는 페이즈 2와 같은 형태다.
          // duringInterval이 없으면 이 줄을 적을 방법이 없다 — onEnd는 종료 시점만 주므로
          // 돌진 도중을 표현하지 못한다(12_통합_계약.md §10 E-11).
          kind: 'charge',
          telegraphSec: PATTERN_CHARGE_TELEGRAPH_SEC, // §6.2 돌진 방향선 (s)
          speedUPerSec: 900,      // §10.3 돌진 속도 (u/s)
          safeCorridorU: 160,     // §10.3 · HR-04 돌진 경로 폭 (u)
          targetYU: null,         // §10.3 플레이어 위치로 돌진한다
          holdSec: 0,             // §10.3 유지 시간 (s)
          returnToStart: true,    // HR-08
          duringInterval: { bullet: 'P4', intervalSec: 0.28 }, // 돌진 중 수리검 간격 (s). §10.3 원값 0.2
          onEnd: DASH_END_RING,
        },
      ],
    },
  ],

  // §10.1 공통 규칙 셋은 여기 없다 — bosses/index.ts의 BOSS_COMMON이 갖는다(12 §10 E-12).
} as const satisfies BossDef;
