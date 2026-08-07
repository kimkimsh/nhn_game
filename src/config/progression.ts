/**
 * 런의 생명주기 — 스펙 §13
 *
 * 값이 아니라 규칙을 담는 표다. 이 게임에는 난이도 선택도 중간 진행 저장도 없고(§13.1·§13.3),
 * 그 사실이 sim과 screens 곳곳의 if로 흩어지지 않게 한 곳에 모아 둔다. boolean이 전부 true라
 * 상수처럼 보이지만 스위치로 두는 이유가 그것이다 — "왜 클리어해도 라이프가 안 차는가"를
 * 물었을 때 열어야 할 파일이 여기 하나다.
 *
 * 라이프 개수는 여기 없다. startLife와 maxLife는 player.ts의 PLAYER가 갖는다(§4.1).
 * 리롤 횟수도 없다 — 런당 1회는 추첨 절차의 일부라 cards/의 DRAW.rerollsPerRun이 단일 소스이고,
 * 이 표는 "게임오버가 그 사용 여부까지 되돌리는가"만 갖는다(§11.1).
 */
import type { ProgressionConfig } from './types';

export const PROGRESSION = {
  stageCount:              5,     // §13.1 · §9.2 스테이지 수. 5를 클리어하면 런이 끝난다 — 무한 모드는 없다
  restartStageId:          1,     // §13.3 재시작 지점. 중간 저장이 없으므로 어느 스테이지에서 죽어도 여기다
  lifeCarriesAcrossStages: true,  // §13.2 라이프는 5스테이지를 관통해 공유되고 클리어로 회복되지 않는다
  cardsLostOnGameOver:     true,  // §13.3 획득 카드 전부 소실. 다음 런의 추첨은 이전 런을 기억하지 않는다
  rerollResetOnGameOver:   true,  // §11.1 리롤 사용 여부도 함께 초기화된다
  comboResetOnStageStart:  true,  // §12.2 콤보는 스테이지를 넘어 유지되지 않는다
} as const satisfies ProgressionConfig;
