# 📒 내 공부 작전노트

초6 아이를 위한 자기주도 학습 플래너 MVP

## 파일 구조

```
study-planner/
├── index.html        # 홈 (오늘 미션 + 진행률)
├── register.html     # 책 등록 (3단계)
├── mission.html      # 오늘의 미션
├── weekly.html       # 주간 작전표
├── review.html       # 주간 점검
├── report.html       # 완주 리포트
├── bookshelf.html    # 책장
├── parent.html       # 부모 화면
├── firebase-config.js  ← 여기에 Firebase 설정 입력
├── app.js            # 공통 유틸
└── style.css         # 스타일
```

## Firebase 설정 (필수)

### 1. Firebase 프로젝트 생성
1. https://console.firebase.google.com 접속
2. "프로젝트 추가" → 이름 입력
3. Google Analytics는 선택사항

### 2. Firestore 활성화
- 왼쪽 메뉴 → "Firestore Database" → "데이터베이스 만들기"
- 테스트 모드로 시작 (나중에 규칙 변경 가능)

### 3. 앱 등록 및 설정값 복사
- 프로젝트 설정 → "앱 추가" → 웹(</>) 아이콘
- 앱 이름 입력 후 Firebase SDK 설정값 복사
- `firebase-config.js` 파일에 붙여넣기

### 4. Firestore 보안 규칙 (테스트용)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // 테스트용, 나중에 수정 필요
    }
  }
}
```

## 실행 방법

### 방법 1: VS Code Live Server (추천)
1. VS Code에서 폴더 열기
2. Live Server 확장 설치
3. index.html 우클릭 → "Open with Live Server"

### 방법 2: 로컬 서버
```bash
cd study-planner
npx serve .
```

## Firestore 데이터 구조

```
users/
  user_main/
    books/
      {bookId}/
        - title, subject, totalPages, ...
        dailyLogs/
          {date}/  ← YYYY-MM-DD
        weeklyPlans/
          {weekStart}/  ← 주 시작일
        weeklyReviews/
          {weekStart}/
        reports/
          completion/
```

## 다음 개발 단계 제안

1. **Firebase Auth** 추가 → 다중 사용자 지원
2. **PWA** 설정 → 홈 화면에 앱으로 추가
3. **푸시 알림** → 매일 미션 알림
4. **OpenAI API** → AI 코칭 메시지 고도화
5. **부모/아이 계정 분리** → 역할별 뷰 분리
