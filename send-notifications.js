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
    
    // pushed=false 플래그만으로 판단 (시간 필터 없음)
    console.log('⏱️ pushed=false 알림 전체 처리 (시간 제한 없음)');

    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let totalSent = 0;
    let totalFailed = 0;
    let processedUsers = 0;
    let skippedNoToken = 0;
    let skippedNotifsDisabled = 0;

    const successList = [];
    const failureList = [];

    for (const uid of Object.keys(usersData)) {
      const user = usersData[uid];
      
      if (!user) continue;

      // ✅ fcmTokens가 없거나 빈 객체이면 스킵 (이유 기록)
      if (!user.fcmTokens || Object.keys(user.fcmTokens).length === 0) {
        skippedNoToken++;
        continue;
      }
      
      // ✅ 알림 비활성화된 경우 스킵
      if (user.notificationsEnabled === false) {
        skippedNotifsDisabled++;
        continue;
      }

      const notifTypes = user.notificationTypes || {};
      const articleEnabled = notifTypes.article !== false;
      const commentEnabled = notifTypes.comment !== false;

      // pushed=false인 알림 가져오기
      const unreadQuery = await db.ref(`notifications/${uid}`)
        .orderByChild('pushed')
        .equalTo(false)
        .once('value');
      
      const queriedNotifications = unreadQuery.val() || {};

      // ✅ 필터: read=false, pushed=false, 타입별 설정 확인
      const unreadNotifications = Object.entries(queriedNotifications)
        .filter(([_, notif]) => {
          if (notif.read === true || notif.pushed === true) return false;

          // admin 타입은 항상 전송
          if (notif.type === 'admin') return true;

          // 알림 타입별 필터
          if (notif.type === 'article' && !articleEnabled) return false;
          if ((notif.type === 'myArticleComment' || notif.type === 'comment') && !commentEnabled) return false;

          return true;
        })
        .map(([id, notif]) => ({ id, ...notif }));

      if (unreadNotifications.length === 0) continue;

      console.log(`\n📬 알림 전송 시작: ${user.email || uid}`);
      console.log(`   📊 전송 대상: ${unreadNotifications.length}개`);
      processedUsers++;

      // ✅ 유효한 토큰만 필터링 (빈 토큰, 너무 짧은 토큰 제외)
      const tokens = Object.values(user.fcmTokens)
        .filter(t => t && t.token && t.token.length > 20)
        .map(t => t.token);

      if (tokens.length === 0) {
        console.log(`   ⚠️  유효한 FCM 토큰 없음 (등록된 항목: ${Object.keys(user.fcmTokens).length}개)`);
        failureList.push({
          email: user.email || uid,
          notifCount: unreadNotifications.length,
          errors: [{ errorCode: 'NO_VALID_FCM_TOKEN', errorMsg: `fcmTokens 존재하나 유효 토큰 없음 (${Object.keys(user.fcmTokens).length}개 항목)` }]
        });
        // ✅ 전송 불가 알림들을 pushed=true로 마킹하지 않음 → 다음에 재시도 가능
        continue;
      }

      console.log(`   🔑 유효한 FCM 토큰: ${tokens.length}개`);

      for (const notification of unreadNotifications) {
        // 동시 실행 방지: 전송 전 재확인
        const recheck = await db.ref(`notifications/${uid}/${notification.id}/pushed`).once('value');
        if (recheck.val() === true) {
          console.log(`   ⏭️ 이미 전송된 알림 스킵: "${notification.title}"`);
          continue;
        }

        // 즉시 pushed 플래그 설정 (중복 방지)
        await db.ref(`notifications/${uid}/${notification.id}`).update({
          pushed: true,
          pushedAt: Date.now(),
          pushAttemptedAt: Date.now()
        });

        const notifLink = notification.articleId
          ? `https://fff376327yhed.github.io/hsj_news.io/?page=article&id=${notification.articleId}`
          : 'https://fff376327yhed.github.io/hsj_news.io/';

        const notifTitle = notification.title || '📰 해정뉴스';
        const notifBody = notification.text || '새로운 알림이 있습니다';

        const message = {
          data: {
            title: notifTitle,
            body: notifBody,
            text: notifBody,
            articleId: notification.articleId || '',
            type: notification.type || 'notification',
            notificationId: notification.id,
            timestamp: Date.now().toString()
          },
          tokens: tokens,
          android: {
            priority: 'high',
            notification: {
              title: notifTitle,
              body: notifBody,
              icon: 'https://fff376327yhed.github.io/hsj_news.io/favicon/android-icon-192x192.png',
              tag: notification.id,
              notificationCount: 1
            }
          },
          apns: {
            payload: {
              aps: {
                alert: {
                  title: notifTitle,
                  body: notifBody
                },
                sound: 'default',
                badge: 1,
                'thread-id': notification.id,
                'mutable-content': 1
              }
            }
          },
          webpush: {
            headers: {
              Urgency: 'high'
            },
            notification: {
              title: notifTitle,
              body: notifBody,
              icon: 'https://fff376327yhed.github.io/hsj_news.io/favicon/android-icon-192x192.png',
              badge: 'https://fff376327yhed.github.io/hsj_news.io/favicon/favicon-16x16.png',
              vibrate: [200, 100, 200],
              requireInteraction: notification.type === 'admin',
              tag: notification.id,
              renotify: true
            },
            fcmOptions: {
              link: notifLink
            }
          }
        };

        try {
          console.log(`   📤 전송: [${notification.type}] "${notifTitle}"`);
          
          const response = await admin.messaging().sendEachForMulticast(message);
          
          console.log(`   📊 결과: ✅ ${response.successCount} 성공 / ❌ ${response.failureCount} 실패`);
          
          totalSent += response.successCount;
          totalFailed += response.failureCount;

          if (response.successCount > 0) {
            successList.push({
              email: user.email || uid,
              notifTitle,
              successCount: response.successCount
            });
          }

          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushSuccessCount: response.successCount,
            pushFailureCount: response.failureCount,
            lastPushAt: Date.now()
          });

          // 실패 상세 분석 및 무효 토큰 제거
          if (response.failureCount > 0) {
            const notifErrors = [];
            const tokensToRemove = [];
            
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                const errorCode = resp.error?.code || 'UNKNOWN';
                notifErrors.push({ errorCode, errorMsg: resp.error?.message || '' });
                console.log(`      ⚠️ 토큰 ${idx} 오류: ${errorCode}`);
                
                const invalidCodes = [
                  'messaging/invalid-registration-token',
                  'messaging/registration-token-not-registered',
                  'messaging/invalid-argument',
                  'messaging/invalid-recipient'
                ];
                
                if (invalidCodes.includes(errorCode) && tokens[idx]) {
                  tokensToRemove.push(tokens[idx]);
                }
              }
            });

            if (notifErrors.length > 0) {
              failureList.push({ email: user.email || uid, notifTitle, errors: notifErrors });
            }

            // 무효 토큰 DB에서 제거
            if (tokensToRemove.length > 0) {
              console.log(`     🗑️ ${tokensToRemove.length}개 무효 토큰 제거 중...`);
              for (const token of tokensToRemove) {
                for (const [tokenKey, tokenData] of Object.entries(user.fcmTokens)) {
                  if (tokenData.token === token) {
                    await db.ref(`users/${uid}/fcmTokens/${tokenKey}`).remove();
                    console.log(`     🗑️ 토큰 제거: ${tokenKey}`);
                  }
                }
              }
            }
          }

        } catch (error) {
          console.error(`   ❌ 전송 오류:`, error.message);
          totalFailed++;
          failureList.push({
            email: user.email || uid,
            notifTitle,
            errors: [{ errorCode: error.code || 'SEND_ERROR', errorMsg: error.message }]
          });
          
          // 오류 시 pushed 플래그 롤백 (다음 실행 시 재시도)
          await db.ref(`notifications/${uid}/${notification.id}`).update({
            pushed: false,
            pushError: error.message,
            pushErrorAt: Date.now()
          });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 최종 결과 요약
    console.log('\n' + '='.repeat(60));
    console.log('📊 전송 완료 결과:');
    console.log(`   👥 처리된 사용자: ${processedUsers}명`);
    console.log(`   ⏭️  FCM 토큰 없어 스킵: ${skippedNoToken}명`);
    console.log(`   🔕 알림 비활성화로 스킵: ${skippedNotifsDisabled}명`);
    console.log(`   ✅ 성공: ${totalSent}건`);
    console.log(`   ❌ 실패: ${totalFailed}건`);
    console.log('='.repeat(60));

    if (successList.length > 0) {
      console.log('\n✅ 전송 성공 목록:');
      console.log('-'.repeat(60));
      successList.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.email} → "${s.notifTitle}" (${s.successCount}개 디바이스)`);
      });
    }

    if (failureList.length > 0) {
      console.log('\n❌ 전송 실패 목록:');
      console.log('-'.repeat(60));
      failureList.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.email}${f.notifTitle ? ` → "${f.notifTitle}"` : ''}`);
        f.errors.forEach(e => console.log(`     ⚠️ ${e.errorCode}: ${e.errorMsg}`));
      });
    }

    if (totalSent === 0 && processedUsers === 0) {
      console.log('ℹ️  전송할 알림이 없습니다.');
    }

    await cleanOldNotifications();

  } catch (error) {
    console.error('❌ 알림 전송 중 오류 발생:', error);
    throw error;
  }
}

// 오래된 알림 정리 (30일)
async function cleanOldNotifications() {
  console.log('\n🧹 오래된 알림 정리 중...');
  
  try {
    const THIRTY_DAYS_AGO = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let deletedCount = 0;
    
    for (const uid of Object.keys(usersData)) {
      const oldNotifications = await db.ref(`notifications/${uid}`)
        .orderByChild('timestamp')
        .endAt(THIRTY_DAYS_AGO)
        .once('value');
      
      const oldData = oldNotifications.val() || {};
      
      for (const notifId of Object.keys(oldData)) {
        await db.ref(`notifications/${uid}/${notifId}`).remove();
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`✅ ${deletedCount}개 오래된 알림 삭제 완료 (30일 이상)`);
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
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 작업 실패:', error);
    process.exit(1);
  });
