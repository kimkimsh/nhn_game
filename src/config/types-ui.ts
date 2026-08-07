/**
 * 색과 화면 레이아웃 테이블의 타입 — 스펙 §15 · §17, 08_화면과_UI.md §9
 *
 * 색과 좌표를 서로 다른 타입으로 가른다. palette.ts에는 "색 하나에 규칙 하나"라는 제약이
 * 걸려 있고 ui.ts의 좌표에는 그런 제약이 없어서, 한 파일에 두면 그 제약이 좌표까지 번진다.
 * ui.ts의 좌표는 전부 논리 플레이필드 단위(u)이고 화면 픽셀이 아니다.
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */

/**
 * §17 색 토큰. 색 하나가 게임 규칙 하나를 담는다
 *
 * 규칙이 없는 색은 추가하지 않는다. 추가하기 전에 답할 것: "이 색이 나타내는 게임 규칙은
 * 무엇인가." 그리고 색만으로 상태를 구분하지 않는다 — 패리 불가는 색에 더해 각진 다각형과
 * 대각 해칭이 함께 붙는다.
 *
 * 목업의 tokens.css는 이식하지 않으므로 이 타입이 덮는 표가 유일한 색 소스다(12 §3.2).
 */
export type Palette = {
  /** 흑 — 모든 것이 얹히는 바탕 */
  readonly ink900: string;
  readonly ink800: string;
  readonly ink700: string;
  /** 적 — 적 탄환·적 본체. 닿으면 라이프 −1 */
  readonly jeok: string;
  /** 발사 예비동작. 이 색으로 밝아지면 곧 쏜다는 뜻이다 */
  readonly jeokHot: string;
  /** 갑주 디테일. 규칙 없음, 형태 전용 */
  readonly jeokDim: string;
  /** 황 — 반사탄. 내 데미지원이지만 나에게도 유효하다(HR-07) */
  readonly hwang: string;
  /** 적 피격 플래시. 반사탄이 유효했다는 확인 */
  readonly hwangHot: string;
  /** 청 — 플레이어가 소유한 모든 것. 패리 원, 쿨다운 링, 라이프 */
  readonly cheong: string;
  readonly cheongDim: string;
  /** 백 — 예고 표시 3종 + 텍스트 + 방패병의 판정면 */
  readonly baek: string;
  readonly baekMute: string;
  readonly baekFaint: string;
  /** 탁적 — 패리 불가. 반드시 각진 형태 + 해칭과 함께 쓴다 */
  readonly takjeok: string;
  /** §11.2가 고정한 카드 등급색. 다시 칠하지 않는다 */
  readonly rarityNormal: string;
  readonly rarityRare: string;
  readonly rarityEpic: string;
};

/**
 * §15 폰트 스택 3종
 *
 * 웹폰트는 번들하지 않는다(12_통합_계약.md §3.1). 첫 항목은 실행 환경에 거의 없고 스택은
 * 시스템 폰트에서 해석되므로, ui.ts의 좌표·크기는 그 상태에서 성립해야 한다.
 * HUD는 전부 data(모노)다 — 숫자가 자릿수마다 흔들리면 안 된다.
 */
export type FontStacks = {
  readonly display: string;
  readonly body: string;
  readonly data: string;
};

/** 모서리가 둥근 상자 하나 (u) */
export type UiBox = {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
  readonly radiusU: number;
};

/**
 * §15.1 라이프. 최대치 칸은 비어 있어도 항상 그린다 —
 * 카드로 최대치가 늘었다는 사실(R06)이 빈 칸으로만 읽힌다
 */
type LifeHud = {
  readonly firstCenterXU: number;
  readonly centerYU: number;
  readonly stepXU: number;
  /** 마름모 반대각선. 칸 폭은 이 값의 2배다 */
  readonly halfDiagU: number;
  readonly emptyStrokeU: number;
  readonly filledGlowRU: number;
  /** §4.1 최대 라이프와 같아야 한다 */
  readonly maxSlots: number;
};

/** §15.1 점수. 상시 표시 */
type ScoreHud = {
  readonly rightXU: number;
  readonly valueBaselineYU: number;
  readonly valuePx: number;
  readonly labelBaselineYU: number;
  readonly labelPx: number;
};

/** §15.1 스테이지 번호 + 스테이지 내 진행률 */
type StageHud = {
  readonly centerXU: number;
  readonly labelBaselineYU: number;
  readonly labelPx: number;
  readonly barXU: number;
  readonly barYU: number;
  readonly barWidthU: number;
  readonly barHeightU: number;
};

/**
 * §15.1 보스 HP. 페이즈 임계값을 눈금으로 표시한다.
 * 눈금은 배경색으로 바를 깎아내는 방식이라 새 색이 필요 없다
 */
type BossHud = {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
  readonly notchStrokeU: number;
  readonly notchOverhangU: number;
  readonly endGlowRU: number;
  readonly nameBaselineYU: number;
  readonly namePx: number;
};

/**
 * §15.1 콤보. combo가 0이면 이 블록 전체를 그리지 않는다 —
 * 사라지는 것 자체가 §12.2의 "스테이지 시작 시 0"을 알리는 신호다
 *
 * 경고 구간 비율은 여기 없다. COMBO_WARN_SEC / 실효 comboHoldSec으로 유도한다 —
 * 분모는 상수가 아니고 N11이 늘린다(12_통합_계약.md §8-5).
 */
type ComboHud = {
  readonly leftXU: number;
  readonly countBaselineYU: number;
  readonly countPx: number;
  /**
   * 고정값이다. 목업은 콤보 글자 폭을 재서 배치했는데 24px 폰트로 50px 글자를 재는 버그가 있어
   * 4자리부터 겹친다(10_스펙_목업_불일치.md A21). 고정이라 배수가 좌우로 떨리지도 않는다.
   */
  readonly multiplierXU: number;
  readonly multiplierBaselineYU: number;
  readonly multiplierPx: number;
  readonly labelBaselineYU: number;
  readonly labelPx: number;
  readonly gaugeXU: number;
  readonly gaugeYU: number;
  readonly gaugeWidthU: number;
  readonly gaugeHeightU: number;
};

/** §15.1 음소거 상태. 목업에 없던 요소다 */
type MuteHud = {
  readonly rightXU: number;
  readonly baselineYU: number;
  readonly px: number;
};

/**
 * §18.5 치트 오염 표시. 목업에 없던 요소다
 *
 * 전체 폭인 이유는 §18.6 — 이 표시가 뜬 화면은 그대로 실격 사유이므로 촬영본을 확인하는
 * 사람이 놓칠 수 없어야 한다. 모서리 배지는 크롭에 지워진다.
 */
type CheatMarkHud = {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
  readonly labelCenterXU: number;
  readonly labelBaselineYU: number;
  readonly labelPx: number;
  readonly hatchAlpha: number;
};

/**
 * §15.1 파괴 가능 부위 게이지. B3 포문 4기
 *
 * 좌표는 부위 중심 기준 상대값이다. 부위에 붙어 다니므로 화면 흔들림 안쪽에서 그린다 —
 * HUD 나머지는 흔들림 밖이고 그것이 옳다(10_스펙_목업_불일치.md A22).
 */
type PartGaugeHud = {
  readonly widthU: number;
  readonly heightU: number;
  readonly offsetYU: number;
  readonly labelOffsetYU: number;
  readonly labelPx: number;
};

/**
 * §15.1 플레이어에 붙는 표시. HUD 모서리가 아니다 —
 * §15.1이 패리 쿨다운을 "플레이어 주변 링"으로 못 박았다
 */
type PlayerHud = {
  readonly parryRingScaleMin: number;
  readonly parryRingScaleMax: number;
  readonly cooldownRingRU: number;
  readonly cooldownRingStrokeU: number;
  /**
   * 링 알파 = base × clamp(실효 쿨다운 / cooldownRingRefSec, 0, 1).
   * R10 빌드는 최소 간격 0.12초까지 내려가 그 속도로 채워지는 링이 스트로브가 된다.
   * 기하가 아니라 알파를 줄이는 이유는 §15.1의 표시 요구가 남아 있기 때문이다.
   */
  readonly cooldownRingAlphaBase: number;
  readonly cooldownRingRefSec: number;
  /** 쿨다운이 끝나는 순간 링이 여기까지 확장한 뒤 소멸한다(12_통합_계약.md §8-1) */
  readonly cooldownRingEndRU: number;
  readonly cooldownRingEndSec: number;
  readonly invulnRingRU: number;
  readonly invulnRingStrokeU: number;
  readonly invulnDashU: readonly number[];
  readonly invulnBlinkHz: number;
  readonly coreOuterRU: number;
  readonly coreShadeRU: number;
  /** §4.1 피격 판정 반경 그 자체다. 이 값은 판정과 1:1이다 */
  readonly coreRU: number;
  readonly coreGlowRU: number;
};

/** §15.2 카드 선택. 카드 3장은 가로 배치 */
type CardSelectUi = {
  readonly dimAlpha: number;
  readonly clearLabelBaselineYU: number;
  readonly titleBaselineYU: number;
  readonly subtitleBaselineYU: number;
  readonly cardWidthU: number;
  readonly cardGapU: number;
  readonly cardFirstXU: number;
  readonly cardTopYU: number;
  readonly cardHeightU: number;
  readonly cardRadiusU: number;
  readonly rarityBandHeightU: number;
  readonly pickedLiftU: number;
  readonly pickedStrokeU: number;
  readonly idleStrokeU: number;
  /** "현재 → 선택 후" 판 상단 */
  readonly deltaPlateOffsetYU: number;
  readonly deltaPlateHeightU: number;
  readonly heldLabelYU: number;
  readonly heldRuleYU: number;
  readonly heldChipYU: number;
  readonly heldChipHeightU: number;
  readonly heldChipPadU: number;
  readonly heldChipGapU: number;
  readonly confirmBox: UiBox;
  readonly rerollBox: UiBox;
  readonly hintBaselineYU: number;
  readonly drawTableBaselineYU: number;
  readonly rerollNoteBaselineYU: number;
};

/**
 * §13.4 일시정지 · §12.3 결과가 공유하는 메뉴 상자 규격
 *
 * 두 화면이 같은 조작(↑↓ 이동 / Enter 실행, §16.3)을 받으므로 규격을 공유한다.
 * 다르게 보이면 다르게 동작하는 줄 안다.
 */
type MenuUi = {
  readonly boxXU: number;
  readonly boxWidthU: number;
  readonly boxRadiusU: number;
  /** 커서가 처음 놓이는 항목 */
  readonly primaryHeightU: number;
  readonly secondaryHeightU: number;
  readonly gapU: number;
  readonly primaryGlowRU: number;
  readonly labelPx: number;
  readonly subLabelPx: number;
};

/** §13.4 일시정지 */
type PauseUi = {
  /**
   * 카드 선택·결과보다 옅다 — 전장이 "멈춘" 것이지 다른 화면으로 간 것이 아니라는 사실을
   * 그림으로 말한다.
   */
  readonly dimAlpha: number;
  readonly contextBaselineYU: number;
  readonly titleBaselineYU: number;
  readonly subtitleBaselineYU: number;
  readonly heldHeaderYU: number;
  readonly heldRuleYU: number;
  readonly heldRowFirstYU: number;
  readonly heldRowStepU: number;
  readonly heldSwatchWidthU: number;
  readonly heldSwatchHeightU: number;
  readonly menuFirstYU: number;
  readonly hintBaselineYU: number;
  readonly warnBaselineYU: number;
};

/** §15.3 결과 화면 */
type ResultUi = {
  readonly dimAlpha: number;
  readonly kickerBaselineYU: number;
  readonly endingBaselineYU: number;
  readonly scoreLabelBaselineYU: number;
  readonly scoreValueBaselineYU: number;
  readonly scoreValuePx: number;
  readonly scoreGlowRU: number;
  readonly ruleYU: number;
  readonly gradeLabelBaselineYU: number;
  readonly gradeBarXU: number;
  readonly gradeBarYU: number;
  readonly gradeBarWidthU: number;
  readonly gradeBarHeightU: number;
  readonly gradeSegGapU: number;
  readonly gradeNameBaselineYU: number;
  readonly gradeCountBaselineYU: number;
  readonly rowFirstBaselineYU: number;
  readonly rowStepU: number;
  readonly rowLeftXU: number;
  readonly rowRightXU: number;
  readonly rowRuleOffsetYU: number;
  readonly cardsLabelBaselineYU: number;
  readonly cardChipYU: number;
  readonly cardChipHeightU: number;
  /** §18.5 오염 여부. 정상 런도 반드시 적는다 */
  readonly integrityBaselineYU: number;
  readonly menuFirstYU: number;
  readonly noteBaselineYU: number;
};

/**
 * §15 화면 레이아웃 전체
 *
 * 타이틀 화면의 구도 값은 없다. 한 번만 쓰이고 서로 얽혀 있어 상수로 뽑으면 오히려 못 고치게
 * 되므로 render/에 그대로 둔다(08_화면과_UI.md §9).
 */
export type UiConfig = {
  /** §3.1 논리 해상도. playfield.ts와 같은 숫자이고, 계층이 서로를 import할 수 없어 생긴 중복이다 */
  readonly playfield: { readonly widthU: number; readonly heightU: number };
  readonly hud: {
    readonly life: LifeHud;
    readonly score: ScoreHud;
    readonly stage: StageHud;
    readonly boss: BossHud;
    readonly combo: ComboHud;
    readonly mute: MuteHud;
    readonly cheatMark: CheatMarkHud;
    readonly partGauge: PartGaugeHud;
  };
  readonly playerHud: PlayerHud;
  readonly cardSelect: CardSelectUi;
  readonly menu: MenuUi;
  readonly pause: PauseUi;
  readonly result: ResultUi;
};
