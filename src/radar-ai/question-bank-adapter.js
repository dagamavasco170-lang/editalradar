/** Adapter for the existing EditalRadar study_questions table and local bank schema. */
const normalizeKey = (value) => String(value ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normalizeOptions = (options) => {
  if (Array.isArray(options)) return options.map((option) => {
    if (Array.isArray(option)) return String(option[0] ?? "");
    if (option && typeof option === "object") return String(option.label ?? option.text ?? option.value ?? "");
    return String(option ?? "");
  }).filter(Boolean);
};
const normalizeAnswerIndex = (question, options) => {
  const raw = question.answer ?? question.correctAnswer ?? question.correctIndex;
  if (Number.isInteger(raw)) return raw;
  if (raw === null || raw === undefined) return null;
  const answer = String(raw).trim().toLowerCase();
  const direct = options.findIndex((option) => option.trim().toLowerCase() === answer);
  if (direct >= 0) return direct;
  if (/^[a-f]$/.test(answer)) return answer.charCodeAt(0) - 97;
  return null;
};

/** Map database/local question shapes to a stable Radar AI contract. */
export function adaptQuestionRecord(record) {
  if (!record || typeof record !== "object") return { valid: false, errors: ["record-must-be-object"] };
  const options = normalizeOptions(record.options);
  const answerIndex = normalizeAnswerIndex(record, options);
  const sourceUrl = record.source_url ?? record.sourceUrl ?? record.references?.[0]?.url ?? null;
  const adapted = {
    id: String(record.id ?? "").trim(),
    subject: String(record.discipline ?? record.subject ?? "").trim(),
    subjectKey: normalizeKey(record.discipline ?? record.subject),
    topic: String(record.topic ?? "").trim(),
    topicKey: normalizeKey(record.topic),
    statement: String(record.prompt ?? record.statement ?? "").trim(),
    options,
    answerIndex,
    answer: answerIndex === null ? null : options[answerIndex],
    explanation: String(record.explanation ?? "").trim(),
    board: String(record.board ?? record.examBoard ?? "unspecified").trim(),
    examName: String(record.exam_name ?? record.examName ?? "").trim(),
    examYear: Number(record.exam_year ?? record.examYear) || null,
    difficulty: String(record.difficulty ?? "unrated").trim(),
    origin: String(record.origin ?? "local").trim(),
    published: record.published === true,
    licenseStatus: record.license_status ?? record.licenseStatus ?? null,
    sourceUrl,
    sourceReferences: sourceUrl ? [{ title: adaptedTitle(record), url: sourceUrl }] : [],
  };
  const errors = [];
  if (!adapted.id) errors.push("missing-id");
  if (!adapted.subject) errors.push("missing-subject");
  if (!adapted.topic) errors.push("missing-topic");
  if (adapted.statement.length < 10) errors.push("statement-too-short");
  if (options.length < 2) errors.push("options-required");
  if (answerIndex === null || answerIndex < 0 || answerIndex >= options.length) errors.push("answer-not-mappable");
  if (sourceUrl && !/^https:\\/\\//i.test(sourceUrl)) errors.push("source-url-must-be-https");
  return { valid: errors.length === 0, errors, question: adapted };
}
function adaptedTitle(record) { return record.exam_name || record.examName || "Fonte da questão"; }

/** Load only questions that are published and meet the schema's public license gate. */
export async function fetchLicensedQuestionBank(supabase, { limit = 1000, offset = 0, discipline, board, topic } = {}) {
  if (!supabase?.from) throw new TypeError("Supabase client is required");
  const safeLimit = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 1000)));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  let query = supabase.from("study_questions")
    .select("id,discipline,topic,difficulty,board,exam_name,exam_year,prompt,options,answer,explanation,source_url,license_status,license_proof_url,published,origin")
    .eq("published", true)
    .in("license_status", ["permission_granted", "public_domain", "cc_by", "cc_by_sa"])
    .order("discipline", { ascending: true })
    .range(safeOffset, safeOffset + safeLimit - 1);
  if (discipline) query = query.eq("discipline", discipline);
  if (board) query = query.eq("board", board);
  if (topic) query = query.eq("topic", topic);
  const { data, error } = await query;
  if (error) throw error;
  const accepted = [];
  const rejected = [];
  for (const row of data ?? []) {
    const result = adaptQuestionRecord(row);
    if (result.valid) accepted.push(result.question);
    else rejected.push({ id: row?.id ?? null, errors: result.errors });
  }
  return { questions: accepted, rejected, fetched: (data ?? []).length, offset: safeOffset, limit: safeLimit };
}

/** Transform local bank tuples and licensed DB records into the same analysis-friendly fields. */
export function adaptLocalQuestionBank(questions = []) {
  const accepted = [];
  const rejected = [];
  for (const question of questions) {
    const result = adaptQuestionRecord(question);
    if (result.valid) accepted.push(result.question);
    else rejected.push({ id: question?.id ?? null, errors: result.errors });
  }
  return { questions: accepted, rejected, total: accepted.length };
}
