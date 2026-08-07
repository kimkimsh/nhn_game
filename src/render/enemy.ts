/**
 * 잡몹 9종의 실루엣 — 목업 engine.js `drawEnemy` 이식 (06_렌더링과_게임필.md §1.6)
 *
 * 목업의 `drawEnemy`(engine.js:397-837)는 한 함수 안에 13개 shape case를 담고 있고,
 * 06 §1.6이 그것을 case 단위로 두 파일에 나눴다 — 잡몹 9종이 여기, 보스 4종이 render/boss.ts다.
 * 그래서 이 파일의 `drawEnemy`는 원본의 공통 헤더(397-435)와 잡몹 case 9개를 그 순서 그대로 갖는다.
 * **400줄 상한의 예외 파일이다**(03_파일_구조.md §6) — 원본이 한 함수인 것을 쪼개면 대조가 끊긴다.
 *
 * ── 원본을 쪼갠 자리는 하나뿐이다 ─────────────────────────────────────────────
 *
 * `paintEnemyBody`가 원본 425-827에 대응한다. 굽기 경로(아래)가 **프레임에서 그리는 것과
 * 완전히 같은 코드**를 오프스크린에도 돌려야 해서 그 구간에 이름이 필요했다. 안의 순서는 원본과
 * 한 줄씩 대응한다.
 *
 * ── sim을 한 줄도 안 바꾼다 (HR-06) ──────────────────────────────────────────
 *
 * 이 파일은 `EnemyView` 한 덩어리를 읽기만 한다. sim/world.ts의 `Enemy`를 직접 받지 않는 이유는
 * 그 타입에 아직 그리기용 칸(예비동작 진행도·피격 플래시·실루엣 폭)이 없기 때문이고, 생기더라도
 * 여기서 읽는 것은 읽기 전용 뷰 하나여야 한다. 프레임률이 판정에 영향을 주면 안 된다.
 *
 * ── 좌표계 ──────────────────────────────────────────────────────────────────
 *
 * 실루엣은 개체 로컬 프레임(원점 = 개체 중심)에서 그린다. HP 바와 부위 게이지만 월드 좌표다 —
 * 목업이 `ctx.restore()`(engine.js:828) 뒤에서 그리는 그 자리다.
 *
 * 실루엣 좌표의 계수(0.34 · 1.08 · 0.062 …)는 이름을 주지 않고 목업 그대로 둔다. 아트 경로의
 * 제어점이라 이름을 붙여도 뜻이 늘지 않고 원본과의 줄 단위 대조만 끊긴다(03 §2.3). 규칙을
 * 나르는 값 — 글로우 상한, 접지 그림자 조건, 예비동작 네 축, 히트스톱 진폭 — 만 이름을 갖는다.
 */

import type { EnemySpriteId, ParryGradeId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { clamp01, lerp } from '../core/math';
import {
  drawEnemyHpBar,
  drawPartHpGauge,
  jingasa,
  lamellae,
  sashimono,
  spokedWheel,
  visor,
} from './enemy-parts';
import { glow, hexA, poly } from './primitives';

/** 목업은 원을 6.284로 닫는다(engine.js:421 등). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;

/**
 * 잡몹 본체 전용 구조물 색 — 여기가 임시 거처다.
 *
 * `config/palette.ts`는 "색 하나에 규칙 하나, 규칙 없는 색은 추가하지 않는다"를 계약으로 걸었고
 * (03 §7), 아래 넷은 실루엣의 속을 채우는 순수 구조물 색이라 그 계약에 걸려 들어갈 자리가 없다.
 * `config/`에 배경 전용 색과 같은 별도 목록이 생기면 그리로 옮겨 간다. export하지 않는 것이 그
 * 준비다 — 이 파일 밖에 참조가 생기면 옮기는 일이 한 파일 작업이 아니게 된다.
 *
 * 다만 앞의 둘은 **규칙을 하나 나른다.** 예비동작 중인 개체의 속이 `#141a24`에서 `#2a1a22`로
 * 붉어지는 것이 §17의 발사 예비동작 신호 중 색 축이다. 색만으로는 부족해서 아래 네 축이 붙는다.
 */
const BODY_IDLE = '#141a24'; // engine.js:426 평상시 속
const BODY_WINDUP = '#2a1a22'; // engine.js:426 예비동작 중 속. 붉은 쪽으로 한 단
const PAVISE_FACE = '#1d2430'; // engine.js:519 다케타바 판면
const BORE_MOUTH = '#3a1218'; // engine.js:578·652 포구 안쪽. 뚫린 구멍이 검게 읽혀야 한다
const PORT_PLANKING = '#0e131c'; // engine.js:639 함포문 판재

/**
 * 목업이 `rgba(3,4,8,0.5)`(419)와 `hexA('#05070c', 0.85)`(642)로 직접 적은 두 검정.
 * render/에 색 리터럴을 둘 수 없어 ink900으로 읽는다 — 채널 차는 각각 (3,3,2)와 (1,0,2)이고,
 * 둘 다 바탕 검정으로 읽혀야 하는 자리라 바탕색과 같은 토큰이 맞다(render/enemy-parts.ts와 같은 판단).
 */
const CONTACT_SHADOW = hexA(PALETTE.ink900, 0.5);
const PORT_PLANK_SEAM = hexA(PALETTE.ink900, 0.85);

/**
 * case가 쓰는 고정 알파 색. 전부 모듈 상수다 — 호출 때마다 `hexA`를 부르면 잡몹 20기 × 자리 10개가
 * 프레임마다 문자열 200개를 만들고, 그 GC가 p99에 그대로 나타난다(render/sprites.ts 머리말).
 */
const SEAM = hexA(PALETTE.jeokDim, 0.85); // engine.js:427 갑주 이음새
const BANNER_POLE = hexA(PALETTE.jeok, 0.6); // engine.js:438
const WAIST_CORD = hexA(PALETTE.jeok, 0.9); // engine.js:443
const MATCH_CORD = hexA(PALETTE.jeokDim, 0.9); // engine.js:447
const QUIVER_SHAFT = hexA(PALETTE.jeokDim, 0.9); // engine.js:460
const BOW_STRING = hexA(PALETTE.baek, 0.4); // engine.js:476
const BRAZIER_RIM = hexA(PALETTE.hwang, 0.5); // engine.js:487
const PAVISE_SLAT = hexA(PALETTE.baek, 0.8); // engine.js:524
const PAVISE_BINDING = hexA(PALETTE.jeok, 0.65); // engine.js:530
const PAVISE_STUMP = hexA(PALETTE.baek, 0.24); // engine.js:539 파괴 후 남은 기둥
const PAVISE_SPLINTER = hexA(PALETTE.baek, 0.16); // engine.js:546 파괴 후 파편
const SPEAR_TASSEL = hexA(PALETTE.jeokDim, 0.95); // engine.js:543
const WHEEL_RIM = hexA(PALETTE.jeokDim, 0.95); // engine.js:560
const FUSE_UNLIT = hexA(PALETTE.jeokDim, 0.8); // engine.js:580
const SCARF_NEAR = hexA(PALETTE.jeok, 0.5); // engine.js:591
const SCARF_FAR = hexA(PALETTE.jeok, 0.28); // engine.js:597
const STAFF_SHAFT = hexA(PALETTE.jeokDim, 0.9); // engine.js:613
const BEAD_THREAD = hexA(PALETTE.jeokDim, 0.5); // engine.js:632
const SHUTTER_FACE = hexA(PALETTE.jeok, 0.22); // engine.js:648
const SHUTTER_EDGE = hexA(PALETTE.jeok, 0.5); // engine.js:650
const PORT_TACKLE = hexA(PALETTE.jeokDim, 0.9); // engine.js:656

/**
 * engine.js:405 — **글로우 반경 상한 130u.** 보스 본체가 300~980u인데 반경을 폭에 비례로 두면
 * 후광이 화면 상반부를 통째로 붉게 씻는다. 잡몹(44~96u)은 상한에 안 닿지만 규칙은 이 상수가 갖는다.
 */
const GLOW_RADIUS_WIDTH_SCALE = 1.2;
const GLOW_RADIUS_MAX_U = 130;
const GLOW_IDLE_SCALE = 0.8;
const GLOW_IDLE_ALPHA = 0.16;
const GLOW_WINDUP_BASE_SCALE = 0.55;
const GLOW_WINDUP_SCALE_GAIN = 0.3;
const GLOW_WINDUP_BASE_ALPHA = 0.12;
const GLOW_WINDUP_ALPHA_GAIN = 0.2;
const GLOW_FLASH_SCALE = 1.4;
const GLOW_FLASH_ALPHA = 0.8;

/**
 * engine.js:418 — **접지 그림자는 폭 110u 이하에만.** 보스 폭에서 같은 타원은 물 위의 700u
 * 얼룩이 된다. 잡몹 최대 폭이 96u(E-I)라 실제로는 9종 전부 통과하지만, 이 조건이 사라지면
 * 보스가 이 함수를 재사용하게 됐을 때 조용히 얼룩이 생긴다.
 */
const CONTACT_SHADOW_MAX_WIDTH_U = 110;

/**
 * engine.js:432-434 — 잡몹 높이는 폭의 비례다. 목업이 `def.shape === 'warship' ? 320 : w * 1.05`로
 * 갈랐고 그 warship case는 render/boss.ts로 갔으므로 여기 남는 것은 비례 쪽 하나뿐이다.
 */
const BODY_HEIGHT_SCALE = 1.05;

/** engine.js:428 — 예비동작 중 외곽선이 굵어진다. 크기 축(1.06)과 함께 실루엣을 두껍게 만든다 */
const OUTLINE_WIDTH_IDLE = 3.4;
const OUTLINE_WIDTH_WINDUP = 5;

/**
 * 발사 예비동작의 비(非)색 축 넷 — 12_통합_계약.md §7.5-정정 · 06 §5.11
 *
 * 스펙 §15.1이 "적이 곧 쏜다는 사실이 적 **본체의 상태 변화만으로** 읽혀야 한다. 궤적을 암시하는
 * 선·화살표는 쓰지 않는다"고 못 박았다. **「만으로」가 배타적이라 본체 밖에는 아무것도 그릴 수 없다** —
 * 12 §7.5가 한때 확정했던 수렴 선분 3개는 §7.5-정정이 취소했다.
 *
 * 그런데 목업의 예비동작은 적색 additive 후광이 6% 커지고 알파가 0.16 → 0.32로 오르는 것뿐이고
 * (engine.js:406-409), 그것을 덮는 탄환 글로우는 fill 기준 17배에 색 계열까지 같다. 그대로 두면
 * 묻히고, §17이 "예비동작이 배경에 묻히면 예고 없는 발사가 아니라 **불공정한 발사**가 된다"고 적었다.
 *
 * 그래서 신호를 본체 안에서 만든다. 넷 다 §15.1이 허용하는 「본체의 상태 변화」다.
 *
 * - **실루엣** — 조총병은 총을 어깨에 올리고, 궁병·화전병은 시위를 당긴다. 탄환은 원·호뿐이라
 *   사람 형태의 변화와 겹칠 도형이 없다. `postureOf`가 그 보간 계수다
 * - **크기** — 본체 등방 확대 1.00 → 1.06 → 1.00. 글로우는 커지지만 실루엣 외곽선은 안 커진다
 * - **운동** — 발사 직전 0.08초에 발사 반대 방향으로 8u 물러났다 돌아온다. 위치 변화는 밝기와 축이 다르다
 * - **명암** — 본체 안을 `source-over` 어두운 띠가 총구 쪽으로 쓸고 간다. additive 클리핑은 밝기를
 *   위로만 올리므로 어두운 것은 어떤 더미 위에서도 남는다(12 §7.2의 반사탄 중앙 점과 같은 원리)
 *
 * **넷 다 이 함수의 기존 변환 안에서 끝나므로 드로우 콜이 늘지 않는다** — 명암 띠 fill 1회만 는다.
 */
const WINDUP_SCALE_GAIN = 0.06;
const WINDUP_RECOIL_U = 8;
const WINDUP_RECOIL_WINDOW_SEC = 0.08;
const WINDUP_SHADE_ALPHA = 0.45;
/** 띠의 반폭·이동 거리는 본체 높이 대비, 클립 타원은 폭·높이 대비다 */
const WINDUP_SHADE_HALF_WIDTH_SCALE = 0.16;
const WINDUP_SHADE_TRAVEL_SCALE = 0.95;
const WINDUP_SHADE_CLIP_RX_SCALE = 0.66;
const WINDUP_SHADE_CLIP_RY_SCALE = 0.78;
const WINDUP_SHADE_CLIP_CENTER_Y_SCALE = 0.2;
const WINDUP_SHADE = hexA(PALETTE.ink900, WINDUP_SHADE_ALPHA);

/**
 * 히트스톱 중 시각적 진동 — 12_통합_계약.md §8-3 · 06 §4.1
 *
 * **판정 위치는 고정한다. 여기서 움직이는 것은 그려지는 자리뿐이다.** 몸이 실제로 흔들리면
 * 히트박스도 같이 움직여 맞아야 할 공격이 빗나간다(Sakurai). sim은 히트스톱 동안 아예 돌지 않으므로
 * 이 변위는 render에만 존재한다.
 *
 * 등급별 시작 진폭이 필요한 이유는 NOT BAD의 히트스톱 0.02초가 60fps에서 1.2프레임이라 **길이만으로는
 * 등급이 안 읽히기** 때문이다. 길이는 스펙 §5.3 값 그대로 두고 진폭을 등급 축으로 더 쓴다.
 *
 * 이 세 숫자는 `config/feel.ts`에 칸이 생기면 그리로 옮긴다. 지금 그 파일의 히트스톱 항목은
 * `PARRY_BANDS[].hitstopSec`(길이)와 `playerHit` 둘뿐이고 진폭 칸이 없다.
 */
const HITSTOP_SHAKE_START_U = {
  GREAT: 6,
  GOOD: 4,
  NOT_BAD: 2,
} as const satisfies Record<ParryGradeId, number>;

/**
 * 히트스톱을 3구간으로 나눠 구간마다 진폭을 절반으로 줄인다 — "시작이 크고 점점 작아진다".
 * 12 §8-3이 GREAT를 `6 → 3 → 1`로 적었지만 같은 줄에서 규칙을 「절반씩」이라고 적었다.
 * 절반을 따르면 셋째 구간이 1.5u다. 표의 반올림이 아니라 **규칙 쪽**을 코드에 남긴다.
 */
const HITSTOP_SHAKE_SEGMENTS = 3;
const HITSTOP_SHAKE_SEGMENT_FALLOFF = 0.5;
/** 정지 구간 전체에 걸친 진동 주기 수. 부호가 바뀌어야 진동으로 읽히고, 한쪽으로 밀리면 이동이 된다 */
const HITSTOP_SHAKE_CYCLES = 6;

/**
 * 굽기 경로 — 06 §3.5 · §3.6
 *
 * P1 게이트가 실패했을 때 쓰는 **1순위 손잡이**(−392 드로우 콜)이고, **기본은 꺼져 있다.**
 * 켜는 것은 스테이지 진입 시 `bakeEnemyBodies`를 한 번 부르는 일이다.
 *
 * 굽는 것은 접지 그림자 + 본체뿐이다. 굽지 못하는 것이 셋이다.
 * - **헤더 글로우와 case 안의 glow** — `lighter` 합성이라 구우면 `source-over` `drawImage`로 나가
 *   가산 광채가 반투명 도장이 된다(12 §7.2가 반사탄 스트릭에 쓴 논거 그대로)
 * - **HP 바** — `hp / maxHp` 종속이라 프레임마다 다르다
 * - **firearcher** — case 안에서 glow를 **무조건** 부른다(engine.js:483·488). 위와 같은 이유로 제외한다
 *
 * 그리고 예비동작 중(`windup01 > 0`)·피격 플래시 중(`flash01 > 0`)에는 구운 장을 안 쓴다.
 * 둘 다 `hot`·`body` 색과 외곽선 굵기를 바꾸고, 예비동작은 그 위에 변환과 명암 띠까지 더한다.
 */
const BAKE_SUPERSAMPLE = 2;

/**
 * 9종 실루엣의 합집합 외곽. 개체 폭 `w`와 높이 `h` 대비다.
 * 좌: scout 목도리 `-1.5w`(engine.js:594) · 우: sashimono 깃발 `0.68w`(engine.js:373)
 * 상: sashimono 깃대 `-0.78h`(engine.js:368) · 하: charger 창끝 `1.42h`(engine.js:541)
 */
const BAKE_LEFT_SCALE = -1.62;
const BAKE_RIGHT_SCALE = 0.86;
const BAKE_TOP_SCALE = -0.9;
const BAKE_BOTTOM_SCALE = 1.52;

/**
 * 이 파일이 sim에서 읽는 전부. 필드는 목업의 `e`(engine.js:397-836)가 읽던 칸과 1:1이고,
 * 뒤의 다섯만 새로 붙었다.
 */
export interface EnemyView {
  /** 어느 실루엣을 그릴지. `config/enemies.ts`의 `shape` 열이 이 값을 고른다 (12 §8-10) */
  readonly shape: EnemySpriteId;
  /** 실루엣 폭 (u). `config/enemies.ts`의 `hitRadiusU`가 이 값 × 0.6에서 나왔다 */
  readonly widthU: number;
  readonly xU: number;
  readonly yU: number;
  /**
   * 발사 예비동작 진행도 [0,1]. 0이면 예비동작 중이 아니다 (목업 `e.charge`).
   * 1은 발사 직전이다 — 크기 축과 명암 축이 이 값 하나로 움직인다.
   */
  readonly windup01: number;
  /**
   * 남은 예비동작 시간 (초). 진행도와 따로 필요한 이유는 반동이 **마지막 0.08초에만** 걸리는데
   * 예비동작 전체 길이가 스테이지마다 다르기 때문이다(`config/difficulty.ts`의 `tellSec`).
   */
  readonly windupRemainingSec: number;
  /** 발사 방향 단위 벡터. 반동 축과 명암 띠의 축이다. 안 쏘는 개체는 (0, 1) — 화면 아래다 */
  readonly aimXU: number;
  readonly aimYU: number;
  /** 피격 플래시 [0,1] (목업 `e.flash`). 반사탄이 유효했다는 확인이다 */
  readonly flash01: number;
  /** §7.3 다케타바가 남아 있나 (목업 `e.shield`). `shield` 말고는 아무 case도 안 읽는다 */
  readonly frontShieldIntact: boolean;
  readonly hp: number;
  readonly maxHp: number;
  /**
   * HP 바를 안 그린다 (목업 `e.nobar`). 두 자리가 이 값을 참으로 준다 —
   * 보스 본체(§15.1대로 화면 상단 바를 쓴다)와 **B1 부하 조총병 5기**다.
   * 후자는 HP를 개별로 갖지 않고 B1 단일 풀을 공유하므로 개별 바가 거짓말이 된다(12 §8-16, 10 A14).
   */
  readonly noHpBar: boolean;
  /**
   * 접지 그림자를 안 그린다. **B1 부하 조총병 5기**가 유일한 자리다 — 방진 대장의 진막 앞에
   * 서 있어서 물이나 땅에 닿아 있지 않다(06 §1.6 「B1 부하 조총병 5기」 행).
   */
  readonly noContactShadow: boolean;
  /**
   * 잡몹 HP 바 대신 부위 게이지를 그린다. **B3 아타케부네의 포문 4기**가 그 자리다 —
   * 개별 HP 300을 갖는 파괴 가능 부위이고 §15.1이 "개별 게이지 표시"를 요구한다.
   * 같은 `port` 실루엣이라도 잡몹 E-I 함포문으로 나온 개체는 거짓이고 보통 HP 바를 받는다.
   */
  readonly partGauge: boolean;
}

/**
 * 히트스톱 한 벌. **프레임에 하나뿐이다** — 히트스톱은 전역이므로 호출부가 프레임마다 한 번
 * 만들어 모든 개체에 같은 것을 넘긴다.
 */
export interface HitstopShake {
  /** 이 히트스톱을 만든 패리 등급. 시작 진폭이 여기서 갈린다 */
  readonly gradeId: ParryGradeId;
  /** 정지 구간의 경과 비율 [0,1] */
  readonly progress01: number;
  /**
   * 진동 축 (rad). **히트스톱이 시작되는 프레임에 render 전용 시드 스트림에서 한 번 뽑는다**(D-05).
   * 매 프레임 다시 뽑으면 축이 흔들려 진동이 아니라 잡음이 되고, 전역 난수(`Math`의 `random`)는
   * D-05의 결정론과 §7의 촬영 재현을 함께 깬다.
   */
  readonly angleRad: number;
}

/** 스테이지 진입 시 구울 목록의 한 줄. 폭이 키에 들어가는 이유는 두 아키타입이 같은 실루엣을 다른 폭으로 쓰기 때문이다 */
export interface EnemyBodyBakeSpec {
  readonly shape: EnemySpriteId;
  readonly widthU: number;
}

interface BakedEnemyBody {
  readonly image: CanvasImageSource;
  readonly leftU: number;
  readonly topU: number;
  readonly widthU: number;
  readonly heightU: number;
}

const bakedBodies = new Map<string, BakedEnemyBody>();

/** 굽기 경로의 스위치. 기본은 꺼짐이고 `bakeEnemyBodies`가 켠다 */
let bodyBakeEnabled = false;

function bodyBakeKey(shape: EnemySpriteId, widthU: number, frontShieldIntact: boolean): string {
  // 다케타바 유무가 그림을 가르는 것은 shield 하나뿐이다. 나머지는 한 장이면 된다
  const shieldPart = shape === 'shield' ? (frontShieldIntact ? 'i' : 'b') : '-';
  return `${shape}|${widthU}|${shieldPart}`;
}

/** 이 실루엣이 case 안에서 `lighter` 글로우를 무조건 부르는가. 그러면 구울 수 없다 */
function isBakeable(shape: EnemySpriteId): boolean {
  return shape !== 'firearcher';
}

/**
 * 스테이지 진입 시 한 번 부른다. 부르지 않으면 굽기 경로는 계속 꺼진 채이고 전부 직접 그린다.
 * 다시 부르면 이전 장을 버리고 새로 굽는다 — DPR 변경이 그렇게 동작해야 한다.
 */
export function bakeEnemyBodies(specs: readonly EnemyBodyBakeSpec[]): void {
  discardEnemyBodyBakes();
  for (const spec of specs) {
    if (!isBakeable(spec.shape)) {
      continue;
    }
    if (spec.shape === 'shield') {
      bakeOneBody(spec, true);
      bakeOneBody(spec, false);
    } else {
      bakeOneBody(spec, true);
    }
  }
  bodyBakeEnabled = bakedBodies.size > 0;
}

/**
 * 공통 헤더(engine.js:425-427)가 정하는 세 색. 06 §1.6이 그 헤더를 이 파일에 배정했고,
 * 보스는 그것을 `BossSilhouette`로 받는다(render/boss.ts) — 두 실루엣 계열이 같은 규칙으로
 * 밝아져야 §17의 "발사 예비동작은 본체의 상태 변화로 읽힌다"가 한 가지로 읽힌다.
 *
 * 색 상수 자체는 여기 밖으로 내보내지 않는다(위 BODY_IDLE 블록의 주석). 나가는 것은 계산 결과뿐이라
 * 나중에 그 넷을 config/로 옮기는 일은 여전히 이 파일 하나를 고치는 일로 남는다.
 */
export function enemyHeaderColors(
  windup01: number,
  flash01: number,
): { readonly hot: string; readonly body: string; readonly seam: string } {
  const windingUp = windup01 > 0;
  return {
    hot: windingUp ? PALETTE.jeokHot : PALETTE.jeok,
    body: flash01 > 0 ? PALETTE.hwangHot : (windingUp ? BODY_WINDUP : BODY_IDLE),
    seam: SEAM,
  };
}

/** 스테이지를 나가거나 backing store를 다시 만든 직후 부른다 */
export function discardEnemyBodyBakes(): void {
  bakedBodies.clear();
  bodyBakeEnabled = false;
}

function bakeOneBody(spec: EnemyBodyBakeSpec, frontShieldIntact: boolean): void {
  const w = spec.widthU;
  const h = w * BODY_HEIGHT_SCALE;
  const leftU = w * BAKE_LEFT_SCALE;
  const topU = h * BAKE_TOP_SCALE;
  const widthU = w * (BAKE_RIGHT_SCALE - BAKE_LEFT_SCALE);
  const heightU = h * (BAKE_BOTTOM_SCALE - BAKE_TOP_SCALE);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthU * BAKE_SUPERSAMPLE);
  canvas.height = Math.ceil(heightU * BAKE_SUPERSAMPLE);
  const bakeCtx = canvas.getContext('2d');
  if (bakeCtx === null) {
    throw new Error(`잡몹 본체 굽기의 2d 컨텍스트를 얻지 못했다: ${spec.shape}`);
  }
  bakeCtx.scale(BAKE_SUPERSAMPLE, BAKE_SUPERSAMPLE);
  bakeCtx.translate(-leftU, -topU);

  const view = bakeableView(spec, frontShieldIntact);
  drawContactShadow(bakeCtx, view, w);
  paintEnemyBody(bakeCtx, view, w, h);

  bakedBodies.set(bodyBakeKey(spec.shape, w, frontShieldIntact), {
    image: canvas,
    leftU,
    topU,
    widthU,
    heightU,
  });
}

/** 구울 수 있는 상태 그대로의 뷰. 예비동작·피격 플래시가 0이라 색과 변환이 고정된다 */
function bakeableView(spec: EnemyBodyBakeSpec, frontShieldIntact: boolean): EnemyView {
  return {
    shape: spec.shape,
    widthU: spec.widthU,
    xU: 0,
    yU: 0,
    windup01: 0,
    windupRemainingSec: 0,
    aimXU: 0,
    aimYU: 1,
    flash01: 0,
    frontShieldIntact,
    hp: 1,
    maxHp: 1,
    noHpBar: true,
    noContactShadow: false,
    partGauge: false,
  };
}

function bakedBodyFor(view: EnemyView): BakedEnemyBody | null {
  if (!bodyBakeEnabled || view.windup01 > 0 || view.flash01 > 0) {
    return null;
  }
  // 구운 장에 접지 그림자가 들어 있으므로 그림자를 빼야 하는 개체(B1 부하)는 직접 그린다
  if (view.noContactShadow) {
    return null;
  }
  return bakedBodies.get(bodyBakeKey(view.shape, view.widthU, view.frontShieldIntact)) ?? null;
}

/** 히트스톱 한 프레임의 진폭 (u). 부호가 바뀌므로 결과는 음수일 수 있다 */
function hitstopAmplitudeU(shake: HitstopShake): number {
  const progress = clamp01(shake.progress01);
  const segment = Math.min(
    Math.floor(progress * HITSTOP_SHAKE_SEGMENTS),
    HITSTOP_SHAKE_SEGMENTS - 1,
  );
  const decayed = HITSTOP_SHAKE_START_U[shake.gradeId]
    * HITSTOP_SHAKE_SEGMENT_FALLOFF ** segment;
  return decayed * Math.sin(progress * HITSTOP_SHAKE_CYCLES * FULL_TURN_RAD);
}

/**
 * 실루엣 축의 보간 계수 [0,1]. 예비동작이 끝날수록 1에 가까워진다.
 *
 * 진행도를 그대로 쓰지 않고 제곱근을 쓰는 이유는 자세 전환이 **일찍** 끝나야 하기 때문이다.
 * 총을 어깨에 올리는 동작이 발사 직전에야 완료되면 플레이어가 반응할 시간이 남지 않는다 —
 * 그 시간을 주는 것이 §15.1이 예비동작을 요구한 이유 전부다.
 */
function postureOf(view: EnemyView): number {
  return Math.sqrt(clamp01(view.windup01));
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawEnemy (397-836)의 잡몹 9종 — 06 §1.6
 *
 * 원본 구조를 그대로 지킨다: 글로우 헤더 → 접지 그림자 → 본체 → `restore` → HP 바.
 * 새로 붙은 것은 세 자리뿐이고 셋 다 위 상수 블록에 근거가 있다 —
 * 히트스톱 진동 변위(12 §8-3), 예비동작 크기·운동 변환(12 §7.5-정정), 부위 게이지(§15.1).
 *
 * `shake`는 히트스톱이 안 걸린 프레임에서 null이다.
 */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  view: EnemyView,
  shake: HitstopShake | null,
): void {
  const w = view.widthU;
  const h = w * BODY_HEIGHT_SCALE;

  // 판정은 (view.xU, view.yU) 그대로다. 아래 변위는 그려지는 자리에만 걸린다
  let shakeXU = 0;
  let shakeYU = 0;
  if (shake !== null) {
    const amplitudeU = hitstopAmplitudeU(shake);
    shakeXU = Math.cos(shake.angleRad) * amplitudeU;
    shakeYU = Math.sin(shake.angleRad) * amplitudeU;
  }

  ctx.save();
  ctx.translate(view.xU + shakeXU, view.yU + shakeYU);

  drawGlowHeader(ctx, view, w);

  const baked = bakedBodyFor(view);
  if (baked !== null) {
    ctx.drawImage(baked.image, baked.leftU, baked.topU, baked.widthU, baked.heightU);
  } else {
    drawContactShadow(ctx, view, w);
    ctx.save();
    applyWindupTransform(ctx, view);
    paintEnemyBody(ctx, view, w, h);
    ctx.restore();
  }

  ctx.restore();

  // 여기부터 월드 좌표다 — 목업의 ctx.restore()(engine.js:828) 뒤 자리. 진동 변위는 함께 간다:
  // 바가 몸에 붙어 있어야 어느 개체의 HP인지 읽힌다
  const barXU = view.xU + shakeXU;
  const barYU = view.yU + shakeYU;
  if (view.partGauge) {
    drawPartHpGauge(ctx, barXU, barYU, view.hp, view.maxHp);
  } else {
    drawEnemyHpBar(ctx, barXU, barYU, w, view.hp, view.maxHp, view.noHpBar);
  }
}

/** 이식: engine.js drawEnemy 403-414 — 그대로 */
function drawGlowHeader(ctx: CanvasRenderingContext2D, view: EnemyView, w: number): void {
  const gr = Math.min(w * GLOW_RADIUS_WIDTH_SCALE, GLOW_RADIUS_MAX_U);
  if (view.windup01 > 0) {
    // 후광이 커지되 상한이 있다. 큰 후광은 "빛"으로 읽히고 실루엣을 삼켜, 곧 쏜다는 뜻을 잃는다
    const c = clamp01(view.windup01);
    glow(
      ctx,
      0,
      0,
      gr * (GLOW_WINDUP_BASE_SCALE + c * GLOW_WINDUP_SCALE_GAIN),
      PALETTE.jeokHot,
      GLOW_WINDUP_BASE_ALPHA + c * GLOW_WINDUP_ALPHA_GAIN,
    );
  } else {
    glow(ctx, 0, 0, gr * GLOW_IDLE_SCALE, PALETTE.jeok, GLOW_IDLE_ALPHA);
  }
  if (view.flash01 > 0) {
    glow(ctx, 0, 0, gr * GLOW_FLASH_SCALE, PALETTE.hwangHot, view.flash01 * GLOW_FLASH_ALPHA);
  }
}

/** 이식: engine.js drawEnemy 416-423 — 그대로. 평평한 도형을 바닥에서 띄운다 */
function drawContactShadow(ctx: CanvasRenderingContext2D, view: EnemyView, w: number): void {
  if (w > CONTACT_SHADOW_MAX_WIDTH_U || view.noContactShadow) {
    return;
  }
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(0, w * 0.62, w * 0.42, w * 0.13, 0, 0, FULL_TURN_RAD);
  ctx.fill();
}

/**
 * 신규: 예비동작의 크기 축과 운동 축 — 12 §7.5-정정
 *
 * 접지 그림자 **뒤**에 거는 것이 규칙이다. 그림자는 땅에 있는 것이라 몸이 커지거나 물러나도
 * 따라 움직이면 안 된다. 그림자가 같이 움직이면 개체가 뜬 것처럼 보인다.
 */
function applyWindupTransform(ctx: CanvasRenderingContext2D, view: EnemyView): void {
  if (view.windup01 <= 0) {
    return;
  }
  // 반동: 남은 시간이 창 안에 들어온 순간부터 물러났다 발사 시점에 0으로 돌아온다
  if (view.windupRemainingSec < WINDUP_RECOIL_WINDOW_SEC) {
    const into = clamp01(1 - view.windupRemainingSec / WINDUP_RECOIL_WINDOW_SEC);
    const backU = Math.sin(into * Math.PI) * WINDUP_RECOIL_U;
    ctx.translate(-view.aimXU * backU, -view.aimYU * backU);
  }
  // 크기: 등방이다. 스쿼시가 아니다 — 눌리면 피격 반응으로 읽힌다(§4.8은 라이프 pip의 것이다)
  const scale = 1 + Math.sin(clamp01(view.windup01) * Math.PI) * WINDUP_SCALE_GAIN;
  ctx.scale(scale, scale);
}

/**
 * 신규: 예비동작의 명암 축 — 12 §7.5-정정
 *
 * 본체 안을 어두운 띠 하나가 총구 쪽으로 쓸고 간다. 클립 타원이 띠를 실루엣 안에 가두고,
 * `source-over`라 위에 얹힌 additive 더미가 아무리 밝아도 이 어두움은 남는다.
 * 드로우 콜은 fill 1회다 — `clip()`은 클리핑 영역만 바꾸므로 드로우 콜이 아니다(06 §3.5).
 */
function drawWindupShade(
  ctx: CanvasRenderingContext2D,
  view: EnemyView,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    0,
    h * WINDUP_SHADE_CLIP_CENTER_Y_SCALE,
    w * WINDUP_SHADE_CLIP_RX_SCALE,
    h * WINDUP_SHADE_CLIP_RY_SCALE,
    0,
    0,
    FULL_TURN_RAD,
  );
  ctx.clip();
  ctx.rotate(Math.atan2(view.aimYU, view.aimXU));
  const travelU = h * WINDUP_SHADE_TRAVEL_SCALE;
  const halfWidthU = h * WINDUP_SHADE_HALF_WIDTH_SCALE;
  const centerU = lerp(-travelU, travelU, clamp01(view.windup01));
  ctx.fillStyle = WINDUP_SHADE;
  ctx.fillRect(centerU - halfWidthU, -travelU, halfWidthU * 2, travelU * 2);
  ctx.restore();
}

/**
 * 이식: engine.js drawEnemy 425-827 — 잡몹 9종. 헤더 색 셋과 switch가 원본 순서 그대로다.
 *
 * **이 함수는 ctx 상태를 되돌리지 않는다.** case 코드가 부품 함수(render/enemy-parts.ts)가 남긴
 * fillStyle·strokeStyle·lineWidth 위에서 이어 그린다 — 예를 들어 gunner 몸통의 fill/stroke(441)는
 * 여기 425-430이 정한 body/hot이 아니라 바로 앞 `sashimono`(438)가 남긴 값이다. 상태 누수가 결과물의
 * 일부라 save/restore로 감싸면 승인된 그림이 바뀐다.
 *
 * 굽기 경로가 이 함수를 오프스크린에도 그대로 돌린다. 프레임에서 그리는 것과 다른 코드가 되면
 * 굽기를 켠 순간 그림이 바뀐다.
 */
function paintEnemyBody(
  ctx: CanvasRenderingContext2D,
  view: EnemyView,
  w: number,
  h: number,
): void {
  const windingUp = view.windup01 > 0;
  const { hot, body, seam } = enemyHeaderColors(view.windup01, view.flash01);
  ctx.lineWidth = windingUp ? OUTLINE_WIDTH_WINDUP : OUTLINE_WIDTH_IDLE;
  ctx.strokeStyle = hot;
  ctx.fillStyle = body;
  const posture = postureOf(view);

  switch (view.shape) {
    case 'gunner': {
      // 이식: engine.js 437-455. 수정은 총 자세 하나 — 12 §7.5-정정의 실루엣 축이다
      sashimono(ctx, w, h, BANNER_POLE);
      poly(ctx, [
        [-w * 0.28, -h * 0.14], [w * 0.28, -h * 0.14], [w * 0.34, h * 0.46],
        [0, h * 0.62], [-w * 0.34, h * 0.46],
      ]);
      ctx.fill(); ctx.stroke();
      lamellae(ctx, w * 0.29, h * 0.02, h * 0.44, 3, seam);
      /* 허리 끈 */
      ctx.strokeStyle = WAIST_CORD; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.2); ctx.lineTo(w * 0.3, h * 0.2); ctx.stroke();
      /* 조총. 예비동작이 진행될수록 개머리판이 어깨로 올라가고 총구가 수직에 가까워진다 —
         목업의 고정 좌표 (-0.16w, 0.10h)→(0.08w, 1.08h)가 자세 0의 값이다 */
      const buttXU = lerp(-w * 0.16, -w * 0.3, posture);
      const buttYU = lerp(h * 0.1, -h * 0.06, posture);
      const muzzleXU = lerp(w * 0.08, w * 0.02, posture);
      ctx.strokeStyle = hot; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(buttXU, buttYU); ctx.lineTo(muzzleXU, h * 1.08); ctx.stroke();
      ctx.strokeStyle = MATCH_CORD; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w * 0.2, h * 0.02); ctx.lineTo(-w * 0.06, h * 0.24); ctx.stroke();
      ctx.fillStyle = hot;
      ctx.beginPath(); ctx.arc(muzzleXU, h * 1.08, w * 0.07, 0, FULL_TURN_RAD); ctx.fill();
      // 불붙은 화승. 개머리판을 따라간다 — 안 따라가면 총과 분리돼 떠 보인다
      if (windingUp) { glow(ctx, buttXU, buttYU - h * 0.04, 22, PALETTE.hwang, 0.7); }
      visor(ctx, w, -h * 0.13, hot);
      jingasa(ctx, -h * 0.16, w * 0.56, w * 0.28, hot);
      break;
    }

    case 'archer':
    case 'firearcher': {
      // 이식: engine.js 457-492. 두 아키타입이 몸통을 공유하고 481-489만 갈린다
      /* 화살통을 먼저 — 깃이 어깨 뒤에 놓여야 한다 */
      ctx.strokeStyle = QUIVER_SHAFT; ctx.lineWidth = 3;
      for (let q = -1; q <= 1; q += 1) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.34, -h * 0.1);
        ctx.lineTo(-w * 0.46 + q * w * 0.06, -h * 0.5);
        ctx.stroke();
      }
      poly(ctx, [[0, h * 0.66], [w * 0.34, -h * 0.14], [-w * 0.34, -h * 0.14]]);
      ctx.fill(); ctx.stroke();
      lamellae(ctx, w * 0.22, h * 0.04, h * 0.5, 3, seam);
      /* 깊은 만곡궁. 제 몸보다 넓게 그린다 */
      ctx.strokeStyle = hot; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(0, h * 0.42, w * 0.58, -Math.PI * 0.46, Math.PI * 0.46); ctx.stroke();
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, h * 0.42, w * 0.72, -Math.PI * 0.2, Math.PI * 0.2); ctx.stroke();
      /* 시위. 예비동작 동안 오늬점이 뒤로 당겨진다 — 목업의 고정 w*0.3이 자세 0의 값이다 */
      const nockXU = lerp(w * 0.3, w * 0.46, posture);
      ctx.strokeStyle = BOW_STRING; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(-Math.PI * 0.46) * w * 0.58, h * 0.42 + Math.sin(-Math.PI * 0.46) * w * 0.58);
      ctx.lineTo(nockXU, h * 0.42);
      ctx.lineTo(Math.cos(Math.PI * 0.46) * w * 0.58, h * 0.42 + Math.sin(Math.PI * 0.46) * w * 0.58);
      ctx.stroke();
      if (view.shape === 'firearcher') {
        // 불씨는 오늬에 물린 화살촉이므로 시위와 함께 당겨진다
        const emberXU = nockXU + w * 0.04;
        glow(ctx, emberXU, h * 0.42, 40, PALETTE.hwang, 0.9);
        ctx.fillStyle = PALETTE.hwang;
        ctx.beginPath(); ctx.arc(emberXU, h * 0.42, 6, 0, FULL_TURN_RAD); ctx.fill();
        /* 화살에 불을 붙이는 화로 */
        ctx.strokeStyle = BRAZIER_RIM; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(-w * 0.44, h * 0.58, w * 0.14, Math.PI, 0); ctx.stroke();
        glow(ctx, -w * 0.44, h * 0.54, 26, PALETTE.hwang, 0.55);
      }
      visor(ctx, w, -h * 0.11, hot);
      jingasa(ctx, -h * 0.14, w * 0.5, w * 0.26, hot);
      break;
    }

    case 'shield': {
      // 이식: engine.js 494-533 — 그대로
      poly(ctx, [
        [-w * 0.26, -h * 0.12], [w * 0.26, -h * 0.12],
        [w * 0.26, h * 0.46], [-w * 0.26, h * 0.46],
      ]);
      ctx.fill(); ctx.stroke();
      visor(ctx, w, -h * 0.1, hot);
      jingasa(ctx, -h * 0.13, w * 0.46, w * 0.24, hot);
      /* 다케타바 — 묶은 대나무 방패. 살과 묶음줄이 "이 면은 막힌다"는 신호다.
         §7.3의 정면 반사탄 1회 무효화가 살아 있는 동안만 그려지고, 부서지면 기둥과 파편만 남는다 —
         그림이 곧 규칙이라 여기를 "예뻐 보이게" 고치면 판정과 화면이 어긋난다 */
      if (view.frontShieldIntact) {
        ctx.fillStyle = PAVISE_FACE;
        ctx.fillRect(-w * 0.66, h * 0.06, w * 1.32, h * 0.42);
        ctx.strokeStyle = PALETTE.baek; ctx.lineWidth = 4;
        ctx.strokeRect(-w * 0.66, h * 0.06, w * 1.32, h * 0.42);
        ctx.strokeStyle = PAVISE_SLAT; ctx.lineWidth = 3;
        for (let sl = 1; sl < 8; sl += 1) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.66 + sl * w * 0.165, h * 0.06);
          ctx.lineTo(-w * 0.66 + sl * w * 0.165, h * 0.48);
          ctx.stroke();
        }
        ctx.strokeStyle = PAVISE_BINDING; ctx.lineWidth = 2.4;
        for (const f of [0.18, 0.36]) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.66, h * (0.06 + f)); ctx.lineTo(w * 0.66, h * (0.06 + f));
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = PAVISE_STUMP; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-w * 0.66, h * 0.06); ctx.lineTo(-w * 0.28, h * 0.06);
        ctx.moveTo(w * 0.28, h * 0.06); ctx.lineTo(w * 0.66, h * 0.06);
        ctx.moveTo(-w * 0.66, h * 0.06); ctx.lineTo(-w * 0.66, h * 0.28);
        ctx.moveTo(w * 0.66, h * 0.06); ctx.lineTo(w * 0.66, h * 0.28);
        ctx.stroke();
        ctx.strokeStyle = PAVISE_SPLINTER; ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, h * 0.3); ctx.lineTo(-w * 0.34, h * 0.48);
        ctx.moveTo(w * 0.46, h * 0.32); ctx.lineTo(w * 0.6, h * 0.5);
        ctx.stroke();
      }
      break;
    }

    case 'charger': {
      // 이식: engine.js 535-555 — 그대로
      /* 야리 — 창이 앞서고 목깃에 붉은 술이 달린다 */
      ctx.strokeStyle = hot; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -h * 0.2); ctx.lineTo(0, h * 1.15); ctx.stroke();
      ctx.fillStyle = hot;
      poly(ctx, [[0, h * 1.42], [w * 0.13, h * 1.0], [-w * 0.13, h * 1.0]]);
      ctx.fill();
      ctx.strokeStyle = SPEAR_TASSEL; ctx.lineWidth = 3;
      for (let ts = -1; ts <= 1; ts += 1) {
        ctx.beginPath();
        ctx.moveTo(0, h * 0.98);
        ctx.quadraticCurveTo(ts * w * 0.14, h * 0.86, ts * w * 0.2, h * 0.72);
        ctx.stroke();
      }
      ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 3.4;
      poly(ctx, [
        [0, h * 0.72], [w * 0.46, -h * 0.06], [w * 0.2, -h * 0.2],
        [-w * 0.2, -h * 0.2], [-w * 0.46, -h * 0.06],
      ]);
      ctx.fill(); ctx.stroke();
      lamellae(ctx, w * 0.3, h * 0.06, h * 0.5, 2, seam);
      visor(ctx, w, -h * 0.18, hot);
      jingasa(ctx, -h * 0.2, w * 0.44, w * 0.22, hot);
      break;
    }

    case 'cannoneer': {
      // 이식: engine.js 557-586 — 그대로
      /* 장비로 그려지는 유일한 잡몹: 바퀴 달린 포가, 테를 두른 포신, 화약통과 도화선 */
      spokedWheel(ctx, -w * 0.5, h * 0.1, w * 0.19, WHEEL_RIM);
      spokedWheel(ctx, w * 0.5, h * 0.1, w * 0.19, WHEEL_RIM);
      ctx.fillStyle = body;
      poly(ctx, [
        [-w * 0.48, -h * 0.38], [w * 0.48, -h * 0.38],
        [w * 0.4, h * 0.3], [-w * 0.4, h * 0.3],
      ]);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = seam; ctx.lineWidth = 2.4;
      for (let bn = 0; bn < 3; bn += 1) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.46 + bn * 2, -h * 0.24 + bn * h * 0.16);
        ctx.lineTo(w * 0.46 - bn * 2, -h * 0.24 + bn * h * 0.16);
        ctx.stroke();
      }
      ctx.fillStyle = BORE_MOUTH;
      ctx.beginPath(); ctx.arc(0, h * 0.16, w * 0.2, 0, FULL_TURN_RAD); ctx.fill();
      ctx.strokeStyle = hot; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, h * 0.2, w * 0.25, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, h * 0.2, w * 0.34, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
      /* 도화선. 예비동작 동안 불이 붙어 있다 */
      ctx.strokeStyle = windingUp ? PALETTE.hwang : FUSE_UNLIT;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -h * 0.34);
      ctx.quadraticCurveTo(-w * 0.42, -h * 0.5, -w * 0.3, -h * 0.6);
      ctx.stroke();
      if (windingUp) { glow(ctx, -w * 0.3, -h * 0.6, 24, PALETTE.hwang, 0.8); }
      break;
    }

    case 'scout': {
      // 이식: engine.js 588-608 — 그대로
      /* 얇고 두건을 쓴, 목도리를 끄는 유일한 잡몹 */
      ctx.strokeStyle = SCARF_NEAR; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.3);
      ctx.quadraticCurveTo(-w * 0.9, -h * 0.55, -w * 1.5, -h * 0.05);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = SCARF_FAR;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.24);
      ctx.quadraticCurveTo(-w * 0.85, -h * 0.3, -w * 1.35, h * 0.2);
      ctx.stroke();
      ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 3.4;
      poly(ctx, [[0, -h * 0.62], [w * 0.3, 0], [0, h * 0.74], [-w * 0.3, 0]]);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = seam; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-w * 0.22, h * 0.06); ctx.lineTo(w * 0.22, h * 0.06); ctx.stroke();
      visor(ctx, w, -h * 0.32, hot);
      jingasa(ctx, -h * 0.34, w * 0.4, w * 0.18, hot);
      break;
    }

    case 'priest': {
      // 이식: engine.js 610-635 — 그대로
      /* 승병 — 게임의 모든 링 패턴이 나온 염주 고리, 그리고 그것을 울리는 석장 */
      ctx.strokeStyle = STAFF_SHAFT; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(w * 0.5, -h * 0.5); ctx.lineTo(w * 0.5, h * 0.6); ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let rg = -1; rg <= 1; rg += 1) {
        ctx.beginPath();
        ctx.arc(w * 0.5 + rg * w * 0.09, -h * 0.52, w * 0.06, 0, FULL_TURN_RAD);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.4, 0, FULL_TURN_RAD); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = seam; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.26, 0, FULL_TURN_RAD); ctx.stroke();
      ctx.fillStyle = hot;
      for (let bd = 0; bd < 12; bd += 1) {
        const a2 = (bd / 12) * FULL_TURN_RAD;
        ctx.beginPath();
        ctx.arc(Math.cos(a2) * w * 0.74, h * 0.04 + Math.sin(a2) * w * 0.74, w * 0.062, 0, FULL_TURN_RAD);
        ctx.fill();
      }
      ctx.strokeStyle = BEAD_THREAD; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.74, 0, FULL_TURN_RAD); ctx.stroke();
      visor(ctx, w, -h * 0.22, hot);
      jingasa(ctx, -h * 0.3, w * 0.58, w * 0.26, hot);
      break;
    }

    case 'port': {
      // 이식: engine.js 637-662 — 그림은 그대로. 수정은 그림 밖의 부위 게이지 하나뿐이고
      // drawEnemy가 월드 좌표에서 그린다(§15.1 · 06 §1.6 `port` 행)
      /* 판재에 뚫은 포문, 젖혀 올린 덧문, 밀어낸 포신 */
      ctx.fillStyle = PORT_PLANKING;
      poly(ctx, [
        [-w / 2, -h * 0.28], [w / 2, -h * 0.28],
        [w / 2, h * 0.34], [-w / 2, h * 0.34],
      ]);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = PORT_PLANK_SEAM; ctx.lineWidth = 2;
      for (let pk = 0; pk < 3; pk += 1) {
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h * 0.14 + pk * h * 0.16);
        ctx.lineTo(w / 2, -h * 0.14 + pk * h * 0.16);
        ctx.stroke();
      }
      ctx.fillStyle = SHUTTER_FACE;
      ctx.fillRect(-w * 0.44, -h * 0.52, w * 0.88, h * 0.22);
      ctx.strokeStyle = SHUTTER_EDGE; ctx.lineWidth = 2;
      ctx.strokeRect(-w * 0.44, -h * 0.52, w * 0.88, h * 0.22);
      ctx.fillStyle = BORE_MOUTH;
      ctx.beginPath(); ctx.arc(0, h * 0.08, w * 0.19, 0, FULL_TURN_RAD); ctx.fill();
      ctx.strokeStyle = hot; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, h * 0.08, w * 0.24, 0, FULL_TURN_RAD); ctx.stroke();
      ctx.strokeStyle = PORT_TACKLE; ctx.lineWidth = 2.4;
      for (const k of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(k * w * 0.24, h * 0.08); ctx.lineTo(k * w * 0.46, h * 0.3);
        ctx.stroke();
      }
      break;
    }
  }

  if (windingUp) {
    drawWindupShade(ctx, view, w, h);
  }
}
