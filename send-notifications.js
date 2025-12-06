const admin = require('firebase-admin');

console.log('🔔 백그라운드 알림 전송 시작...');
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

async function sendNotifications() {
  try {
    console.log('📊 데이터베이스 읽기 중...');
    
    // 1. 모든 알림 가져오기
    const notificationsSnapshot = await db.ref('notifications').once('value');
    const notificationsData = notificationsSnapshot.val() || {};
    
    // 2. 사용자 정보 가져오기
    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let totalSent = 0;
    let totalFailed = 0;
    let processedUsers = 0;
    let skippedUsers = 0;
    
    console.log(`👥 총 ${Object.keys(notificationsData).length}명의 알림 확인 중...`);
    
    // 3. 각 사용자별 처리
    for (const [uid, userNotifications] of Object.entries(notificationsData)) {
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
      
      // 읽지 않았고, 아직 푸시 안 보낸 알림만 필터링
      const unreadNotifications = Object.entries(userNotifications)
        .filter(([_, notif]) => !notif.read && !notif.pushed)
        .map(([id, notif]) => ({ id, ...notif }));
      
      if (unreadNotifications.length === 0) {
        continue;
      }
      
      console.log(`\n📬 사용자 ${user.email || uid}: ${unreadNotifications.length}개 알림`);
      processedUsers++;
      
      // FCM 토큰 추출
      const tokens = Object.values(user.fcmTokens)
        .map(t => t.token)
        .filter(t => t); // null/undefined 제거
      
      if (tokens.length === 0) {
        console.log('  ⚠️ 유효한 FCM 토큰 없음');
        continue;
      }
      
      // 4. 각 알림 전송
      for (const notification of unreadNotifications) {
        // 알림 메시지 구성 (data 페이로드 사용)
        const message = {
          data: {
            title: notification.title || '📰 해정뉴스',
            body: notification.text || '새로운 알림이 있습니다',
            text: notification.text || '새로운 알림이 있습니다', // 호환성
            articleId: notification.articleId || '',
            type: notification.type || 'notification',
            notificationId: notification.id,
            timestamp: Date.now().toString()
          },
          tokens: tokens,
          // Android 설정
          android: {
            priority: 'high',
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'ic_notification',
              color: '#c62828',
              sound: 'default',
              channelId: 'default'
            }
          },
          // iOS 설정
          apns: {
            payload: {
              aps: {
                alert: {
                  title: notification.title || '📰 해정뉴스',
                  body: notification.text || '새로운 알림이 있습니다'
                },
                sound: 'default',
                badge: 1
              }
            }
          },
          // 웹 설정
          webpush: {
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: '/favicon/android-icon-192x192.png',
              badge: '/favicon/favicon-16x16.png',
              vibrate: [200, 100, 200],
              requireInteraction: false
            },
            fcmOptions: {
              link: notification.articleId ? 
                `https://yourdomain.com/?page=article&id=${notification.articleId}` : 
                'https://yourdomain.com/'
            }
          }
        };
        
        try {
          const response = await admin.messaging().sendEachForMulticast(message);
          
          console.log(`  📤 "${notification.title}"`);
          console.log(`     ✅ 성공: ${response.successCount}`);
          console.log(`     ❌ 실패: ${response.failureCount}`);
          
          totalSent += response.successCount;
          totalFailed += response.failureCount;
          
          // 성공한 경우 pushed 플래그 설정
          if (response.successCount > 0) {
            await db.ref(`notifications/${uid}/${notification.id}`).update({
              pushed: true,
              pushedAt: Date.now()
            });
          }
          
          // 실패한 토큰 처리
          if (response.failureCount > 0) {
            const tokensToRemove = [];
            
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                const errorCode = resp.error?.code;
                
                console.log(`     ⚠️ 오류 [${idx}]: ${errorCode}`);
                
                // 토큰이 유효하지 않은 경우만 삭제
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
        }
        
        // API 제한 방지를 위한 딜레이 (100ms)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 5. 최종 결과
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
    
    // 6. 오래된 알림 정리 (7일 이상 된 알림 삭제)
    await cleanOldNotifications();
    
  } catch (error) {
    console.error('❌ 알림 전송 중 오류 발생:', error);
    throw error;
  }
}

// 오래된 알림 정리 함수
async function cleanOldNotifications() {
  console.log('\n🧹 오래된 알림 정리 중...');
  
  try {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const notificationsSnapshot = await db.ref('notifications').once('value');
    const notificationsData = notificationsSnapshot.val() || {};
    
    let deletedCount = 0;
    
    for (const [uid, userNotifications] of Object.entries(notificationsData)) {
      for (const [notifId, notif] of Object.entries(userNotifications)) {
        // 7일 이상 된 알림 삭제
        if (notif.timestamp < sevenDaysAgo) {
          await db.ref(`notifications/${uid}/${notifId}`).remove();
          deletedCount++;
        }
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
    console.log('\n✅ 작업 완료!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 작업 실패:', error);
    process.exit(1);
  });
