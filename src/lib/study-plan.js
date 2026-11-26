export function buildStudySessions(hours, selectedDays, focus = "") {
  const allowed=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
  const days=[...new Set((Array.isArray(selectedDays)?selectedDays:[]).filter(day=>allowed.includes(day)))];
  if(!days.length)throw new Error("Selecione ao menos um dia.");
  const normalizedHours=[5,8,10,15,20].includes(Number(hours))?Number(hours):10;
  const text=String(focus||"").toLowerCase();
  const subjects=/pol[ií]cia|bombeiro|tribunal|procurador/.test(text)
   ? ["Direito Constitucional","Língua Portuguesa","Raciocínio lógico","Direito Administrativo","Informática"]
   : /auditor|controle|fiscal|analista/.test(text)
    ? ["Direito Administrativo","Língua Portuguesa","Direito Constitucional","Raciocínio lógico","Informática"]
    : ["Língua Portuguesa","Direito Constitucional","Raciocínio lógico","Direito Administrativo","Informática"];
  const total=normalizedHours*60,base=Math.floor(total/days.length),extra=total%days.length;
  return days.map((day,index)=>({id:day+"-"+index,day,subject:subjects[index%subjects.length],minutes:base+(index<extra?1:0)}));
}
