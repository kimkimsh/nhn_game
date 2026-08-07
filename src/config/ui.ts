/**
 * 화면 레이아웃 상수 — 스펙 §15.1 · §15.2 · §15.3 · §18.5
 *
 * 좌표는 전부 논리 플레이필드 단위(u, §3.1의 1080×1920)다. 화면 픽셀이 아니므로 창 크기를
 * 바꿔도 이 값들은 변하지 않는다. 색은 이 파일에 없다 — palette.ts에 있고, 거기에는
 * "색 하나에 규칙 하나"라는 제약이 걸려 있어서 좌표와 같은 파일에 둘 수 없다.
 *
 * 값의 출처는 승인된 목업이다 — HUD는 engine.js drawHud(1669-1740), 나머지 세 화면은
 * 11_card_select · 13_result · 14_pause의 scene.js. 여기 숫자를 옮기면 그 그림과의 대조가
 * 끊기므로, 옮길 이유가 있으면 목업 쪽 판정을 먼저 바꿔야 한다.
 *
 * 타이틀 화면의 구도 값은 없다. 한 번만 쓰이고 서로 얽혀 있어 상수로 뽑으면 오히려 못 고치게
 * 된다 — render/에 그대로 둔다(08 §9).
 */

import { PARRY } from './parry';
import { PLAYFIELD } from './playfield';
import type { FontStacks, UiConfig } from './types';

/**
 * §3.1 논리 해상도 (u). 오른쪽·아래 정렬선이 전부 이 둘에서 나오므로 먼저 이름을 준다.
 * 숫자는 playfield.ts에만 산다 — HUD가 옛 해상도로 정렬되는 고장은 화면을 봐도 안 보인다.
 */
const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;
const PLAYFIELD_HEIGHT_U = PLAYFIELD.heightU;

/**
 * §15 폰트 스택 3종. HUD는 전부 data(모노)다 — 숫자가 자릿수마다 흔들리면 안 된다
 *
 * 웹폰트는 번들하지 않는다(12 §3.1). 서브셋하지 않은 한글 웹폰트 2종을 base64로 인라인하면
 * 수 MB이고, 그것이 D-03이 단일 파일 빌드를 뒤집는 조건으로 이름 붙인 위험 그 자체다.
 * 따라서 첫 항목은 실행 환경에 거의 없고 스택은 시스템 폰트에서 해석된다 — 이 파일의
 * 좌표·크기는 그 상태에서 성립해야 하며, 09 §6 E-11이 15화면 레이아웃으로 확인한다.
 */
export const FONTS = {
  display: '"Gowun Batang", "Nanum Myeongjo", "Apple SD Gothic Neo", serif',
  body: '"IBM Plex Sans KR", "Pretendard", -apple-system, "Segoe UI", system-ui, sans-serif',
  data: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const satisfies FontStacks;

export const UI = {
  playfield: {
    widthU: PLAYFIELD_WIDTH_U,     // §3.1
    heightU: PLAYFIELD_HEIGHT_U,   // §3.1
  },

  hud: {
    /**
     * §15.1 라이프. 최대치 칸은 비어 있어도 항상 그린다 —
     * 카드로 최대치가 늘었다는 사실(R06)이 빈 칸으로만 읽힌다.
     */
    life: {
      firstCenterXU: 40,   // §15.1 첫 칸 중심 x (u)
      centerYU: 54,        // §15.1 모든 칸 공통 중심 y (u)
      stepXU: 46,          // §15.1 칸 간격 (u)
      halfDiagU: 15,       // §15.1 마름모 반대각선 (u). 칸 폭은 이 값의 2배인 30u
      emptyStrokeU: 2.5,   // §15.1 빈 칸 테두리 두께 (u)
      filledGlowRU: 30,    // §15.1 채워진 칸 글로우 반경 (u)
      /**
       * §4.1 최대 라이프 5 — 칸 배열이 넘을 수 없는 상한이다.
       * **실제로 그리는 칸 수는 이 값이 아니다.** 10 A19가 판정했다 — 최대 라이프는 파생
       * 값이고 HUD는 `3 + (R06 중첩 수)`개를 그린다. R06 최대 중첩이 2(§11.4)라서 그 식의
       * 최대가 여기 5와 만난다. render/hud.ts가 5를 그리면 카드를 안 든 런에서도 빈 칸이
       * 두 개 뜨고, 그러면 "최대치가 늘었다"는 신호가 사라진다.
       */
      maxSlots: 5,
    },

    /** §15.1 점수. 상시 표시 */
    score: {
      rightXU: PLAYFIELD_WIDTH_U - 36,  // §15.1 오른쪽 정렬선 (u). 여백 36u
      valueBaselineYU: 66, // §15.1 값 베이스라인 (u)
      valuePx: 44,         // §15.1 값 크기 (px). weight 600
      labelBaselineYU: 24, // §15.1 'SCORE' 베이스라인 (u)
      labelPx: 20,         // §15.1 라벨 크기 (px). weight 500
    },

    /** §15.1 스테이지 번호 + 스테이지 내 진행률 */
    stage: {
      centerXU: PLAYFIELD_WIDTH_U / 2,        // §15.1 가운데 정렬선 (u)
      labelBaselineYU: 30,                    // §15.1 'STAGE n · Wm 0:51 / 1:00' 베이스라인 (u)
      labelPx: 21,                            // §15.1 (px). weight 500
      barXU: PLAYFIELD_WIDTH_U / 2 - 170,     // §15.1 = centerXU − barWidthU / 2 (u)
      barYU: 48,                              // §15.1 (u)
      barWidthU: 340,                         // §15.1 (u)
      barHeightU: 6,                          // §15.1 (u)
    },

    /**
     * §15.1 보스 HP. 페이즈 임계값을 눈금으로 표시한다.
     * 눈금은 배경색(ink900)으로 바를 깎아내는 방식이라 새 색이 필요 없다.
     */
    boss: {
      xU: 70,                                  // §15.1 (u)
      yU: 96,                                  // §15.1 (u)
      widthU: PLAYFIELD_WIDTH_U - 140,         // §15.1 좌우 여백 70u씩 (u)
      heightU: 16,                             // §15.1 (u)
      notchStrokeU: 3,                         // §15.1 페이즈 눈금 선 두께 (u)
      notchOverhangU: 4,                       // §15.1 눈금이 바 위아래로 튀어나오는 길이 (u)
      endGlowRU: 46,                           // §15.1 채움 끝점 글로우 반경 (u)
      nameBaselineYU: 82,                      // §15.1 '{이름}  ·  PHASE n' 베이스라인 (u)
      namePx: 20,                              // §15.1 (px). weight 500
    },

    /**
     * §15.1 콤보. combo가 0이면 이 블록 전체를 그리지 않는다 —
     * 사라지는 것 자체가 §12.2의 "스테이지 시작 시 0"을 알리는 신호다.
     *
     * 경고 구간 비율은 여기 없다. §17 "끊기기 직전임을 알린다"의 길이는 scoring.ts의
     * COMBO_WARN_SEC 하나뿐이고(12 §8-5), 게이지가 적색으로 바뀌는 비율은
     * COMBO_WARN_SEC / stats.comboHoldSec으로 유도한다. 분모는 상수가 아니다 —
     * N11이 유지 시간을 4.5초까지 늘린다(10 A11).
     */
    combo: {
      leftXU: 40,                              // §15.1 왼쪽 정렬선 (u)
      countBaselineYU: PLAYFIELD_HEIGHT_U - 56, // §15.1 콤보 수 베이스라인 (u). weight 700
      countPx: 50,                             // §15.1 (px)
      /**
       * §15.1 배수 x는 고정값이다 (u). 목업(engine.js:1729)은 콤보 글자 폭을 재서 배치했는데
       * 24px 폰트로 50px 글자를 재는 버그가 있어 4자리부터 겹친다(10 A21).
       * = leftXU + countPx × 0.6 × 5자리 + 30u 여백. 고정이라 배수가 좌우로 떨리지도 않는다.
       */
      multiplierXU: 220,
      multiplierBaselineYU: PLAYFIELD_HEIGHT_U - 60, // §15.1 = countBaselineYU − 4 (u). weight 600
      multiplierPx: 24,                        // §15.1 (px)
      labelBaselineYU: PLAYFIELD_HEIGHT_U - 98, // §15.1 'COMBO' 베이스라인 (u). weight 500
      labelPx: 18,                             // §15.1 (px)
      gaugeXU: 40,                             // §12.2 유지 시간이 줄어드는 게이지 (u)
      gaugeYU: PLAYFIELD_HEIGHT_U - 40,        // §12.2 (u)
      gaugeWidthU: 190,                        // §12.2 (u)
      gaugeHeightU: 5,                         // §12.2 (u)
    },

    /**
     * §15.1 음소거 상태. 목업 drawHud에 없던 요소다.
     * 오른쪽 아래는 drawHud가 한 획도 긋지 않는 유일한 사분면이라 골랐다 — 왼쪽 아래
     * 콤보와 좌우 대칭이 되고 새 색도 필요 없다. 정상(♪)은 흐리게, 음소거(MUTE)는 진하게
     * 칠한다. 음소거는 잊어버렸을 때만 문제가 되므로 이상 상태 쪽이 눈에 띄어야 한다.
     */
    mute: {
      rightXU: PLAYFIELD_WIDTH_U - 36,         // §15.1 score.rightXU와 같은 오른쪽 정렬선 (u)
      baselineYU: PLAYFIELD_HEIGHT_U - 56,     // §15.1 combo.countBaselineYU와 같은 높이 (u)
      px: 22,                                  // §15.1 (px). weight 500
    },

    /**
     * §18.5 치트 오염 표시. 목업에 없던 요소다.
     * 전체 폭인 이유는 §18.6 — 이 표시가 뜬 화면은 그대로 실격 사유이므로 촬영본을 확인하는
     * 사람이 놓칠 수 없어야 한다. 모서리 배지는 크롭 한 번에 사라진다.
     * 사선 해칭을 쓰는 것은 팔레트의 색이 전부 게임 규칙에 묶여 있어서다 — 아무 색이나
     * 재사용하면 그 색의 뜻이 두 개가 된다.
     */
    cheatMark: {
      xU: 0,                                   // §18.5 (u)
      yU: PLAYFIELD_HEIGHT_U - 22,             // §18.5 아래 변에 붙인다 (u). = heightU만큼 위
      widthU: PLAYFIELD_WIDTH_U,               // §18.5 전체 폭 (u)
      heightU: 22,                             // §18.5 (u)
      labelCenterXU: PLAYFIELD_WIDTH_U / 2,    // §18.5 '치트 — 오염된 런' 가운데 정렬 (u)
      labelBaselineYU: PLAYFIELD_HEIGHT_U - 6, // §18.5 (u)
      labelPx: 22,                             // §18.5 (px). weight 600
      hatchAlpha: 0.22,                        // §18.5 해칭 알파 (0~1)
    },

    /**
     * §15.1 파괴 가능 부위 게이지. B3 포문 4기 × HP 300 (§10.4).
     * 좌표는 부위 중심 기준 상대값이다. 부위에 붙어 다니므로 화면 흔들림 **안쪽**에서 그린다 —
     * HUD 나머지는 흔들림 밖이고 그것이 옳다(10 A22). 구분 기준은 "화면에 붙었나, 월드
     * 오브젝트에 붙었나"이며 부위 게이지는 후자다. 파괴된 포문의 바도 지우지 않는다 —
     * §10.4의 P2 조건이 "포문 2개 파괴"라서 몇 개를 부쉈는지가 진행도 그 자체다.
     */
    partGauge: {
      widthU: 130,          // §15.1 (u)
      heightU: 9,           // §15.1 (u)
      offsetYU: -96,        // §15.1 부위 중심 대비 게이지 상단 y (u)
      labelOffsetYU: -114,  // §15.1 부위 중심 대비 라벨 베이스라인 y (u). = offsetYU − 18
      labelPx: 21,          // §15.1 '{hp} / 300' 또는 '파괴' (px)
    },
  },

  /**
   * §15.1 플레이어에 붙는 표시. HUD 모서리가 아니다 —
   * §15.1이 패리 쿨다운을 "플레이어 주변 링"으로 못 박았다. 넷 다 흔들림 안쪽에서 그린다.
   * 그리는 코드는 render/player.ts에 있고 값만 여기 있다.
   */
  playerHud: {
    parryRingScaleMin: 0.86,   // §5.1 활성 시작 시 반경 배율 (× 패리 반경 70u)
    parryRingScaleMax: 1.06,   // §5.1 활성 종료 시 배율. = parryRingScaleMin + 0.2
    cooldownRingRU: 50,        // §15.1 쿨다운 링 반경 (u)
    cooldownRingStrokeU: 3.5,  // §15.1 (u)
    /**
     * §17 링 알파 = cooldownRingAlphaBase × clamp(실효 쿨다운 / cooldownRingRefSec, 0, 1).
     * R10 발동 빌드는 최소 간격 0.12초까지 내려가 초당 8.33회가 되고(§11.4), 그 속도로
     * 채워지는 링은 스트로브가 된다. §17이 "신호가 피로하지 않아야 한다"를 요구한다.
     * 기하가 아니라 알파를 줄이는 이유는 §15.1의 표시 요구가 남아 있기 때문이다.
     */
    cooldownRingAlphaBase: 0.9,
    /**
     * §5.1 기본 쿨다운 (초) — 위 식의 기준값. 카드가 실효 쿨다운을 줄였을 때 링이 옅어지는
     * 것이 이 표시의 전부이므로, 기준값이 parry.ts의 진짜 기본 쿨다운과 갈리면 카드 0장에서도
     * 링이 옅어지거나 영영 안 옅어진다.
     */
    cooldownRingRefSec: PARRY.cooldownSec,
    /**
     * 쿨다운이 끝나는 순간의 신호(12 §8-1). 링이 한 바퀴를 채우면 여기까지 확장한 뒤 소멸한다.
     * 1프레임 밝기 상승을 쓰지 않는 이유는 이 사건이 기본 쿨다운에서 초당 4.16회여서
     * 점멸이 신호가 아니라 스트로브가 되기 때문이다.
     */
    cooldownRingEndRU: 56,     // §15.1 확장 도달 반경 (u). = cooldownRingRU + 6
    cooldownRingEndSec: 0.08,  // §15.1 확장 길이 (초). ease-out
    /**
     * §15.1 패리 무적 표시의 **시작** 반경 (u). 12 §8-4가 목업의 회전·점멸을 버리고
     * 62u → 50u 단조 수축으로 바꿨다 — 0.14초는 60fps에서 8프레임이라 40Hz 점멸이 5.6주기,
     * 남은 시간으로 안 읽히고 명멸로만 보인다. 수축 끝 반경 50u는 이 타입에 칸이 없다.
     */
    invulnRingRU: 62,
    invulnRingStrokeU: 2.5,    // §15.1 (u)
    invulnDashU: [9, 7],       // §15.1 점선 패턴 (u)
    /**
     * §15.1 점멸 주파수 (Hz). **0이다** — 12 §8-4가 점멸을 없애고 알파를 고정했다.
     * 목업(engine.js:868)의 알파 식 `0.5 + sin(t × Hz) × 0.25`에 0을 넣으면 0.5 고정이
     * 되므로, 그 식을 그대로 이식해도 12의 판정이 지켜진다.
     */
    invulnBlinkHz: 0,
    coreOuterRU: 19,           // §15.1 겉링 반경 (u)
    coreShadeRU: 14,           // §15.1 코어를 또렷하게 유지하는 어두운 원반 반경 (u)
    coreRU: 10,                // §4.1 피격 판정 반경 그 자체 (u). 이 값은 판정과 1:1이다
    coreGlowRU: 22,            // §15.1 (u)
  },

  /** §15.2 카드 선택. 카드 3장은 가로 배치 */
  cardSelect: {
    dimAlpha: 0.86,              // §15.2 딤 알파 (0~1). 목업 11_card_select/scene.js:184
    clearLabelBaselineYU: 168,   // §15.2 'STAGE n  CLEAR' (u). 30px / weight 500 / data
    titleBaselineYU: 262,        // §15.2 (u). 74px / weight 700 / display
    subtitleBaselineYU: 312,     // §15.2 (u). 27px / weight 400 / body
    cardWidthU: 320,             // §15.2 (u)
    cardGapU: 30,                // §15.2 카드 사이 간격 (u)
    cardFirstXU: 30,             // §15.2 (u). = (1080 − (320×3 + 30×2)) / 2, 가운데 정렬의 결과
    cardTopYU: 380,              // §15.2 (u)
    cardHeightU: 800,            // §15.2 (u)
    cardRadiusU: 8,              // §15.2 (u)
    rarityBandHeightU: 10,       // §11.2 카드 상단 등급 띠 (u). 등급색을 쓰는 유일한 자리다
    pickedLiftU: 18,             // §15.2 선택된 카드가 떠오르는 거리 (u)
    pickedStrokeU: 5,            // §15.2 (u)
    idleStrokeU: 2.5,            // §15.2 (u)
    deltaPlateOffsetYU: 632,     // §15.2 "현재 → 선택 후" 판 상단 (u). = cardHeightU − 168
    deltaPlateHeightU: 74,       // §15.2 (u)
    heldLabelYU: 1320,           // §15.2 '보유 카드' 베이스라인 (u)
    heldRuleYU: 1344,            // §15.2 구분선 y (u)
    heldChipYU: 1372,            // §15.2 보유 카드 칩 상단 (u)
    heldChipHeightU: 50,         // §15.2 (u)
    heldChipPadU: 34,            // §15.2 칩 좌우 여백 합 (u)
    heldChipGapU: 14,            // §15.2 칩 사이 간격 (u)
    confirmBox: { xU: 120, yU: 1500, widthU: 400, heightU: 88, radiusU: 6 },  // §15.2 확정 단계
    rerollBox: { xU: 560, yU: 1500, widthU: 400, heightU: 88, radiusU: 6 },   // §11.1 런당 1회
    hintBaselineYU: 1670,        // §16.2 조작 안내 (u)
    drawTableBaselineYU: 1730,   // §11.2 회차별 등급 가중치 안내 (u)
    rerollNoteBaselineYU: 1780,  // §11.1 '다시 뽑으면 등급부터 다시 추첨한다' (u)
  },

  /**
   * §13.4 일시정지 · §12.3 결과. 두 화면은 같은 조작(↑↓ 이동 / Enter 실행, §16.3)을
   * 받으므로 메뉴 상자 규격을 공유한다. 다르게 보이면 다르게 동작하는 줄 안다.
   * 목업 결과 화면(13_result/scene.js:137·143)은 상자 둘을 가로로 놓았는데, 그 배치는
   * ↑↓ 조작과 맞지 않아 08 §5.5가 세로 배치로 판정했다.
   */
  menu: {
    boxXU: 300,             // §16.3 (u)
    boxWidthU: 480,         // §16.3 (u)
    boxRadiusU: 6,          // §16.3 (u)
    primaryHeightU: 92,     // §16.3 커서가 처음 놓이는 항목 (u)
    secondaryHeightU: 78,   // §16.3 (u)
    gapU: 18,               // §16.3 상자 사이 간격 (u)
    primaryGlowRU: 240,     // §16.3 (u)
    labelPx: 36,            // §16.3 (px). weight 600 / data
    subLabelPx: 30,         // §16.3 (px). weight 500 / data
  },

  /** §13.4 일시정지 */
  pause: {
    /**
     * §13.4 딤 알파 (0~1). 목업 14_pause/scene.js:104.
     * 카드 선택(0.86)·결과(0.9)보다 옅다 — 전장이 "멈춘" 것이지 다른 화면으로 간 것이
     * 아니라는 사실을 그림으로 말한다. 세 화면 다 전투 프레임을 배경으로 그린다(12 §1 C-02).
     */
    dimAlpha: 0.78,
    contextBaselineYU: 620,   // §13.4 'STAGE 4 · 행주산성 야전 · W4' (u). 28px / data
    titleBaselineYU: 736,     // §13.4 (u). 96px / weight 700 / display
    subtitleBaselineYU: 790,  // §13.4 (u). 26px / body
    heldHeaderYU: 880,        // §15.2 '보유 카드 n' (u)
    heldRuleYU: 904,          // §15.2 구분선 y (u)
    heldRowFirstYU: 936,      // §15.2 첫 줄 상단 (u)
    heldRowStepU: 92,         // §15.2 줄 간격 (u)
    heldSwatchWidthU: 4,      // §11.2 등급색 세로 막대 (u)
    heldSwatchHeightU: 52,    // §11.2 (u)
    menuFirstYU: 1290,        // §16.3 첫 메뉴 상자 상단 (u)
    hintBaselineYU: 1636,     // §16.3 조작 안내 (u)
    warnBaselineYU: 1686,     // §13.4 '포기하면 카드가 전부 사라진다' (u)
  },

  /** §15.3 결과 화면 */
  result: {
    dimAlpha: 0.9,               // §15.3 딤 알파 (0~1). 목업 13_result/scene.js:52
    kickerBaselineYU: 190,       // §13.1 엔딩 한 줄 (u). 30px / weight 500 / data
    endingBaselineYU: 300,       // §13.1 (u). 92px / weight 700 / display
    scoreLabelBaselineYU: 400,   // §12.3 'TOTAL SCORE' (u)
    scoreValueBaselineYU: 512,   // §12.3 (u). weight 600 / data
    scoreValuePx: 128,           // §12.3 (px)
    scoreGlowRU: 420,            // §12.3 (u)
    ruleYU: 588,                 // §15.3 구분선 y (u)
    gradeLabelBaselineYU: 650,   // §12.3 '패리 등급 분포' (u)
    gradeBarXU: 90,              // §12.3 (u)
    gradeBarYU: 674,             // §12.3 (u)
    gradeBarWidthU: PLAYFIELD_WIDTH_U - 180,  // §12.3 좌우 여백 90u씩 (u)
    gradeBarHeightU: 26,         // §12.3 (u)
    gradeSegGapU: 3,             // §12.3 세그먼트 사이를 이 폭만큼 비운다 (u)
    gradeNameBaselineYU: 740,    // §12.3 등급 이름 (u)
    gradeCountBaselineYU: 776,   // §12.3 등급별 횟수 (u)
    rowFirstBaselineYU: 856,     // §12.3 첫 항목 줄 (u)
    rowStepU: 62,                // §12.3 줄 간격 (u)
    rowLeftXU: 90,               // §12.3 항목명 왼쪽 정렬선 (u)
    rowRightXU: PLAYFIELD_WIDTH_U - 90,  // §12.3 값 오른쪽 정렬선 (u)
    rowRuleOffsetYU: 20,         // §12.3 줄 아래 구분선까지 (u)
    cardsLabelBaselineYU: 1300,  // §12.3 '획득 카드' (u)
    cardChipYU: 1330,            // §12.3 칩 상단 (u)
    cardChipHeightU: 52,         // §12.3 (u)
    integrityBaselineYU: 1462,   // §18.5 오염 여부 (u). 정상 런도 반드시 적는다
    menuFirstYU: 1560,           // §16.3 첫 메뉴 상자 상단 (u)
    noteBaselineYU: 1740,        // §13.3 '재시작하면 카드는 전부 사라진다' (u)
  },
} as const satisfies UiConfig;
