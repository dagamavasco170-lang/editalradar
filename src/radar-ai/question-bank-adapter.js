/** Canonical adapter for the local and licensed EditalRadar question banks. */
const normalizeKey = (value) => String(value ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function optionData(options) {
 if (!Array.isArray(options)) return [];
 return options.map((item,index)=>{
  if (Array.isArray(item)) return {text:String(item[0]??"").trim(), key:String(item[1]??index).trim()};
  if (item && typeof item==="object") return {text:String(item.label??item.text??item.value??"").trim(),key:String(item.key??item.id??index).trim()};
  return {text:String(item??"").trim(),key:String(index)};
 }).filter(o=>o.text);
}
function answerIndex(record, options) {
 const raw=record.answer??record.correctAnswer??record.correctIndex;
 if(Number.isInteger(raw)) return raw;
 if(raw===null||raw===undefined) return null;
 const answer=String(raw).trim().toLowerCase();
 const exact=options.findIndex(o=>o.key.toLowerCase()===answer||o.text.toLowerCase()===answer);
 if(exact>=0) return exact;
 if(/^[a-f]$/.test(answer)) return answer.charCodeAt(0)-97;
 return null;
}
export function adaptQuestionRecord(record) {
 if(!record||typeof record!=="object"||Array.isArray(record)) return {valid:false,errors:["record-must-be-object"]};
 const mappedOptions=optionData(record.options), options=mappedOptions.map(o=>o.text), index=answerIndex(record,mappedOptions);
 const sourceUrl=record.source_url??record.sourceUrl??record.references?.[0]?.url??null;
 const question={id:String(record.id??"").trim(),subject:String(record.discipline??record.subject??"").trim(),subjectKey:normalizeKey(record.discipline??record.subject),topic:String(record.topic??"").trim(),topicKey:normalizeKey(record.topic),statement:String(record.prompt??record.statement??"").trim(),options,answerIndex:index,answer:index===null?null:options[index],explanation:String(record.explanation??"").trim(),board:String(record.board??record.examBoard??"unspecified").trim(),examName:String(record.exam_name??record.examName??"").trim(),examYear:Number(record.exam_year??record.examYear)||null,difficulty:String(record.difficulty??"unrated").trim(),origin:String(record.origin??"local").trim(),published:record.published===true,licenseStatus:record.license_status??record.licenseStatus??null,licenseProofUrl:record.license_proof_url??record.licenseProofUrl??null,rightsHolder:record.rights_holder??record.rightsHolder??null,sourceUrl,sourceReferences:sourceUrl?[{title:record.exam_name??record.examName??"Fonte da questão",url:sourceUrl}]:[]};
 const errors=[];
 if(!question.id) errors.push("missing-id");
 if(!question.subject) errors.push("missing-subject");
 if(!question.topic) errors.push("missing-topic");
 if(question.statement.length<10) errors.push("statement-too-short");
 if(options.length<2) errors.push("options-required");
 if(index===null||index<0||index>=options.length) errors.push("answer-not-mappable");
 if(sourceUrl&&!/^https:\/\//i.test(sourceUrl)) errors.push("source-url-must-be-https");
 return {valid:errors.length===0,errors,question};
}
const LICENSED=new Set(["permission_granted","public_domain","cc_by","cc_by_sa"]);
const isRightsCleared=(row)=>row?.license_status==="public_domain"||(LICENSED.has(row?.license_status)&&typeof row?.license_proof_url==="string"&&/^https:\/\//i.test(row.license_proof_url));
export async function fetchLicensedQuestionBank(supabase,{limit=1000,offset=0,discipline,board,topic}={}) {
 if(!supabase?.from) throw new TypeError("Supabase client is required");
 const safeLimit=Math.max(1,Math.min(2000,Math.floor(Number(limit)||1000))),safeOffset=Math.max(0,Math.floor(Number(offset)||0));
 let query=supabase.from("study_questions").select("id,discipline,topic,difficulty,board,exam_name,exam_year,prompt,options,answer,explanation,source_url,rights_holder,license_status,license_proof_url,published,origin").eq("published",true).in("license_status",[...LICENSED]).order("discipline",{ascending:true}).range(safeOffset,safeOffset+safeLimit-1);
 if(discipline) query=query.eq("discipline",discipline); if(board) query=query.eq("board",board); if(topic) query=query.eq("topic",topic);
 const {data,error}=await query;if(error) throw error;
 const questions=[],rejected=[];
 for(const row of data??[]){
  if(!isRightsCleared(row)){rejected.push({id:row?.id??null,errors:["license-proof-required"]});continue;}
  const result=adaptQuestionRecord(row);if(result.valid) questions.push(result.question);else rejected.push({id:row?.id??null,errors:result.errors});
 }
 return {questions,rejected,fetched:(data??[]).length,offset:safeOffset,limit:safeLimit};
}
export function adaptLocalQuestionBank(records=[]) {
 const questions=[],rejected=[];
 for(const row of records){const result=adaptQuestionRecord(row);if(result.valid) questions.push(result.question);else rejected.push({id:row?.id??null,errors:result.errors});}
 return {questions,rejected,total:questions.length};
}
