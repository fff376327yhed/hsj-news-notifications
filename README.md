# 📰 해정뉴스 - 백그라운드 알림 시스템

## 🚀 자동화 시스템

### 📱 푸시 알림 시스템
- ⏰ **5분마다 자동 실행** (GitHub Actions)
- 🔔 **읽지 않은 알림 자동 전송**
- 📱 **FCM(Firebase Cloud Messaging) 사용**
- 🔒 **안전한 키 관리** (GitHub Secrets)
- ⚡ **중복 방지 강화** (Tag/Thread-ID + pushed 플래그)

## ✨ 주요 기능

### 알림 시스템
- **5분 간격 자동 실행**: GitHub Actions로 5분마다 자동으로 알림 전송
- **실시간 알림**: 5분 이내 생성된 알림만 처리
- **중복 방지**: pushed 플래그로 이미 전송된 알림 필터링
- **무효 토큰 자동 제거**: 실패한 FCM 토큰 자동 정리
- **오래된 알림 정리**: 7일 이상 된 알림 자동 삭제

### GitHub Actions 최적화
```yaml
# ✅ 5분마다 실행 (cron: */5 * * * *)
# ✅ npm 캐시 활성화 (속도 향상)
# ✅ npm ci 사용 (더 빠른 설치)
# ✅ 중복 실행 방지 로직 강화
```

## 📊 알림 시스템 기능

### 알림 타입
- **📰 새 기사**: 팔로우한 사용자의 새 글
- **💬 댓글**: 내가 쓴 댓글에 대한 답글
- **📝 내 기사**: 내 기사에 달린 댓글

### 중복 방지 메커니즘
1. **5분 이내 알림만 처리** - 오래된 알림 제외
2. **pushed 플래그** - 이미 전송된 알림 스킵
3. **Tag/Thread-ID** - 같은 알림 덮어쓰기
4. **동시 실행 방지** - 전송 전 pushed 재확인
5. **재시도 로직** - 실패 시 플래그 롤백

## 🔧 설정 방법

### GitHub Secrets 등록
1. Firebase Service Account JSON 발급
2. GitHub Secrets에 다음 값 등록:
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase 비공개 키 (JSON 전체)
   - `FIREBASE_DATABASE_URL`: `https://hsj-news-default-rtdb.firebaseio.com`

### Firebase 데이터 구조
```
notifications/
  {uid}/
    {notificationId}/
      title: string
      text: string
      type: "article" | "comment" | "myArticleComment"
      articleId: string (optional)
      timestamp: number
      read: boolean
      pushed: boolean
      pushedAt: number (optional)
      pushSuccessCount: number (optional)
      pushFailureCount: number (optional)

users/
  {uid}/
    fcmTokens/
      {tokenId}/
        token: string
        createdAt: number
    notificationsEnabled: boolean
```

## 📝 수동 실행

### 알림 전송 수동 실행
1. GitHub 저장소 → Actions 탭
2. "Push Notifications Sender" 선택
3. "Run workflow" 클릭

## 📊 모니터링

- **Actions 탭**에서 실행 로그 확인
- 성공/실패 이메일 알림
- 실시간 통계 확인 가능

## 🔄 시스템 흐름

### 5분마다 자동 실행
1. **GitHub Actions Cron**: 5분마다 자동 트리거
2. **send-notifications.js** 실행 (푸시 알림 전송)
3. 무효 토큰 자동 제거
4. 7일 이상 오래된 알림 자동 삭제

## 🎯 주요 특징

### 효율성
- ⚡ **npm 캐시 활성화** - 빠른 의존성 설치
- 📦 **배치 처리** - multicast 전송
- 🗑️ **무효 토큰 자동 제거**
- 🧹 **7일 이상 오래된 알림 자동 삭제**
- ⏱️ **API 제한 방지** (요청 간 100ms 딜레이)

### 안정성
- 🔒 **동시 실행 방지** - pushed 플래그 사용
- 🔄 **재시도 로직** - 실패 시 플래그 롤백
- 📊 **상세 로그** - 성공/실패 건수 기록
- ⚠️ **에러 처리** - 각 단계별 try-catch

## 🛠️ 개발 환경

- **Node.js**: 20.x
- **Firebase Admin SDK**: 12.0.0
- **GitHub Actions**: Cron Schedule (5분 간격)

## 📁 파일 구조

```
.github/workflows/
  └── push-notifications.yml       # 알림 전송 워크플로우 (5분)

send-notifications.js              # 알림 전송 스크립트
package.json                       # 의존성 관리
README.md                          # 문서
```

## ⚠️ 주의사항

### GitHub Actions 제한
- **5분이 최소 실행 주기입니다**
- 더 빠른 실행이 필요하면 다른 서비스 사용 권장:
  - Vercel Cron (1분 간격 가능)
  - AWS Lambda + EventBridge (1분 간격)
  - Google Cloud Scheduler (1분 간격)

### 알림 설정
- 사용자가 FCM 토큰을 등록해야 알림을 받습니다
- 알림 비활성화 시 푸시가 전송되지 않습니다

### 배터리 절약
- 5분 간격은 배터리 소모가 적당한 수준입니다
- 더 자주 알림을 받고 싶다면 앱을 열어두세요

## 📞 문의

문제가 발생하면 Issues 탭에 문의해주세요.

## 🔄 업데이트 내역

### v2.2.0 (2025-01-20)
- ✅ 5분 간격 자동 실행 시스템 완성
- ✅ 실시간 알림 처리 (5분 이내 생성된 알림만)
- ✅ 중복 방지 로직 강화
- ✅ 무효 토큰 자동 제거
- ✅ 오래된 알림 자동 정리

### v2.1.0 (2025-01-11)
- ✅ 주식 관련 기능 제거
- ✅ 알림 시스템에만 집중
- ✅ GitHub Actions 최적화

### v2.0.0 (2025-01-05)
- ✅ Quill 에디터 중복 문제 해결
- ✅ 메신저 → 알림 확인 기능으로 변경
- ✅ GitHub Actions 최적화 (5분 주기)
- ✅ npm 캐시 활성화
- ✅ 중복 방지 로직 강화
- ✅ 알림 필터링 기능 추가

### v1.0.0 (2025-01-04)
- 🎉 초기 릴리스
- 📱 푸시 알림 시스템

---

Made with ❤️ for 해정뉴스
