/**
 * 잡몹 아키타입 9종 — 스펙 §8.1
 *
 * hp는 스테이지 1 기준값이다. 실제 HP = hp × 스테이지 HP 배율(difficulty.ts).
 * 잡몹 하나가 너무 세다고 느껴지면 여기의 hp를, 스테이지 전체가 세면 difficulty.ts를 고친다.
 *
 * moveSpeedUPerSec에는 스테이지 배율이 없다. §14.1의 배율은 탄속에만 걸린다 — 이동 속도에도
 * 두면 §14.2의 난이도 축이 5개에서 6개가 되고, §14.4의 검산표가 다루지 않는 축이 생긴다
 * (10_스펙_목업_불일치.md A16). 목업이 E-C를 26 u/s로 내리고 E-F를 스테이지마다 420→450으로
 * 올린 것은 그래서 따르지 않는다. 여기 한 줄을 전 스테이지가 공유한다.
 *
 * fireCycleSec는 발사 예비동작 시간을 포함한다. 예비동작 자체의 길이는 스테이지마다
 * 다르므로 telegraph.ts에 있다.
 *
 * spreadDeg는 전각이 아니라 반각이다 — 최외곽 탄이 조준선에서 몇 도 떨어지는가(A5).
 * 3발 부채꼴 ±14°는 최외곽 두 발이 각각 14° 벌어진다는 뜻이고, 전각으로 읽으면 절반이 된다.
 *
 * shape는 render/enemy.ts가 그릴 실루엣 키다(ids.ts의 EnemySpriteId). BulletDef와 BossDef에는
 * 처음부터 있었고 EnemyDef에만 없어서, 잡몹을 하나 늘릴 때마다 반드시 render/를 열어야 했다.
 * 이 한 열이 그 강제를 없앤다 — 기존 실루엣을 재사용하는 아키타입 추가는 config/ 안에서 끝난다
 * (12_통합_계약.md §8-10).
 *
 * hitRadiusU도 같은 이유로 여기 있다. 목업은 반사탄 명중을 ENEMIES[e.type].w * 0.6으로
 * 판정하는데(engine.js:1874) w는 실루엣 폭이라 render/enemy.ts가 소유한다. 그 곱을 여기서
 * 미리 해 둔다 — config/에는 계산식을 둘 수 없고 sim/은 render/를 읽을 수 없다
 * (12_통합_계약.md §10 E-04). 목업 w(engine.js:56-64)에서 유도한 반올림 정수다:
 *
 *   E-A 54×0.6 = 32.4 → 32     E-B 52×0.6 = 31.2 → 31     E-C 70×0.6 = 42
 *   E-D 50×0.6 = 30            E-E 76×0.6 = 45.6 → 46     E-F 44×0.6 = 26.4 → 26
 *   E-G 62×0.6 = 37.2 → 37     E-H 54×0.6 = 32.4 → 32     E-I 96×0.6 = 57.6 → 58
 *
 * 여기를 키우면 그 잡몹이 맞히기 쉬워질 뿐 실루엣은 그대로다 — 판정과 그림이 어긋나 보이면
 * render/enemy.ts의 w와 대조한다.
 *
 * HR-02: 모든 웨이브 편성에 원거리 적이 최소 1기 있어야 한다. isRanged가 그 판정 기준이고,
 * tests/guards.test.ts가 config/stages/* 전체를 훑어 이 규칙을 검사한다.
 */
import type { EnemyDef } from './types';
import type { EnemyId } from './ids';

export const ENEMIES = {
  'E-A': {
    name: '조총병',
    shape: 'gunner',
    hitRadiusU: 32,               // 목업 w 54 × 0.6
    hp: 30,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 120,        // §8.1 이동 속도 (u/s)
    behavior: 'holdAndFire',      // 진입 후 정지, 예비동작 → 단발
    bullet: 'P2',
    shotsPerCycle: 1,
    spreadDeg: 0,                 // 단발이라 부채꼴이 없다
    fireCycleSec: 2.2,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 100,                   // §8.1 처치 점수
  },
  'E-B': {
    name: '궁병',
    shape: 'archer',
    hitRadiusU: 31,               // 목업 w 52 × 0.6
    hp: 36,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 150,        // §8.1 이동 속도 (u/s)
    behavior: 'strafeAndFire',    // 좌우 왕복하며 발사
    bullet: 'P1',
    shotsPerCycle: 3,
    spreadDeg: 14,                // §8.1 ±14° 부채꼴 — 반각 (deg)
    fireCycleSec: 2.6,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 100,                   // §8.1 처치 점수
  },
  'E-C': {
    name: '방패병',
    shape: 'shield',
    hitRadiusU: 42,               // 목업 w 70 × 0.6
    hp: 90,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 90,         // §8.1 이동 속도 (u/s). 목업의 26은 A16이 기각했다
    behavior: 'descend',          // 발사 없음. 하강하며 접촉 피해
    bullet: null,
    shotsPerCycle: 0,
    spreadDeg: 0,                 // 발사하지 않는다
    fireCycleSec: 0,              // 발사하지 않는다 (s)
    isRanged: false,
    contactDamage: true,
    frontShield: true,            // §7.3 정면 반사탄 1회 무효화 후 파괴
    score: 150,                   // §8.1 처치 점수
  },
  'E-D': {
    name: '돌격병',
    shape: 'charger',
    hitRadiusU: 30,               // 목업 w 50 × 0.6
    hp: 40,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 340,        // §8.1 이동 속도 (u/s)
    behavior: 'charge',           // 돌진 방향선 1.0초 표시 후 직선 돌진
    bullet: null,
    shotsPerCycle: 0,
    spreadDeg: 0,                 // 발사하지 않는다
    fireCycleSec: 0,              // 발사하지 않는다 (s)
    isRanged: false,
    contactDamage: true,
    telegraph: 'dash',            // §6.2 HR-05가 허용하는 3종 중 하나. 지속 시간은 telegraph.ts
    score: 120,                   // §8.1 처치 점수
  },
  'E-E': {
    name: '화포병',
    shape: 'cannoneer',
    hitRadiusU: 46,               // 목업 w 76 × 0.6
    hp: 70,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 60,         // §8.1 이동 속도 (u/s). 9종 중 가장 느리다
    behavior: 'holdAndFire',
    bullet: 'P6',
    shotsPerCycle: 1,
    spreadDeg: 0,                 // 단발이라 부채꼴이 없다
    fireCycleSec: 3.4,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 200,                   // §8.1 처치 점수
  },
  'E-F': {
    name: '척후',
    shape: 'scout',
    hitRadiusU: 26,               // 목업 w 44 × 0.6. 9종 중 가장 작다
    hp: 20,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 420,        // §8.1 이동 속도 (u/s) 고정. 목업의 430·440·450은 A16이 기각했다
    behavior: 'crossPass',        // 측면 진입 → 반대편 통과 후 소멸. 되돌아오지 않는다(A8)
    bullet: 'P11',
    shotsPerCycle: 2,             // §8.1 통과 중 2회
    spreadDeg: 0,                 // 유도탄 단발이라 부채꼴이 없다
    fireCycleSec: 0,              // 주기가 아니라 통과 중 2회. crossPass가 자체 스케줄을 쓴다 (s)
    isRanged: true,
    contactDamage: false,
    score: 130,                   // §8.1 처치 점수
    note: '화면 끝에서 되돌아오면 측면 위협이 아니라 상주 적이 되고 §9의 동시 잡몹 도달치가 어긋난다(A8)',
  },
  'E-G': {
    name: '신관',
    shape: 'priest',
    hitRadiusU: 37,               // 목업 w 62 × 0.6
    hp: 60,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 100,        // §8.1 이동 속도 (u/s)
    behavior: 'holdAndFire',
    bullet: 'P4',
    shotsPerCycle: 10,            // §8.1 링 탄막 10발
    spreadDeg: 360,               // §8.1 등간격 36° 링. 유일하게 반각이 아니라 전방위 표시다
    fireCycleSec: 3.0,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 180,                   // §8.1 처치 점수
  },
  'E-H': {
    name: '화전병',
    shape: 'firearcher',          // archer와 몸통을 공유하고 불씨만 더 그린다(engine.js:458-491)
    hitRadiusU: 32,               // 목업 w 54 × 0.6. archer(31)와 다르다 — 몸통만 공유한다
    hp: 40,                       // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 130,        // §8.1 이동 속도 (u/s)
    behavior: 'holdAndFire',
    bullet: 'P8',
    shotsPerCycle: 2,
    spreadDeg: 10,                // §8.1 ±10° 부채꼴 — 반각 (deg). 목업의 ±5°는 A6이 기각했다
    fireCycleSec: 2.8,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 160,                   // §8.1 처치 점수
  },
  'E-I': {
    name: '함포문',
    shape: 'port',
    hitRadiusU: 58,               // 목업 w 96 × 0.6. 9종 중 가장 크다
    hp: 200,                      // §8.1 기본 HP (S1 기준)
    moveSpeedUPerSec: 0,          // §8.1 모함에 부착. 스스로 움직이지 않는다 (u/s)
    behavior: 'mounted',
    bullet: 'P6',
    shotsPerCycle: 4,             // §8.1 4발 일제
    spreadDeg: 0,                 // 일제 사격이고 부채꼴로 벌리지 않는다
    fireCycleSec: 4.0,            // §8.1 발사 주기 (s)
    isRanged: true,
    contactDamage: false,
    score: 300,                   // §8.1 처치 점수
    note: '보스 B3의 포문은 이 값이 아니라 고정 HP 300과 사각 히트박스를 쓴다(스펙 §10.4의 BossPartDef)',
  },
} as const satisfies Record<EnemyId, EnemyDef>;
