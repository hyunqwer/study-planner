const { onRequest } = require('firebase-functions/v2/https');
const OpenAI = require('openai');

// ────────────────────────────────────────────────────────
// POST /analyzeMission
// Body: { period, weekPct, weekGoal, weekDone, books[], dayData[], reason? }
// Response: { situation, analysis, recommendation }
// ────────────────────────────────────────────────────────
exports.analyzeMission = onRequest(
  { cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

    const { period = 'week', weekPct = 0, weekGoal = 0, weekDone = 0, books = [], dayData = [], reason } = req.body;

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
      const client = new OpenAI({ apiKey });

      // 상황 판단
      let situation = 'on_track';
      if (weekPct >= 95) situation = 'too_easy';
      else if (weekPct < 50) situation = 'struggling';
      if (reason === 'too-easy') situation = 'too_easy';
      if (['too-much', 'hard', 'lazy'].includes(reason)) situation = 'struggling';

      const booksDesc = books.map(b =>
        `  - [${b.subject}] ${b.title}: 목표 ${b.weekGoal}쪽 중 ${b.weekDone}쪽 완료 (${b.pct}%), 하루 ${b.dailyPages}쪽 계획`
      ).join('\n');

      const dayDesc = dayData.length
        ? dayData.map(d => `  ${d.dayLabel}: 목표 ${d.goal}쪽 / 완료 ${d.done}쪽`).join('\n')
        : '(요일 데이터 없음)';

      const reasonDesc = reason
        ? `\n본인 평가: "${reason}"` : '';

      const periodLabel = period === 'month' ? '월간(4주)' : '주간';

      const prompt = `너는 초중등 학습자의 자기주도학습 코치야.
아래는 학습자의 ${periodLabel} 공부 결과야. 이 데이터를 보고 분석과 조언을 줘.

전체 달성률: ${weekPct}% (목표 ${weekGoal}쪽 중 ${weekDone}쪽)${reasonDesc}

교재별 현황:
${booksDesc}

요일별 현황:
${dayDesc}

상황 판단: ${situation === 'too_easy' ? '목표가 너무 쉬움' : situation === 'struggling' ? '실행이 힘든 상태' : '적절한 페이스'}

다음 JSON 형식으로만 응답해. 마크다운 불필요.
{
  "situation": "too_easy 또는 on_track 또는 struggling",
  "analysis": "2~3문장 분석 (초중등 학습자에게 코치가 말하듯 반말, 따뜻하고 솔직하게)",
  "recommendation": "다음 주 구체적 행동 제안 1문장 (숫자 포함 권장)"
}

말투 규칙:
- 반말, 친근한 코치 톤 ("~해", "~하자", "~봐", "~괜찮아")
- "학생", "학습자" 금지 → "너" 또는 "네가"
- "습니다" 금지
- 격려와 현실적 조언 균형
JSON만 반환.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = completion.choices[0].message.content.trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/```(?:json)?\n?([\s\S]*?)```/);
        if (match) parsed = JSON.parse(match[1].trim());
        else throw new Error('AI 응답 파싱 실패');
      }

      if (parsed.analysis)      parsed.analysis      = normalizeCoachTone(parsed.analysis);
      if (parsed.recommendation) parsed.recommendation = normalizeCoachTone(parsed.recommendation);
      parsed.situation = parsed.situation || situation;

      return res.status(200).json(parsed);
    } catch (err) {
      console.error('analyzeMission error:', err);
      return res.status(500).json({ error: err.message || '분석 중 오류가 발생했습니다.' });
    }
  }
);

function normalizeCoachTone(text = '') {
  return String(text)
    .trim()
    .replace(/학생들이/g, '네가')
    .replace(/학생이/g, '네가')
    .replace(/학습자/g, '너')
    .replace(/학습을/g, '공부를')
    .replace(/학습/g, '공부')
    .replace(/구성되어 있습니다/g, '구성되어 있어')
    .replace(/포함하고 있습니다/g, '포함하고 있어')
    .replace(/중요합니다/g, '중요해')
    .replace(/필요합니다/g, '필요해')
    .replace(/좋습니다/g, '좋아')
    .replace(/가능합니다/g, '가능해')
    .replace(/도움이 됩니다/g, '도움이 돼')
    .replace(/하는 것이/g, '하는 게')
    .replace(/있습니다/g, '있어')
    .replace(/없습니다/g, '없어')
    .replace(/됩니다/g, '돼')
    .replace(/합니다/g, '해')
    .replace(/하세요/g, '해줘')
    .replace(/매일 꾸준히/g, '매일 조금씩 꾸준히');
}

/**
 * POST /analyzeToc
 * Body: { images: ["base64...", "base64..."], mimeTypes: ["image/jpeg", ...] }
 * Response: { chapters, bookTitle, totalPages, aiComment }
 *
 * OPENAI_API_KEY는 functions/.env 파일에서 process.env로 자동 로드됨
 */
exports.analyzeToc = onRequest(
  {
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST만 허용됩니다.' });
    }

    const { images, mimeTypes } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '이미지가 없습니다.' });
    }

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
      const client = new OpenAI({ apiKey });

      // 이미지 콘텐츠 배열 구성
      const imageContents = images.map((b64, i) => ({
        type: 'image_url',
        image_url: {
          url: `data:${mimeTypes?.[i] || 'image/jpeg'};base64,${b64}`,
          detail: 'auto',
        },
      }));

      const prompt = `이 이미지는 한국 교육 문제집 또는 교재의 목차 페이지야.
이미지를 분석해서 반드시 아래 JSON 형식으로만 응답해줘. 다른 텍스트는 포함하지 마.

{
  "bookTitle": "책 제목 (이미지에서 보이면, 없으면 빈 문자열)",
  "totalPages": 전체 페이지 수 (목차의 마지막 단원 끝 페이지 기준으로 추정, 모르면 0),
  "chapters": [
    {
      "number": 단원 번호 (숫자),
      "title": "단원 이름",
      "startPage": 시작 페이지 (숫자, 모르면 0),
      "endPage": 끝 페이지 (숫자, 모르면 0),
      "estimatedDifficulty": "easy 또는 medium 또는 hard",
      "estimatedDays": 이 단원을 공부하는 데 예상 일수 (1~14 사이 숫자)
    }
  ],
  "aiComment": "이 책의 특징과 학습 조언을 2~3문장으로 (한국어, 친구 같은 코치 선생님 말투)"
}

난이도 기준: easy=기초/개념, medium=응용, hard=심화/서술형
말투 기준:
- 초중등 아이에게 말하듯 친근한 반말 코치 톤으로 써.
- "~해", "~하자", "~좋아", "~괜찮아", "~잡자" 같은 문장으로 끝내.
- "습니다", "합니다", "중요합니다", "구성되어 있습니다" 같은 존댓말은 절대 쓰지 마.
- "학생", "학습자"라고 부르지 말고 필요하면 "너" 또는 "네가"라고 말해.
JSON만 반환. 마크다운 코드블록 사용 금지.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContents,
            ],
          },
        ],
      });

      const raw = completion.choices[0].message.content.trim();

      // JSON 파싱 (마크다운 블록 방어)
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/```(?:json)?\n?([\s\S]*?)```/);
        if (match) parsed = JSON.parse(match[1].trim());
        else throw new Error('AI 응답 파싱 실패');
      }

      if (parsed.aiComment) parsed.aiComment = normalizeCoachTone(parsed.aiComment);
      return res.status(200).json(parsed);

    } catch (err) {
      console.error('analyzeToc error:', err);
      return res.status(500).json({
        error: err.message || 'OpenAI 호출 중 오류가 발생했습니다.',
      });
    }
  }
);

// ────────────────────────────────────────────────────────
// POST /discussBook  (방식 A — AI는 책 내용을 모른다)
// Body: {
//   bookTitle: string,
//   answers: { q1, q2, q3 },   // 완독 후 입력한 3문
//   messages: [{ role, content }],  // 이전 대화 내역
// }
// Response: { reply, bloomLevel, turnCount }
// ────────────────────────────────────────────────────────
exports.discussBook = onRequest(
  { cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

    const { bookTitle = '이 책', answers = {}, messages = [] } = req.body;
    const { q1 = '', q2 = '', q3 = '' } = answers;

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY 미설정');
      const client = new OpenAI({ apiKey });

      const turnCount = messages.filter(m => m.role === 'user').length;

      // 블룸 단계 판별 (턴 수 기반)
      let bloomLevel = 1;
      if (turnCount >= 3) bloomLevel = 2;
      if (turnCount >= 6) bloomLevel = 3;

      const bloomGuide = {
        1: `[1단계 — 회상] 아이가 말한 내용을 더 구체적으로 물어봐. "그 장면에서 어떤 느낌이었어?", "그게 왜 기억에 남았어?" 같은 질문으로 시작해.`,
        2: `[2단계 — 분석] 이제 "왜?"를 중심으로 사고를 확장해. "그 인물은 왜 그런 선택을 했을까?", "만약 네가 그 상황이었다면?", "그 장면이 책에서 왜 중요할까?" 등으로 깊이를 더해.`,
        3: `[3단계 — 창의·적용] 책을 넘어 상상력을 자극해. "결말을 바꾼다면?", "이 이야기가 지금 우리 세상에서 벌어진다면?", "책에서 배운 것 중 네 삶에 적용할 수 있는 게 있어?" 등으로 이어가.`,
      };

      const systemPrompt = `너는 초중등 학습자의 독서 토론 파트너야.

[중요 규칙]
- 너는 "${bookTitle}"의 내용을 전혀 모른다. 절대로 책의 줄거리나 내용을 먼저 언급하지 마.
- 오직 아이가 직접 말한 내용에만 근거해서 질문하고 대화해.
- 한 번에 질문은 하나만 해. 여러 질문을 동시에 하지 마.
- 친근한 반말 코치 톤: "~해?", "~해봐", "~였어?" 등 자연스럽게.
- "학생", "학습자" 금지. "너", "네가"로 말해.
- 한 번 응답은 3~4문장 이내로 짧게.

[아이가 입력한 내용 — 이것만이 네 grounding 재료]
- 기억에 남는 장면: "${q1}"
- 웃기거나 신기했던 부분: "${q2}"
- 마음에 든 인물: "${q3}"

${bloomGuide[bloomLevel]}`;

      const chatMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];

      // 첫 턴이면 AI가 먼저 시작
      if (messages.length === 0) {
        chatMessages.push({
          role: 'user',
          content: '토론 시작해줘',
        });
      }

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: chatMessages,
      });

      const reply = normalizeCoachTone(completion.choices[0].message.content.trim());

      return res.status(200).json({ reply, bloomLevel, turnCount });

    } catch (err) {
      console.error('discussBook error:', err);
      return res.status(500).json({ error: err.message || '오류가 발생했어요.' });
    }
  }
);

// ────────────────────────────────────────────────────────
// POST /summarizeDiscussion
// Body: { bookTitle, answers, messages }
// Response: { summary, bloomReached, coachingPoints }
// ────────────────────────────────────────────────────────
exports.summarizeDiscussion = onRequest(
  { cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

    const { bookTitle = '', answers = {}, messages = [] } = req.body;

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY 미설정');
      const client = new OpenAI({ apiKey });

      const turnCount = messages.filter(m => m.role === 'user').length;
      const bloomReached = turnCount >= 6 ? 3 : turnCount >= 3 ? 2 : 1;

      const transcript = messages.map(m =>
        `${m.role === 'user' ? '아이' : 'AI'}: ${m.content}`
      ).join('\n');

      const prompt = `다음은 "${bookTitle}" 독서 토론 대화야.

[아이의 초기 답변]
- 기억에 남는 장면: ${answers.q1}
- 웃기거나 신기한 부분: ${answers.q2}
- 마음에 든 인물: ${answers.q3}

[토론 대화]
${transcript}

위 토론을 분석해서 아래 JSON 형식으로만 응답해. 마크다운 불필요.
{
  "summary": "토론 내용 요약 3문장. 아이가 보인 사고력과 표현을 중심으로. 멘토(부모·선생님)에게 보고하는 톤으로 존댓말.",
  "bloomReached": ${bloomReached},
  "coachingPoints": ["멘토에게 드리는 코칭 제안 1문장", "추가 대화 주제나 후속 독서 추천 1문장"]
}

JSON만 반환.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = completion.choices[0].message.content.trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/```(?:json)?\n?([\s\S]*?)```/);
        if (match) parsed = JSON.parse(match[1].trim());
        else throw new Error('파싱 실패');
      }

      return res.status(200).json(parsed);

    } catch (err) {
      console.error('summarizeDiscussion error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 웹 푸시 알림 — Scheduled Functions
// ─────────────────────────────────────────────────────────────
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

// admin 초기화 (중복 방지)
if (!admin.apps.length) admin.initializeApp();

/**
 * sendDailyPush — 매 시간 정각 실행
 * 각 유저의 push.dailyHour 와 현재 KST 시간 비교 → 매칭되면 푸시
 * 오늘 학습 기록 있으면 칭찬, 없으면 리마인더
 */
exports.sendDailyPush = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Seoul', memory: '256MiB' },
  async () => {
    const db = admin.firestore();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentHour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);

    // push.dailyEnabled=true, dailyHour=현재시간 인 유저 조회
    const usersSnap = await db.collection('users')
      .where('push.dailyEnabled', '==', true)
      .where('push.dailyHour', '==', currentHour)
      .get();

    const sends = usersSnap.docs.map(async (userDoc) => {
      const user = userDoc.data();
      const fcmToken = user.fcmToken;
      if (!fcmToken) return;

      // 오늘 완료한 미션이 있는지 확인
      const booksSnap = await db.collection('users').doc(userDoc.id)
        .collection('books').where('status', '==', 'active').limit(5).get();

      let hasTodayLog = false;
      for (const bookDoc of booksSnap.docs) {
        const logDoc = await db.collection('users').doc(userDoc.id)
          .collection('books').doc(bookDoc.id)
          .collection('dailyLogs').doc(todayStr).get();
        if (logDoc.exists && (logDoc.data().status === 'done' || logDoc.data().status === 'partial')) {
          hasTodayLog = true;
          break;
        }
      }

      const nickname = user.nickname || user.email?.split('@')[0] || '친구';
      const message = hasTodayLog
        ? {
            notification: {
              title: `${nickname}, 오늘도 완료! 🎉`,
              body: '오늘 공부 기록을 남겼어. 이 습관이 쌓이면 진짜 실력이 돼. 내일도 파이팅!',
            },
            data: { click_action: '/index.html' },
          }
        : {
            notification: {
              title: `${nickname}, 오늘 기록 남겼어? 📖`,
              body: '오늘 공부한 내용을 작전노트에 남겨봐. 아주 짧아도 괜찮아!',
            },
            data: { click_action: '/mission.html' },
          };

      try {
        await admin.messaging().send({ token: fcmToken, ...message });
        console.log(`Daily push sent to ${userDoc.id}`);
      } catch (e) {
        console.warn(`Push failed for ${userDoc.id}:`, e.message);
      }
    });

    await Promise.allSettled(sends);
  }
);

/**
 * sendWeeklyPush — 매 시간 정각 실행 (요일+시간 조건으로 필터)
 * 각 유저의 push.weeklyDay, push.weeklyHour 비교 → 매칭되면 주간 작전 안내 푸시
 */
exports.sendWeeklyPush = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Seoul', memory: '256MiB' },
  async () => {
    const db = admin.firestore();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentHour = now.getHours();
    const currentDay  = now.getDay(); // 0=일 6=토

    const usersSnap = await db.collection('users')
      .where('push.weeklyEnabled', '==', true)
      .where('push.weeklyDay', '==', currentDay)
      .where('push.weeklyHour', '==', currentHour)
      .get();

    const sends = usersSnap.docs.map(async (userDoc) => {
      const user = userDoc.data();
      const fcmToken = user.fcmToken;
      if (!fcmToken) return;

      const nickname = user.nickname || user.email?.split('@')[0] || '친구';
      try {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: `${nickname}, 주간 작전 시간이야! ⚔️`,
            body: '이번 주를 돌아보고 다음 주 작전을 세워봐. 5분이면 충분해!',
          },
          data: { click_action: '/review.html' },
        });
        console.log(`Weekly push sent to ${userDoc.id}`);
      } catch (e) {
        console.warn(`Weekly push failed for ${userDoc.id}:`, e.message);
      }
    });

    await Promise.allSettled(sends);
  }
);

// ─────────────────────────────────────────────────────────────
// generateMentorFeedback — POST /generateMentorFeedback
// Body: { mentorUid, menteeUid, periodKey, weekDates[] }
// 멘티 데이터를 Firestore에서 직접 읽어 AI 피드백 생성 후 저장
// ─────────────────────────────────────────────────────────────
exports.generateMentorFeedback = onRequest(
  { cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { mentorUid, menteeUid, periodKey, weekDates = [] } = req.body;
    if (!mentorUid || !menteeUid) return res.status(400).json({ error: 'mentorUid, menteeUid 필요' });

    try {
      const db = admin.firestore();
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY 미설정');

      // ── 멘티 데이터 수집 ──────────────────────────────
      const menteeRef = db.collection('users').doc(menteeUid);
      const [profileDoc, booksSnap] = await Promise.all([
        menteeRef.get(),
        menteeRef.collection('books').where('status', '==', 'active').get(),
      ]);
      const menteeProfile = profileDoc.data() || {};
      const nickname = menteeProfile.nickname || menteeProfile.email?.split('@')[0] || '학습자';
      const books = booksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 주간 날짜 결정 (없으면 이번 주 월~일)
      let dates = weekDates;
      if (!dates.length) {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const dow = now.getDay();
        const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday); d.setDate(monday.getDate() + i);
          dates.push(d.toISOString().slice(0, 10));
        }
      }

      // 책별 주간 로그 수집
      const booksSummary = await Promise.all(books.map(async book => {
        const logsSnap = await menteeRef.collection('books').doc(book.id)
          .collection('dailyLogs').where('date', 'in', dates.slice(0, 10)).get();
        const logs = logsSnap.docs.map(d => d.data());
        const done = logs.reduce((s, l) => s + (l.pagesRead || 0), 0);
        const goal = (book.dailyPages || 0) * 5; // 주 5일 기준
        const pct = goal ? Math.min(100, Math.round(done / goal * 100)) : 0;
        return { subject: book.subject, title: book.title, done, goal, pct };
      }));

      const totalGoal = booksSummary.reduce((s, b) => s + b.goal, 0);
      const totalDone = booksSummary.reduce((s, b) => s + b.done, 0);
      const weekPct = totalGoal ? Math.round(totalDone / totalGoal * 100) : 0;

      const booksDesc = booksSummary.map(b =>
        `  - [${b.subject}] ${b.title}: 목표 ${b.goal}쪽 중 ${b.done}쪽 (${b.pct}%)`
      ).join('\n') || '  (진행 중인 교재 없음)';

      // ── AI 피드백 생성 ────────────────────────────────
      const client = new OpenAI({ apiKey });
      const prompt = `너는 초중등 학습자의 자기주도학습 코치야.
아래는 멘토가 관리하는 학습자 "${nickname}"의 이번 주 공부 결과야.

전체 달성률: ${weekPct}% (목표 ${totalGoal}쪽 중 ${totalDone}쪽)

교재별 현황:
${booksDesc}

멘토에게 보내는 주간 리포트를 JSON 형식으로 작성해줘.
멘토 입장에서 이 학습자를 어떻게 코칭하면 좋을지 담아줘.

{
  "weekPct": ${weekPct},
  "totalDone": ${totalDone},
  "totalGoal": ${totalGoal},
  "situation": "great(90% 이상) / on_track(70-89%) / needs_push(50-69%) / struggling(50% 미만) 중 하나",
  "summary": "이번 주 학습 요약 2문장 (멘토에게 보고하는 톤, 존댓말)",
  "coachingTip": "멘토가 이번 주에 해줄 수 있는 구체적 코칭 조언 1문장",
  "nextWeekGoal": "다음 주 학습 방향 제안 1문장"
}
JSON만 반환.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = completion.choices[0].message.content.trim();
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        const match = raw.match(/```(?:json)?\n?([\s\S]*?)```/);
        if (match) parsed = JSON.parse(match[1].trim());
        else throw new Error('AI 파싱 실패');
      }

      // ── Firestore 저장 ────────────────────────────────
      const key = periodKey || dates[0]?.slice(0, 7) + '-W' + dates[0];
      const reportData = {
        ...parsed,
        generatedAt: new Date().toISOString(),
        generatedBy: mentorUid,
        weekStart: dates[0] || '',
        weekEnd: dates[6] || '',
        books: booksSummary,
      };
      await menteeRef.collection('mentorReports').doc(key).set(reportData);

      return res.status(200).json(reportData);
    } catch (err) {
      console.error('generateMentorFeedback error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// autoWeeklyReport — 매 시간 정각 실행
// 멘토의 reportSchedule(dayOfWeek, hour)와 현재 KST 시간 비교
// 일치하면 해당 멘토의 모든 멘티 리포트 자동 생성
// ─────────────────────────────────────────────────────────────
exports.autoWeeklyReport = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Seoul', memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const db = admin.firestore();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentHour = now.getHours();
    const currentDay  = now.getDay(); // 0=일..6=토

    // 오늘/이번 시간에 맞는 멘토 조회
    const mentorsSnap = await db.collection('users')
      .where('role', '==', 'mentor')
      .where('reportSchedule.dayOfWeek', '==', currentDay)
      .where('reportSchedule.hour', '==', currentHour)
      .get();

    console.log(`autoWeeklyReport: ${mentorsSnap.size}명의 멘토 리포트 생성 시작`);

    // 이번 주 날짜 배열 (월~일)
    const dow = now.getDay();
    const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      weekDates.push(d.toISOString().slice(0, 10));
    }
    const periodKey = `${weekDates[0]}_${weekDates[6]}`;

    const tasks = mentorsSnap.docs.map(async (mentorDoc) => {
      const mentorUid = mentorDoc.id;
      try {
        // 이 멘토와 연결된 accepted 멘티 목록
        const connSnap = await db.collection('connections')
          .where('mentorUid', '==', mentorUid)
          .where('status', '==', 'accepted')
          .get();

        for (const conn of connSnap.docs) {
          const menteeUid = conn.data().menteeUid;
          try {
            // 이미 이번 주 리포트가 있으면 스킵
            const existing = await db.collection('users').doc(menteeUid)
              .collection('mentorReports').doc(periodKey).get();
            if (existing.exists) {
              console.log(`skip: ${menteeUid} 이미 리포트 있음`);
              continue;
            }

            // HTTP 함수 내부 로직 재사용 (직접 Firestore + OpenAI 호출)
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) { console.warn('OPENAI_API_KEY 없음'); continue; }

            const menteeRef = db.collection('users').doc(menteeUid);
            const [profileDoc, booksSnap] = await Promise.all([
              menteeRef.get(),
              menteeRef.collection('books').where('status', '==', 'active').get(),
            ]);
            const profile = profileDoc.data() || {};
            const nickname = profile.nickname || profile.email?.split('@')[0] || '학습자';
            const books = booksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const booksSummary = await Promise.all(books.map(async book => {
              const logsSnap = await menteeRef.collection('books').doc(book.id)
                .collection('dailyLogs').where('date', 'in', weekDates.slice(0, 10)).get();
              const logs = logsSnap.docs.map(d => d.data());
              const done = logs.reduce((s, l) => s + (l.pagesRead || 0), 0);
              const goal = (book.dailyPages || 0) * 5;
              const pct = goal ? Math.min(100, Math.round(done / goal * 100)) : 0;
              return { subject: book.subject, title: book.title, done, goal, pct };
            }));

            const totalGoal = booksSummary.reduce((s, b) => s + b.goal, 0);
            const totalDone = booksSummary.reduce((s, b) => s + b.done, 0);
            const weekPct = totalGoal ? Math.round(totalDone / totalGoal * 100) : 0;

            const booksDesc = booksSummary.map(b =>
              `  - [${b.subject}] ${b.title}: ${b.done}/${b.goal}쪽 (${b.pct}%)`
            ).join('\n') || '  (교재 없음)';

            const client = new OpenAI({ apiKey });
            const completion = await client.chat.completions.create({
              model: 'gpt-4o',
              max_tokens: 500,
              messages: [{ role: 'user', content:
                `멘토용 주간 리포트. 학습자: "${nickname}", 달성률: ${weekPct}%\n${booksDesc}\n\n` +
                `{"weekPct":${weekPct},"totalDone":${totalDone},"totalGoal":${totalGoal},` +
                `"situation":"great/on_track/needs_push/struggling 중 하나",` +
                `"summary":"2문장 요약(존댓말)","coachingTip":"코칭 조언 1문장","nextWeekGoal":"다음주 방향 1문장"}\nJSON만.`
              }],
            });

            let parsed;
            try { parsed = JSON.parse(completion.choices[0].message.content.trim()); }
            catch { parsed = { weekPct, totalDone, totalGoal, situation: 'on_track',
              summary: `${nickname}의 이번 주 달성률은 ${weekPct}%입니다.`, coachingTip: '', nextWeekGoal: '' }; }

            await menteeRef.collection('mentorReports').doc(periodKey).set({
              ...parsed, generatedAt: new Date().toISOString(),
              generatedBy: mentorUid, weekStart: weekDates[0], weekEnd: weekDates[6],
              books: booksSummary, auto: true,
            });
            console.log(`✅ 리포트 생성: mentor=${mentorUid} mentee=${menteeUid}`);

            // 멘토에게 FCM 푸시 알림
            const mentorData = mentorDoc.data();
            if (mentorData.fcmToken) {
              await admin.messaging().send({
                token: mentorData.fcmToken,
                notification: {
                  title: `${nickname}의 주간 리포트 도착 📊`,
                  body: `이번 주 달성률 ${weekPct}%. 대시보드에서 확인해 보세요!`,
                },
                data: { click_action: '/mentor.html' },
              }).catch(e => console.warn('FCM 전송 실패:', e.message));
            }
          } catch (e) {
            console.error(`mentee ${menteeUid} 리포트 실패:`, e.message);
          }
        }
      } catch (e) {
        console.error(`mentor ${mentorUid} 처리 실패:`, e.message);
      }
    });

    await Promise.allSettled(tasks);
    console.log('autoWeeklyReport 완료');
  }
);

// ─────────────────────────────────────────────────────────────
// 독서 모듈 — Google Custom Search 헬퍼
// ─────────────────────────────────────────────────────────────
async function googleSearch(query, num = 5) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx     = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) { console.warn('Google Search 키 미설정'); return []; }
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${num}&lr=lang_ko&gl=kr`;
    const res  = await fetch(url);
    const data = await res.json();
    return (data.items || []).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
    }));
  } catch (e) {
    console.warn('googleSearch 오류:', e.message);
    return [];
  }
}

function buildSearchContext(results) {
  return results.map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}`).join('\n\n');
}

// ─────────────────────────────────────────────────────────────
// POST /analyzeReading
// Body: { type: 'book'|'passage', imageBase64, uid }
// Response: { chatId, firstMessage, ...bookInfo | passageInfo }
// ─────────────────────────────────────────────────────────────
exports.analyzeReading = onRequest(
  { cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { type, imageBase64, uid } = req.body;
    if (!type || !imageBase64 || !uid) return res.status(400).json({ error: 'type, imageBase64, uid 필요' });

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY 미설정');
      const client = new OpenAI({ apiKey });
      const db     = admin.firestore();
      const imgUrl = `data:image/jpeg;base64,${imageBase64}`;

      // ── 1. GPT-4o Vision 분석 ──────────────────────────
      let visionPrompt, visionData, searchQuery, searchResults, firstMessage, chatData;

      if (type === 'book') {
        visionPrompt = `이 책 표지 이미지를 보고 책 제목과 저자명을 추출해줘.
반드시 JSON 형식으로만 응답해: {"title": "책제목", "author": "저자명"}
제목이나 저자를 알 수 없으면 빈 문자열로 남겨줘.`;

        const visionRes = await client.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 200,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: visionPrompt },
              { type: 'image_url', image_url: { url: imgUrl, detail: 'low' } },
            ],
          }],
        });
        visionData = JSON.parse(visionRes.choices[0].message.content);
        const { title = '', author = '' } = visionData;
        if (!title) return res.status(422).json({ error: '책 제목을 인식하지 못했어요. 다시 찍어봐요.' });

        // ── 2. 웹 서치 ────────────────────────────────────
        searchQuery   = `${title} ${author} 책 줄거리 주제 독후감`;
        searchResults = await googleSearch(searchQuery);

        // ── 3. 첫 메시지 생성 ─────────────────────────────
        const ctx = buildSearchContext(searchResults);
        const sysPrompt = `너는 초중등 학습자의 독서 토론 파트너야.
아래 책 정보를 바탕으로 학습자와 자연스럽게 대화해. 친근한 반말을 써.

책: "${title}" (${author})
검색 정보:
${ctx || '정보 없음'}

첫 인사: 책을 읽은 소감이나 기억에 남는 장면을 물어보는 짧은 인사로 시작해. (2문장 이내)`;

        const firstRes = await client.chat.completions.create({
          model: 'gpt-4o', max_tokens: 150,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: '안녕' },
          ],
        });
        firstMessage = firstRes.choices[0].message.content.trim();

        chatData = {
          type: 'book',
          bookTitle: title, bookAuthor: author,
          searchResults, searchQuery,
          messages: [{ role: 'assistant', content: firstMessage, ts: Date.now() }],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };

        const chatRef = db.collection('users').doc(uid).collection('readingChats').doc();
        await chatRef.set(chatData);
        return res.json({ chatId: chatRef.id, bookTitle: title, bookAuthor: author, searchResults, firstMessage });

      } else if (type === 'passage') {
        visionPrompt = `이 이미지에 있는 글을 읽고 내용을 분석해줘.
반드시 JSON 형식으로만 응답해:
{"text": "글의 전체 내용 요약 (3-5문장)", "keywords": ["핵심개념1", "핵심개념2", "핵심개념3"]}
키워드는 학습 가치가 있는 개념어로 3-5개 뽑아줘.`;

        const visionRes = await client.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: visionPrompt },
              { type: 'image_url', image_url: { url: imgUrl, detail: 'high' } },
            ],
          }],
        });
        visionData = JSON.parse(visionRes.choices[0].message.content);
        const { text = '', keywords = [] } = visionData;
        if (!text && !keywords.length) return res.status(422).json({ error: '글을 인식하지 못했어요. 더 선명하게 찍어봐요.' });

        // ── 2. 웹 서치 (키워드별) ─────────────────────────
        searchQuery   = keywords.slice(0, 3).join(' ') + ' 개념 설명 지식';
        searchResults = await googleSearch(searchQuery);

        // ── 3. 첫 메시지 생성 ─────────────────────────────
        const ctx = buildSearchContext(searchResults);
        const sysPrompt = `너는 호기심을 자극하는 지식 탐구 파트너야.
아래 글과 검색 정보를 바탕으로 학습자와 대화해. 친근한 반말을 써.

글 내용 요약:
${text}

핵심 키워드: ${keywords.join(', ')}

검색된 관련 지식:
${ctx || '정보 없음'}

첫 인사: 글에서 가장 흥미로운 개념 하나를 자연스럽게 꺼내 호기심을 자극해. (2-3문장 이내)`;

        const firstRes = await client.chat.completions.create({
          model: 'gpt-4o', max_tokens: 200,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: '글 올렸어' },
          ],
        });
        firstMessage = firstRes.choices[0].message.content.trim();

        chatData = {
          type: 'passage',
          extractedText: text, keywords,
          searchResults, searchQuery,
          messages: [{ role: 'assistant', content: firstMessage, ts: Date.now() }],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };

        const chatRef = db.collection('users').doc(uid).collection('readingChats').doc();
        await chatRef.set(chatData);
        return res.json({ chatId: chatRef.id, extractedText: text, keywords, searchResults, firstMessage });

      } else {
        return res.status(400).json({ error: 'type은 book 또는 passage만 허용' });
      }

    } catch (err) {
      console.error('analyzeReading error:', err);
      return res.status(500).json({ error: err.message || '분석 중 오류가 발생했어요.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// POST /readingChat
// Body: { chatId, message, uid }
// Response: { reply }
// ─────────────────────────────────────────────────────────────
exports.readingChat = onRequest(
  { cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { chatId, message, uid } = req.body;
    if (!chatId || !message || !uid) return res.status(400).json({ error: 'chatId, message, uid 필요' });

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY 미설정');
      const client = new OpenAI({ apiKey });
      const db     = admin.firestore();

      const chatRef = db.collection('users').doc(uid).collection('readingChats').doc(chatId);
      const chatDoc = await chatRef.get();
      if (!chatDoc.exists) return res.status(404).json({ error: '채팅을 찾을 수 없어요.' });

      const chat = chatDoc.data();
      const ctx  = buildSearchContext(chat.searchResults || []);
      const turnCount = (chat.messages || []).filter(m => m.role === 'user').length;

      // ── 시스템 프롬프트 ───────────────────────────────
      let systemPrompt;
      if (chat.type === 'book') {
        const bloomGuide = turnCount < 3
          ? '내용 확인 단계: 학습자가 말한 것을 더 구체적으로 물어봐. ("그 장면에서 어떤 느낌이었어?")'
          : turnCount < 6
          ? '분석 단계: "왜?"를 중심으로 사고를 확장해. ("그 인물은 왜 그런 선택을 했을까?")'
          : '창의·적용 단계: 책을 넘어 상상력을 자극해. ("결말을 바꾼다면?" "네 삶에 적용한다면?")';

        systemPrompt = `너는 초중등 학습자의 독서 토론 파트너야.

책: "${chat.bookTitle}" (${chat.bookAuthor})

검색된 책 정보 (이것을 바탕으로 정확하게 대화해):
${ctx || '없음'}

[현재 단계] ${bloomGuide}

규칙:
- 친근한 반말 코치 톤: "~해?", "~해봐", "~였어?"
- 한 번에 질문 하나만
- 3-4문장 이내로 짧게
- 학습자가 말한 내용을 적극 활용
- "학생", "학습자" 금지 — "너"로 말해`;

      } else {
        systemPrompt = `너는 호기심을 자극하는 지식 탐구 파트너야.

글 내용 요약:
${chat.extractedText || ''}

핵심 키워드: ${(chat.keywords || []).join(', ')}

검색된 관련 지식 (정확한 정보 제공에 활용해):
${ctx || '없음'}

규칙:
- 친근한 반말 코치 톤
- 글에서 나온 개념을 쉽게 설명하되, 검색 결과 기반으로 정확하게
- 흥미로운 사실을 자연스럽게 제시해 호기심 자극
- 한 번에 질문 하나만
- 3-4문장 이내로 짧게
- "학생", "학습자" 금지 — "너"로 말해`;
      }

      // ── 메시지 히스토리 구성 (최근 20턴만) ───────────
      const history = (chat.messages || []).slice(-20).map(m => ({
        role: m.role, content: m.content,
      }));

      const completion = await client.chat.completions.create({
        model: 'gpt-4o', max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: message },
        ],
      });

      const reply = completion.choices[0].message.content.trim();

      // ── Firestore 저장 ────────────────────────────────
      const updatedMessages = [
        ...(chat.messages || []),
        { role: 'user',      content: message, ts: Date.now() },
        { role: 'assistant', content: reply,   ts: Date.now() },
      ];
      await chatRef.update({ messages: updatedMessages, updatedAt: new Date().toISOString() });

      return res.json({ reply });

    } catch (err) {
      console.error('readingChat error:', err);
      return res.status(500).json({ error: err.message || '오류가 발생했어요.' });
    }
  }
);
