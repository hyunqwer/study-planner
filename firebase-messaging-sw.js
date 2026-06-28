// Firebase Messaging Service Worker
// 백그라운드 푸시 알림 처리

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB8F6DcDxaJ0lt5znwL0BNlPkZXr8OZCSk",
  authDomain: "selfstudy-planner.firebaseapp.com",
  projectId: "selfstudy-planner",
  storageBucket: "selfstudy-planner.firebasestorage.app",
  messagingSenderId: "283483008828",
  appId: "1:283483008828:web:21f20545f2499294ac3839"
});

const messaging = firebase.messaging();

// 백그라운드 메시지 수신 처리
messaging.onBackgroundMessage((payload) => {
  // data-only 메시지 우선, notification 페이로드는 폴백
  const d = payload.data || {};
  const n = payload.notification || {};
  const title    = d.title || n.title || '작전노트';
  const body     = d.body  || n.body  || '';
  const icon     = d.icon  || n.icon  || '/icons/icon-192.png';
  const clickUrl = d.click_action || '/';
  self.registration.showNotification(title, {
    body,
    icon,
    badge: '/icons/badge-72.png',
    data: { url: clickUrl },
    vibrate: [200, 100, 200],
  });
});

// 알림 클릭 → 해당 URL 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
