/**
 * 반사탄 파라미터 — 스펙 §7.1 · §7.4
 *
 * 패리(parry.ts)와 파일을 나눈 것은 03_파일_구조.md §1의 배정이다. §5 패리 판정과 §7 반사탄의
 * 일생은 서로 다른 시점에 다른 사람이 고치는 값이라, 한 파일에 두면 둘 다 읽어야 한다.
 *
 * graceSec이 parry.ts가 아니라 여기 있는 것도 같은 이유다. 자해 유예는 패리가 만드는 값이지만
 * 반사탄이 들고 다니는 상태이고, §7.1이 그것을 반사탄 항목으로 적었다. 패리 쪽에서 읽을 일이
 * 없다 — C5가 검사하는 것은 발사체의 잔여 유예이지 설정값이 아니다.
 *
 * 화면 밖 소멸 경계(+150u)는 여기 없다. 반사탄만의 규칙이 아니라 모든 발사체에 공통이므로
 * playfield.ts의 despawnMarginU가 갖는다.
 */
import { SCORING } from './scoring';
import type { ReflectConfig } from './types';

export const REFLECT = {
  graceSec:        0.15,  // §7.1 자해 유예 (s). 반사 직후 피격도 패리도 판정하지 않는다.
                          //      재패리마다 새로 시작한다(§7.4)
  lifetimeSec:     3.0,   // §7.1 수명 (s). 재패리 시 재설정한다(§7.4)
  speedMaxUPerSec: 2400,  // §7.1 속도 상한 (u/s). §11.6 카드 상한도 이 값을 가리킨다
  pierceCount:     0,     // §7.1 추가 관통 수 (기). 0이면 적 1기 명중 시 소멸 — R02가 +1~2를 준다
  // §7.4 재패리 점수는 등급 점수의 이 비율 (25 / 75 / 200). 점수 규칙이라 숫자는 §12.1이 갖는다
  scoreRatio:      SCORING.reparryRatio,
} as const satisfies ReflectConfig;
