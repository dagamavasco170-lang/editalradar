import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SimulatorPanel from "./SimulatorPanel.jsx";
import { clearActiveSimulation } from "./lib/simulator-progress.js";

afterEach(() => {
  cleanup();
  clearActiveSimulation(null);
  localStorage.clear();
});

function generatedBank() {
  return Array.from({length:20},(_,index)=>({
    id:"generated-"+(index+1),databaseId:1000+index,origin:"generated",
    discipline:"Direito Constitucional",topic:"Princípios fundamentais",difficulty:"Intermediária",
    board:"EditalRadar",prompt:"Enunciado da questão "+(index+1),
    options:[["A. Alternativa A","a"],["B. Alternativa B","b"],["C. Alternativa C","c"],["D. Alternativa D","d"]]
  }));
}

describe("simulados com questões adicionais do banco",()=>{
  it("corrige questões armazenadas usando a função segura do Supabase",async()=>{
    const questions=generatedBank();
    const authClient={rpc:vi.fn(async(_name,args)=>({
      data:{correct:args.p_selected_answer==="b",explanation:"Fundamentação recuperada com segurança."},error:null
    }))};
    const onComplete=vi.fn();
    render(<SimulatorPanel questionBank={questions} authClient={authClient} userId="user-1" onComplete={onComplete}/>);

    fireEvent.click(screen.getByRole("button",{name:"Iniciar simulado"}));
    fireEvent.click(screen.getByRole("button",{name:"B. Alternativa B"}));
    fireEvent.click(screen.getByRole("button",{name:"Finalizar e corrigir"}));
    fireEvent.click(screen.getByRole("button",{name:"Finalizar mesmo assim"}));

    await screen.findByText("1 de 20 acertos");
    await waitFor(()=>expect(onComplete).toHaveBeenCalledTimes(1));
    const summary=onComplete.mock.calls[0][0];
    expect(summary.correct).toBe(1);
    expect(summary.total).toBe(20);
    expect(summary.review.some(item=>item.selected==="b"&&item.correct)).toBe(true);
    expect(authClient.rpc).toHaveBeenCalledWith("check_study_question_answer",expect.objectContaining({
      p_selected_answer:"b"
    }));
  });

  it("mantém a prova aberta e permite tentar novamente se a correção segura falhar",async()=>{
    const questions=generatedBank();
    const authClient={rpc:vi.fn(async()=>({data:null,error:{message:"Falha de conexão"}}))};
    render(<SimulatorPanel questionBank={questions} authClient={authClient} userId="user-2"/>);

    fireEvent.click(screen.getByRole("button",{name:"Iniciar simulado"}));
    fireEvent.click(screen.getByRole("button",{name:"B. Alternativa B"}));
    fireEvent.click(screen.getByRole("button",{name:"Finalizar e corrigir"}));
    fireEvent.click(screen.getByRole("button",{name:"Finalizar mesmo assim"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível corrigir o simulado. Confira sua conexão e tente novamente.");
    expect(screen.getByRole("button",{name:"Tentar corrigir novamente"})).toBeInTheDocument();
  });
});
