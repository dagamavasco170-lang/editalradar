/** Shared domain contracts. Keep these aligned with the persisted data and API boundaries. */

export type Identifier = string | number;

export type QuestionDifficulty = "Fácil" | "Intermediária" | "Avançada" | string;
export type QuestionOrigin = "authorial" | "exam_import" | "licensed" | string;

export interface QuestionOption {
  label: string;
  value: string;
}

export interface StudyQuestion {
  id: Identifier;
  prompt: string;
  options: QuestionOption[] | Array<[label: string, value: string]>;
  answer?: string | null;
  explanation?: string | null;
  discipline: string;
  topic?: string | null;
  board?: string | null;
  examYear?: number | string | null;
  difficulty?: QuestionDifficulty | null;
  origin?: QuestionOrigin | null;
  sourceUrl?: string | null;
  rightsBasis?: string | null;
  databaseId?: Identifier | null;
}

export interface StudyAttempt {
  questionId: Identifier;
  correct: boolean;
  at?: string | null;
  discipline?: string | null;
  topic?: string | null;
  selectedAnswer?: string | null;
  elapsedMs?: number | null;
}

export interface TopicMastery {
  discipline: string;
  topic: string;
  accuracy: number;
  answered: number;
  correct: number;
  wrong: number;
  due?: boolean;
  questionIds?: Identifier[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Values keyed by topic name, persisted in user_data.concept_mastery. */
export type ConceptMasteryMap = Record<string, number>;

export interface UserDataRecord {
  user_id: string;
  concept_mastery?: ConceptMasteryMap;
  [key: string]: JsonValue | undefined;
}

export interface ContestRecord {
  id: Identifier;
  orgao?: string;
  cargo?: string;
  status?: string;
  estado?: string;
  cidade?: string;
  nivel?: string;
  sourceUrl?: string;
  [key: string]: unknown;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
