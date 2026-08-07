/**
 * 스테이지 5 노량 밤바다 — 스펙 §9.7
 *
 * 학습 목표가 없다. 앞 네 스테이지에서 배운 모든 대응을 동시에 요구하는 것이 이 스테이지의 편성
 * 원칙이고, 그래서 다섯 웨이브가 각각 앞 스테이지 하나씩의 위협 축을 다시 꺼낸다(§9.7).
 *
 * 여기가 동시 잡몹 상한 20기에 실제로 닿는 유일한 스테이지다. W5 편성 16기에 잔존 4기가 얹혀
 * 20기가 되고, 신규 스폰이 지연되는 상황이 의도적으로 발생한다(§9.7 · 01_설계_결정.md §4-B S-10).
 * 다른 스테이지에서 같은 지연이 관측되면 그것은 편성이 아니라 버그다.
 *
 * 관통 대창 P12는 보스 패턴이 아니라 웨이브 위협이라 이 파일에 있다. B5 페이즈 4가 쓰는 것과
 * 같은 sim/lance.ts를 sim/waves.ts가 부른다(12_통합_계약.md §10 E-10).
 *
 * HR-02: 모든 웨이브에 원거리 적이 최소 1기 있어야 한다. W4는 E-C가 섞여도 E-I·E-F가 받치고,
 * W3은 E-D 6기를 E-G·E-H가 받친다.
 */
import type { LanceDef, StageDef } from '../types';

/**
 * §9.7 배경 함대의 관통 대창 광역 공격 — W4부터 나온다
 *
 * W4와 W5가 같은 값을 가리키게 두는 이유는 규칙 5다. 리터럴을 두 벌 적으면 한쪽만 고치는 날이
 * 반드시 온다. 15초 간격은 W4 시작부터 연속으로 흐르며 웨이브 경계에서 다시 세지 않는다 —
 * "W4부터"이지 "W4마다"가 아니다(§9.7).
 */
const BACKGROUND_FLEET_LANCE = {
  intervalSec: 15, // §9.7 15초 간격 (s)
  lanes: 2, // §9.7 세로 2줄
  telegraphSec: 0.8, // §6.1 P12 · §6.2 예고선 0.8초 고정 (s)
  activeSec: 0.4, // §6.1 P12 예고선이 사라진 뒤 관통 판정 0.4초 (s)
  // HR-04 · §9.7. 목업 실측 2줄이 x = 300 · 800이고 폭 40u라 실제 통로가 460u다
  // (10_스펙_목업_불일치.md §3). §10.6이 B5에 요구한 최소 200u를 넘는다
  safeCorridorU: 460, // §9.7 (u)
  // 목업 두 줄이 x = 300 · 800이라 중심이 플레이필드 중심 540이 아니라 550이다
  // (09_stage5_noryang/scene.js:59). 유도만 하면 두 줄이 통째로 10u 왼쪽에 선다
  centerXU: 550, // §9.7 줄 묶음의 가로 중심 (u). 목업 실측
} as const satisfies LanceDef;

export const STAGE_5 = {
  id: 5, // §9.2 스테이지 5
  name: '노량 밤바다',
  background: 'noryang',
  concept: '최종 결전. 앞 4스테이지 요소의 복합',
  bossId: 'B5',

  waves: [
    {
      // §9.7 W1 — S1의 조총·궁병 조합을 좌우 협공으로 되돌려 준다. 시작부터 10기다
      startSec: 0,
      endSec: 13,
      formation: 'F-2', // §8.2 좌우 협공
      squads: [
        { enemy: 'E-A', count: 6 },
        { enemy: 'E-B', count: 4 },
      ],
      concurrentMax: 10, // §9.7 동시 최대
    },
    {
      // §9.7 W2 — S3의 저속 대형탄. 편성 6기로 가장 성기지만 E-I 2기가 오래 버틴다
      startSec: 13,
      endSec: 27,
      formation: 'F-5', // §8.2 성벽 배치. E-I는 모함 부착이라 이동하지 않는다
      squads: [
        { enemy: 'E-E', count: 4 },
        { enemy: 'E-I', count: 2 },
      ],
      concurrentMax: 6, // §9.7 동시 최대
    },
    {
      // §9.7 W3 — S4의 화공에 돌격병 6기가 얹힌다. 링 탄막·장판·돌진이 한 화면에 겹치는 자리
      startSec: 27,
      endSec: 42,
      formation: ['F-3', 'F-4'], // §8.2 횡대 정렬 + 사인 곡선 강하
      squads: [
        { enemy: 'E-G', count: 4 },
        { enemy: 'E-H', count: 4 },
        { enemy: 'E-D', count: 6 },
      ],
      concurrentMax: 14, // §9.7 동시 최대
    },
    {
      // §9.7 W4 — 관통 대창이 처음 들어온다. 편성 11기로 한 번 성글게 만든 뒤 광역 공격을 얹는다
      startSec: 42,
      endSec: 56,
      formation: ['F-5', 'F-6'], // §8.2 성벽 배치 + 측면 통과
      squads: [
        { enemy: 'E-I', count: 3 },
        { enemy: 'E-F', count: 4 },
        { enemy: 'E-C', count: 4 },
      ],
      concurrentMax: 11, // §9.7 동시 최대
      lance: BACKGROUND_FLEET_LANCE,
    },
    {
      // §9.7 W5 — 편성 16기 + 잔존 4기로 상한 20기에 닿는다. 대창은 여기서도 계속 떨어진다
      startSec: 56,
      endSec: 70,
      formation: ['F-2', 'F-5'], // §8.2 좌우 협공 + 성벽 배치
      squads: [
        { enemy: 'E-A', count: 6 },
        { enemy: 'E-E', count: 4 },
        { enemy: 'E-G', count: 3 },
        { enemy: 'E-H', count: 3 },
      ],
      concurrentMax: 16, // §9.7 동시 최대. 잔존 4기가 얹혀 §3.2의 상한 20기에 닿는다
      lance: BACKGROUND_FLEET_LANCE,
    },
  ],

  // §9.1 소강 구간 (s). 신규 적 탄환만 없을 뿐 무적 구간이 아니다.
  // 대창의 관통 판정도 신규 적 탄환이므로 이 3초에는 발행되지 않는다
  lullSec: 3, // §9.1

  // §9.1 잔존 잡몹 퇴장 유예 (s). 소강 3초 안에 화면을 떠야 하므로 3이다 —
  // 스펙의 4초는 소강보다 길어 "적 탄환 없음"을 깬다(01_설계_결정.md §4-B S-07)
  stragglerGraceSec: 3, // §9.1
} as const satisfies StageDef;
