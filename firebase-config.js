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

// 현재 로그인 사용자 ID (auth.html 제외한 모든 페이지에서 사용)
let USER_ID = null;
