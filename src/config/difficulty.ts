/**
 * 스테이지별 난이도 배율 — 스펙 §14.1
 *
 * 게임이 통째로 어렵거나 쉬우면 다른 어디도 아닌 이 파일을 고친다. 잡몹 hp(enemies.ts)나
 * 탄속(bullets.ts)을 직접 고치면 한 스테이지만 노렸는데 다섯 스테이지가 전부 움직인다.
 *
 * 스펙 §14.2가 난이도를 올리는 축을 다섯으로 못 박았고, 그중 이 표가 담당하는 것은
 * 축 1(탄속) · 축 2(예비동작 시간) · 축 3(동시 탄환·적 수)이다. 축 4는 unparryable 열이
 * "어느 스테이지부터인가"만 밝히고 실제 배치는 stages/*가, 축 5(위협 전환 속도)는 bosses/*가
 * 갖는다. enemyHpMul만 올려서 난이도를 만들지 않는다 — §14.2가 명시적으로 금지한다.
 *
 * 이 표에 없는 것 둘. 보스 HP는 BossDef.hp가 단일 소스이고, 동시 잡몹 최대 도달치는 편성이
 * 실제로 도달하는 값이라 손으로 적으면 stages/*를 고치는 순간 조용히 썩는다 — 헤드리스
 * 리포트가 stages/*를 돌려 얻은 값을 §14.1의 10 / 12 / 10 / 18 / 20과 대조한다
 * (12_통합_계약.md §5).
 *
 * 반대로 이 표에만 있는 것이 하나. maxEnemyBullets가 §3.2 동시 적 탄환 상한의 유일한 소스이고
 * playfield.ts는 이 값을 갖지 않는다(12_통합_계약.md §10 E-13). 전역 상수가 아니라 §14.2의
 * 축 3이라 스테이지마다 다르고, 두 파일에 두면 S5의 280만 한쪽에서 늙는다. 성능 게이트가
 * 스트레스 씬을 세울 때 읽는 값도 여기 S5 칸이다(12_통합_계약.md §2).
 */
import type { StageScaling } from './types';
import type { StageId } from './ids';

export const STAGE_SCALING = {
  1: {
    enemyHpMul:      1.00,    // §14.1 배율. enemies.ts의 hp에 곱한다
    bulletSpeedMul:  1.00,    // §14.1 배율. bullets.ts의 speedUPerSec에 곱한다
    tellSec:         0.95,    // §14.1 초. 단발 직선(P1~P3)의 발사 예비동작
    maxEnemyBullets: 80,      // §14.1 발. 성능 방어선이지 난이도 목표치가 아니다
    waveCount:       3,       // §9.3 웨이브 수
    targetLengthSec: 70,      // §9.2 초. 보스 격파까지 포함한 목표 길이
    unparryable:     'none',  // §14.1 패리 불가 요소 없음
  },
  2: {
    enemyHpMul:      1.35,    // §14.1 배율
    bulletSpeedMul:  1.08,    // §14.1 배율
    tellSec:         0.85,    // §14.1 초
    maxEnemyBullets: 120,     // §14.1 발
    waveCount:       4,       // §9.4 웨이브 수
    targetLengthSec: 85,      // §9.2 초
    unparryable:     'none',  // §14.1 패리 불가 요소 없음
  },
  3: {
    enemyHpMul:      1.80,    // §14.1 배율
    bulletSpeedMul:  1.16,    // §14.1 배율
    tellSec:         0.75,    // §14.1 초
    maxEnemyBullets: 170,     // §14.1 발
    waveCount:       4,       // §9.5 웨이브 수
    targetLengthSec: 90,      // §9.2 초
    unparryable:     'none',  // §14.1 패리 불가 요소 없음
  },
  4: {
    enemyHpMul:      2.40,    // §14.1 배율
    bulletSpeedMul:  1.24,    // §14.1 배율
    tellSec:         0.65,    // §14.1 초
    maxEnemyBullets: 210,     // §14.1 발
    waveCount:       4,       // §9.6 웨이브 수
    targetLengthSec: 95,      // §9.2 초
    unparryable:     'zone',  // §14.1 화염 장판(P9) 첫 등장. 동시 6개 상한은 §9.6이 갖는다
  },
  5: {
    enemyHpMul:      3.10,    // §14.1 배율
    bulletSpeedMul:  1.34,    // §14.1 배율
    tellSec:         0.55,    // §14.1 초
    maxEnemyBullets: 280,     // §14.1 발. 잡몹 상한 20기로 발사원이 늘어난 만큼 올린 값이다
    waveCount:       5,       // §9.7 웨이브 수
    targetLengthSec: 110,     // §9.2 초
    unparryable:     'zone+lance', // §14.1 장판 + 관통 대창(P12). P12는 W4부터 배경 함대가 쏜다(§9.7)
  },
} as const satisfies Record<StageId, StageScaling>;

/**
 * §6.2 확산·링 발사의 예비동작
 *
 * 스테이지와 무관하게 고정이라 STAGE_SCALING의 열이 아니다. 궤적 예고가 아니라 발사원이
 * 밝아지는 예비동작이므로 telegraph.ts의 예고 3종에도 들어가지 않는다.
 */
export const SPREAD_TELL_SEC = 0.4;   // §6.2 초

/** §6.2 참격파(P5)의 백스윙. 역시 스테이지와 무관하게 고정이고 궤적 잔상을 미리 그리지 않는다 */
export const SLASH_TELL_SEC = 0.7;    // §6.2 초
