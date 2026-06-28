// ─────────────────────────────────────────────────────────────
// game.js — RIVALS 테마 게임 엔진 (작전노트)
// 기존 학습 로그(dailyLogs/taskLogs)에서 전적·마스터리를 "읽기 시 계산"한다.
// 새 점수 컬렉션을 쌓지 않으므로 데이터 정합성 부담이 없다.
//
// 의존: app.js(db, USER_ID, 날짜 헬퍼), firebase-config.js
// ─────────────────────────────────────────────────────────────

// ── 테마 레지스트리 (확장 지점) ───────────────────────────────
// 새 테마 추가 = 항목 1줄 + home 페이지 1개.
const THEME_REGISTRY = {
  default: { id: 'default', label: '기본',        emoji: '📘', home: 'index.html',  desc: '깔끔한 기본 작전노트' },
  rivals:  { id: 'rivals',  label: 'RIVALS 작전', emoji: '⚔️', home: 'rivals.html', desc: '숙제를 RIVALS 시즌처럼 플레이' },
};
const DEFAULT_THEME = 'default';

function getThemeId(settings) {
  const t = settings && settings.theme;
  return THEME_REGISTRY[t] ? t : DEFAULT_THEME;
}

// ── 무기 카탈로그 (RIVALS 실제 무기 기반, 확장 가능) ──────────
const WEAPONS = [
  // 주무기(Primary)
  { id: 'assault_rifle', name: '어썰트 라이플', emoji: '🔫', cat: 'primary'   },
  { id: 'burst_rifle',   name: '버스트 라이플', emoji: '🔫', cat: 'primary'   },
  { id: 'sniper',        name: '스나이퍼',      emoji: '🎯', cat: 'primary'   },
  { id: 'shotgun',       name: '샷건',          emoji: '💥', cat: 'primary'   },
  { id: 'crossbow',      name: '크로스보우',    emoji: '🏹', cat: 'primary'   },
  { id: 'bow',           name: '보우',          emoji: '🏹', cat: 'primary'   },
  { id: 'rpg',           name: 'RPG',           emoji: '🚀', cat: 'primary'   },
  { id: 'minigun',       name: '미니건',        emoji: '🌀', cat: 'primary'   },
  { id: 'flamethrower',  name: '화염방사기',    emoji: '🔥', cat: 'primary'   },
  { id: 'energy_rifle',  name: '에너지 라이플', emoji: '⚡', cat: 'primary'   },
  // 보조무기(Secondary)
  { id: 'handgun',       name: '핸드건',        emoji: '🔫', cat: 'secondary' },
  { id: 'revolver',      name: '리볼버',        emoji: '🔫', cat: 'secondary' },
  { id: 'uzi',           name: '우지',          emoji: '🔫', cat: 'secondary' },
  { id: 'flare_gun',     name: '플레어건',      emoji: '🎆', cat: 'secondary' },
  { id: 'slingshot',     name: '슬링샷',        emoji: '🪃', cat: 'secondary' },
  // 근접(Melee)
  { id: 'katana',        name: '카타나',        emoji: '🗡️', cat: 'melee'     },
  { id: 'scythe',        name: '사이드(낫)',    emoji: '⚔️', cat: 'melee'     },
  { id: 'knife',         name: '나이프',        emoji: '🔪', cat: 'melee'     },
  { id: 'battle_axe',    name: '배틀액스',      emoji: '🪓', cat: 'melee'     },
  { id: 'chainsaw',      name: '체인소',        emoji: '🪚', cat: 'melee'     },
  { id: 'maul',          name: '마울',          emoji: '🔨', cat: 'melee'     },
];
const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
const WEAPON_CATS = [
  { id: 'primary',   label: '주무기'   },
  { id: 'secondary', label: '보조무기' },
  { id: 'melee',     label: '근접'     },
];
function weaponInfo(id) {
  return WEAPON_BY_ID[id] || { id: id || '', name: '미배정', emoji: '❔', cat: '' };
}

// ── 게임 규칙 상수 (전부 튜닝 가능) ──────────────────────────
const GAME = {
  XP_PER_WIN: 10,
  MASTERY_THRESHOLDS: [0, 30, 80, 160, 280, 450, 700], // Lv1..Lv7 (MAX)
  MAX_LEVEL: 7,
  ELO_BASE: 1000,
  ELO_WIN: 20,
  ELO_LOSS: 10,
  FORM_WINDOW: 30, // 랭크/전적 계산 기간(일)
};

// 마스터리: 누적 XP → 레벨
function xpToLevel(xp) {
  let lv = 1;
  const t = GAME.MASTERY_THRESHOLDS;
  for (let i = 1; i < t.length; i++) if (xp >= t[i]) lv = i + 1;
  return Math.min(lv, GAME.MAX_LEVEL);
}
// 다음 레벨까지 진행도 {cur, next, pct, isMax}
function levelProgress(xp) {
  const lv = xpToLevel(xp);
  const t = GAME.MASTERY_THRESHOLDS;
  if (lv >= GAME.MAX_LEVEL) return { level: lv, cur: xp, next: null, pct: 100, isMax: true };
  const base = t[lv - 1], nextNeed = t[lv];
  const pct = Math.round(((xp - base) / (nextNeed - base)) * 100);
  return { level: lv, cur: xp, next: nextNeed, pct: Math.max(0, Math.min(100, pct)), isMax: false };
}
// 레벨 → 스킨 티어
function levelTier(level) {
  if (level >= 7) return { key: 'diamond', label: '다이아', color: '#22d3ee' };
  if (level >= 5) return { key: 'gold',    label: '골드',   color: '#f5b301' };
  if (level >= 3) return { key: 'silver',  label: '실버',   color: '#c0c7d4' };
  return { key: 'base', label: '기본', color: '#9ba3bf' };
}

// ── 랭크(ELO → 티어) ─────────────────────────────────────────
const RANKS = [
  { name: '브론즈',     min: 1000, sub: true,  color: '#cd7f32' },
  { name: '실버',       min: 1200, sub: true,  color: '#c0c7d4' },
  { name: '골드',       min: 1400, sub: true,  color: '#f5b301' },
  { name: '플래티넘',   min: 1600, sub: true,  color: '#36d1c4' },
  { name: '다이아',     min: 1800, sub: true,  color: '#22d3ee' },
  { name: '오닉스',     min: 2000, sub: true,  color: '#7c83a3' },
  { name: '네메시스',   min: 2300, sub: false, color: '#a855f7' },
  { name: '아크네메시스',min: 2600, sub: false, color: '#ef4444' },
];
function eloToRank(elo) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (elo >= RANKS[i].min) idx = i;
  const r = RANKS[idx];
  let label = r.name;
  if (r.sub) {
    const next = RANKS[idx + 1] ? RANKS[idx + 1].min : r.min + 200;
    const band = (next - r.min) / 3;
    const pos = Math.min(2, Math.floor((elo - r.min) / band)); // 0,1,2
    const roman = ['I', 'II', 'III'][2 - pos]; // 아래일수록 III, 위로 I
    label = `${r.name} ${roman}`;
  }
  return { name: r.name, label, color: r.color, elo };
}

// ── 완료 판정 헬퍼 ───────────────────────────────────────────
function bookLogDone(log) {
  return !!log && (log.status === 'done' || log.status === 'partial' || log.status === 'extra');
}
function bookLogProgress(log) {
  return !!log && ((log.completedPages || 0) > 0 || bookLogDone(log));
}
function taskLogDone(task, log) {
  if (!log) return false;
  if (task.type === 'lesson') {
    const need = (task.subItems && task.subItems.length) ? task.subItems.length : 1;
    return (log.checkedItems || []).length >= need;
  }
  return (log.percent || 0) >= 100;
}
function taskLogProgress(task, log) {
  if (!log) return false;
  if (task.type === 'lesson') return (log.checkedItems || []).length > 0;
  return (log.percent || 0) > 0;
}

// 과목 추출
function bookSubject(b) { return (b.subject && b.subject.trim()) || '기타'; }
function taskSubject(t) { return (t.subject && t.subject.trim()) || '기타'; }

// ── 메인: 게임 상태 로드 (읽기 시 계산) ──────────────────────
// 반환: { player, weapons[], todayMatch, subjects[] }
async function loadGameState() {
  const uid = getUserId();
  const settings = (await getUserProfile(uid)) || {};
  const weaponMap = settings.weaponMap || {};
  const weaponMeta = settings.weaponMeta || {};

  // 1) 교재/과제 로드
  const [books, tasks] = await Promise.all([getBooks(), getTasks()]);

  // 2) 모든 로그 로드 (마스터리=누적 위해 전체)
  const bookLogsByBook = {}; // bookId -> { date: log }
  await Promise.all(books.map(async (b) => {
    const snap = await db.collection('users').doc(uid)
      .collection('books').doc(b.id).collection('dailyLogs').get();
    const m = {};
    snap.docs.forEach(d => { m[d.id] = d.data(); });
    bookLogsByBook[b.id] = m;
  }));
  const taskLogsByKey = {}; // `${date}_${taskId}` -> log
  {
    const snap = await db.collection('users').doc(uid).collection('taskLogs').get();
    snap.docs.forEach(d => { taskLogsByKey[d.id] = d.data(); });
  }

  // 3) 과목별 집계 구조 초기화
  const subjects = {}; // subject -> { wins, recentWins, recentLosses, items:{books,tasks} }
  function ensureSub(s) {
    if (!subjects[s]) subjects[s] = { subject: s, wins: 0, recentWins: 0, recentLosses: 0 };
    return subjects[s];
  }

  const todayStr = today();
  const formDates = lastNDates(GAME.FORM_WINDOW); // 최근 N일 (오늘 포함)
  const formSet = new Set(formDates);

  // 3-1) 교재 집계
  books.forEach((b) => {
    const s = bookSubject(b);
    ensureSub(s);
    const logs = bookLogsByBook[b.id] || {};
    const workDays = b.workDays || [1, 2, 4, 5];
    // 누적 승: 완료 로그 수
    Object.keys(logs).forEach(date => {
      if (bookLogDone(logs[date])) subjects[s].wins += 1;
    });
    // 최근 윈도우 승/패 (예정일 기준)
    formDates.forEach(date => {
      if (date > todayStr) return;
      const scheduled = workDays.includes(dateDow(date));
      if (!scheduled) return;
      const log = logs[date];
      if (bookLogDone(log)) subjects[s].recentWins += 1;
      else if (date < todayStr && !bookLogProgress(log)) subjects[s].recentLosses += 1;
    });
  });

  // 3-2) 과제 집계
  tasks.forEach((t) => {
    const s = taskSubject(t);
    ensureSub(s);
    const days = t.days || [];
    // 누적 승
    Object.keys(taskLogsByKey).forEach(key => {
      if (!key.endsWith('_' + t.id)) return;
      if (taskLogDone(t, taskLogsByKey[key])) subjects[s].wins += 1;
    });
    // 최근 윈도우
    formDates.forEach(date => {
      if (date > todayStr) return;
      const scheduled = days.includes(dateDow(date));
      if (!scheduled) return;
      const log = taskLogsByKey[`${date}_${t.id}`];
      if (taskLogDone(t, log)) subjects[s].recentWins += 1;
      else if (date < todayStr && !taskLogProgress(t, log)) subjects[s].recentLosses += 1;
    });
  });

  // 4) 과목 → 무기 스탯 변환
  const weapons = Object.values(subjects).map((sub) => {
    const wId = weaponMap[sub.subject] || null;
    const meta = weaponMeta[sub.subject] || {};
    const prestige = meta.prestige || 0;
    // 이적(retire) 시 xpBaseline 만큼 빼서 새 무기는 Lv1부터 시작
    const xp = Math.max(0, sub.wins * GAME.XP_PER_WIN - (meta.xpBaseline || 0));
    const prog = levelProgress(xp);
    return {
      subject: sub.subject,
      weaponId: wId,
      weapon: weaponInfo(wId),
      mapped: !!wId,
      wins: sub.wins,
      xp,
      level: prog.level,
      progress: prog,
      tier: levelTier(prog.level),
      prestige,
      retired: meta.retired || [],
      recentWins: sub.recentWins,
      recentLosses: sub.recentLosses,
    };
  }).sort((a, b) => b.xp - a.xp);

  // 5) 플레이어 종합 (최근 윈도우 기준)
  let recentWins = 0, recentLosses = 0;
  weapons.forEach(w => { recentWins += w.recentWins; recentLosses += w.recentLosses; });
  const streak = computeStreak(books, tasks, bookLogsByBook, taskLogsByKey);
  const streakBonus = Math.min(streak, 10) * 5;
  const elo = GAME.ELO_BASE + recentWins * GAME.ELO_WIN - recentLosses * GAME.ELO_LOSS + streakBonus;
  const rank = eloToRank(elo);
  const form = recentForm(books, tasks, bookLogsByBook, taskLogsByKey, 7);

  // 6) 오늘의 매치
  const todayMatch = buildTodayMatch(books, tasks, bookLogsByBook, taskLogsByKey, weaponMap);

  return {
    player: { elo, rank, recentWins, recentLosses, streak, form,
              totalWins: weapons.reduce((s, w) => s + w.wins, 0) },
    weapons,
    todayMatch,
    unmappedSubjects: weapons.filter(w => !w.mapped).map(w => w.subject),
  };
}

// ── 날짜 헬퍼 (app.js의 today/dateDow 사용) ──────────────────
function lastNDates(n) {
  const out = [];
  const base = new Date(today() + 'T12:00:00');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(toKSTDateStr(d));
  }
  return out; // 과거→오늘 순
}

// 연승(연속 완수일): 오늘부터 거슬러, 예정 있던 날 중 하나라도 완수하면 +1, 미완수면 끊김
function computeStreak(books, tasks, bookLogs, taskLogs) {
  let streak = 0;
  const base = new Date(today() + 'T12:00:00');
  const todayStr = today();
  for (let i = 0; i < 90; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const date = toKSTDateStr(d);
    const { scheduled, done } = dayStatus(date, books, tasks, bookLogs, taskLogs);
    if (scheduled === 0) continue;            // 예정 없는 날은 건너뜀
    if (done > 0) { streak += 1; }
    else if (date === todayStr) { continue; } // 오늘은 아직 안 끝남 → 끊지 않음
    else break;
  }
  return streak;
}

// 특정 날짜의 예정/완수 카운트
function dayStatus(date, books, tasks, bookLogs, taskLogs) {
  const dow = dateDow(date);
  let scheduled = 0, done = 0;
  books.forEach(b => {
    const wd = b.workDays || [1, 2, 4, 5];
    if (!wd.includes(dow)) return;
    scheduled++;
    if (bookLogDone((bookLogs[b.id] || {})[date])) done++;
  });
  tasks.forEach(t => {
    if (!(t.days || []).includes(dow)) return;
    scheduled++;
    if (taskLogDone(t, taskLogs[`${date}_${t.id}`])) done++;
  });
  return { scheduled, done };
}

// 최근 m일 폼: 'win' | 'partial' | 'loss' | 'rest'
function recentForm(books, tasks, bookLogs, taskLogs, m) {
  return lastNDates(m).map(date => {
    const { scheduled, done } = dayStatus(date, books, tasks, bookLogs, taskLogs);
    if (scheduled === 0) return 'rest';
    if (done >= scheduled) return 'win';
    if (done > 0) return 'partial';
    return date === today() ? 'partial' : 'loss';
  });
}

// 오늘의 매치 카드 (과목/무기별 그룹)
function buildTodayMatch(books, tasks, bookLogs, taskLogs, weaponMap) {
  const dow = todayDow();
  const todayStr = today();
  const groups = {}; // subject -> {subject, weapon, items:[{name, done}]}
  function g(subject) {
    if (!groups[subject]) groups[subject] = {
      subject, weaponId: weaponMap[subject] || null,
      weapon: weaponInfo(weaponMap[subject] || null), items: [],
    };
    return groups[subject];
  }
  books.forEach(b => {
    const wd = b.workDays || [1, 2, 4, 5];
    if (b.status !== 'active' || !wd.includes(dow)) return;
    const log = (bookLogs[b.id] || {})[todayStr];
    g(bookSubject(b)).items.push({
      name: `[${b.subject || '교재'}] ${b.title}`,
      done: bookLogDone(log), kind: 'book', id: b.id,
    });
  });
  tasks.forEach(t => {
    if (!(t.days || []).includes(dow)) return;
    const log = taskLogs[`${todayStr}_${t.id}`];
    g(taskSubject(t)).items.push({
      name: t.name, done: taskLogDone(t, log), kind: 'task', id: t.id,
    });
  });
  const list = Object.values(groups);
  let total = 0, won = 0;
  list.forEach(grp => grp.items.forEach(it => { total++; if (it.done) won++; }));
  let result = 'pending';
  if (total > 0 && won >= total) result = 'mvp';
  else if (won > 0) result = 'partial';
  else if (total === 0) result = 'rest';
  return { groups: list, total, won, result };
}
