/**
 * B5 왜 수군 총대장 기함 — 스펙 §10.6
 *
 * HP 5100 / 4페이즈 / 목표 격파 시간 37초. 앞선 네 보스의 대표 패턴을 순서대로 재구성한 복합
 * 보스이고 새 규칙은 하나도 도입하지 않는다 — 페이즈가 조총 · 함포 · 백병 · 전부 순이다.
 *
 * 페이즈 4만 `patternOrder`가 'randomNoRepeat'이고 나머지 셋은 §10.1의 고정 순환이다. 페이즈 4에
 * 제한 시간은 없다 — 시간 초과 즉사는 최후 보스를 「버티면 죽는」 구간으로 바꾸는데, 이 게임의
 * 실패는 언제나 패리를 놓쳐서 나야 한다(§10.6).
 *
 * 목업이 선체 위에 따로 얹은 총대장 본체 220 × 240(10_boss5_flagship/scene.js:14)은 여기 없다.
 * `BossDef.hitBox`는 하나뿐이고, `BossPartDef`는 hp와 bullet을 요구하는데 총대장 본체는 따로
 * 파괴되지 않으므로 부위가 아니다.
 */
import type { BossDef } from '../types';
import {
  PATTERN_ARC_BACKSWING_SEC,
  PATTERN_CHARGE_TELEGRAPH_SEC,
  PATTERN_MORTAR_TELEGRAPH_SEC,
  PATTERN_RING_START_ANGLE_DEG,
  PATTERN_SPREAD_TELL_SEC,
} from './patterns';

export const BOSS_5 = {
  id: 'B5',
  name: '왜 수군 총대장 기함',
  hp: 5100,                     // §10.6 · §14.1 보스 HP
  targetKillSec: 37,            // §10.6 목표 격파 시간 (s)
  shape: 'warship',             // render/boss.ts의 실루엣 키. B3 아타케부네와 같은 키를 쓴다
  hitBox: { wU: 900, hU: 260 }, // §10.6 선체 (u). 목업 10_boss5_flagship/scene.js:13

  phases: [
    {
      // §10.6 페이즈 1 (100% → 75%) — 조총 계열
      hpThreshold: 1.00,        // §10.6 시작 페이즈
      onEnter: null,
      // §10.1 패턴은 순환한다. 무작위 선택이 아니다
      patterns: [
        {
          name: '총력 일제사격',
          // §10.6 발사 예비동작 0.5초, 9발 직선, 2회 반복.
          // §10.2 B1 일제사격의 재구성이므로 aim은 'down'이다 — 스펙이 여기서는 「직선」이라고만
          // 적었고, 조준을 요구한 자리(§10.5 대통 직사, §10.4 화공선)와 표현이 다르다.
          kind: 'volley', bullet: 'P2',
          count: 9,               // §10.6 9발
          tellSec: 0.5,           // §10.6 발사 예비동작 (s). 스펙이 이 패턴에 직접 준 값이다
          intervalSec: 1.2,       // 반복 간격 (s). §10.6이 침묵한다 — B1의 1.4초보다 짧게 둔다
          repeat: 2,              // §10.6 2회 반복
          aim: 'down',            // §10.6 「직선」. 조준을 요구한 자리와 표현이 다르다
          sourceSpread: 780,      // 목업 전탄 발사의 조총 발사원 x 150~930 (u) — scene.js:28
          from: 'boss',
        },
        {
          name: '난사 강화',
          // §10.6 30발 무작위 확산, 1.5초.
          // 「강화」가 올리는 것은 발수 20 → 30뿐이다. 탄속까지 올리면 §14.2의 축 1과 축 3을
          // 한 패턴에서 같이 미는 셈이 된다.
          kind: 'barrage', bullet: 'P2',
          count: 30,              // §10.6 30발
          durationSec: 1.5,       // §10.6 확산에 걸리는 시간 (s)
          speedUPerSec: 550,      // §10.2 B1 난사가 준 속도 (u/s)
          origin: 'boss',         // §10.6 발사원은 본체다
        },
      ],
    },
    {
      // §10.6 페이즈 2 (75% → 50%) — 함포 계열
      hpThreshold: 0.75,          // §10.6 진입 HP 비율
      onEnter: null,
      patterns: [
        {
          name: '전현 포격',
          // §10.6 함포탄 6발 동시, 발사 예비동작 0.6초.
          // aim 'down'은 스펙이 「동시」만 적은 자리의 판단이다. P6는 300 u/s로 가장 느려서
          // 커튼으로 내려와도 읽히고, 6발을 한 점에 모으면 §5.5 원형 거울 반사의 출발 각도가
          // 전부 같아져 어느 방향으로 되돌릴지가 사라진다.
          kind: 'volley', bullet: 'P6',
          count: 6,               // §10.6 6발
          tellSec: 0.6,           // §10.6 발사 예비동작 (s). 스펙이 이 패턴에 직접 준 값이다
          intervalSec: 0,         // §10.6 「동시」 (s)
          repeat: 1,              // §10.6 연사가 아니다
          aim: 'down',            // §10.6 「동시」. 조준이 적혀 있지 않다
          sourceSpread: 780,      // 선체 900u 안쪽의 현측 발사 구간 (u)
          from: 'boss',
        },
        {
          name: '충각 돌진',
          // §10.6 y=1200까지 하강, 2.5초 유지.
          kind: 'charge',
          telegraphSec: PATTERN_CHARGE_TELEGRAPH_SEC, // §6.2 돌진 방향선. HR-05의 예고 도형 3종 중 하나
          speedUPerSec: 620,      // 돌진 속도 (u/s). §10.4 B3 충각의 520보다 빠르다 — §14.2 축 1
          safeCorridorU: 200,     // §10.6 · HR-04 안전 지대 좌우 폭 200u
          targetYU: 1200,         // §10.6 도달 목표 y (u)
          holdSec: 2.5,           // §10.6 유지 시간 (s)
          returnToStart: true,    // HR-08 보스는 상단 영역에 머문다. 돌진이 그 예외이므로 되돌아간다
          onEnd: null,            // §10.6 종료 시 추가 발사가 없다
        },
      ],
    },
    {
      // §10.6 페이즈 3 (50% → 25%) — 백병전
      hpThreshold: 0.50,          // §10.6 진입 HP 비율
      onEnter: null,
      // §10.6 「총대장 본체가 갑판으로 나와」. 이 페이즈 동안 판정 도형이 선체가 아니라
      // 갑판 위 총대장이다 — 목업 10_boss5_flagship/scene.js:14의 hitW · hitH 실측 (u)
      bodyHitBox: { wU: 220, hU: 240 },
      patterns: [
        {
          name: '총대장 등판',
          // §10.6 총대장 본체가 갑판으로 나와 참격파 5연발 좌우 교차.
          kind: 'arc', bullet: 'P5',
          count: 5,               // §10.6 5연발
          backswingSec: PATTERN_ARC_BACKSWING_SEC, // §6.2 참격파의 백스윙은 스테이지와 무관하게 고정이다
          intervalSec: 0.35,      // 연발 간격 (s). §10.6이 침묵한다 — §10.3의 4연발 0.4초와 6연발 0.3초 사이다
          alternate: true,        // §10.6 좌우 교차
        },
        {
          name: '이도류 돌진',
          // §10.6 돌진 방향선 1.0초 후 돌진, 종료 지점에서 링 16발.
          // targetYU가 null이라 §10.3 B2 돌진 베기처럼 플레이어 위치로 간다. 충각 돌진과 달리
          // 선체가 아니라 총대장 본체가 나가는 근접 돌진이고, 그래서 속도와 경로 폭도 §10.3이
          // 그 돌진에 준 값을 그대로 쓴다.
          kind: 'charge',
          telegraphSec: PATTERN_CHARGE_TELEGRAPH_SEC, // §6.2 돌진 방향선 (s)
          speedUPerSec: 900,      // §10.3 본체 돌진 속도 (u/s)
          safeCorridorU: 160,     // §10.3 · HR-04 돌진 경로 폭 (u)
          targetYU: null,         // §10.6 플레이어 위치로 돌진한다
          holdSec: 0,             // §10.6 유지가 없다 (s). 유지가 붙는 것은 충각 돌진뿐이다
          returnToStart: true,    // HR-08 상단 정위치로 되돌아간다
          onEnd: {
            name: '돌진 종료 링',
            kind: 'ring', bullet: 'P4',
            count: 16,            // §10.6 종료 지점에서 링 16발
            tellSec: PATTERN_SPREAD_TELL_SEC,            // §6.2 링의 예비동작은 스테이지와 무관하게 고정이다
            startAngleDeg: PATTERN_RING_START_ANGLE_DEG, // 스펙이 정하지 않은 자리. patterns.ts의 규약을 따른다
          },
        },
      ],
    },
    {
      // §10.6 페이즈 4 (25% → 0%) — 최후 발악
      hpThreshold: 0.25,          // §10.6 진입 HP 비율
      onEnter: null,
      // §10.6 페이즈 4만 무작위 순환이고 직전 패턴은 제외한다. 나머지 셋은 §10.1의 고정 순환이다
      patternOrder: 'randomNoRepeat',
      patterns: [
        {
          name: '전탄 발사',
          // §10.6 링 탄막 20발 + 조총 일제 7발 + 함포탄 4발 동시.
          // 자식 셋의 tellSec이 같아야 스펙의 「동시」가 성립한다. 스펙이 이 자리에서 동시 발사를
          // 직접 요구했으므로 tellSec 계약 ③의 형태별 기본값(링 0.4 · 단발 직선 S5 0.55)이 갈라
          // 놓는 것을 허용할 수 없고, 목업이 세 발사에 하나로 준 tell 0.5를 쓴다(scene.js:25).
          kind: 'parallel',
          parts: [
            {
              name: '링 탄막',
              kind: 'ring', bullet: 'P4',
              count: 20,          // §10.6 링 20발
              tellSec: 0.5,       // 목업 10_boss5_flagship/scene.js:25의 tell (s). 자식 셋이 같아야 한다
              startAngleDeg: PATTERN_RING_START_ANGLE_DEG, // 스펙이 정하지 않은 자리. patterns.ts의 규약을 따른다
            },
            {
              name: '조총 일제',
              kind: 'volley', bullet: 'P2',
              count: 7,           // §10.6 조총 일제 7발
              tellSec: 0.5,       // 목업 scene.js:25의 tell (s). 자식 셋이 같아야 「동시」가 된다
              intervalSec: 0,     // §10.6 「동시」 (s)
              repeat: 1,          // §10.6 연사가 아니다
              aim: 'player',      // 목업 scene.js:28이 aimAt을 쓴다
              sourceSpread: 780,  // 목업의 발사원 x 150~930 (u) — scene.js:28
              from: 'boss',
            },
            {
              name: '함포 일제',
              kind: 'volley', bullet: 'P6',
              count: 4,           // §10.6 함포탄 4발
              tellSec: 0.5,       // 목업 scene.js:25의 tell (s). 자식 셋이 같아야 「동시」가 된다
              intervalSec: 0,     // §10.6 「동시」 (s)
              repeat: 1,          // §10.6 연사가 아니다
              aim: 'player',      // 목업 scene.js:30이 aimAt을 쓴다
              sourceSpread: 630,  // 목업의 발사원 x 220~850 (u) — scene.js:30
              from: 'boss',
            },
          ],
        },
        {
          name: '화공 총공세',
          // §10.6 착탄 예고 원 5개 + 불화살 비 15발(12_통합_계약.md §10 E-08).
          kind: 'parallel',
          parts: [
            {
              name: '집중 곡사',
              // §10.6이 링을 붙이지 않았으므로 장판만 남는다.
              kind: 'mortar',
              count: 5,           // §10.6 예고 원 5개
              telegraphSec: PATTERN_MORTAR_TELEGRAPH_SEC, // §6.2 곡사 착탄 예고 원은 고정이다
              radiusU: 90,        // §6.1 P9 화염 장판 반경에 맞춘 예고 원 반경 (u)
              sequentialSec: 0.12, // 목업이 원을 하나씩 띄우는 간격 (s) — 10_boss5_flagship/scene.js:41
              trackPlayer: false, // §10.6 추적 배치가 적혀 있지 않다
              onImpact: null,     // §10.6 링이 붙지 않는다
              spawnsZone: { bullet: 'P9', radiusU: 90 }, // §6.1 P9 화염 장판 반경 90u
            },
            {
              name: '불화살 비',
              kind: 'barrage', bullet: 'P8',
              count: 15,          // §10.6 불화살 비 15발
              durationSec: 2.7,   // 15발 × 0.18초 간격 (s). 간격은 목업 scene.js:36의 값이다
              speedUPerSec: 480,  // §6.1 P8 기본 속도 (u/s)
              origin: 'topSpan',  // §10.5 불화살 비는 상단 전역에서 낙하한다
              spanU: 880,         // 목업의 낙하 x 100~980 (u) — 10_boss5_flagship/scene.js:36
            },
          ],
        },
      ],
      /**
       * §10.6 관통 대창 — 세로 3줄, 예고선 0.8초 → 0.4초 관통
       *
       * 스펙은 이것을 페이즈 4 순환의 셋째 패턴으로 적었지만 `BossPattern`이 아니다. §9.7 S5 W4의
       * 배경 함대와 `sim/lance.ts` 하나를 공유하기 때문이고, 그래서 `patterns`가 둘이고 셋째가
       * 여기 있다(12_통합_계약.md §10 E-10).
       *
       * 줄의 x 좌표는 `LanceDef`에 자리가 없다. 목업의 200 · 540 · 880을 `sim/lance.ts`가 갖는다
       * (10_boss5_flagship/scene.js:60) — 줄 간격 340u에서 폭 40u를 빼면 통로가 300u라 아래
       * `safeCorridorU`를 넘긴다.
       *
       * `intervalSec`는 스펙이 침묵한 자리다. 위 두 패턴이 한 바퀴 도는 데 걸리는 시간에 맞춰
       * 스펙의 3패턴 순환 중 1/3 빈도를 재현한다 — 순환에 낄 수 없는 이상 빈도를 낼 수단이
       * 간격뿐이다.
       */
      lance: {
        intervalSec: 5.5,     // 반복 간격 (s). §10.6의 3패턴 순환 중 1/3 빈도에 맞춘 값이다
        lanes: 3,             // §10.6 세로 3줄
        telegraphSec: 0.8,    // §6.2 관통 대창 예고선은 0.8초 고정이다
        activeSec: 0.4,       // §10.6 예고선이 사라진 뒤 관통 판정이 살아 있는 시간 (s)
        safeCorridorU: 200,   // §10.6 · HR-04 줄 사이 안전 지대 폭 (u)
      },
    },
  ],

  // §10.1 공통 규칙 셋은 여기 없다 — bosses/index.ts의 BOSS_COMMON이 갖는다(12 §10 E-12).
} as const satisfies BossDef;
