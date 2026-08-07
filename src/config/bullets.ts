/**
 * 탄환 12종 — 스펙 §6.1
 *
 * brp(반사기본위력)가 이 표에서 가장 중요한 열이다. 반사탄 데미지는 언제나 brp에서 다시 시작하고
 * (§7.2), 재패리를 해도 직전 데미지에 배수를 다시 곱하지 않는다. brp를 올리면 그 탄을 쓰는
 * 모든 적과 보스의 체감 난이도가 동시에 내려간다.
 *
 * 실제 탄속 = speedUPerSec × 스테이지 탄속 배율(difficulty.ts). 이 파일의 값은 S1 기준이다.
 *
 * 여기 있는 값 중 예고·예비동작 시간은 하나도 없다. 그것은 탄종이 아니라 발사 형태가 정하므로
 * telegraph.ts가 갖는다(§6.2 HR-05).
 */
import type { BulletDef } from './types';
import type { BulletId } from './ids';

export const BULLETS = {
  P1: {
    name: '화살',
    radiusU: 8,
    speedUPerSec: 520,
    isParryable: true,
    brp: 10,
    shape: 'shard',
    note: '기본 원거리탄',
  },
  P2: {
    name: '조총탄',
    radiusU: 6,
    speedUPerSec: 760,
    isParryable: true,
    brp: 14,
    shape: 'dot',
    note: '고속·소형. 판정창이 좁다',
  },
  P3: {
    // 스펙 안에 발사원이 없다. §8.1의 어느 잡몹 사용 탄 열에도, §10의 어느 보스 패턴에도
    // 배정된 적이 없어서 이 정의는 아무도 읽지 않는다(01 R-05 · 10 C5). 스펙을 바꾸지 않으므로
    // 여기서 배정하지 않는다 — 배정은 §8·§9의 개정이지 구현 판단이 아니다.
    name: '편전',
    radiusU: 5,
    speedUPerSec: 880,
    isParryable: true,
    brp: 12,
    shape: 'needle',
    note: '최고속. 발사 예비동작이 가장 짧다',
  },
  P4: {
    name: '수리검',
    radiusU: 10,
    speedUPerSec: 600,
    isParryable: true,
    brp: 12,
    shape: 'star',
    note: '회전. 확산 발사 전용',
  },
  P5: {
    name: '참격파',
    radiusU: 34,               // §6.1 호 형태, 실측 폭 120u
    speedUPerSec: 420,
    isParryable: true,
    brp: 30,
    shape: 'crescent',
    note: '저속·대형. 회피가 쉽고 반사 위력이 크다. GREAT 판정 시 이미 코어를 덮고 있다(§5.3)',
  },
  P6: {
    name: '함포탄',
    radiusU: 26,
    speedUPerSec: 300,
    isParryable: true,
    brp: 55,
    shape: 'orb',
    note: '최저속·최대 위력. 해전 전용. NOT BAD 반사 속도 390u/s로 추격 가능(§7.1)',
  },
  P7: {
    name: '대통 폭탄',
    radiusU: 30,
    speedUPerSec: 260,
    isParryable: true,
    brp: 70,
    shape: 'bomb',
    note: '착탄 시 폭발 → P9 생성. 폭발 전에만 패리 가능',
  },
  P8: {
    name: '불화살',
    radiusU: 9,
    speedUPerSec: 480,
    isParryable: true,
    brp: 12,
    shape: 'fireshard',
    note: '착탄 시 P9 생성',
  },
  P9: {
    name: '화염 장판',
    radiusU: 90,
    speedUPerSec: 0,
    isParryable: false,        // §5.6 패리 원 안에 있어도 무시된다
    brp: 0,
    shape: 'zone',
    note: '지속 4.0초, 0.5초 간격 피해(§4.3). 패리 불가이므로 반사탄이 되지 않는다',
  },
  P10: {
    name: '신기전',
    radiusU: 6,
    speedUPerSec: 620,
    isParryable: true,
    brp: 11,
    shape: 'dart',
    note: '좁은 각도 다발 발사 전용',
  },
  P11: {
    name: '유도탄',
    radiusU: 9,
    speedUPerSec: 380,         // §6.1 380 → 560. 유도 종료 후 가속한다
    isParryable: true,
    brp: 16,
    shape: 'seeker',
    // 유도는 적 탄환일 때만이다. 반사되는 순간 소멸한다 — sim/reflect.ts가
    // homingRemainingSec = 0 으로 만든다 (01 §4-B S-12, 05 §4.3).
    // 반사탄이 유도를 갖는 경로는 카드 R03 하나뿐이다 (§7.1 "유도 | 기본 없음")
    homing: {
      durationSec: 1.2,        // §6.1 발사 후 이 시간 동안만 유도 (s)
      turnRateDegPerSec: 120,  // §6.1 유도 선회율 (deg/s)
      exitSpeedUPerSec: 560,   // §6.1 유도 종료 후 직진 속도 (u/s)
    },
    note: '카드 R03이 반사탄에 붙이는 유도와는 별개 파라미터다',
  },
  P12: {
    name: '관통 대창',
    radiusU: 20,               // §6.1 폭 40u 직선의 절반
    speedUPerSec: 0,           // §6.1 즉시 판정. 이동하지 않는다
    isParryable: false,
    brp: 0,
    shape: 'lance',
    note: '예고선 0.8초 후 0.4초간 관통 판정. 스테이지 5 전용',
  },
} as const satisfies Record<BulletId, BulletDef>;
