import type { QuestionBankItem } from "../types/question-bank.js";
import { questionBank as legacyQuestionBank } from "./question-bank.js";

export {
  mergeQuestionProgress,
  normalizeQuestionProgress,
  loadQuestionProgress,
  questionProgressStorageKey,
} from "./question-progress.ts";

/** Typed entry point preserving the existing authored/demo dataset at runtime. */
export const questionBank = legacyQuestionBank as QuestionBankItem[];
