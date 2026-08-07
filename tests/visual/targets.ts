/**
 * 고정 대상 6장과 마스킹 — 09 §5.5(어느 화면을 고정하는가) · §5.4(무엇을 가리는가).
 *
 * 여기 있는 좌표는 하나도 새로 적은 것이 아니다. 전부 `src/config/ui.ts`에서 읽는다 —
 * HUD가 어디 그려지는지를 이 파일이 따로 알면 UI 좌표를 옮긴 사람이 마스크를 같이 못 옮기고,
 * 그러면 마스크가 빗나간 자리에서 하네스가 폰트 차이를 회귀로 신고한다.
 *
 * `at` 값도 지어낸 것이 아니라 목업 `scene.js`가 발행한 그 프레임이다 (`?at=` 없이 열었을 때와
 * 같은 순간). 값을 바꾸면 09 §5.5가 "이 화면이 잠근다"고 적은 규칙이 화면에서 사라진다.
 */

import { PLAYFIELD } from '../../src/config/playfield';
import { UI } from '../../src/config/ui';
import type { MaskRect } from './compare';

/** 고정 대상 하나 */
export interface VisualTarget {
  /** 목업 폴더 이름 그대로. 리포트의 행 이름이자 산출 파일 이름이다 */
  readonly id: string;
  /** `docs/sample_image/` 아래 상대 경로 */
  readonly dir: string;
  /** 목업 `scene.js`가 발행한 프레임의 시각 (초). `?at=`으로 넘긴다 */
  readonly atSec: number;
  /** 09 §5.5의 "그 화면이 잠그는 것" 칸 그대로 */
  readonly locks: string;
  /** 목업 `BG` 키. 정적 굽기 대조가 이 키로 배경 함수를 찾는다 */
  readonly backgroundKey: string;
  /**
   * 09 §5.4-3 — 기준선을 아직 고정하면 안 되는 이유들.
   *
   * 사각형으로 못 가리는 판정이 여기 온다. 탄환 다섯 발의 위치가 통째로 바뀌는 판정은
   * 마스크가 화면의 절반이 되어 대조 자체를 무의미하게 만들기 때문이다. 비어 있는 프레임만
   * 기준선을 고정할 수 있다.
   */
  readonly baselineBlockers: readonly BaselineBlocker[];
}

export interface BaselineBlocker {
  /** 판정 ID(`A5`)나 문서 절(`06 §4.5`) */
  readonly ruling: string;
  readonly why: string;
}

/** 09 §5.5의 필수 6장. 권장 3장(13 · 11 · 06)은 여기 없다 — 게이트가 6장이다 */
export const VISUAL_TARGETS: readonly VisualTarget[] = [
  {
    id: '12_parry_moment',
    dir: '12_parry_moment',
    atSec: 2.32,
    locks: '등급 밴드 · 반사 공식 · 동시 반사 · 코어 비가림',
    backgroundKey: 'hansando',
    baselineBlockers: [
      {
        ruling: '06 §4.5',
        why: '임팩트 프레임(레이어 6.5)은 목업에 없는 신규 층이다. 이 프레임이 히트스톱 구간이면 게임은 전면 백색 채움을 그리고 목업은 안 그린다',
      },
      {
        ruling: '06 §1.11 · D-05',
        why: '이 프레임에만 처치 파편 14개가 있고, 목업 burst가 Math.random()으로 뽑는다. 같은 프레임을 두 번 띄우기만 해도 파편 자리가 달라진다 — 목업이 결정론적이지 않은 유일한 층이다',
      },
    ],
  },
  {
    id: '01_stage1_busanjin',
    dir: '01_stage1_busanjin',
    atSec: 4.25,
    locks: '§15.1 HUD 전 요소 — 라이프 · 점수 · 콤보 · 쿨다운 링 · 코어 · 진행도',
    backgroundKey: 'busanjin',
    baselineBlockers: [
      {
        ruling: 'A15',
        why: 'E-B 3발 부채꼴의 예비동작 시간이 0.95초에서 0.4초로 바뀐다. 적의 charge 발광 상태가 달라지므로 적 실루엣 주변 픽셀이 통째로 어긋난다',
      },
    ],
  },
  {
    id: '07_stage4_haengju',
    dir: '07_stage4_haengju',
    atSec: 3.0,
    locks: '패리 불가 화염 장판 — 색이 아니라 형태(해칭)로 구분한다는 §17',
    backgroundKey: 'haengju',
    baselineBlockers: [
      {
        ruling: 'A6',
        why: 'E-H 불화살 2발의 확산이 ±5°에서 ±10°로 바뀌어 탄 위치가 갈린다',
      },
      {
        ruling: 'A15',
        why: 'E-H 2발 부채꼴도 예비동작 0.55초 → 0.4초다',
      },
      {
        ruling: 'A9 · A16',
        why: 'E-F 척후의 편성 수(2 → 4)와 이동 속도(450 → 420 u/s)가 둘 다 바뀐다',
      },
    ],
  },
  {
    id: '09_stage5_noryang',
    dir: '09_stage5_noryang',
    atSec: 3.25,
    locks: '잡몹 20기 밀도 + 관통 대창 예고선 (예고 3종 중 하나)',
    backgroundKey: 'noryang',
    baselineBlockers: [
      {
        ruling: 'A13',
        why: 'E-F 셋째 기가 y = 1040에서 990으로 내려온다. §3.1의 적 활동 영역 상한이 1000u다',
      },
      {
        ruling: 'A9 · A16',
        why: 'E-F 편성 수와 이동 속도가 바뀐다',
      },
      {
        ruling: '06 §1.9',
        why: '번개(engine.js:1608-1619)가 정적 굽기에서 빠지고 간헐 이벤트가 된다. 목업은 이 프레임에 번개를 붙잡아 두었다',
      },
    ],
  },
  {
    id: '08_boss4_daetong',
    dir: '08_boss4_daetong',
    atSec: 5.0,
    locks: '착탄 예고 원 + 장판 누적 (예고 3종 중 둘째)',
    backgroundKey: 'haengju',
    baselineBlockers: [],
  },
  {
    id: '04_boss2_samurai',
    dir: '04_boss2_samurai',
    atSec: 6.5,
    locks: '돌진 방향선(회피) vs 참격파(패리) — HR-05의 교육 구조가 한 화면에 있는 유일한 자리',
    backgroundKey: 'dongnae',
    baselineBlockers: [
      {
        ruling: 'A18',
        why: '페이즈 2에 페이즈 1 패턴인 투척 수리검이 섞여 있다. 게임은 그 자리에 참격파 4연발을 그리므로 탄환이 통째로 다른 물건이 된다',
      },
      {
        ruling: 'A5',
        why: '수리검이 남는다 해도 확산이 ±72°에서 ±36°로 좁아진다',
      },
    ],
  },
];

/**
 * 고정폭 서체의 글자당 전진폭 어림값 (em 대비).
 *
 * HUD는 전부 `FONTS.data`(IBM Plex Mono 계열)로 그려지고 그 계열의 전진폭이 0.6em이다.
 * 마스크를 넉넉하게 잡으려고 조금 키운 값이며, 정밀할 필요가 없다 — 마스크가 몇 u 넓은 것은
 * 손해가 없고 좁은 것은 폰트 차이가 회귀로 새는 구멍이다.
 */
const MONO_ADVANCE_PER_PX = 0.66;

/** 텍스트 상자를 글리프 바깥으로 밀어내는 여유 (u). 밑줄 삐침과 글로우가 이 안에 들어온다 */
const TEXT_MASK_PAD_U = 10;

type TextAlign = 'left' | 'center' | 'right';

/**
 * 베이스라인과 정렬 기준으로 텍스트가 차지할 상자를 만든다.
 *
 * 상자의 위쪽을 글자 크기의 1.1배까지 올리는 것은 한글 글리프가 라틴 대문자보다 위로 더
 * 올라가기 때문이다. 아래는 0.35배 — 고정폭 서체의 디센더가 그 안에 들어온다.
 */
function textMask(
  align: TextAlign,
  anchorXU: number,
  baselineYU: number,
  px: number,
  maxChars: number,
  reason: string,
): MaskRect {
  const widthU = px * MONO_ADVANCE_PER_PX * maxChars + TEXT_MASK_PAD_U * 2;
  const leftU =
    align === 'left'
      ? anchorXU - TEXT_MASK_PAD_U
      : align === 'right'
        ? anchorXU + TEXT_MASK_PAD_U - widthU
        : anchorXU - widthU / 2;
  return {
    xU: leftU,
    yU: baselineYU - px * 1.1 - TEXT_MASK_PAD_U,
    widthU,
    heightU: px * 1.45 + TEXT_MASK_PAD_U * 2,
    kind: 'text',
    reason,
  };
}

/** §15.1 점수는 최대 7자리 + 쉼표 2개 */
const SCORE_MAX_CHARS = 9;
/** §15.1 'STAGE 5 · W5  1:04 / 1:10' 길이 */
const STAGE_LABEL_MAX_CHARS = 26;
/** §15.1 '{보스 이름}  ·  PHASE n'. 보스 이름이 가장 긴 것은 'B1 조총 방진 대장'이다 */
const BOSS_LABEL_MAX_CHARS = 30;
/** §15.1 콤보 수는 최대 3자리 + 배수 '×3.0' */
const COMBO_COUNT_MAX_CHARS = 3;
const COMBO_MULT_MAX_CHARS = 5;
/** §15.1 음소거 표시 'MUTE' */
const MUTE_MAX_CHARS = 5;

/**
 * 프레임과 무관하게 언제나 붙는 마스크.
 *
 * 보스 이름과 콤보는 그 프레임에 그것이 없어도 마스크를 남긴다 — 마스크 목록이 프레임마다
 * 갈리면 "왜 이 프레임만 여기가 가려졌나"를 매번 다시 확인해야 한다. 빈 자리를 가려서
 * 잃는 것은 없다.
 */
export function staticMasks(): readonly MaskRect[] {
  const hud = UI.hud;
  return [
    textMask(
      'right',
      hud.score.rightXU,
      hud.score.valueBaselineYU,
      hud.score.valuePx,
      SCORE_MAX_CHARS,
      '09 §5.4-1 점수 값 — 폰트 대체로 자간이 흔들린다',
    ),
    textMask(
      'right',
      hud.score.rightXU,
      hud.score.labelBaselineYU,
      hud.score.labelPx,
      'SCORE'.length,
      "09 §5.4-1 'SCORE' 라벨",
    ),
    textMask(
      'center',
      hud.stage.centerXU,
      hud.stage.labelBaselineYU,
      hud.stage.labelPx,
      STAGE_LABEL_MAX_CHARS,
      '09 §5.4-1 스테이지·웨이브 라벨',
    ),
    textMask(
      'left',
      hud.boss.xU,
      hud.boss.nameBaselineYU,
      hud.boss.namePx,
      BOSS_LABEL_MAX_CHARS,
      '09 §5.4-1 보스 이름 + PHASE',
    ),
    textMask(
      'left',
      hud.combo.leftXU,
      hud.combo.countBaselineYU,
      hud.combo.countPx,
      COMBO_COUNT_MAX_CHARS,
      '09 §5.4-1 콤보 수',
    ),
    textMask(
      'left',
      hud.combo.multiplierXU,
      hud.combo.multiplierBaselineYU,
      hud.combo.multiplierPx,
      COMBO_MULT_MAX_CHARS,
      "09 §5.4-1 콤보 배수. 위치 자체도 A21 판정으로 바뀐다 — 목업은 measureText 결과, 게임은 고정 220u",
    ),
    textMask(
      'left',
      hud.combo.leftXU,
      hud.combo.labelBaselineYU,
      hud.combo.labelPx,
      'COMBO'.length,
      "09 §5.4-1 'COMBO' 라벨",
    ),
    {
      // A11 — 목업 게이지는 `1 − ((t % 3) / 3)`인 벽시계 톱니파다. 게임은 마지막 패리
      // 시각에서 계산하므로 같은 프레임에서 채움 폭이 다르다. 그림이 아니라 값의 차이다
      xU: UI.hud.combo.gaugeXU - 4,
      yU: UI.hud.combo.gaugeYU - 4,
      widthU: UI.hud.combo.gaugeWidthU + 8,
      heightU: UI.hud.combo.gaugeHeightU + 8,
      kind: 'ruling',
      reason: 'A11 콤보 감쇠 게이지 — 목업은 t 기반 톱니파, 게임은 마지막 패리 시각 기반',
    },
    {
      ...textMask(
        'right',
        UI.hud.mute.rightXU,
        UI.hud.mute.baselineYU,
        UI.hud.mute.px,
        MUTE_MAX_CHARS,
        '',
      ),
      kind: 'new-element',
      reason: '§15.1 음소거 표시 — 목업 drawHud에 없던 요소다 (06 §1.10)',
    },
  ];
}

/**
 * 치트 오염 표시(§18.5)가 그려질 자리. **마스크가 아니다.**
 *
 * 09 §5.6이 이 띠가 박힌 화면을 실격 사유로 지목했으므로 가리면 안 된다 — 오염된 런으로 찍은
 * 기준선은 그 사실이 픽셀로 남아 있어야 사람이 잡는다. 리포트가 이 영역의 차이를 따로 세는 것은
 * 대조가 아니라 경고를 띄우기 위해서다.
 */
export function cheatMarkRegion(): MaskRect {
  return {
    xU: UI.hud.cheatMark.xU,
    yU: UI.hud.cheatMark.yU,
    widthU: UI.hud.cheatMark.widthU,
    heightU: UI.hud.cheatMark.heightU,
    kind: 'ruling',
    reason: '§18.5 치트 오염 표시 자리 — 여기에 차이가 있으면 어느 한쪽이 오염된 런이다',
  };
}

/** 등급 팝업 하나를 덮는 상자 (u). 팝업 폰트가 40~52px이고 위로 46u까지 떠오른다 */
const POPUP_HALF_WIDTH_U = 190;
const POPUP_TOP_OFFSET_U = 96;
const POPUP_HEIGHT_U = 150;

/** 재패리 라벨 상자 (u). engine.js:283이 탄 반경 + 10u 오른쪽, 반경 + 8u 위에 21px로 그린다 */
const REPARRY_LABEL_WIDTH_U = 90;
const REPARRY_LABEL_HEIGHT_U = 46;

/**
 * 처치 파편 한 조각을 덮는 상자 (u).
 *
 * 목업은 `fillRect(p.x − 3, p.y − 3, 6, 6)`으로 6u 사각형을 그린다(engine.js:1953-1955).
 * 게임은 크기도 분포도 다르므로(06 §1.11) 넉넉히 덮는다.
 */
const PARTICLE_HALF_U = 12;

/** 마스크를 계산하는 데 필요한 만큼만 추린 프레임 정보. adapt.ts의 출력에서 그대로 나온다 */
export interface MaskSource {
  readonly popups: readonly { readonly xU: number; readonly yU: number }[];
  readonly reparryLabels: readonly { readonly xU: number; readonly yU: number; readonly radiusU: number }[];
  readonly particles: readonly { readonly xU: number; readonly yU: number }[];
}

/**
 * 처치 파편 마스크 — 판정 마스크다.
 *
 * 목업 `burst`(engine.js:1925-1930)가 각도와 속도를 `Math.random()`으로 뽑는다. D-05 위반이고
 * 06 §1.11이 주입 RNG + §4.3의 균등 링으로 교체하기로 판정했다. 그러므로 **같은 프레임을 두 번
 * 띄우기만 해도 파편 자리가 달라지고**, 게임과 대조하면 분포 자체가 다르다. 대조가 성립하는
 * 층이 아니다.
 */
export function particleMasks(
  positions: readonly { readonly xU: number; readonly yU: number }[],
): readonly MaskRect[] {
  return positions.map((particle) => ({
    xU: particle.xU - PARTICLE_HALF_U,
    yU: particle.yU - PARTICLE_HALF_U,
    widthU: PARTICLE_HALF_U * 2,
    heightU: PARTICLE_HALF_U * 2,
    kind: 'ruling' as const,
    reason: '06 §1.11 · D-05 처치 파편 — 목업은 Math.random(), 게임은 주입 RNG + 균등 링',
  }));
}

/**
 * 프레임마다 자리가 달라지는 텍스트 마스크.
 *
 * 등급 팝업과 재패리 라벨은 월드 좌표에 그려지므로 고정 상자로 못 가린다. 09 §5.3이 이 둘을
 * "텍스트 내용·자간은 안 잡힌다"로 분류했고, 반대로 **팝업이 있었는지 없었는지**는 여전히
 * 잡혀야 하므로 리포트가 개수를 따로 적는다.
 */
export function dynamicMasks(source: MaskSource): readonly MaskRect[] {
  const masks: MaskRect[] = [];
  for (const popup of source.popups) {
    masks.push({
      xU: popup.xU - POPUP_HALF_WIDTH_U,
      yU: popup.yU - POPUP_TOP_OFFSET_U,
      widthU: POPUP_HALF_WIDTH_U * 2,
      heightU: POPUP_HEIGHT_U,
      kind: 'text',
      reason: '09 §5.4-1 등급 팝업 텍스트',
    });
  }
  for (const bullet of source.reparryLabels) {
    masks.push({
      xU: bullet.xU + bullet.radiusU,
      yU: bullet.yU - bullet.radiusU - REPARRY_LABEL_HEIGHT_U,
      widthU: REPARRY_LABEL_WIDTH_U,
      heightU: REPARRY_LABEL_HEIGHT_U,
      kind: 'text',
      reason: '09 §5.4-1 재패리 카운트 라벨 (engine.js:280-283)',
    });
  }
  masks.push(...particleMasks(source.particles));
  return masks;
}

/** 차이 격자 한 칸의 한 변 (u). 1080 / 120 = 9열, 1920 / 120 = 16행 */
export const DIFF_CELL_U = 120;

/** 플레이필드 크기. 하네스가 목업 캔버스 배율을 이 값으로 나눠서 구한다 */
export const PLAYFIELD_SIZE_U = {
  widthU: PLAYFIELD.widthU,
  heightU: PLAYFIELD.heightU,
} as const;
