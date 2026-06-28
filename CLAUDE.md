# 작전노트 (study-planner) — Claude 컨텍스트

Firebase 기반 학습 플래너 웹앱. 중학생 학습자 대상, 멘티/멘토 역할 구분.

## 기술 스택

- Vanilla JS + HTML 단일 파일 구조 (프레임워크 없음)
- Firebase Firestore, Auth, Hosting, Cloud Functions v2
- OpenAI GPT-4o Vision, Google Custom Search API (독서 모듈)

## 핵심 컨벤션

### 날짜 / 타임존
- `today()` → KST 기준 오늘 날짜 문자열 `YYYY-MM-DD`
- `toKSTDateStr(d)` → Date 객체를 KST 문자열로 변환
- 날짜→요일 변환은 반드시 `T12:00:00` 패턴 사용 (UTC 자정 버그 방지)
  - `todayDow()` = `new Date(today() + 'T12:00:00').getDay()`
  - `dateDow(dateStr)` = `new Date(dateStr + 'T12:00:00').getDay()`
- 주간 날짜 배열: `getThisWeekDates()` → 월~일 7개 (KST 안전)

### 요일 순서 / 매핑
- UI 표시: 월 화 수 목 금 토 일 (항상 월요일 시작)
- JS getDay() 값: 월=1, 화=2, 수=3, 목=4, 금=5, 토=6, 일=0
- `DAY_LABELS = ['월','화','수','목','금','토','일']`
- `DAY_NUMS   = [  1,   2,   3,   4,   5,   6,   0]`

### 인증
- `requireAuth(callback)` → USER_ID 세팅 후 callback 실행
- 모든 페이지 하단에서 호출, `setActiveNav('페이지명')` 같이 사용

### 용어
- 교재(책)와 과제(반복 태스크) 모두 UI에서는 **"과제"** 로 표기 통일
- Firestore 컬렉션: 교재 → `books`, 과제 → `tasks`, 과제 로그 → `taskLogs`

## Firestore 구조

```
users/{uid}/
  books/{bookId}           — 교재 (title, subject, totalPages, dailyPages, status, ...)
  books/{bookId}/dailyLogs/{dateStr}    — 교재 일별 학습 기록
  books/{bookId}/weeklyPlans/{weekStart} — 주간 계획
  tasks/{taskId}           — 과제 (name, type, days[], subItems[], status)
  taskLogs/{date_taskId}   — 과제 로그 (percent or checkedItems, date, taskId)
  weeklyReviews/{weekStart} — 주간 점검 결과
  readingChats/{chatId}    — 독서 AI 채팅 히스토리
```

## 주요 파일

| 파일 | 역할 |
|------|------|
| `app.js` | 공통 헬퍼 (DB 함수, 날짜, 인증, KST 유틸) |
| `style.css` | 공통 스타일 (CSS 변수: --primary, --surface-1~3, --text-1~3, --r 등) |
| `firebase-config.js` | Firebase 초기화 |
| `index.html` | 홈 대시보드 (오늘의 과제 통합 카드, 멘토 리디렉션) |
| `mission.html` | 오늘 학습 기록 (교재 + 과제 통합) |
| `weekly.html` | 주간 과제표 (교재+과제 통합 테이블, table-layout:fixed) |
| `bookshelf.html` | 학습관리 (교재/과제 탭 분리 — 관리 목적) |
| `review.html` | 주간 점검 + AI 분석 + 교재별 조정 |
| `register.html` | 교재 등록 |
| `task-register.html` | 과제 등록 |
| `reading.html` | 독서 홈 (모듈 선택) |
| `reading-book.html` | 책 표지 찍어 AI 독후 대화 |
| `reading-passage.html` | 본문 글 찍어 AI 탐구 대화 |
| `mentor.html` | 멘토 대시보드 (멘티 학습 현황) |
| `connect.html` | 멘토/멘티 연결 |
| `settings.html` | 설정 (멘토연결, 푸시알림, 프로필) |
| `functions/index.js` | Cloud Functions (AI 분석, 독서 챗봇, 주간 점검) |

## 주간 테이블 구조 (weekly.html)

- `table-layout:fixed`, 컬럼 폭: 이름 90px + 요일 7×40px = 370px → 모바일 가로스크롤 없음
- 교재 행 → 섹션 구분선 → 과제 행 순서로 단일 `<table>` 내 렌더
- 셀 표시: ✓(완료) / N쪽(진행중) / ○(예정) / —(휴식/미지정)

## Cloud Functions 엔드포인트

- `analyzeReading` — 이미지(base64) 분석 후 채팅 세션 생성
- `readingChat` — 독서 AI 이어서 대화
- `analyzeMission` (또는 유사명) — 주간 점검 AI 분석

## 환경 변수 (Firebase Secrets)

```
OPENAI_API_KEY
GOOGLE_SEARCH_API_KEY
GOOGLE_SEARCH_CX
```

## 최근 완료 작업

- weekly.html 가로스크롤 제거 → 통합 테이블로 재설계
- 용어 통일: 교재/과제 → UI상 모두 "과제"
- KST 타임존 버그 전면 수정 (T12:00:00 패턴 적용)
- index.html "오늘 할 일" + "오늘의 과제" → 단일 카드 병합
- mission.html "오늘 할 일" → "오늘의 과제" 라벨 변경
- review.html 과제 달성 현황 구현 (renderTaskBreakdown 추가)
- reading 모듈 전면 재설계 (GPT-4o Vision + Google Custom Search)
- weekly.html 과제 편집 기능 추가 (조회만 되던 것 수정 가능하게)
