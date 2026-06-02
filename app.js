// 내 공부 작전노트 - 공통 유틸리티

// ────────────────────────────────────────────
// 인증 가드
// auth.html을 제외한 모든 페이지 상단에서 호출
// 로그인 안 돼 있으면 auth.html로 이동
// 로그인 되면 USER_ID 세팅 후 callback 실행
// ────────────────────────────────────────────
function requireAuth(callback) {
  // 5초 안에 auth 상태 확인 안 되면 auth.html로 이동 (안전장치)
  const timeout = setTimeout(() => {
    location.href = 'auth.html';
  }, 5000);

  let unsubscribe = () => {};
  unsubscribe = auth.onAuthStateChanged(user => {
    clearTimeout(timeout);
    unsubscribe();
    if (!user) {
      location.href = 'auth.html';
      return;
    }
    USER_ID = user.uid;
    document.body.style.visibility = 'visible';
    if (callback) callback(user);
  });
}

// 로그아웃
async function logout() {
  await auth.signOut();
  location.href = 'auth.html';
}

function getUserId() {
  const uid = USER_ID || auth.currentUser?.uid;
  if (!uid) throw new Error('로그인 상태를 확인할 수 없어요. 다시 로그인해 주세요.');
  USER_ID = uid;
  return uid;
}

// ────────────────────────────────────────────
// 날짜 유틸
// ────────────────────────────────────────────
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  return DAY_KO[d.getDay()] + '요일';
}

function diffDays(from, to) {
  return Math.ceil((new Date(to) - new Date(from)) / 86400000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 이번 주 월~일 날짜 배열
function getThisWeekDates() {
  const d = new Date();
  const day = d.getDay(); // 0=일
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return dd.toISOString().slice(0, 10);
  });
}

// ────────────────────────────────────────────
// 계획 계산
// ────────────────────────────────────────────
function calcDailyPages(totalPages, startDate, endDate, workDays = 5) {
  const days = diffDays(startDate, endDate);
  const weeks = Math.ceil(days / 7);
  const weeklyPages = Math.ceil(totalPages / weeks);
  const dailyPages = Math.ceil(weeklyPages / workDays);
  return { weeks, weeklyPages, dailyPages };
}

// 밀린 분량 재계획 옵션
function calcCatchupOptions(book, completedPages) {
  const remaining = book.totalPages - completedPages;
  const todayDate = today();
  const daysLeft = Math.max(1, diffDays(todayDate, book.targetEndDate));
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));

  const optionA_daily = Math.ceil(remaining / daysLeft);
  const optionB_sat = Math.ceil(remaining / weeksLeft);
  const newEndDate = new Date(book.targetEndDate);
  newEndDate.setDate(newEndDate.getDate() + 7);

  return [
    { id: 'A', label: `하루 분량 늘리기`, detail: `하루 ${optionA_daily}쪽씩` },
    { id: 'B', label: `토요일에 보충하기`, detail: `매주 토요일 +${optionB_sat}쪽` },
    { id: 'C', label: `완료일 1주 연장`, detail: `→ ${formatDate(newEndDate.toISOString().slice(0, 10))}` },
  ];
}

// ────────────────────────────────────────────
// Firestore CRUD
// ────────────────────────────────────────────

// 책 저장
async function saveBook(bookData) {
  const ref = db.collection('users').doc(getUserId()).collection('books').doc();
  await ref.set({ ...bookData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  return ref.id;
}

// 책 목록
async function getBooks() {
  const snap = await db.collection('users').doc(getUserId()).collection('books')
    .orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 특정 책
async function getBook(bookId) {
  const doc = await db.collection('users').doc(getUserId()).collection('books').doc(bookId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// 책 업데이트
async function updateBook(bookId, data) {
  await db.collection('users').doc(getUserId()).collection('books').doc(bookId).update(data);
}

// 일일 기록 저장
async function saveDailyLog(bookId, log) {
  const dateKey = log.date || today();
  await db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('dailyLogs').doc(dateKey).set(log, { merge: true });
}

// 일일 기록 조회
async function getDailyLog(bookId, dateStr) {
  const doc = await db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('dailyLogs').doc(dateStr).get();
  return doc.exists ? doc.data() : null;
}

// 여러 날짜의 일일 기록을 한 번에 조회
async function getDailyLogsForDates(bookId, dateStrs) {
  const dates = [...new Set((dateStrs || []).filter(Boolean))];
  const logs = {};
  dates.forEach(d => { logs[d] = null; });
  if (!dates.length) return logs;

  const ref = db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('dailyLogs');
  const chunks = [];
  for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10));
  const snaps = await Promise.all(chunks.map(chunk =>
    ref.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get()
  ));
  snaps.forEach(snap => {
    snap.docs.forEach(doc => { logs[doc.id] = doc.data(); });
  });
  return logs;
}

// 주간 계획 저장
async function saveWeeklyPlan(bookId, weekStart, plan) {
  await db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('weeklyPlans').doc(weekStart).set(plan, { merge: true });
}

// 주간 계획 조회
async function getWeeklyPlan(bookId, weekStart) {
  const doc = await db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('weeklyPlans').doc(weekStart).get();
  return doc.exists ? doc.data() : null;
}

// 완료된 총 페이지 계산
async function getTotalCompleted(bookId) {
  const snap = await db.collection('users').doc(getUserId())
    .collection('books').doc(bookId)
    .collection('dailyLogs').get();
  let total = 0;
  snap.docs.forEach(d => { total += (d.data().completedPages || 0); });
  return total;
}

// ────────────────────────────────────────────
// 현재 진행 중인 책
// ────────────────────────────────────────────
async function getActiveBook() {
  const snap = await db.collection('users').doc(getUserId()).collection('books')
    .where('status', '==', 'active').limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getActiveBooks() {
  const snap = await db.collection('users').doc(getUserId()).collection('books')
    .where('status', '==', 'active').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function weekIndexForToday() {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function buildWeeklyPlanFromBook(book, weekDates) {
  const workDays = book.workDays || [1, 2, 4, 5];
  const dailyPages = weekDates.map(dateStr => {
    const dow = new Date(dateStr).getDay();
    return workDays.includes(dow) ? (book.dailyPages || 5) : 0;
  });
  return {
    weekStart: weekDates[0],
    dailyPages,
    weekGoal: dailyPages.reduce((sum, pages) => sum + pages, 0),
  };
}

async function getOrCreateWeeklyPlan(book, weekDates) {
  let plan = await getWeeklyPlan(book.id, weekDates[0]);
  if (!plan) {
    plan = buildWeeklyPlanFromBook(book, weekDates);
    await saveWeeklyPlan(book.id, weekDates[0], plan);
  }
  return plan;
}

// ────────────────────────────────────────────
// UI 헬퍼
// ────────────────────────────────────────────
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function setActiveNav(page) {
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
}

// 쿼리 파라미터
function getParam(key) {
  return new URLSearchParams(location.search).get(key);
}

// 로딩 오버레이
function showLoading(show) {
  let el = document.getElementById('loading-overlay');
  if (!el && show) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,0.7);
      display:flex;align-items:center;justify-content:center;z-index:999;font-size:24px;`;
    el.textContent = '⚡';
    document.body.appendChild(el);
  } else if (el) {
    el.style.display = show ? 'flex' : 'none';
  }
}
