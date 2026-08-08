/**
 * B4 대통 포병 대장 — 스펙 §10.5
 *
 * HP 2567 / 3페이즈 / 목표 격파 시간 32초.
 *
 * hp와 발수·간격은 difficulty.ts 헤더의 난이도 조정을 받은 값이고 § 뒤 숫자가 원값이다.
 *
 * 설계 의도(§10.5): 패리로 지울 수 없는 공간(장판 P9)이 쌓이며 이동 가능 면적이 줄어든다.
 * 패리 실력과 별개로 공간 관리를 요구하는 유일한 보스이므로, 장판을 만드는 자리를 빼면 이
 * 보스는 나머지 넷과 구별되지 않는다. `spawnsZone`이 붙은 두 자리가 그 자리다.
 *
 * §10.5의 「장판 동시 상한 6개」는 여기 없다. `BossDef`에 그 필드가 없고, §11.5 E06 카드가
 * 만드는 장판과도 상한을 공유하므로(§11.5) 보스 하나가 아니라 전역이 갖는 값이다.
 */
import type { BossDef } from '../types';
import {
  PATTERN_MORTAR_TELEGRAPH_SEC,
  PATTERN_RING_START_ANGLE_DEG,
  PATTERN_SPREAD_TELL_SEC,
} from './patterns';

export const BOSS_4 = {
  id: 'B4',
  name: '대통 포병 대장',
  hp: 1000,                     // §10.5 · §14.1 보스 HP 원값 3850 × 2/3
  targetKillSec: 32,            // §10.5 목표 격파 시간 (s)
  shape: 'artillery',           // render/boss.ts의 실루엣 키
  hitBox: { wU: 460, hU: 240 }, // §10.5 (u). 목업 08_boss4_daetong/scene.js:12

  phases: [
    {
      // §10.5 페이즈 1 (100% → 60%)
      hpThreshold: 1.00,        // §10.5 시작 페이즈
      onEnter: null,
      // §10.1 패턴은 순환한다. 무작위 선택이 아니다
      patterns: [
        {
          name: '곡사 포격',
          // §10.5 착탄 예고 원(반경 90u) 표시 1.2초 → 폭발. 각 폭발 지점에서 링 확산 +
          // 장판 P9 생성. spawnsZone이 없으면 장판을 만들 수단이 아예 없다 — 링은 onImpact가
          // 받지만 장판은 어느 kind도 못 만든다(12_통합_계약.md §10 E-08의 인접 판정).
          kind: 'mortar',
          count: 5,               // 예고 원 (개). §10.5 원값 3 × 0.7
          telegraphSec: PATTERN_MORTAR_TELEGRAPH_SEC, // §6.2 곡사 착탄 예고 원은 고정이다
          radiusU: 90,            // §10.5 예고 원 반경 (u)
          sequentialSec: 0.2,    // 원을 하나씩 띄우는 간격 (s). 목업 scene.js:29의 0.18 × 1.4
          // 추적 배치를 명시한 것은 페이즈 2 연쇄 포격뿐이다. 여기까지 추적하면 연쇄 포격이
          // 이 패턴과 구별되지 않는다.
          trackPlayer: false,     // §10.5 곡사 포격에는 추적 배치가 없다
          onImpact: {
            name: '폭발 링',
            kind: 'ring', bullet: 'P4',
            count: 6,             // 각 폭발 지점의 링 (발). §10.5 원값 8 × 0.7
            tellSec: PATTERN_SPREAD_TELL_SEC,            // §6.2 링의 예비동작은 스테이지와 무관하게 고정이다
            startAngleDeg: PATTERN_RING_START_ANGLE_DEG, // 스펙이 정하지 않은 자리. patterns.ts의 규약을 따른다
          },
          spawnsZone: { bullet: 'P9', radiusU: 90 },     // §6.1 P9 화염 장판 반경 90u
        },
        {
          name: '불화살 비',
          // §10.5 상단 전역에서 불화살이 순차 낙하. 착탄 시 장판 생성은 P8
          // 자신의 성질이라(§6.1) 여기서 다시 적지 않는다.
          // origin이 'topSpan'인 것이 「상단 전역」이다 — 보스 좌표에서 쏘면 낙하 위치 분포가
          // 통째로 달라지고 각도 무작위만으로는 표현되지 않는다(12_통합_계약.md §10 E-11).
          kind: 'barrage', bullet: 'P8',
          count: 20,               // 발. §10.5 원값 12 × 0.7
          durationSec: 2,      // 8발 × 0.42초 간격 (s). §10.5 원값 2.4 × 1.4
          speedUPerSec: 480,      // §6.1 P8 기본 속도 (u/s). 스테이지 탄속 배율은 sim이 따로 곱한다
          origin: 'topSpan',      // §10.5 「상단 전역」
          spanU: 840,             // 목업의 낙하 x 120~960 (u) — 08_boss4_daetong/scene.js:41
        },
      ],
    },
    {
      // §10.5 페이즈 2 (60% → 30%)
      hpThreshold: 0.60,          // §10.5 진입 HP 비율
      onEnter: null,
      patterns: [
        {
          name: '연쇄 포격',
          // §10.5 착탄 예고 원이 순차 표시·폭발. 예고 원은 플레이어 현재
          // 위치를 추적해 배치된다. onImpact와 spawnsZone이 둘 다 없는 것은 스펙이 이 패턴에
          // 후속을 주지 않아서다 — 위협은 폭발 자체이고, 추적 배치가 그것을 「서 있던 자리가
          // 계속 지워진다」로 만든다.
          kind: 'mortar',
          count: 10,               // 예고 원 (개). §10.5 원값 6 × 0.7
          telegraphSec: PATTERN_MORTAR_TELEGRAPH_SEC, // §6.2 곡사 착탄 예고 원은 고정이다
          radiusU: 90,            // §10.5 예고 원 반경 (u)
          sequentialSec: 0.3,    // 순차 표시 간격 (s). §10.5 원값 0.4 × 1.4
          trackPlayer: true,      // §10.5 플레이어 현재 위치를 추적해 배치한다
          onImpact: null,         // §10.5 후속 발사가 없다
        },
        {
          name: '대통 직사',
          // §10.5 대통 폭탄을 플레이어 방향으로 직사. 발수를 담은 열이 count가 아니라 repeat다.
          // BRP 70이라 반사 시 최대
          // 딜 기회이고, 그래서 이 패턴만은 조준이 스펙에 적혀 있다.
          // 확산이 아니라 volley다 — 04_밸런스_데이터_설계.md §8.1의 인용이 오기였다
          // (12_통합_계약.md §10 E-11).
          kind: 'volley', bullet: 'P7',
          count: 1,               // §10.5 한 번에 한 발
          // §6.2가 P7에 붙인 착탄 예고 원 1.2초는 곡사에 붙는 것이고 이 패턴은 직사다.
          tellSec: 0.65,          // §14.1 S4 단발 직선 발사 예비동작 (s). 연사 전체 앞에 한 번이다
          intervalSec: 0.5,      // 연사 간격 (s). §10.5 원값 0.6 × 1.4
          repeat: 5,              // 발수. §10.5 원값 3 × 0.7
          aim: 'player',          // §10.5 「플레이어 방향으로 직사」
          sourceSpread: 0,        // §10.5 본체 한 점에서 나간다 (u)
          from: 'boss',
        },
      ],
    },
    {
      // §10.5 페이즈 3 (30% → 0%)
      hpThreshold: 0.30,          // §10.5 진입 HP 비율
      onEnter: null,
      patterns: [
        {
          name: '화차 일제사격',
          // §10.5 신기전 다발 — 좁은 각도로 3웨이브, 좌 → 우 → 중앙.
          kind: 'spread', bullet: 'P10',
          count: 25,              // 웨이브당 발수. §10.5 원값 25 × 0.7
          halfAngleDeg: 6,        // §10.5 좁은 각도 ±6° (deg)
          tellSec: PATTERN_SPREAD_TELL_SEC, // §6.2 확산의 예비동작은 스테이지와 무관하게 고정이다
          sets: 3,                // §10.5 3웨이브
          setIntervalSec: 1.0,   // 웨이브 간격 (s). §10.5 원값 1.2 × 1.4
          // 배열 순서가 스펙의 「좌 → 우 → 중앙」 그대로다. 순서를 바꾸면 회피 방향의 학습이 뒤집힌다.
          setOriginsU: [-170, 170, 0], // 본체 폭 460u 안쪽의 좌·우 포구와 중앙 (u)
        },
        {
          name: '초토화',
          // §10.5 착탄 예고 원 + 불화살 비 동시 진행. 후속을 하나만 붙이는 onImpact로는
          // 병렬을 못 만든다(12_통합_계약.md §10 E-08).
          kind: 'parallel',
          parts: [
            {
              name: '집중 곡사',
              // §10.5가 이 자리에 「예고 원 4개」만 적었으므로 페이즈 1과 달리 링은 붙지 않고
              // 장판만 남는다.
              kind: 'mortar',
              count: 10,           // 예고 원 (개). §10.5 원값 4 × 0.7
              telegraphSec: PATTERN_MORTAR_TELEGRAPH_SEC, // §6.2 곡사 착탄 예고 원은 고정이다
              radiusU: 90,        // §10.5 예고 원 반경 (u)
              sequentialSec: 0.2, // 원을 하나씩 띄우는 간격 (s). 목업 scene.js:29의 0.18 × 1.4
              trackPlayer: false, // §10.5 추적 배치는 연쇄 포격만 갖는다
              onImpact: null,     // §10.5 링이 붙지 않는다
              spawnsZone: { bullet: 'P9', radiusU: 90 }, // §6.1 P9 화염 장판 반경 90u
            },
            {
              name: '불화살 비',
              // §10.5 페이즈 1과 같은 편성이다
              kind: 'barrage', bullet: 'P8',
              count: 30,           // 발. §10.5 원값 12 × 0.7
              durationSec: 2.0,  // 8발 × 0.42초 간격 (s). §10.5 원값 2.4 × 1.4
              speedUPerSec: 480,  // §6.1 P8 기본 속도 (u/s)
              origin: 'topSpan',  // §10.5 「상단 전역」
              spanU: 840,         // 목업의 낙하 x 120~960 (u) — 08_boss4_daetong/scene.js:41
            },
          ],
        },
      ],
    },
  ],

  // §10.1 공통 규칙 셋은 여기 없다 — bosses/index.ts의 BOSS_COMMON이 갖는다(12 §10 E-12).
} as const satisfies BossDef;
