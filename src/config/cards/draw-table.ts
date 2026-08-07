/**
 * 카드 추첨 — 스펙 §11.1 · §11.2
 *
 * 회차별로 등급 가중치가 달라진다. 이 표를 바꾸면 후반 빌드의 강도가 통째로 움직인다.
 *
 * 추첨 절차와 제시 가능 조건은 데이터가 아니라 sim/cards.ts의 일이다 — 3장 각각의 등급을 독립
 * 추첨하고, 해당 등급 풀에서 제시 가능한 것만 남겨 균등 확률로 뽑고, 같은 화면에 이미 뽑힌 카드를
 * 제외하고, 풀이 비면 한 단계 아래로(노말이 비면 위로) 내린다. 제시 가능 조건도 마찬가지로
 * CardDef의 maxStack과 hideWhen이 데이터고 판정은 sim이다.
 *
 * 등급 표시색 세 개는 §11.2가 고정했지만 여기 없다. 색의 단일 소스는 palette.ts이고
 * rarityNormal · rarityRare · rarityEpic이 그 자리다(12_통합_계약.md §3.2). 여기 옮겨 적으면
 * 같은 색이 두 곳에 살게 되고, 다시 칠하지 말라는 근거는 palette.ts에만 남는다.
 */
import type { DrawConfig, RarityWeights } from '../types';

/**
 * §11.2 회차별 등급 추첨 가중치
 *
 * 키는 직전에 클리어한 스테이지 번호이자 곧 카드 화면의 회차다. 카드 선택 화면의 가중치 안내 줄이
 * 이 표를 그대로 읽는다(08_화면과_UI.md §3.1).
 */
export const RARITY_WEIGHTS = {
  1: { NORMAL: 70, RARE: 27, EPIC: 3  },   // §11.2 S1 클리어
  2: { NORMAL: 60, RARE: 33, EPIC: 7  },   // §11.2 S2 클리어
  3: { NORMAL: 50, RARE: 38, EPIC: 12 },   // §11.2 S3 클리어
  4: { NORMAL: 40, RARE: 42, EPIC: 18 },   // §11.2 S4 클리어
} as const satisfies Record<1 | 2 | 3 | 4, RarityWeights>;

export const DRAW = {
  offerCount: 3,             // 장. §11.1 한 화면에 제시하는 매수. 같은 화면 안의 중복은 금지다
  acquisitionCount: 4,       // 회. §11.1 S1~S4 클리어 직후. RARITY_WEIGHTS의 회차 수와 같다
  startingCards: 0,          // 장. §11.1 스테이지 1은 언제나 카드 0장으로 시작한다
  rerollsPerRun: 1,          // 회. §11.1 런 전체에서 1회. 게임오버 시 사용 여부도 초기화된다
  rerollRedrawsRarity: true, // §11.1 제시된 3장을 버리고 등급 추첨부터 다시 실행한다
} as const satisfies DrawConfig;
