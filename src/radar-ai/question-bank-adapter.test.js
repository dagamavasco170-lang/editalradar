import {describe,it,expect,vi} from "vitest";
import {adaptQuestionRecord,adaptLocalQuestionBank,fetchLicensedQuestionBank} from "./question-bank-adapter.js";
const sample={id:"q1",discipline:"Direito Administrativo",topic:"Legalidade",prompt:"Enunciado suficientemente longo para uso como questão de prova.",options:[["Certo","certo"],["Errado","errado"]],answer:"certo",explanation:"Explicação válida e objetiva.",source_url:"https://example.org/q",published:true,license_status:"permission_granted",license_proof_url:"https://example.org/license"};
describe("question bank adapter",()=>{
 it("maps tuple keys/display and answers",()=>{const r=adaptQuestionRecord(sample);expect(r.valid).toBe(true);expect(r.question.answerIndex).toBe(0);expect(r.question.options).toEqual(["Certo","Errado"]);});
 it("maps answer by tuple key even if order is changed",()=>{const r=adaptQuestionRecord({...sample,options:[["Errado","e"],["Certo","c"]],answer:"c"});expect(r.question.answerIndex).toBe(1);});
 it("rejects invalid and missing rights/source information",()=>{expect(adaptQuestionRecord({...sample,answer:"missing",source_url:"http://x"}).errors).toEqual(expect.arrayContaining(["answer-not-mappable","source-url-must-be-https"]));});
 it("normalizes local records and rejection reporting",()=>{expect(adaptLocalQuestionBank([sample,{id:"bad"}]).total).toBe(1);});
 it("requires license proof except public domain before accepting DB rows",async()=>{
  const rows=[sample,{...sample,id:"q2",license_proof_url:null},{...sample,id:"q3",license_status:"public_domain",license_proof_url:null}];
  const chain={};for(const m of ["select","eq","in","order","range"]) chain[m]=vi.fn(()=>chain);chain.then=(resolve)=>Promise.resolve({data:rows,error:null}).then(resolve);
  const result=await fetchLicensedQuestionBank({from:vi.fn(()=>chain)});
  expect(result.questions).toHaveLength(2);expect(result.rejected).toContainEqual({id:"q2",errors:["license-proof-required"]});
 });
});
