const { onRequest } = require('firebase-functions/v2/https');
const OpenAI = require('openai');

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
    timeoutSeconds: 60,
    memory: '256MiB',
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
