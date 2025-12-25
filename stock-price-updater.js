const admin = require('firebase-admin');

console.log('📈 주식 가격 업데이트 시작...');
console.log('⏰ 실행 시간:', new Date().toLocaleString('ko-KR'));

// Firebase Admin 초기화
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  
  console.log('✅ Firebase Admin 초기화 완료');
} catch (error) {
  console.error('❌ Firebase 초기화 실패:', error.message);
  process.exit(1);
}

const db = admin.database();

// 주식 종목 정의 (stock.js와 동일)
const STOCK_CATEGORIES = {
  '해정': ['전자', '음식', '로봇', '전기', '약품', '공업', '항공우주', '성장판'],
  '은채': ['전자', '음식', '로봇', '전기', '약품', '공업', '항공우주'],
  '아영': ['전자', '음식', '로봇', '전기', '약품', '공업', '항공우주', '키작음']
};

// 종목별 변동 특성 (실제 시장 참고)
const STOCK_VOLATILITY = {
  '전자': { min: -0.025, max: 0.025, trend: 0.0005 },      // 안정적
  '음식': { min: -0.02, max: 0.02, trend: 0.0003 },        // 매우 안정적
  '로봇': { min: -0.04, max: 0.05, trend: 0.001 },         // 성장주
  '전기': { min: -0.03, max: 0.03, trend: 0.0002 },        // 중간
  '약품': { min: -0.035, max: 0.045, trend: 0.0008 },      // 성장주
  '공업': { min: -0.025, max: 0.025, trend: 0 },           // 안정적
  '항공우주': { min: -0.05, max: 0.06, trend: 0.0015 },    // 고변동성
  '성장판': { min: -0.06, max: 0.08, trend: 0.002 },       // 초고변동성
  '키작음': { min: -0.055, max: 0.065, trend: 0.0012 }     // 고변동성
};

// 가격 변동 계산
function calculatePriceChange(stockName, currentPrice) {
  const volatility = STOCK_VOLATILITY[stockName] || { min: -0.03, max: 0.03, trend: 0 };
  
  // 랜덤 변동률 계산 (정규분포 근사)
  const random1 = Math.random();
  const random2 = Math.random();
  const normalRandom = Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);
  
  // 변동률 계산 (트렌드 + 랜덤)
  const range = volatility.max - volatility.min;
  let changePercent = volatility.trend + (normalRandom * range / 4);
  
  // 최소/최대 제한
  changePercent = Math.max(volatility.min, Math.min(volatility.max, changePercent));
  
  // 새 가격 계산
  const newPrice = Math.floor(currentPrice * (1 + changePercent));
  const change = newPrice - currentPrice;
  
  return {
    newPrice: Math.max(1000, newPrice), // 최소 1000원
    change: change,
    changePercent: changePercent * 100
  };
}

// 알림 생성 함수
async function createStockAlert(uid, stockId, stockName, change, changePercent, userEmail) {
  try {
    // 사용자의 알림 설정 확인
    const settingsSnapshot = await db.ref(`users/${uid}/stockAlertSettings`).once('value');
    const settings = settingsSnapshot.val() || {};
    
    const riseThreshold = settings.riseThreshold || 0;
    const fallThreshold = settings.fallThreshold || 0;
    
    // 알림이 비활성화되어 있으면 스킵
    if (riseThreshold === 0 && fallThreshold === 0) {
      return false;
    }
    
    let shouldAlert = false;
    let alertType = '';
    let alertIcon = '';
    
    // 상승 알림 체크
    if (changePercent > 0 && riseThreshold > 0 && changePercent >= riseThreshold) {
      shouldAlert = true;
      alertType = 'rise';
      alertIcon = '📈';
    }
    
    // 하락 알림 체크
    if (changePercent < 0 && fallThreshold > 0 && Math.abs(changePercent) >= fallThreshold) {
      shouldAlert = true;
      alertType = 'fall';
      alertIcon = '📉';
    }
    
    if (!shouldAlert) {
      return false;
    }
    
    // 알림 생성
    const notificationRef = db.ref(`notifications/${uid}`).push();
    await notificationRef.set({
      title: `${alertIcon} ${stockName} ${alertType === 'rise' ? '상승' : '하락'} 알림`,
      text: `${stockName} 주식이 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% ${alertType === 'rise' ? '상승' : '하락'}했습니다. (${change >= 0 ? '+' : ''}${change.toLocaleString()}원)`,
      type: 'stock_alert',
      stockId: stockId,
      change: change,
      changePercent: changePercent,
      alertType: alertType,
      timestamp: Date.now(),
      read: false,
      pushed: false
    });
    
    console.log(`  📬 알림 생성: ${userEmail} - ${stockName} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
    return true;
    
  } catch (error) {
    console.error('  ❌ 알림 생성 오류:', error.message);
    return false;
  }
}

// 메인 실행 함수
async function updateStockPrices() {
  try {
    console.log('📊 주식 데이터 로딩 중...');
    
    // 1. 모든 주식 가격 가져오기
    const pricesSnapshot = await db.ref('stocks/prices').once('value');
    const prices = pricesSnapshot.val() || {};
    
    // 2. 모든 사용자의 보유 주식 가져오기
    const userStocksSnapshot = await db.ref('stocks/userStocks').once('value');
    const userStocks = userStocksSnapshot.val() || {};
    
    // 3. 사용자 정보 가져오기 (이메일용)
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val() || {};
    
    const updates = {};
    let updatedCount = 0;
    let totalAlerts = 0;
    
    // 4. 각 주식 가격 업데이트
    for (const [category, names] of Object.entries(STOCK_CATEGORIES)) {
      for (const name of names) {
        const stockId = `${category}_${name}`;
        const currentData = prices[stockId];
        
        if (!currentData) {
          console.log(`⚠️  ${stockId} - 가격 데이터 없음, 초기화 필요`);
          continue;
        }
        
        // 가격 변동 계산
        const { newPrice, change, changePercent } = calculatePriceChange(name, currentData.price);
        
        // 히스토리 업데이트
        const history = currentData.history || [];
        history.push({
          price: newPrice,
          timestamp: Date.now()
        });
        
        // 최근 100개만 유지
        if (history.length > 100) {
          history.shift();
        }
        
        // 업데이트 데이터 준비
        updates[`stocks/prices/${stockId}`] = {
          price: newPrice,
          change: change,
          changePercent: changePercent,
          lastUpdate: Date.now(),
          history: history
        };
        
        console.log(`📊 ${stockId}: ${currentData.price.toLocaleString()}원 → ${newPrice.toLocaleString()}원 (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
        
        updatedCount++;
        
        // 5. 이 주식을 보유한 사용자들에게 알림
        for (const [uid, stocks] of Object.entries(userStocks)) {
          if (stocks[stockId]) {
            const user = users[uid];
            const userEmail = user?.email || 'unknown';
            
            const alertCreated = await createStockAlert(
              uid,
              stockId,
              stockId,
              change,
              changePercent,
              userEmail
            );
            
            if (alertCreated) {
              totalAlerts++;
            }
          }
        }
        
        // API 제한 방지 딜레이
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 6. 모든 업데이트 한 번에 적용
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`\n✅ ${updatedCount}개 주식 가격 업데이트 완료`);
      console.log(`📬 ${totalAlerts}개 알림 생성`);
    } else {
      console.log('ℹ️  업데이트할 주식이 없습니다.');
    }
    
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ 주식 가격 업데이트 중 오류:', error);
    throw error;
  }
}

// 실행
updateStockPrices()
  .then(() => {
    console.log('\n✅ 작업 완료! (5분 간격 실행)');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 작업 실패:', error);
    process.exit(1);
  });
