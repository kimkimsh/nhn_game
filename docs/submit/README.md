# 제출용 게임 소개서

NAN 2026 사전 과제의 「게임 소개 및 설명 PDF」에 해당하는 문서다.
게임 개요, 플레이 방법, 실행 방법을 A4 7쪽에 담았다.

| 파일 | 내용 |
|---|---|
| `게임_소개서.pdf` | 제출본. A4 세로 7쪽 |
| `게임_소개서.html` | PDF의 원본. 브라우저로 열어도 같은 지면이 보인다 |
| `images/` | 인게임 화면 8장 |
| `fonts.css` · `fonts/` | 문서가 쓰는 글자만 남긴 웹폰트 하위 집합 |

## 다시 만드는 방법

`게임_소개서.html`을 고친 뒤 Chrome으로 인쇄한다.

```bash
cd docs/submit
google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=25000 --print-to-pdf="게임_소개서.pdf" \
  "file://$PWD/게임_소개서.html"
```

`@page { size: A4; margin: 0 }`과 `.sheet`의 210mm × 297mm가 지면을 정하므로 인쇄 대화상자의
용지 설정과 무관하게 같은 결과가 나온다. 배경색이 빠지면 `print-color-adjust: exact`가 지워진
것이다.

**Google Fonts를 `<link>`로 불러오면 안 된다.** headless 인쇄는 글꼴 요청이 끝나기 전에 지면을
찍어 버려서 본문이 대체 글꼴로 굳는다. 그래서 `fonts/`에 파일을 두고 상대 경로로 읽는다.

`fonts/`를 다시 만들려면 Google Fonts CSS(`Gowun Batang` 400·700, `IBM Plex Sans KR` 400·600,
`IBM Plex Mono` 400·500·600)를 받아 `unicode-range`가 본문의 글자와 겹치는 `@font-face`만
남기고 그 woff2를 내려받는다. 79개 파일 1.2 MB가 나온다.

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
