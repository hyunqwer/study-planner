// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyB8F6DcDxaJ0lt5znwL0BNlPkZXr8OZCSk",
  authDomain: "selfstudy-planner.firebaseapp.com",
  projectId: "selfstudy-planner",
  storageBucket: "selfstudy-planner.firebasestorage.app",
  messagingSenderId: "283483008828",
  appId: "1:283483008828:web:21f20545f2499294ac3839"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

// 페이지를 오갈 때 같은 데이터를 다시 받을 일이 많아서, 가능한 경우 Firestore 로컬 캐시를 켠다.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn('Firestore persistence disabled:', err.code || err.message);
});

// 현재 로그인 사용자 ID (auth.html 제외한 모든 페이지에서 사용)
let USER_ID = null;
