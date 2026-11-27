import type { Identifier, QuestionDifficulty, QuestionOrigin } from "./domain.js";

/** Canonical question model shared by question-bank, filters and study sessions. */
export interface QuestionBankOption {
  label: string;
  value: string;
}

export interface QuestionBankItem {
  id: Identifier;
  discipline: string;
  topic: string;
  board: string;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: QuestionBankOption[] | Array<[label: string, value: string]>;
  answer: string;
  explanation: string;
  origin: QuestionOrigin;
  examYear?: number | string | null;
  sourceUrl?: string | null;
  rightsBasis?: string | null;
}

export interface QuestionAttemptRecord {
  id?: string;
  questionId: string;
  answer: string;
  correct: boolean;
  at?: string;
  [key: string]: unknown;
}

export interface QuestionSimulationRecord {
  id: string;
  questionIds: string[];
  correct: number;
  total: number;
  [key: string]: unknown;
}

export interface QuestionProgressRecord {
  attempts: QuestionAttemptRecord[];
  saved: string[];
  simulations: QuestionSimulationRecord[];
}

export interface QuestionProgressInput {
  attempts?: unknown;
  saved?: unknown;
  simulations?: unknown;
}
