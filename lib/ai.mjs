import { AppError, requireValue } from './errors.mjs';

export function aiStatus(env = process.env) {
  if (env.AI_PROVIDER === 'openrouter' && Boolean(env.OPENROUTER_API_KEY)) return true;
  return env.AI_PROVIDER === 'approved-gateway' && env.AI_GATEWAY_APPROVED_FOR_CHILDREN === 'true' && Boolean(env.AI_GATEWAY_URL && env.AI_GATEWAY_KEY);
}

export async function askAI({ mode, grade, lesson, materials, history = [], message, practiceType='mcq' }, env = process.env) {
  if (!aiStatus(env)) throw new AppError(503, 'The AI tutor is not connected yet. Your study plan and saved practice still work.');

  const context = (materials || []).slice(0, 6).map(m => ({
    title: m.title,
    summary: (m.summary || '').slice(0, 3000),
    text: (m.extracted_text || '').slice(0, 9000)
  }));

  const instructions = `You are Jarvis, a friendly, patient, and highly knowledgeable school tutor for ${grade}.
Use age-appropriate, concise explanations. Ask one question or check at a time. Offer gentle hints before revealing solutions.
Never claim that a chat proves mastery. Stay strictly within the selected lesson: "${lesson.lesson_name}" (${lesson.subject}).
Learning objective: "${lesson.learning_objective || 'Master this topic'}".
Do not request personal information. Use only verified facts and the supplied school materials if available.
${mode === 'quiz'
  ? 'Return ONLY a JSON object (no markdown wrapping) with a "questions" array of exactly 3 questions of the requested practice type: ' + practiceType + '. mcq: choices (2-4 strings), correct_index (zero-based integer). fill_blank: choices=[], expected_answer (array of accepted short strings). short_answer: choices=[], expected_answer (model answer string), rubric (clear parent marking guidance). matching: choices=[], details={left:[2-5 distinct labels],right:[same number of distinct labels]}, expected_answer (array mapping each left label to its zero-based right index; use a permutation).'
  : 'Explain clearly, concisely, and encouragingly. Always end with a single, simple understanding check or question.'
}`;

  let responseText = '';

  if (env.AI_PROVIDER === 'openrouter') {
    const model = env.AI_MODEL || 'openrouter/free';
    const messages = [
      { role: 'system', content: instructions },
      ...(context.length > 0 ? [{ role: 'system', content: 'School materials context:\n' + JSON.stringify(context) }] : []),
      ...history.slice(-10).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message }
    ];

    let resp;
    try {
      resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.APP_ORIGIN || 'https://family-tutor-rep-count.vercel.app',
          'X-Title': 'Family Tutor AI'
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          messages,
          max_tokens: mode === 'quiz' ? 2400 : 1200,
          temperature: 0.4
        })
      });
    } catch {
      throw new AppError(502, 'The tutor could not respond. Please try again. This exchange was not saved.');
    }

    if (!resp.ok) {
      throw new AppError(resp.status === 429 ? 429 : 502, resp.status === 429 ? 'The tutor is busy. Please wait and try again.' : 'The tutor service could not respond. This exchange was not saved.');
    }

    const json = await resp.json();
    responseText = json.choices?.[0]?.message?.content || '';
  } else {
    // Approved gateway
    const endpoint = new URL(env.AI_GATEWAY_URL);
    requireValue(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password, 'The AI connection needs an HTTPS endpoint.', 503);
    let response;
    try {
      response = await fetch(endpoint.href, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.AI_GATEWAY_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(40000),
        body: JSON.stringify({
          model: env.AI_MODEL || undefined,
          mode,
          practice_type: practiceType,
          max_output_tokens: mode === 'quiz' ? 2400 : 1200,
          instructions,
          context: { grade, lesson: { subject: lesson.subject, name: lesson.lesson_name, objective: lesson.learning_objective }, materials: context },
          messages: [...history.slice(-10), { role: 'user', content: message }]
        })
      });
    } catch {
      throw new AppError(502, 'The tutor could not respond. Please try again. This exchange was not saved.');
    }
    if (!response.ok) throw new AppError(response.status === 429 ? 429 : 502, response.status === 429 ? 'The tutor is busy. Please wait and try again.' : 'The tutor service could not respond. This exchange was not saved.');
    const raw = await response.text();
    if (raw.length > 100000) throw new AppError(502, 'The tutor response was too large.');
    let data;
    try { data = JSON.parse(raw); } catch { throw new AppError(502, 'The tutor returned an unreadable response.'); }
    if (mode === 'quiz') {
      const parsed = typeof data.text === 'string' ? parseQuiz(data.text) : data;
      validateQuestions(parsed.questions, practiceType);
      return parsed.questions;
    }
    responseText = data.text || '';
  }

  if (mode === 'quiz') {
    const parsed = parseQuiz(responseText);
    validateQuestions(parsed.questions, practiceType);
    return parsed.questions;
  }

  requireValue(typeof responseText === 'string' && responseText.trim().length > 0 && responseText.length <= 16000, 'The tutor returned an invalid answer.', 502);
  return responseText.trim();
}

function parseQuiz(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```$/m, '').trim();
    const data = JSON.parse(cleaned);
    return data;
  } catch {
    throw new AppError(502, 'The tutor returned an invalid question set. No questions were saved.');
  }
}

export function validateQuestions(questions, requiredKind=null) {
  requireValue(Array.isArray(questions)&&questions.length===3,'The tutor must return three questions.',502);
  for(const q of questions){
    const kind=q.kind||'mcq';q.kind=kind;
    requireValue(['mcq','fill_blank','short_answer','matching'].includes(kind)&&(!requiredKind||kind===requiredKind),'The tutor returned a different question type.',502);
    requireValue(typeof q.prompt==='string'&&q.prompt.trim()&&q.prompt.length<=4000&&typeof q.explanation==='string'&&q.explanation.trim()&&q.explanation.length<=8000,'The tutor returned an invalid question.',502);
    if(kind==='mcq')requireValue(Array.isArray(q.choices)&&q.choices.length>=2&&q.choices.length<=4&&q.choices.every(c=>typeof c==='string'&&c.trim()&&c.length<=1000)&&new Set(q.choices.map(c=>c.trim().toLowerCase())).size===q.choices.length&&Number.isInteger(q.correct_index)&&q.correct_index>=0&&q.correct_index<q.choices.length,'Invalid multiple-choice answer key.',502);
    else {q.choices=[];q.correct_index=null;}
    if(kind==='fill_blank')requireValue(Array.isArray(q.expected_answer)&&q.expected_answer.length>=1&&q.expected_answer.length<=10&&q.expected_answer.every(a=>typeof a==='string'&&a.trim()&&a.length<=2000),'Invalid accepted answers.',502);
    if(kind==='short_answer')requireValue(typeof q.expected_answer==='string'&&q.expected_answer.trim()&&q.expected_answer.length<=8000&&typeof q.rubric==='string'&&q.rubric.trim()&&q.rubric.length<=4000,'Short answers need a model answer and parent rubric.',502);
    if(kind==='matching'){const left=q.details?.left,right=q.details?.right,key=q.expected_answer;requireValue(Array.isArray(left)&&Array.isArray(right)&&left.length>=2&&left.length<=5&&right.length===left.length&&[...left,...right].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)&&new Set(left).size===left.length&&new Set(right).size===right.length&&Array.isArray(key)&&key.length===left.length&&key.every(v=>Number.isInteger(v)&&v>=0&&v<right.length)&&new Set(key).size===key.length,'Invalid matching question or key.',502);}
  }
}

export async function geminiAdultDevelopmentTest(prompt, env = process.env) {
  requireValue(env.GEMINI_API_KEY && env.GEMINI_MODEL, 'Configure the Gemini development credentials privately.', 503);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new AppError(502, 'Gemini development request failed.');
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}
