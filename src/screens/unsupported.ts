/**
 * 모바일 미지원 안내 — 스펙 §16.6 · 08 §7
 *
 * **이 화면의 완료 조건은 「폰에서 열었을 때 *미지원*이라고 읽히는 것」이다.** 빈 화면, 검은
 * 캔버스, 잘린 레이아웃, 멈춘 로딩은 전부 「고장」으로 읽히므로 실패다. 제출물이 링크 클릭만으로
 * 열리는 공개 웹 빌드라 심사자가 휴대폰으로 열 가능성이 있고, 그때 조작이 안 되는 화면을 그대로
 * 두면 미지원이 아니라 고장으로 보고된다.
 *
 * ── 이 화면만 캔버스를 안 쓴다 (08 §7.3) ───────────────────────────────────────
 *
 * `boot/canvas.ts`의 DPR·스케일 경로가 실패하거나 어긋나도 안내는 떠야 한다. 안내가 캔버스에
 * 의존하면 캔버스가 문제인 상황에서 안내도 같이 죽는다. 그래서 DOM/CSS 한 겹을 화면 전체에
 * 덮고, 아래에 무엇이 있든(검은 캔버스든 아무것도 없든) 가린다.
 *
 * 색과 서체는 `config/palette.ts` · `config/ui.ts`에서 그대로 읽는다. 08 §7.3은 이 몇 값을
 * `index.html`의 셸 CSS에 적으라고 했지만, import 한 줄이면 색의 단일 소스(12 §3.2)를 쪼개지
 * 않고도 같은 결과가 나온다 — 값을 옮겨 적는 순간 팔레트를 고친 사람이 이 화면만 잊는다.
 *
 * ── 세로 비율을 사과하지 않는다 ────────────────────────────────────────────────
 *
 * §16.6이 못 박았다 — 플레이필드가 9:16 세로인 것은 **모바일을 겨냥한 것이 아니라 종스크롤
 * 슈팅의 장르 관례**이고, §3.1의 좌표계가 그 구조에서 나왔다. 그래서 문구에 「모바일 버전
 * 준비 중」이나 「세로 화면인데 죄송합니다」류가 없다. 세로인데 왜 PC냐는 오해를 먼저 끊기
 * 위해 그 사실을 화면에도 한 줄로 적는다.
 *
 * ── 탈출구 (T-18) ──────────────────────────────────────────────────────────────
 *
 * 물리 keydown 하나면 판정을 뒤집는다(08 §7.2). 뒤집은 뒤 부팅을 다시 태우는 것은
 * `screens/manager.ts`가 미지원 판정에서 곧바로 반환하기 때문이다 — 그 시점 이후로 화면
 * 매니저를 다시 세울 입구가 없다. D-03의 단일 파일 빌드에는 네트워크 대기가 없어서 다시
 * 부팅하는 비용이 사실상 0이다.
 */

import { grantKeyboardOverride } from '../boot/platform-guard';
import { PALETTE } from '../config/palette';
import { PLAYER } from '../config/player';
import { FONTS } from '../config/ui';

/** 두 번 부르면 안내가 두 겹이 된다. `manager.ts`는 한 번만 부르지만 그 계약에 기대지 않는다 */
const ROOT_ID = 'hwando-unsupported';

/**
 * 폰 세로 화면에서 스크롤 없이 들어가야 한다(08 §7.3). 그래서 크기는 전부 `clamp(최소, vw, 최대)`
 * 꼴이고 고정 px이 하나도 없다 — 320px 폭에서도 1024px 폭에서도 같은 위계로 읽힌다.
 */
const CSS = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(0.9rem, 3.2vw, 1.6rem);
  box-sizing: border-box;
  padding: clamp(1.4rem, 6vw, 3rem);
  overflow-y: auto;
  background: ${PALETTE.ink900};
  color: ${PALETTE.baek};
  font-family: ${FONTS.body};
  line-height: 1.55;
  text-align: center;
}
#${ROOT_ID} .hw-mark {
  font-family: ${FONTS.display};
  font-weight: 700;
  font-size: clamp(2.6rem, 13vw, 4.4rem);
  letter-spacing: 0.06em;
}
#${ROOT_ID} .hw-mark span {
  display: block;
  color: ${PALETTE.hwang};
  font-weight: 400;
  font-size: clamp(0.9rem, 4vw, 1.3rem);
  letter-spacing: 0.32em;
}
#${ROOT_ID} .hw-lead {
  font-size: clamp(1.05rem, 4.6vw, 1.5rem);
  font-weight: 500;
}
#${ROOT_ID} .hw-why {
  margin: 0 auto;
  padding: 0;
  max-width: 34rem;
  list-style: none;
  text-align: left;
  color: ${PALETTE.baekMute};
  font-size: clamp(0.85rem, 3.6vw, 1.05rem);
}
#${ROOT_ID} .hw-why li + li {
  margin-top: 0.6rem;
}
#${ROOT_ID} .hw-why b {
  color: ${PALETTE.baek};
  font-weight: 600;
}
#${ROOT_ID} .hw-keys {
  font-family: ${FONTS.data};
  font-size: clamp(0.8rem, 3.4vw, 1rem);
  color: ${PALETTE.cheong};
}
#${ROOT_ID} .hw-keys div + div {
  margin-top: 0.35rem;
}
#${ROOT_ID} .hw-note {
  color: ${PALETTE.baekFaint};
  font-size: clamp(0.72rem, 3vw, 0.9rem);
  max-width: 34rem;
  margin: 0 auto;
}
`;

/**
 * 08 §7.3 「내용 2 — 이유」. §16.6이 적은 두 가지를 그대로 옮긴다.
 *
 * 코어 반경은 `PLAYER.hitRadiusU`에서 읽는다. 숫자를 문장에 적어 두면 판정 반경을 조정한
 * 사람이 이 화면만 잊고, 안내가 지금 게임과 다른 수치를 말하게 된다.
 */
const REASONS: readonly (readonly [string, string])[] = [
  ['동시 입력', '이동과 패리가 동시에 들어가야 하는데, 드래그로 움직이며 같은 화면을 탭하면 한 손가락이 두 역할을 다툰다.'],
  ['판정 가림', `패리 등급이 탄환과 플레이어 중심 사이 거리로 정해져 반경 ${PLAYER.hitRadiusU}u 코어가 계속 보여야 하는데, 손가락이 그 위를 덮는다.`],
];

/** §16.1 조작 두 줄. 왜 터치로 대체되지 않는지가 이 두 줄로 읽힌다 */
const KEY_LINES: readonly string[] = [
  '이동    WASD · 방향키',
  '패리    SPACE · J · 좌클릭',
];

function element(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== '') {
    node.className = className;
  }
  if (text !== '') {
    node.textContent = text;
  }
  return node;
}

function reasonList(): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'hw-why';
  for (const [title, body] of REASONS) {
    const item = document.createElement('li');
    item.appendChild(element('b', '', title));
    item.appendChild(document.createTextNode(` — ${body}`));
    list.appendChild(item);
  }
  return list;
}

function keyBlock(): HTMLElement {
  const block = element('div', 'hw-keys', '');
  for (const line of KEY_LINES) {
    block.appendChild(element('div', '', line));
  }
  return block;
}

function markBlock(): HTMLElement {
  const mark = element('div', 'hw-mark', '환도');
  mark.appendChild(element('span', '', '還 刀'));
  return mark;
}

/**
 * T-18. **물리 keydown 하나**다 — 포인터로는 뒤집지 않는다. 뒤집으려는 판정이 "정밀 포인터가
 * 있는가"였으므로 포인터 이벤트는 그 판정에 아무 정보도 더하지 않는다.
 */
function armKeyboardEscape(): void {
  function onKeyDown(): void {
    window.removeEventListener('keydown', onKeyDown);
    grantKeyboardOverride();
    window.location.reload();
  }
  window.addEventListener('keydown', onKeyDown);
}

/** `screens/registry.ts`가 이 이름으로 잡는다. 게임은 시작되지 않은 상태로 여기 들어온다 */
export function showUnsupported(): void {
  if (document.getElementById(ROOT_ID) !== null) {
    return;
  }
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.appendChild(markBlock());
  root.appendChild(element('p', 'hw-lead', 'PC 브라우저에서 열어 주세요.'));
  root.appendChild(reasonList());
  root.appendChild(keyBlock());
  root.appendChild(element(
    'p',
    'hw-note',
    '세로 화면은 종스크롤 슈팅의 장르 관례이며 모바일용이 아닙니다. '
    + '키보드가 연결되어 있다면 아무 키나 누르세요 — 바로 시작합니다.',
  ));
  document.body.appendChild(root);

  armKeyboardEscape();
}
