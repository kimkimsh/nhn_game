/**
 * 보스 5기와 다섯이 함께 쓰는 규칙 — 스펙 §10.1
 *
 * BOSS_COMMON의 세 값은 원래 BossDef 안에 있었다. 다섯이 같은 값이라 리터럴이 15개로 불어나고
 * 소유자가 두 병렬 작업으로 갈렸다(12_통합_계약.md §10 E-12). 보스 하나만 연출 길이를 다르게
 * 하고 싶어졌다면 그것은 이 파일이 아니라 스펙 §10.1을 바꾸는 일이다.
 *
 * B3의 파괴 가능 부위는 여기 없다. boss-3-atakebune.ts 안에 있고 BOSSES.B3.parts로 읽힌다 —
 * 이 파일이 다섯 보스를 모으므로 boss-3이 여기서 무언가를 읽으면 순환 import가 된다.
 */
import type { BossId } from '../ids';
import type { BossCommon, BossDef } from '../types';
import { BOSS_1 } from './boss-1-johong';
import { BOSS_2 } from './boss-2-samurai';
import { BOSS_3 } from './boss-3-atakebune';
import { BOSS_4 } from './boss-4-daetong';
import { BOSS_5 } from './boss-5-flagship';

export const BOSSES = {
  B1: BOSS_1, // §10.2 조총 방진 대장
  B2: BOSS_2, // §10.3 왜장 사무라이 대장
  B3: BOSS_3, // §10.4 아타케부네 기함
  B4: BOSS_4, // §10.5 대통 포병 대장
  B5: BOSS_5, // §10.6 왜 수군 총대장 기함
} as const satisfies Record<BossId, BossDef>;

export const BOSS_COMMON = {
  phaseTransitionSec: 1.2, // §10.1 전환 연출 (s). 보스 무적, 신규 발사 정지. 기존 탄환은 유지된다(HR-03)
  patternGapSec: 0.8,      // §10.1 패턴 사이 간격 (s)
  deathSec: 2.0,           // §10.1 격파 연출 (s). 이 동안 모든 적 탄환 소멸, 플레이어 무적
} as const satisfies BossCommon;
