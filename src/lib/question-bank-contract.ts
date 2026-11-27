import type { QuestionBankItem, QuestionBankOption } from "../types/question-bank.js";

type QuestionOptionInput = QuestionBankItem["options"][number];

/** Runtime contract for questions entering filters, simulations and study flows. */
export function isQuestionBankItem(value: unknown): value is QuestionBankItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const validOptions = Array.isArray(item.options) && item.options.length >= 2
    && item.options.every((option: unknown) => {
      if (Array.isArray(option)) return option.length >= 2 && typeof option[0] === "string" && typeof option[1] === "string";
      if (typeof option !== "object" || option === null) return false;
      const record = option as Record<string, unknown>;
      return typeof record.label === "string" && typeof record.value === "string";
    });
  return (typeof item.id === "string" || typeof item.id === "number")
    && typeof item.discipline === "string"
    && typeof item.topic === "string"
    && typeof item.board === "string"
    && typeof item.difficulty === "string"
    && typeof item.prompt === "string"
    && item.prompt.trim().length > 0
    && validOptions
    && typeof item.answer === "string"
    && typeof item.explanation === "string"
    && typeof item.origin === "string";
}

/** Convert mixed option formats to a stable label/value representation. */
export function normalizeQuestionOptions(options: QuestionOptionInput[]): QuestionBankOption[] {
  return options.flatMap((option): QuestionBankOption[] => {
    if (Array.isArray(option)) {
      const [label, value] = option;
      return typeof label === "string" && typeof value === "string" ? [{ label, value }] : [];
    }
    return typeof option.label === "string" && typeof option.value === "string"
      ? [{ label: option.label, value: option.value }]
      : [];
  });
}

/** Guard imported or generated question collections without mutating the originals. */
export function normalizeQuestionBank(value: unknown): QuestionBankItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isQuestionBankItem).map((question) => ({
    ...question,
    options: normalizeQuestionOptions(question.options),
  }));
}
