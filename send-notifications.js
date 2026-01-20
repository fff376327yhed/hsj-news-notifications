const admin = require('firebase-admin');

console.log('🔔 백그라운드 알림 전송 시작...');
console.log('⏰ 실행 시간:', new Date().toLocaleString('ko-KR'));
console.log('⚡ 5분 간격 실행');

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

async function sendNotifications() {
  try {
    console.log('📊 데이터베이스 읽기 중...');
    
    // ⭐ 5분 이내 알림만 처리
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    // 1. 사용자 정보 먼저 가져오기 (한 번만)
    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let totalSent = 0;
    let totalFailed = 0;
    let processedUsers = 0;
    let skippedUsers = 0;
    
    // 2. 각 사용자별 최적화된 쿼리 사용
    for (const uid of Object.keys(usersData)) {
      const user = usersData[uid];
      
      // FCM 토큰 없으면 스킵
      if (!user || !user.fcmTokens) {
        skippedUsers++;
        continue;
      }
      
      // 알림이 비활성화되어 있으면 스킵
      if (user.notificationsEnabled === false) {
        skippedUsers++;
        continue;
      }
      
      // ⭐ 최적화: pushed=false인 알림만 쿼리로 가져오기
      const unreadQuery = await db.ref(`notifications/${uid}`)
        .orderByChild('pushed')
        .equalTo(false)
        .once('value');
      
      const queriedNotifications = unreadQuery.val() || {};
      
      // 🔍 추가 필터링 (read=false, 5분 이내)
      const unreadNotifications = Object.entries(queriedNotifications)
        .filter(([_, notif]) => {
          return !notif.read && notif.timestamp >= fiveMinutesAgo;
        })
        .map(([id, notif]) => ({ id, ...notif }));
      
      if (unreadNotifications.length === 0) {
        continue;
      }
      
      console.log(`\n📬 알림 전송 시작: ${user.email || uid}`);
      console.log(`   📊 전송 대상: ${unreadNotifications.length}개`);
      processedUsers++;
      
      // FCM 토큰 추출
      const tokens = Object.values(user.fcmTokens)
        .map(t => t.token)
        .filter(t => t);
      
      if (tokens.length === 0) {
        console.log('   ⚠️  유효한 FCM 토큰 없음');
        continue;
      }
      
      // 3. 각 알림 전송
      for (const notification of unreadNotifications) {
        // ⭐ 전송 전 다시 한 번 pushed 상태 확인 (동시 실행 방지)
        const recheck = await db.ref(`notifications/${uid}/${notification.id}/pushed`).once('value');
        if (recheck.val() === true) {
          console.log(`  ⏭️ 이미 전송된 알림: ${notification.title}`);
          continue;
        }
        
        // ⭐ 즉시 pushed 플래그 설정
        await db.ref(`notifications/${uid}/${notification.id}`).update({
          pushed: true,
          pushedAt: Date.now(),
          pushAttemptedAt: Date.now()
        });
        
        // 알림 메시지 구성
        const message = {
          data: {
            title: notification.title || '📰 해정뉴스',
            body: notification.text || '새로운 알림이 있습니다',
            text: notification.text || '새로운 알림이 있습니다',
            articleId: notification.articleId || '',
            type: notification.type || 'notification',
            notificationId: notification.id,
            timestamp: Date.now().toString()
          },
          tokens: tokens,
          android: {
            priority: 'high',
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'ic_notification',
              color: '#c62828',
              sound: 'default',
              channelId: 'default',
              tag: notification.id,
              clickAction: 'FLUTTER_NOTIFICATION_CLICK'
            }
          },
          apns: {
            payload: {
              aps: {
                alert: {
                  title: notification.title || '📰 해정뉴스',
                  body: notification.text || '새로운 알림이 있습니다'
                },
                sound: 'default',
                badge: 1,
                'thread-id': notification.id,
                'mutable-content': 1
              }
            }
          },
          webpush: {
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'https://fff376327yhed.github.io/hsj_news.io/favicon/android-icon-192x192.png',
              badge: 'https://fff376327yhed.github.io/hsj_news.io/favicon/favicon-16x16.png',
              vibrate: [200, 100, 200],
              requireInteraction: false,
              tag: notification.id,
              renotify: false
            },
            fcmOptions: {
              link: notification.articleId ? 
                `https://fff376327yhed.github.io/hsj_news.io/?page=article&id=${notification.articleId}` : 
                'https://fff376327yhed.github.io/hsj_news.io/'
            }
          }
        };
        
        try {
          console.log(`   📤 전송 중: "${notification.title}"`);
          
          const response = await admin.messaging().sendEachForMulticast(message);
          
          console.log(`   📊 전송 결과:`);
          console.log(`      ✅ 성공: ${response.successCount}개`);
          console.log(`      ❌ 실패: ${response.failureCount}개`);
          
          totalSent += response.successCount;
          totalFailed += response.failureCount;
          
          // 전송 결과 기록
          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushSuccessCount: response.successCount,
            pushFailureCount: response.failureCount,
            lastPushAt: Date.now()
          });
          
          // 실패한 토큰 처리
          if (response.failureCount > 0) {
            const tokensToRemove = [];
            
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                const errorCode = resp.error?.code;
                
                if (errorCode === 'messaging/invalid-registration-token' ||
                    errorCode === 'messaging/registration-token-not-registered') {
                  tokensToRemove.push(tokens[idx]);
                }
              }
            });
            
            // DB에서 무효 토큰 제거
            if (tokensToRemove.length > 0) {
              console.log(`     🗑️ ${tokensToRemove.length}개 무효 토큰 제거 중...`);
              
              for (const token of tokensToRemove) {
                const tokenKey = Buffer.from(token)
                  .toString('base64')
                  .substring(0, 20)
                  .replace(/[^a-zA-Z0-9]/g, '');
                
                await db.ref(`users/${uid}/fcmTokens/${tokenKey}`).remove();
              }
            }
          }
          
        } catch (error) {
          console.error(`  ❌ 전송 오류:`, error.message);
          totalFailed++;
          
          // 오류 발생 시 pushed 플래그 롤백
          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushed: false,
            pushError: error.message,
            pushErrorAt: Date.now()
          });
        }
        
        // API 제한 방지를 위한 딜레이
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 4. 최종 결과
    console.log('\n' + '='.repeat(60));
    console.log('📊 전송 완료 결과:');
    console.log(`   👥 처리된 사용자: ${processedUsers}명`);
    console.log(`   ⏭️  건너뛴 사용자: ${skippedUsers}명`);
    console.log(`   ✅ 성공: ${totalSent}건`);
    console.log(`   ❌ 실패: ${totalFailed}건`);
    console.log('='.repeat(60));
    
    if (totalSent === 0 && processedUsers === 0) {
      console.log('ℹ️  전송할 알림이 없습니다.');
    }
    
    // 5. 오래된 알림 정리
    await cleanOldNotifications();
    
  } catch (error) {
    console.error('❌ 알림 전송 중 오류 발생:', error);
    throw error;
  }
}

// 오래된 알림 정리 함수 (최적화)
async function cleanOldNotifications() {
  console.log('\n🧹 오래된 알림 정리 중...');
  
  try {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    // ⭐ 최적화: 사용자별로 개별 쿼리
    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let deletedCount = 0;
    
    for (const uid of Object.keys(usersData)) {
      // ⭐ timestamp 기준으로 오래된 알림 쿼리
      const oldNotifications = await db.ref(`notifications/${uid}`)
        .orderByChild('timestamp')
        .endAt(sevenDaysAgo)
        .once('value');
      
      const oldData = oldNotifications.val() || {};
      
      for (const notifId of Object.keys(oldData)) {
        await db.ref(`notifications/${uid}/${notifId}`).remove();
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`✅ ${deletedCount}개의 오래된 알림 삭제 완료`);
    } else {
      console.log('ℹ️  삭제할 오래된 알림 없음');
    }
    
  } catch (error) {
    console.error('⚠️ 알림 정리 중 오류:', error.message);
  }
}

// 실행
sendNotifications()
  .then(() => {
    console.log('\n✅ 작업 완료! (5분 간격 자동 실행)');
    console.log('⏰ 다음 실행: 약 5분 후');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 작업 실패:', error);
    process.exit(1);
  });
