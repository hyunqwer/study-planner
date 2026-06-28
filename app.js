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

function toKSTDateStr(d) {
  // UTC+9 기준 날짜 문자열 반환
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function today() {
  return toKSTDateStr(new Date());
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

// KST 기준 요일 반환 (0=일, 1=월 ... 6=토)
function todayDow() {
  return new Date(today() + 'T12:00:00').getDay();
}

// 날짜 문자열(YYYY-MM-DD)의 요일 반환 — T12:00:00으로 UTC/KST 시차 무관하게 동일 결과
function dateDow(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay();
}

// 이번 주 월~일 날짜 배열 (KST 기준)
// T12:00:00 로컬 정오 사용 → toISOString() UTC 변환 시 날짜 이탈 없음
// toKSTDateStr()로 변환 → KST 기준 날짜 문자열 보장
function getThisWeekDates() {
  const d = new Date(today() + 'T12:00:00'); // 로컬 정오
  const day = d.getDay(); // 0=일
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return toKSTDateStr(dd); // UTC offset 없이 KST 날짜 보장
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

// getDailyLogsForDates → see unified version below (supports mentor uid param)

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
  const day = todayDow(); // KST 기준
  return day === 0 ? 6 : day - 1; // 월=0 ... 일=6
}

function buildWeeklyPlanFromBook(book, weekDates) {
  const workDays = book.workDays || [1, 2, 4, 5];
  const dailyPages = weekDates.map(dateStr => {
    const dow = dateDow(dateStr); // T12:00:00 기준으로 일관된 요일
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

// ────────────────────────────────────────────
// 멘토/멘티 연결 (connections)
// connId = mentorUid_menteeUid
// ────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 유저 프로필 & 설정
// ─────────────────────────────────────────────────────────

async function getUserProfile(uid) {
  const snap = await db.collection('users').doc(uid || USER_ID).get();
  return snap.exists ? snap.data() : null;
}

async function getUserByEmail(email) {
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { uid: doc.id, ...doc.data() };
}

async function getMyRole() {
  const snap = await db.collection('users').doc(USER_ID).get();
  return snap.exists ? snap.data().role : 'mentee';
}

async function saveUserSettings(settings) {
  await db.collection('users').doc(USER_ID).set(settings, { merge: true });
}

async function getUserSettings() {
  const snap = await db.collection('users').doc(USER_ID).get();
  return snap.exists ? snap.data() : null;
}

// FCM 토큰 저장
// VAPID_KEY는 Firebase Console > Project Settings > Cloud Messaging > Web Push certificates 에서 복사
const VAPID_KEY = 'BNz1jKeLR5YDcNeHfg_yWA6uBs0C8-0FkgY_hlDsQ8OxrKVf4rRzvtHLWquoQ-jiEqGaDZjSuQ-8INthRGu_UOo'; // ← Firebase 콘솔에서 발급 후 교체

async function registerFcmToken() {
  try {
    if (!firebase.messaging) return;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY });
    if (token) {
      await db.collection('users').doc(USER_ID).update({ fcmToken: token, fcmUpdatedAt: new Date().toISOString() });
      console.log('FCM token registered');
    }
  } catch(e) {
    console.warn('FCM token error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────
// 멘토/멘티 연결 (connections)
// connId = mentorUid_menteeUid
// ─────────────────────────────────────────────────────────

async function sendConnectionRequest(mentorEmail) {
  const mentor = await getUserByEmail(mentorEmail);
  if (!mentor) throw new Error('해당 이메일의 멘토 계정을 찾을 수 없어요');
  const mentorUid = mentor.uid;
  const menteeUid = USER_ID;
  const connId = `${mentorUid}_${menteeUid}`;
  await db.collection('connections').doc(connId).set({
    connId, mentorUid, menteeUid,
    mentorEmail, menteeEmail: firebase.auth().currentUser?.email || '',
    status: 'pending',
    requestedBy: menteeUid,
    createdAt: new Date().toISOString(),
  });
}

async function getMyConnections(statusFilter) {
  const uid = USER_ID;
  const [asMentor, asMentee] = await Promise.all([
    db.collection('connections').where('mentorUid', '==', uid).get(),
    db.collection('connections').where('menteeUid', '==', uid).get(),
  ]);
  const all = [];
  asMentor.docs.forEach(d => all.push({ connId: d.id, ...d.data() }));
  asMentee.docs.forEach(d => all.push({ connId: d.id, ...d.data() }));
  if (statusFilter && statusFilter !== 'all') return all.filter(c => c.status === statusFilter);
  return all;
}

async function acceptConnection(connId) {
  await db.collection('connections').doc(connId).update({ status: 'accepted', acceptedAt: new Date().toISOString() });
}
async function rejectConnection(connId) {
  await db.collection('connections').doc(connId).update({ status: 'rejected' });
}
async function revokeConnection(connId) {
  await db.collection('connections').doc(connId).delete();
}

// ─────────────────────────────────────────────────────────
// 멘토용 멘티 데이터 조회
// ─────────────────────────────────────────────────────────

async function getMenteeBooksFor(menteeUid) {
  const snap = await db.collection('users').doc(menteeUid).collection('books').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getMenteeTotalCompletedFor(menteeUid, bookId) {
  const snap = await db.collection('users').doc(menteeUid)
    .collection('books').doc(bookId).collection('dailyLogs').get();
  return snap.docs.reduce((sum, d) => sum + (d.data().completedPages || 0), 0);
}

async function getMenteeRecentSessions(menteeUid, bookId, limit = 3) {
  const snap = await db.collection('users').doc(menteeUid)
    .collection('readingBooks').doc(bookId).collection('sessions')
    .orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getMenteeReadingBooks(menteeUid) {
  const snap = await db.collection('users').doc(menteeUid).collection('readingBooks').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 멘토용: 멘티 일별 로그 조회 (날짜 배열)
// getDailyLogsForDates — 항상 { date: logData } object 반환
// 2인수: (bookId, dates) → 본인 조회
// 3인수: (uid, bookId, dates) → 특정 유저 조회
async function getDailyLogsForDates(uidOrBookId, bookIdOrDates, dates) {
  let uid, bookId;
  if (!dates) {
    // 2인수 모드: (bookId, dates)
    uid = USER_ID;
    bookId = uidOrBookId;
    dates = bookIdOrDates;
  } else {
    // 3인수 모드: (uid, bookId, dates)
    uid = uidOrBookId;
    bookId = bookIdOrDates;
  }
  const chunks = [];
  for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10));
  const logMap = {};
  for (const chunk of chunks) {
    const snap = await db.collection('users').doc(uid)
      .collection('books').doc(bookId).collection('dailyLogs')
      .where('date', 'in', chunk).get();
    snap.docs.forEach(d => { logMap[d.data().date] = d.data(); });
  }
  return logMap; // 항상 { date: logData } object
}

// ─────────────────────────────────────────────────────────
// 독서 (readingBooks)
// ─────────────────────────────────────────────────────────

async function saveReadingBook(data) {
  const ref = db.collection('users').doc(USER_ID).collection('readingBooks').doc();
  await ref.set({ ...data, createdAt: new Date().toISOString() });
  return ref.id;
}
async function getReadingBooks() {
  const snap = await db.collection('users').doc(USER_ID).collection('readingBooks').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getReadingBook(bookId) {
  const snap = await db.collection('users').doc(USER_ID).collection('readingBooks').doc(bookId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}
async function updateReadingBook(bookId, data) {
  await db.collection('users').doc(USER_ID).collection('readingBooks').doc(bookId).update(data);
}

// 주간 완독 수
async function getWeeklyCompletedCount(uid) {
  const dates = getThisWeekDates();
  const snap = await db.collection('users').doc(uid || USER_ID)
    .collection('readingBooks')
    .where('status', '==', 'completed').get();
  return snap.docs.filter(d => {
    const completedAt = d.data().completedAt?.slice(0, 10);
    return completedAt && dates.includes(completedAt);
  }).length;
}

// 독서 목표
async function getReadingGoal() {
  const snap = await db.collection('users').doc(USER_ID).collection('readingMeta').doc('goal').get();
  return snap.exists ? snap.data() : { weeklyTarget: 2 };
}
async function saveReadingGoal(data) {
  await db.collection('users').doc(USER_ID).collection('readingMeta').doc('goal').set(data, { merge: true });
}

// ─────────────────────────────────────────────────────────
// 독서 토론 세션
// ─────────────────────────────────────────────────────────

async function saveDiscussionSession(bookId, data) {
  const ref = db.collection('users').doc(USER_ID)
    .collection('readingBooks').doc(bookId).collection('sessions').doc();
  await ref.set({ ...data, createdAt: new Date().toISOString() });
  return ref.id;
}
async function updateDiscussionSession(bookId, sessionId, data) {
  await db.collection('users').doc(USER_ID)
    .collection('readingBooks').doc(bookId).collection('sessions').doc(sessionId).update(data);
}
async function getDiscussionSessions(bookId) {
  const snap = await db.collection('users').doc(USER_ID)
    .collection('readingBooks').doc(bookId).collection('sessions')
    .orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 스트릭 관련
async function updateStreak(goal) {
  const meta = await getReadingGoal();
  const weeklyTarget = goal || meta.weeklyTarget || 2;
  const weekDone = await getWeeklyCompletedCount();
  if (weekDone >= weeklyTarget) {
    const lastWeek = meta.lastCompletedWeek;
    const thisWeek = getThisWeekDates()[0];
    let streak = meta.streak || 0;
    if (lastWeek !== thisWeek) streak++;
    await saveReadingGoal({ streak, lastCompletedWeek: thisWeek });
    return streak;
  }
  return meta.streak || 0;
}

// ─────────────────────────────────────────────────────────
// 과제 (tasks)
// type: 'homework' (주간숙제 %) | 'lesson' (강의 체크)
// days: [0~6] 0=일,1=월,...,6=토
// subItems: string[] (lesson 세부항목)
// ─────────────────────────────────────────────────────────

async function saveTask(data) {
  const ref = db.collection('users').doc(USER_ID).collection('tasks').doc();
  await ref.set({ ...data, status: 'active', createdAt: new Date().toISOString() });
  return ref.id;
}

async function getTasks() {
  const snap = await db.collection('users').doc(USER_ID).collection('tasks')
    .where('status', '==', 'active').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function updateTask(taskId, data) {
  await db.collection('users').doc(USER_ID).collection('tasks').doc(taskId).update(data);
}

async function deleteTask(taskId) {
  await db.collection('users').doc(USER_ID).collection('tasks').doc(taskId).update({ status: 'deleted' });
}

async function getTasksForDay(dayOfWeek) {
  const tasks = await getTasks();
  return tasks.filter(t => (t.days || []).includes(dayOfWeek));
}

// 과제 로그 저장 (logId = date_taskId)
async function saveTaskLog(taskId, date, logData) {
  const logId = `${date}_${taskId}`;
  await db.collection('users').doc(USER_ID).collection('taskLogs').doc(logId)
    .set({ taskId, date, ...logData, updatedAt: new Date().toISOString() }, { merge: true });
}

async function getTaskLog(taskId, date) {
  const logId = `${date}_${taskId}`;
  const snap = await db.collection('users').doc(USER_ID).collection('taskLogs').doc(logId).get();
  return snap.exists ? snap.data() : null;
}

async function getTaskLogsForDate(date) {
  const snap = await db.collection('users').doc(USER_ID).collection('taskLogs')
    .where('date', '==', date).get();
  const map = {};
  snap.docs.forEach(d => { map[d.data().taskId] = d.data(); });
  return map;
}
