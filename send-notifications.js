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
    
    // ⭐ [수정] 10분으로 확장 - 5분 간격 실행이지만 딜레이 대비 여유분 추가
    const TEN_MINUTES_AGO = Date.now() - (10 * 60 * 1000);
    console.log(`⏱️ 기준 시간: ${new Date(TEN_MINUTES_AGO).toLocaleString('ko-KR')} 이후 알림 처리`);

    const usersSnapshot = await db.ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let totalSent = 0;
    let totalFailed = 0;
    let processedUsers = 0;
    let skippedUsers = 0;

    // 결과 추적
    const successList = []; // { email, notifTitle, successCount }
    const failureList = []; // { email, notifTitle, errors: [{errorCode, errorMsg}] }

    for (const uid of Object.keys(usersData)) {
      const user = usersData[uid];
      
      if (!user || !user.fcmTokens) {
        skippedUsers++;
        continue;
      }
      
      if (user.notificationsEnabled === false) {
        skippedUsers++;
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

      // ⭐ [수정] 10분 윈도우 + admin 타입 추가
      const unreadNotifications = Object.entries(queriedNotifications)
        .filter(([_, notif]) => {
          if (notif.read || notif.pushed) return false;

          // ⭐ 타임스탬프 없는 알림도 처리 (admin이 직접 삽입한 경우)
          if (notif.timestamp && notif.timestamp < TEN_MINUTES_AGO) {
            console.log(`   ⏭️ 오래된 알림 스킵 (${new Date(notif.timestamp).toLocaleString('ko-KR')}): ${notif.title}`);
            return false;
          }

          // 알림 타입별 필터
          if (notif.type === 'article' && !articleEnabled) return false;
          if ((notif.type === 'myArticleComment' || notif.type === 'comment') && !commentEnabled) return false;
          // ⭐ admin 타입은 항상 전송 (사용자 설정 무시)
          // 그 외 타입도 허용

          return true;
        })
        .map(([id, notif]) => ({ id, ...notif }));

      if (unreadNotifications.length === 0) continue;

      console.log(`\n📬 알림 전송 시작: ${user.email || uid}`);
      console.log(`   📊 전송 대상: ${unreadNotifications.length}개`);
      processedUsers++;

      const tokens = Object.values(user.fcmTokens)
        .map(t => t.token)
        .filter(t => t && t.length > 10); // ⭐ 빈 토큰 필터

      if (tokens.length === 0) {
        console.log('   ⚠️  유효한 FCM 토큰 없음');
        failureList.push({
          email: user.email || uid,
          notifCount: unreadNotifications.length,
          errors: [{ errorCode: 'NO_FCM_TOKEN', errorMsg: '등록된 FCM 토큰 없음' }]
        });
        continue;
      }

      console.log(`   🔑 FCM 토큰 수: ${tokens.length}개`);

      for (const notification of unreadNotifications) {
        // 동시 실행 방지: 전송 전 재확인
        const recheck = await db.ref(`notifications/${uid}/${notification.id}/pushed`).once('value');
        if (recheck.val() === true) {
          console.log(`  ⏭️ 이미 전송된 알림: ${notification.title}`);
          continue;
        }

        // 즉시 pushed 플래그 설정
        await db.ref(`notifications/${uid}/${notification.id}`).update({
          pushed: true,
          pushedAt: Date.now(),
          pushAttemptedAt: Date.now()
        });

        // ⭐ [수정] admin 타입 링크 처리 추가
        const notifLink = notification.articleId
          ? `https://fff376327yhed.github.io/hsj_news.io/?page=article&id=${notification.articleId}`
          : 'https://fff376327yhed.github.io/hsj_news.io/';

        // ⭐ [수정] admin 타입 배지 색상 구분
        const badgeIcon = notification.type === 'admin'
          ? '📢 해정뉴스'
          : '📰 해정뉴스';

        const message = {
          data: {
            title: notification.title || badgeIcon,
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
              title: notification.title || badgeIcon,
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
                  title: notification.title || badgeIcon,
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
            headers: {
              Urgency: 'high'
            },
            notification: {
              title: notification.title || badgeIcon,
              body: notification.text || '새로운 알림이 있습니다',
              icon: 'https://fff376327yhed.github.io/hsj_news.io/favicon/android-icon-192x192.png',
              badge: 'https://fff376327yhed.github.io/hsj_news.io/favicon/favicon-16x16.png',
              vibrate: [200, 100, 200],
              requireInteraction: notification.type === 'admin', // ⭐ 관리자 알림은 직접 닫아야 함
              tag: notification.id,
              renotify: true // ⭐ 같은 tag여도 다시 표시
            },
            fcmOptions: {
              link: notifLink
            }
          }
        };

        try {
          console.log(`   📤 전송 중: [${notification.type}] "${notification.title}"`);
          
          const response = await admin.messaging().sendEachForMulticast(message);
          
          console.log(`   📊 전송 결과: ✅ 성공 ${response.successCount} / ❌ 실패 ${response.failureCount}`);
          
          totalSent += response.successCount;
          totalFailed += response.failureCount;

          // 성공 기록
          if (response.successCount > 0) {
            successList.push({
              email: user.email || uid,
              notifTitle: notification.title,
              successCount: response.successCount
            });
          }

          // 실패 상세 기록
          if (response.failureCount > 0) {
            const notifErrors = [];
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                notifErrors.push({
                  errorCode: resp.error?.code || 'UNKNOWN',
                  errorMsg: resp.error?.message || '알 수 없는 오류'
                });
              }
            });
            if (notifErrors.length > 0) {
              failureList.push({
                email: user.email || uid,
                notifTitle: notification.title,
                errors: notifErrors
              });
            }
          }

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
                console.log(`      ⚠️ 토큰 ${idx} 오류: ${errorCode}`);
                
                const invalidCodes = [
                  'messaging/invalid-registration-token',
                  'messaging/registration-token-not-registered',
                  'messaging/invalid-argument',
                  'messaging/invalid-recipient'
                ];
                
                if (invalidCodes.includes(errorCode)) {
                  tokensToRemove.push(tokens[idx]);
                }
              }
            });

            if (tokensToRemove.length > 0) {
              console.log(`     🗑️ ${tokensToRemove.length}개 무효 토큰 제거 중...`);
              for (const token of tokensToRemove) {
                if (user.fcmTokens) {
                  for (const [tokenKey, tokenData] of Object.entries(user.fcmTokens)) {
                    if (tokenData.token === token) {
                      await db.ref(`users/${uid}/fcmTokens/${tokenKey}`).remove();
                      console.log(`     🗑️ 토큰 제거 완료: ${tokenKey}`);
                    }
                  }
                }
              }
            }
          }

        } catch (error) {
          console.error(`  ❌ 전송 오류:`, error.message);
          totalFailed++;

          failureList.push({
            email: user.email || uid,
            notifTitle: notification.title,
            errors: [{ errorCode: error.code || 'SEND_ERROR', errorMsg: error.message }]
          });
          
          // 오류 시 pushed 플래그 롤백
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
    console.log(`   ⏭️  건너뛴 사용자: ${skippedUsers}명`);
    console.log(`   ✅ 성공: ${totalSent}건`);
    console.log(`   ❌ 실패: ${totalFailed}건`);
    console.log('='.repeat(60));

    // ✅ 성공 이메일 목록
    if (successList.length > 0) {
      console.log('\n✅ 전송 성공 목록:');
      console.log('-'.repeat(60));
      successList.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.email}`);
        console.log(`     알림: "${s.notifTitle}"  |  성공 디바이스: ${s.successCount}개`);
      });
    }

    // ❌ 실패 이메일 + 오류 목록
    if (failureList.length > 0) {
      console.log('\n❌ 전송 실패 목록:');
      console.log('-'.repeat(60));
      failureList.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.email}`);
        if (f.notifTitle) console.log(`     알림: "${f.notifTitle}"`);
        f.errors.forEach(e => {
          console.log(`     ⚠️  오류코드: ${e.errorCode}`);
          console.log(`         오류내용: ${e.errorMsg}`);
        });
      });
    }

    console.log('\n' + '='.repeat(60));

    if (totalSent === 0 && processedUsers === 0) {
      console.log('ℹ️  전송할 알림이 없습니다.');
    }

    await cleanOldNotifications();

  } catch (error) {
    console.error('❌ 알림 전송 중 오류 발생:', error);
    throw error;
  }
}

// ⭐ [수정] 오래된 알림 정리 - 30일로 확장 (7일은 너무 짧음)
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
      console.log(`✅ ${deletedCount}개의 오래된 알림 삭제 완료 (30일 이상)`);
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
