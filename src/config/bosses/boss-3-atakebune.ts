/**
 * B3 아타케부네 기함 — 스펙 §10.4
 *
 * 본체 HP 800 / 3페이즈 / 목표 격파 시간 29초. §10.7 요약표의 3200은 본체 2000 + 포문 4 × 300의
 * 합계이고 `BossDef.hp`가 단일 소스이므로 그 필드에는 본체 HP만 들어간다(12_통합_계약.md §5).
 * B1이 쓰는 「§10.7 요약표와 그대로 대조」하는 단언을 이 보스에 쓰면 안 된다 — 다섯 중 B3만
 * 요약표 값이 본체 + 부위 합계다(04_밸런스_데이터_설계.md §8.1-B).
 *
 * hp와 발수·간격은 체감으로 다시 세운 값이다 — 주석의 「원값」이 스펙 숫자이고 둘을 잇는 배율은 없다(difficulty.ts 헤더).
 * **본체와 포문이 같은 × 2/3을 받아야 합계가 요약표 × 2/3(=2133)이 된다** — 한쪽만 줄이면
 * 「어느 포문을 먼저 부술지」의 비용 대비가 조용히 틀어진다.
 *
 * 설계 의도(§10.4): 저속 대형탄 위주라 개별 패리는 쉽고, 대신 **어느 포문을 먼저 부술지**가
 * 다른 넷은 묻지 않는 결정으로 들어온다. 원형 거울 반사로 좌우 포문을 노리려면 몸을 그쪽으로
 * 옮겨야 하므로, 포문 넷의 `offsetU`를 좁히면 이 보스의 유일한 새 축이 사라진다.
 */
import type { BossDef, BossPattern } from '../types';
import {
  PATTERN_CHARGE_TELEGRAPH_SEC,
  PATTERN_RING_START_ANGLE_DEG,
  PATTERN_SPREAD_TELL_SEC,
} from './patterns';

/**
 * §10.4 갑판 조총 사격 — 페이즈 1과 2가 같은 것을 쓴다
 *
 * **페이즈 2에 이것이 있는 이유는 §10.4가 아니라 HR-03이다.** 그 페이즈의 스펙 패턴은 충각
 * 돌진과 교차 포격 둘인데 교차 포격이 `from: 'partsAlternating'`이라, 포문 4기가 전부 부서지면
 * `sim/boss-shots.ts`가 한 발도 내지 않는다 — 그 침묵이 예비동작 0.75초 + 15연사 × 0.5초 +
 * 패턴 간격 0.8초로 9초가 되어 적 탄환 공백 2.0초를 깬다. HR-01상 적 탄환이 유일한 탄약이라
 * 그 9초는 데미지를 넣을 수단이 없는 구간이기도 하다.
 *
 * 본체 발사원을 하나 더 두는 쪽을 골랐다 — 교차 포격이 포문을 잃으면 조용해지는 것 자체는
 * §10.4가 「본체가 대신 쏘지 않는다」로 못 박은 규칙이고, 그것을 뒤집으면 포문 파괴의 보상이
 * 사라진다. 두 페이즈가 한 벌을 공유하는 것은 두 벌로 적으면 한쪽만 늙기 때문이다.
 */
const DECK_MATCHLOCK_VOLLEY = {
  name: '갑판 조총 사격',
  // §10.4 갑판 조총병 실루엣에서 소형 고속탄 산발. 발수를 담은 열이 count가 아니라 repeat다.
  // tellSec은 연사 전체 앞에 한 번이고 repeat마다 다시 붙지 않는다
  // (types-content.ts의 tellSec 계약 ①). 스펙이 이 패턴의 예비동작을 직접 주지 않았고
  // 단발 직선이므로 §14.1의 스테이지 값을 읽는다(계약 ③).
  kind: 'volley', bullet: 'P2',
  count: 1,               // §10.4 한 번에 한 발씩 흘린다
  tellSec: 0.75,          // §14.1 S3 단발 직선 발사 예비동작 (s)
  intervalSec: 0.2,       // §10.4 산발 간격 (s)
  repeat: 10,             // §10.4 발수
  aim: 'player',          // §10.4가 침묵하는 자리. 목업 scene.js:41이 aimAt을 쓴다
  sourceSpread: 630,      // §10.4 갑판 발사원 폭 (u). 목업 x 240~870 — scene.js:41
  from: 'boss',
} as const satisfies BossPattern;

export const BOSS_3 = {
  id: 'B3',
  name: '아타케부네 기함',
  hp: 800,                     // 본체 HP. §10.4 원값 2000. 포문은 parts가 따로 갖는다
  targetKillSec: 29,            // §10.4 목표 격파 시간 (s)
  shape: 'warship',             // render/boss.ts의 실루엣 키. B5 기함과 같은 키를 쓴다
  hitBox: { wU: 860, hU: 250 }, // §10.4 선체 (u). 목업 06_boss3_atakebune/scene.js:15

  /**
   * §10.4 · §15.1 파괴 가능 포문 4기
   *
   * hp 200은 §10.4가 따로 못 박은 300을 체감으로 내린 값이다. `enemies.ts`의 'E-I' 200 ×
   * 스테이지 HP 배율과 별개이므로 스테이지 3의 배율이 이 값에 걸리지 않는다.
   *
   * `offsetU`는 목업 좌표에서 본체 (540, 330)을 뺀 것이다 — 포문 (190,430) (400,450) (680,450)
   * (890,430)(06_boss3_atakebune/scene.js:16-19).
   *
   * `hitBox` 96 × 63은 `drawEnemy`의 port case가 그리는 판재 사각형 그대로다. w = 96(engine.js:64),
   * h = w × 1.05(engine.js:434), 판재가 −h × 0.28 ~ h × 0.34를 덮으므로 세로가 0.62h = 62.5다
   * (engine.js:639-640). 목업의 명중 판정은 원 w × 0.6 = 57.6이라 세로가 이보다 넓은데, 선체와
   * 겹치는 영역에서 포문이 먼저 판정을 가져가려면 사각형이어야 한다(12_통합_계약.md §10 E-04).
   */
  parts: [
    { id: 'port-1', hp: 200, offsetU: { xU: -350, yU: 100 }, hitBox: { wU: 96, hU: 63 }, bullet: 'P6' },
    { id: 'port-2', hp: 200, offsetU: { xU: -140, yU: 120 }, hitBox: { wU: 96, hU: 63 }, bullet: 'P6' },
    { id: 'port-3', hp: 200, offsetU: { xU:  140, yU: 120 }, hitBox: { wU: 96, hU: 63 }, bullet: 'P6' },
    { id: 'port-4', hp: 200, offsetU: { xU:  350, yU: 100 }, hitBox: { wU: 96, hU: 63 }, bullet: 'P6' },
  ],

  phases: [
    {
      // §10.4 페이즈 1
      hpThreshold: 1.00,        // §10.4 시작 페이즈
      onEnter: null,
      // §10.1 패턴은 순환한다. 무작위 선택이 아니다
      patterns: [
        {
          name: '좌현 일제포격',
          // §10.4 살아있는 포문에서 함포탄 각 1발, 동시 발사. 발사 예비동작 0.75초.
          // 포문이 줄면 이 패턴의 발수가 그대로 줄어든다 — 그것이 부위 파괴의 보상이다.
          kind: 'volley', bullet: 'P6',
          count: 1,               // §10.4 발사원 하나당 발수. from이 'parts'라 살아남은 포문 수만큼 나간다
          tellSec: 0.75,          // §10.4 발사 예비동작 (s). 스펙이 이 패턴에 직접 준 값이다
          intervalSec: 0,         // §10.4 「동시 발사」 (s)
          repeat: 1,              // §10.4 연사가 아니다
          aim: 'player',          // §10.4가 침묵하는 자리. 목업이 포문마다 aimAt을 쓴다(scene.js:31)
          sourceSpread: 0,        // §10.4 발사원 위치는 parts의 offsetU가 이미 정한다 (u)
          from: 'parts',
        },
        DECK_MATCHLOCK_VOLLEY,
      ],
    },
    {
      /**
       * §10.4 페이즈 2
       *
       * 진입 조건이 HP 하나가 아니다 — 포문 2개 파괴 **또는** 본체 HP 60% 이하이고 먼저 만족한
       * 쪽이 이긴다. `hpThreshold`만 두면 포문을 넷 다 부숴도 페이즈가 안 넘어가고, 그러면
       * §10.4가 이 보스의 유일한 새 축이라고 적은 표적 선택이 진행에 아무 영향을 주지 못한다
       * (04_밸런스_데이터_설계.md §8.1-B).
       */
      hpThreshold: 0.60,          // §10.4 진입 HP 비율
      partsDestroyedThreshold: 2, // §10.4 파괴된 포문 수. hpThreshold와 OR이다
      onEnter: null,
      patterns: [
        {
          name: '충각 돌진',
          // §10.4 함선이 y=1100까지 밀고 내려온 뒤 3초 유지, 복귀.
          // speedUPerSec는 스펙이 침묵한다. 본체 돌진 속도를 준 곳은 §10.3 B2의 900 u/s뿐인데,
          // 폭 860u짜리 선체가 그 속도로 내려오면 방향선 1.0초 말고는 비켜설 시간이 없다.
          kind: 'charge',
          telegraphSec: PATTERN_CHARGE_TELEGRAPH_SEC, // §6.2 돌진 방향선. HR-05의 예고 도형 3종 중 하나
          speedUPerSec: 520,      // 돌진 속도 (u/s). y 330 → 1100의 770u를 1.48초에 지난다
          safeCorridorU: 240,     // §10.4 · HR-04 안전 지대는 좌우 각 폭 240u
          targetYU: 1100,         // §10.4 도달 목표 y (u)
          holdSec: 3.0,           // §10.4 유지 시간 (s)
          returnToStart: true,    // §10.4 복귀한다. HR-08의 상단 정위치로 돌아간다
          // 하강 1.48초 + 유지 3.0초 + 복귀 1.48초 동안 이 보스는 다른 발사원이 없다. 그 6초는
          // HR-03(적 탄환 공백 2.0초)을 깨고, HR-01상 적 탄환이 유일한 탄약이므로 동시에
          // 「데미지를 넣을 수단이 없는 6초」다. §10.4가 이 패턴에 발사를 주지 않았으므로
          // 스펙에 없는 값이고, 함포탄인 것은 이 보스의 나머지 발사가 전부 P6이기 때문이다
          duringInterval: { bullet: 'P6', intervalSec: 0.8 }, // 흘리는 간격 (s)
          onEnd: null,            // §10.4 종료 시 추가 발사가 없다
        },
        {
          name: '교차 포격',
          // §10.4 좌우 포문이 번갈아 발사.
          // repeat가 「총 발수」다 — 포문이 파괴돼도 발수는 줄지 않고 남은 쪽이 이어 쏜다.
          kind: 'volley', bullet: 'P6',
          count: 1,               // §10.4 한 차례에 한 포문이 한 발
          tellSec: 0.75,          // §14.1 S3 단발 직선 발사 예비동작 (s). 연사 전체 앞에 한 번이다
          intervalSec: 0.5,      // 교차 간격 (s). §10.4 원값 0.4
          repeat: 15,              // 총 발수. §10.4 원값 8
          aim: 'player',          // §10.4가 침묵하는 자리. 좌현 일제포격과 같은 포문이다
          sourceSpread: 0,        // §10.4 발사원 위치는 parts의 offsetU가 정한다 (u)
          from: 'partsAlternating',
        },
        // §10.4의 페이즈 2 목록에 없다. 위 상수 주석의 HR-03이 이 한 줄의 근거다
        DECK_MATCHLOCK_VOLLEY,
      ],
    },
    {
      // §10.4 페이즈 3 (본체 HP 35% 이하)
      hpThreshold: 0.35,          // §10.4 진입 HP 비율
      onEnter: null,
      patterns: [
        {
          /**
           * §10.4 화공선 — 불타는 소형선이 플레이어를 조준해 돌진하고, 접촉 또는 화면 하단
           * 도달 시 폭발해 장판 P9를 남긴다.
           *
           * 화공선은 §8.1 아키타입 9종에 없어 `EnemyId`를 못 가지므로 `summon`으로 쓸 수 없고
           * (12_통합_계약.md §10 E-09), `BossPattern`에 화공선 전용 kind도 없다. 남은 형태 중
           * P8 불화살이 「조준해 날아가 착탄 지점에 장판 P9를 남긴다」를 그대로 갖고 있어
           * 그것으로 쓴다(§6.1). 잃는 것은 실루엣 하나다 — render는 배가 아니라 불화살을 그린다.
           *
           * `mortar` + `spawnsZone`으로 쓰면 착탄 예고 원이 붙어 패리로 지울 수 없는 위협이
           * 되는데, §14.1은 스테이지 3의 패리 불가 요소를 「없음」으로 적었다.
           */
          name: '화공선',
          kind: 'volley', bullet: 'P8',
          count: 8,               // 소형선 (척). §10.4 원값 3
          tellSec: 0.75,          // §14.1 S3 단발 직선 발사 예비동작 (s)
          intervalSec: 0,         // §10.4 함께 나간다 (s)
          repeat: 1,              // §10.4 연사가 아니다
          aim: 'player',          // §10.4 「플레이어 조준 후 돌진」
          sourceSpread: 630,      // 갑판 폭 (u). 갑판 조총 사격과 같은 발사원 구간이다
          from: 'boss',
          speedMul: 0.5,          // §6.1 P8 기본 480 u/s를 240 u/s로 낮춰 「배가 밀고 온다」를 만든다
        },
        {
          name: '최후 포격',
          // §10.4 함포탄을 부채꼴로 동시 발사 + 신관 링 탄막.
          // charge.onEnd와 mortar.onImpact는 후속을 하나만 붙일 수 있어 병렬을 못 만든다 —
          // 그래서 parallel이다(12_통합_계약.md §10 E-08).
          kind: 'parallel',
          parts: [
            {
              name: '함포 부채꼴',
              kind: 'spread', bullet: 'P6',
              count: 12,           // 함포탄 (발). §10.4 원값 6
              halfAngleDeg: 40,   // §10.4가 침묵하는 자리 (deg). 4발이 20° 간격으로 벌어진다
              tellSec: PATTERN_SPREAD_TELL_SEC, // §6.2 확산의 예비동작은 스테이지와 무관하게 고정이다
              sets: 1,            // §10.4 「동시 발사」라 세트가 하나다
              setIntervalSec: 0,  // §10.4 세트가 하나이므로 간격이 없다 (s)
            },
            {
              name: '신관 링',
              // §10.4가 발수를 주지 않아 §8.1 E-G 신관의 링을 그대로 쓴다 — 조정 뒤에도 두 값이 같다.
              // tellSec이 함포 부채꼴과 같아야 스펙의 「동시」가 성립한다.
              kind: 'ring', bullet: 'P4',
              count: 20,           // E-G 신관의 링과 같은 발수. §8.1 원값 10
              tellSec: PATTERN_SPREAD_TELL_SEC,            // §6.2 링의 예비동작도 고정이다
              startAngleDeg: PATTERN_RING_START_ANGLE_DEG, // 스펙이 정하지 않은 자리. patterns.ts의 규약을 따른다
            },
          ],
        },
      ],
    },
  ],

  // §10.1 공통 규칙 셋은 여기 없다 — bosses/index.ts의 BOSS_COMMON이 갖는다(12 §10 E-12).
} as const satisfies BossDef;
