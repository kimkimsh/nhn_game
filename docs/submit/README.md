# 제출 문서

NAN 2026 사전 과제의 PDF 세 종이다.

| 파일 | 요건 항목 | 분량 |
|---|---|---|
| `게임_소개서.pdf` | 게임 소개 및 설명 | A4 7쪽 |
| `AI_활용_기술.pdf` | AI 활용 기술 | A4 6쪽 |
| `팀_소개.pdf` | 팀원 롤 기술 | A4 4쪽 |

각 PDF의 원본이 같은 이름의 `.html`이다. 브라우저로 열어도 같은 지면이 보인다.

| 파일 | 내용 |
|---|---|
| `images/` | 인게임 화면 8장 |
| `fonts.css` · `fonts/` | 세 문서가 나눠 쓰는 웹폰트 하위 집합 |

## 다시 만드는 방법

`.html`을 고친 뒤 Chrome으로 인쇄한다.

```bash
cd docs/submit
for f in 게임_소개서 AI_활용_기술 팀_소개; do
  google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=25000 --print-to-pdf="$f.pdf" "file://$PWD/$f.html"
done
```

`@page { size: A4; margin: 0 }`과 `.sheet`의 210mm × 297mm가 지면을 정하므로 인쇄 대화상자의
용지 설정과 무관하게 같은 결과가 나온다. 배경색이 빠지면 `print-color-adjust: exact`가 지워진
것이다.

**Google Fonts를 `<link>`로 불러오면 안 된다.** headless 인쇄는 글꼴 요청이 끝나기 전에 지면을
찍어 버려서 본문이 대체 글꼴로 굳는다. 그래서 `fonts/`에 파일을 두고 상대 경로로 읽는다.

`fonts/`를 다시 만들려면 Google Fonts CSS(`Gowun Batang` 400·700, `IBM Plex Sans KR` 400·600,
`IBM Plex Mono` 400·500·600)를 받아, **세 HTML이 쓰는 글자를 합친 집합**과 `unicode-range`가
겹치는 `@font-face`만 남기고 그 woff2를 내려받는다. 99개 파일 1.4 MB가 나온다.
어느 문서든 새 글자가 들어가면 이 선별을 다시 돌려야 한다.

## 세 문서의 색 규칙이 다르다

같은 종이와 같은 글꼴과 같은 레일을 쓰지만 색이 뜻하는 것이 다르다.

- **게임_소개서** — 게임의 색법을 그대로 따른다. 적색은 적, 황색은 반사탄, 청색은 플레이어와
  조작. `src/config/palette.ts`의 값을 그대로 쓴다.
- **AI_활용_기술** — 축이 하나다. 황색은 AI가 만든 것, 먹색은 사람이 정한 것. 그래서 세 도구를
  색으로 구분하지 않고 이름으로만 구분한다.
- **팀_소개** — 대비시킬 축이 없어서 색을 하나만 쓴다. 황색은 역할 표시에만 붙고 나머지는
  전부 먹색이다. 세 사람에게 각자의 색을 주지 않은 것은 서열이 아니기 때문이다.

## 화면 이미지의 출처

| 파일 | 어디서 나왔나 |
|---|---|
| `01-title.png` | 실행 중인 게임을 1080×1920으로 캡처 |
| `02-stage1.png` · `03-parry.png` · `05-boss.png` · `06-stage5.png` · `08-boss2.png` | `tests/visual`이 렌더한 게임 프레임 |
| `04-card.png` | `docs/sample_image/11_card_select` — 스펙을 실행해 그린 한 프레임 |
| `07-detail.png` | `03-parry`와 같은 프레임을 3:4로 자른 것 |

전부 800px 폭으로 줄였다. A4에서 57~76mm로 놓이므로 300dpi를 넘는다.

## 글꼴 라이선스

Gowun Batang, IBM Plex Sans KR, IBM Plex Mono 셋 다 SIL Open Font License 1.1이다.
게임 빌드는 이 파일들을 읽지 않는다 — 글꼴 이름만 요청하고 없으면 시스템 글꼴로 대체한다.
