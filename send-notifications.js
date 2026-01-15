const admin = require('firebase-admin');

console.log('🔔 백그라운드 알림 전송 시작...');
console.log('⏰ 실행 시간:', new Date().toLocaleString('ko-KR'));
console.log('⚡ 5분 간격 실행 (GitHub Actions 최소 주기)');

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
    
    // ⭐ 현재 시간 (5분 이내 알림만 처리)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    // 3. 각 사용자별 처리
for (const [uid, userNotifications] of Object.entries(notificationsData)) {
  const user = usersData[uid];
  
  // 🔍 디버깅: 사용자 정보 상세 출력
  console.log(`\n🔍 사용자 체크: ${uid}`);
  console.log(`   📧 이메일: ${user?.email || '없음'}`);
  console.log(`   📱 FCM 토큰: ${user?.fcmTokens ? Object.keys(user.fcmTokens).length + '개' : '❌ 없음'}`);
  console.log(`   🔔 알림 활성화: ${user?.notificationsEnabled !== false ? '✅ 예' : '❌ 아니오'}`);
  console.log(`   📊 알림 개수: ${Object.keys(userNotifications).length}개`);
  
  // FCM 토큰 없으면 스킵
  if (!user || !user.fcmTokens) {
    console.log(`   ⏭️  스킵 이유: FCM 토큰 없음 (사용자가 알림을 허용하지 않았거나 로그인 기록 없음)`);
    skippedUsers++;
    continue;
  }
  
  // 알림이 비활성화되어 있으면 스킵
  if (user.notificationsEnabled === false) {
    console.log(`   ⏭️  스킵 이유: 사용자가 알림을 비활성화함`);
    skippedUsers++;
    continue;
  }
  
  // ⭐ 중복 방지 강화: 읽지 않았고, 아직 푸시 안 보냈고, 5분 이내 생성된 알림만 필터링
  const unreadNotifications = Object.entries(userNotifications)
    .filter(([_, notif]) => {
      // 읽지 않았고
      if (notif.read) return false;
      
      // 이미 푸시 보냈으면 제외
      if (notif.pushed) return false;
      
      // ⭐ 5분 이내 생성된 알림만 (오래된 알림 중복 방지)
      if (notif.timestamp < fiveMinutesAgo) {
        return false;
      }
      
      return true;
    })
    .map(([id, notif]) => ({ id, ...notif }));
  
  // 🔍 디버깅: 필터링 결과
  const totalNotifs = Object.keys(userNotifications).length;
  const readCount = Object.values(userNotifications).filter(n => n.read).length;
  const pushedCount = Object.values(userNotifications).filter(n => n.pushed).length;
  const oldCount = Object.values(userNotifications).filter(n => n.timestamp < fiveMinutesAgo).length;
  
  console.log(`   📊 알림 분석:`);
  console.log(`      - 전체: ${totalNotifs}개`);
  console.log(`      - 이미 읽음: ${readCount}개`);
  console.log(`      - 이미 푸시됨: ${pushedCount}개`);
  console.log(`      - 5분 이상 경과: ${oldCount}개`);
  console.log(`      - 전송 대상: ${unreadNotifications.length}개`);
  
  if (unreadNotifications.length === 0) {
    console.log(`   ⏭️  스킵 이유: 전송할 새 알림 없음`);
    continue;
  }
  
  console.log(`\n📬 알림 전송 시작: ${user.email || uid}`);
  processedUsers++;
      
// FCM 토큰 추출
const tokens = Object.values(user.fcmTokens)
  .map(t => t.token)
  .filter(t => t); // null/undefined 제거

console.log(`   📱 추출된 토큰: ${tokens.length}개`);

// 🔍 디버깅: 토큰 상세 정보
if (tokens.length > 0) {
  tokens.forEach((token, idx) => {
    console.log(`      토큰 ${idx + 1}: ${token.substring(0, 20)}...`);
  });
}

if (tokens.length === 0) {
  console.log('   ⚠️  유효한 FCM 토큰 없음 (토큰이 null이거나 형식이 잘못됨)');
  continue;
}
      
      // 4. 각 알림 전송
      for (const notification of unreadNotifications) {
        // ⭐ 전송 전 다시 한 번 pushed 상태 확인 (동시 실행 방지)
        const recheck = await db.ref(`notifications/${uid}/${notification.id}/pushed`).once('value');
        if (recheck.val() === true) {
          console.log(`  ⏭️ 이미 전송된 알림: ${notification.title}`);
          continue;
        }
        
        // ⭐ 즉시 pushed 플래그 설정 (다른 워커가 중복 전송하지 않도록)
        await db.ref(`notifications/${uid}/${notification.id}`).update({
          pushed: true,
          pushedAt: Date.now(),
          pushAttemptedAt: Date.now()
        });
        
        // 알림 메시지 구성 (data 페이로드 사용)
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
          // Android 설정
          android: {
            priority: 'high',
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'ic_notification',
              color: '#c62828',
              sound: 'default',
              channelId: 'default',
              tag: notification.id,  // ⭐ 중복 방지
              clickAction: 'FLUTTER_NOTIFICATION_CLICK'
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
                badge: 1,
                'thread-id': notification.id,  // ⭐ 중복 방지
                'mutable-content': 1
              }
            }
          },
          // 웹 설정
          webpush: {
            notification: {
              title: notification.title || '📰 해정뉴스',
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'https://fff376327yhed.github.io/hsj_news.io/favicon/android-icon-192x192.png',
              badge: 'https://fff376327yhed.github.io/hsj_news.io/favicon/favicon-16x16.png',
              vibrate: [200, 100, 200],
              requireInteraction: false,
              tag: notification.id,  // ⭐ 중복 방지
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
  console.log(`      대상 토큰: ${tokens.length}개`);
  console.log(`      알림 ID: ${notification.id}`);
  console.log(`      생성 시각: ${new Date(notification.timestamp).toLocaleString('ko-KR')}`);
  
  const response = await admin.messaging().sendEachForMulticast(message);
  
  console.log(`   📊 전송 결과:`);
  console.log(`      ✅ 성공: ${response.successCount}개`);
  console.log(`      ❌ 실패: ${response.failureCount}개`);
  
  totalSent += response.successCount;
  totalFailed += response.failureCount;
          
          // ⭐ 전송 결과 기록
          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushSuccessCount: response.successCount,
            pushFailureCount: response.failureCount,
            lastPushAt: Date.now()
          });
          
// 실패한 토큰 처리
if (response.failureCount > 0) {
  console.log(`\n   ⚠️  실패 상세 분석:`);
  const tokensToRemove = [];
  
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const errorCode = resp.error?.code;
      const errorMessage = resp.error?.message;
      
      console.log(`      [${idx + 1}] 오류 코드: ${errorCode}`);
      console.log(`          오류 메시지: ${errorMessage}`);
      console.log(`          토큰: ${tokens[idx]?.substring(0, 30)}...`);
                
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
          
          // ⭐ 오류 발생 시 pushed 플래그 롤백
          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushed: false,
            pushError: error.message,
            pushErrorAt: Date.now()
          });
        }
        
        // ⭐ API 제한 방지를 위한 딜레이 (100ms)
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
    console.log('\n✅ 작업 완료! (5분 간격 실행 - 최소 주기)');
    console.log('⏰ 다음 실행: 약 5분 후');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 작업 실패:', error);
    process.exit(1);
  });
