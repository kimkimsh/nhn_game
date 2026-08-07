/**
 * 카드 31종과 등급별 추첨 풀 — 스펙 §11.3 · §11.4 · §11.5
 *
 * 풀에 담기는 것은 CardDef가 아니라 ID다. CardDef에는 id 필드가 없고(문구와 효과만 갖는다)
 * 뽑은 결과를 RunState의 보유 중첩 수에 이어 붙이는 열쇠가 키뿐이기 때문이다. 정의가 필요하면
 * 뽑은 ID로 CARDS를 한 번 더 읽는다.
 *
 * 세 배열을 손으로 적지 않는다. 등급 파일의 Record가 이미 ID union 전체를 요구하므로 키 집합은
 * 타입이 보증하고, 같은 목록을 여기 옮겨 적으면 카드를 늘리면서 풀에 넣는 것만 잊는 고장이
 * 생긴다 — 컴파일도 테스트도 통과하고 그 카드만 영원히 제시되지 않는다.
 */
import type { CardId, CardRarity, EpicCardId, NormalCardId, RareCardId } from '../ids';
import type { CardDef } from '../types';
import { EPIC_CARDS } from './epic';
import { NORMAL_CARDS } from './normal';
import { RARE_CARDS } from './rare';

export const CARDS = {
  ...NORMAL_CARDS,
  ...RARE_CARDS,
  ...EPIC_CARDS,
} as const satisfies Record<CardId, CardDef>;

/**
 * Object.keys의 반환 타입이 string[]인 것은 TypeScript의 객체가 봉인돼 있지 않아서다 —
 * 선언에 없는 키가 런타임에 더 있을 수 있다고 본다. 위 세 표는 리터럴이고 `as const satisfies`가
 * 키를 union과 정확히 맞춰 두었으므로 그 여지가 없다. 좁히는 단언은 그 사실을 적은 것이다.
 *
 * 순서는 선언 순서다. 문자열 키의 Object.keys는 삽입 순서를 유지하므로 시드가 같으면 추첨
 * 결과도 같다(01_설계_결정.md D-05).
 */
const NORMAL_POOL: readonly NormalCardId[] = Object.keys(NORMAL_CARDS) as NormalCardId[];
const RARE_POOL: readonly RareCardId[] = Object.keys(RARE_CARDS) as RareCardId[];
const EPIC_POOL: readonly EpicCardId[] = Object.keys(EPIC_CARDS) as EpicCardId[];

/**
 * §11.2 등급을 먼저 뽑고 그 등급의 풀에서 카드를 고른다
 *
 * 여기 있는 것은 등급별 전체 목록뿐이다. 최대 중첩 도달·중첩 불가 보유·효과 무의미(N14)로
 * 빼는 일과, 풀이 비면 한 단계 아래로(노말이 비면 위로) 내리는 일은 런 상태를 봐야 알 수 있어
 * sim/cards.ts의 몫이다.
 */
export const CARD_POOLS = {
  NORMAL: NORMAL_POOL,
  RARE: RARE_POOL,
  EPIC: EPIC_POOL,
} as const satisfies Record<CardRarity, readonly CardId[]>;
