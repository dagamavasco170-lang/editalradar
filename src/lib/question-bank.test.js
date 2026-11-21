import { beforeEach, describe, expect, it } from "vitest";
import {
  loadQuestionProgress,
  mergeQuestionProgress,
  normalizeQuestionProgress,
  questionBank,
  questionProgressStorageKey
} from "./question-bank.js";

describe("banco de questões e progresso", () => {
  beforeEach(() => localStorage.clear());

  it("mantém 80 questões autorais únicas em cinco disciplinas", () => {
    expect(questionBank).toHaveLength(80);
    expect(new Set(questionBank.map(question => question.id)).size).toBe(80);
    expect(new Set(questionBank.map(question => question.discipline))).toEqual(new Set([
      "Língua Portuguesa","Raciocínio lógico","Direito Constitucional","Direito Administrativo","Informática"
    ]));
    expect(questionBank.every(question =>
      question.origin === "authorial" && question.prompt && question.topic
      && question.board && question.options.length >= 2
      && question.options.some(([, key]) => key === question.answer)
      && question.explanation
    )).toBe(true);
  });

  it("separa histórico, caderno de erros e simulados por usuário", () => {
    expect(questionProgressStorageKey(null)).toBe("er-question-progress:visitor");
    expect(questionProgressStorageKey("user-1")).toBe("er-question-progress:user-1");
    localStorage.setItem(questionProgressStorageKey("user-1"), JSON.stringify({
      attempts: [{ questionId:"p1", answer:"certo", correct:true }],
      saved: ["p1"],
      simulations: [{ id:"sim-1", questionIds:["p1"], correct:1, total:1 }]
    }));
    expect(loadQuestionProgress("user-1").saved).toEqual(["p1"]);
    expect(loadQuestionProgress("user-1").simulations).toHaveLength(1);
    expect(loadQuestionProgress("user-2")).toEqual({ attempts:[], saved:[], simulations:[] });
  });

  it("normaliza dados inválidos, duplicidades e limita o histórico", () => {
    const normalized = normalizeQuestionProgress({
      attempts: [
        null,
        { questionId:"p1", answer:"certo", correct:true },
        { questionId:2, answer:"a", correct:true },
        { questionId:"p2", answer:"b", correct:"sim" }
      ],
      saved: ["p1","p1",3,"p2"],
      simulations: [
        { id:"ok", questionIds:["p1"], correct:1, total:1 },
        { questionIds:["p2"], correct:0, total:1 }
      ]
    });
    expect(normalized.attempts).toHaveLength(1);
    expect(normalized.saved).toEqual(["p1","p2"]);
    expect(normalized.simulations).toHaveLength(1);
    expect(normalizeQuestionProgress(null)).toEqual({ attempts:[], saved:[], simulations:[] });
    expect(normalizeQuestionProgress({
      attempts:Array.from({length:520},(_,i)=>({questionId:"q"+i,answer:"a",correct:true})),
      simulations:Array.from({length:120},(_,i)=>({id:"s"+i,questionIds:[],correct:0,total:0}))
    }).attempts).toHaveLength(500);
    expect(normalizeQuestionProgress({
      simulations:Array.from({length:120},(_,i)=>({id:"s"+i,questionIds:[],correct:0,total:0}))
    }).simulations).toHaveLength(100);
  });

  it("recupera JSON inválido e sincroniza histórico local e remoto sem duplicar tentativas", () => {
    localStorage.setItem(questionProgressStorageKey("broken"), "{");
    expect(loadQuestionProgress("broken")).toEqual({ attempts:[], saved:[], simulations:[] });
    const merged=mergeQuestionProgress(
      { attempts:[{questionId:"p1",answer:"a",correct:false,at:"2026-01-01"}], saved:["p1"] },
      { attempts:[{questionId:"p1",answer:"b",correct:true,at:"2026-01-02"},{questionId:"p2",answer:"c",correct:true,at:"2026-01-03"}], saved:["p2"], simulations:[{id:"s1",questionIds:["p2"],correct:1,total:1}] }
    );
    expect(merged.attempts).toHaveLength(2);
    expect(merged.attempts.find(item=>item.questionId==="p1").correct).toBe(true);
    expect(merged.saved).toEqual(["p1","p2"]);
    expect(merged.simulations).toHaveLength(1);
  });
});
