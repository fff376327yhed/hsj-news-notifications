# 📰 해정뉴스 - 백그라운드 시스템

## 🚀 자동화 시스템

### 📱 푸시 알림 시스템
- ⏰ **5분마다 자동 실행** (GitHub Actions Cron)
- 🔔 **읽지 않은 알림 자동 전송**
- 📱 **FCM(Firebase Cloud Messaging) 사용**
- 🔒 **안전한 키 관리** (GitHub Secrets)

### 📈 주식 가격 변동 시스템
- ⏰ **5분마다 자동 가격 변동**
- 📊 **실제 시장 변동률 반영** (종목별 차등)
- 🔔 **보유 주식 가격 알림** (상승/하락)
- 📉 **실시간 히스토리 기록** (최근 100개)

## 📊 주식 시스템 기능

### 종목 특성
- **전자**: 안정적 성장 (변동률: -2.5% ~ +2.5%)
- **음식**: 매우 안정적 (변동률: -2% ~ +2%)
- **로봇**: 고성장주 (변동률: -4% ~ +5%)
- **전기**: 중간 변동 (변동률: -3% ~ +3%)
- **약품**: 성장주 (변동률: -3.5% ~ +4.5%)
- **공업**: 안정적 (변동률: -2.5% ~ +2.5%)
- **항공우주**: 고변동성 (변동률: -5% ~ +6%)
- **성장판**: 초고변동성 (변동률: -6% ~ +8%)
- **키작음**: 고변동성 (변동률: -5.5% ~ +6.5%)

### 알림 설정
사용자는 알림 설정 페이지에서 다음을 설정할 수 있습니다:
- 📈 **상승률 알림**: X% 이상 상승 시 알림
- 📉 **하락률 알림**: X% 이상 하락 시 알림
- 🔕 **비활성화**: 0으로 설정 시 알림 없음 (기본값)

## 🔧 설정 방법

### GitHub Secrets 등록
1. Firebase Service Account JSON 발급
2. GitHub Secrets에 다음 값 등록:
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase 비공개 키 (JSON 전체)
   - `FIREBASE_DATABASE_URL`: `https://hsj-news-default-rtdb.firebaseio.com`

### Firebase 데이터 구조
```
users/
  {uid}/
    stockAlertSettings/
      riseThreshold: 2.0    # 2% 이상 상승 시 알림
      fallThreshold: 2.0    # 2% 이상 하락 시 알림
      updatedAt: timestamp

stocks/
  prices/
    {stockId}/
      price: number
      change: number
      changePercent: number
      lastUpdate: timestamp
      history: []
  
  userStocks/
    {uid}/
      {stockId}/
        quantity: number
        totalCost: number
        averagePrice: number

notifications/
  {uid}/
    {notificationId}/
      title: string
      text: string
      type: "stock_alert" | "notification"
      stockId: string (if stock_alert)
      change: number
      changePercent: number
      alertType: "rise" | "fall"
      read: boolean
      pushed: boolean
```

## 📝 수동 실행

### 알림 전송 수동 실행
Actions 탭 → "Push Notifications Sender" → "Run workflow" 클릭

### 주식 가격 업데이트 수동 실행
Actions 탭 → "Stock Price Updater" → "Run workflow" 클릭

## 📊 모니터링

- **Actions 탭**에서 실행 로그 확인
- 성공/실패 이메일 알림
- 실시간 통계 확인 가능

## 🔄 시스템 흐름

### 5분마다 자동 실행
1. **stock-price-updater.js** 실행
   - 모든 주식 가격 업데이트 (종목별 변동률 적용)
   - 히스토리 기록
   - 보유 주식 체크
   - 설정된 임계값 확인
   - 알림 생성

2. **send-notifications.js** 실행
   - 읽지 않은 알림 조회
   - FCM 토큰 확인
   - 푸시 알림 전송
   - 전송 결과 기록

## 🎯 주요 특징

### 중복 방지
- ⏰ **5분 이내 생성된 알림만 처리**
- 🏷️ **Tag/Thread-ID 사용** (같은 알림 중복 방지)
- ✅ **pushed 플래그** (이미 전송된 알림 제외)
- 🔄 **재시도 로직** (실패 시 플래그 롤백)

### 효율성
- 📦 **배치 처리** (multicast 전송)
- 🗑️ **무효 토큰 자동 제거**
- 🧹 **7일 이상 오래된 알림 자동 삭제**
- ⚡ **API 제한 방지** (요청 간 딜레이)

## 🛠️ 개발 환경

- **Node.js**: 20.x
- **Firebase Admin SDK**: 12.0.0
- **GitHub Actions**: Cron Schedule

## 📁 파일 구조

```
.github/workflows/
  ├── push-notifications.yml       # 알림 전송 워크플로우
  └── stock-price-updater.yml      # 주식 가격 업데이트 워크플로우

send-notifications.js              # 알림 전송 스크립트
stock-price-updater.js             # 주식 가격 업데이트 스크립트
package.json                       # 의존성 관리
```

## ⚠️ 주의사항

- 알림 설정이 **기본적으로 비활성화**(0) 되어 있습니다
- 사용자가 직접 임계값을 설정해야 알림을 받습니다
- 주식 가격 변동은 **보유 주식에 대해서만** 알림이 전송됩니다
- GitHub Actions 무료 사용량 제한에 주의하세요

## 📞 문의

문제가 발생하면 Issues 탭에 문의해주세요.

---

Made with ❤️ for 해정뉴스
