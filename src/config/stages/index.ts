/**
 * 스테이지 5개를 한 표로 — 스펙 §9.2
 *
 * 키가 StageId 그대로다. 배열로 모으면 인덱스와 스테이지 번호가 1씩 어긋난 채로 다니게 되고,
 * 그 어긋남은 배경이 한 칸 밀려도 화면만 봐서는 드러나지 않는다. Record면 다음 스테이지를
 * 집는 코드가 sim/run.ts의 StageId 하나로 끝난다.
 *
 * 보스 정의는 여기 없다. StageDef.bossId가 BOSSES의 키를 가리키기만 하고 실체는
 * bosses/index.ts가 갖는다 — 스테이지 편성과 보스 패턴은 서로를 열지 않고 고칠 수 있어야 한다.
 */
import type { StageId } from '../ids';
import type { StageDef } from '../types';
import { STAGE_1 } from './stage-1-busanjin';
import { STAGE_2 } from './stage-2-dongnaeseong';
import { STAGE_3 } from './stage-3-hansando';
import { STAGE_4 } from './stage-4-haengju';
import { STAGE_5 } from './stage-5-noryang';

export const STAGES = {
  1: STAGE_1, // §9.3 부산진 새벽
  2: STAGE_2, // §9.4 동래성 함락
  3: STAGE_3, // §9.5 한산도 앞바다
  4: STAGE_4, // §9.6 행주산성
  5: STAGE_5, // §9.7 노량 최후의 밤
} as const satisfies Record<StageId, StageDef>;
