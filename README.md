## 🚀 작동 방식

- ⏰ **5분마다 자동 실행** (GitHub Actions Cron)
- 🔔 **읽지 않은 알림 자동 전송**
- 📱 **FCM(Firebase Cloud Messaging) 사용**
- 🔒 **안전한 키 관리** (GitHub Secrets)

## 📊 모니터링

- **Actions 탭**에서 실행 로그 확인
- 성공/실패 이메일 알림
- 실시간 통계 확인 가능

## 🔧 설정 방법

1. Firebase Service Account JSON 발급
2. GitHub Secrets에 다음 값 등록:
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase 비공개 키 (JSON 전체)
   - `FIREBASE_DATABASE_URL`: `https://hsj-news-default-rtdb.firebaseio.com`

## 📝 수동 실행

Actions 탭 → "Push Notifications Sender" → "Run workflow" 클릭

---

Made with ❤️ for 해정뉴
