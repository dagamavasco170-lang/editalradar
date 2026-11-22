import { describe, expect, it } from "vitest";
import { extractReadableSourceText, htmlToReadableText } from "./source-utils.ts";

describe("Extração automática de material aberto e licenciado", () => {
  it("remove scripts, estilos, menu e tags, preservando o conteúdo principal", () => {
    const html = "<html><nav>Menu</nav><main><h1>Edital</h1><p>O órgão publicou o edital com cento e vinte vagas.</p><script>malicious()</script><p>As inscrições ocorrerão no período previsto.</p></main><footer>Rodapé</footer></html>";
    const text = htmlToReadableText(html);
    expect(text).toContain("Edital");
    expect(text).toContain("cento e vinte vagas");
    expect(text).not.toContain("Menu");
    expect(text).not.toContain("Rodapé");
    expect(text).not.toContain("malicious");
  });

  it("remove blocos de código de exemplos com licença separada", () => {
    const html = "<main><p>O texto explicativo deve ser aproveitado para elaborar a questão.</p><pre>const segredo = 'não usar';</pre></main>";
    const text = htmlToReadableText(html);
    expect(text).toContain("texto explicativo");
    expect(text).not.toContain("const segredo");
  });

  it("decodifica entidades HTML e números", () => {
    const text = htmlToReadableText("<p>Direito &amp; Administração &#xE9; pública.</p>");
    expect(text).toContain("Direito & Administração é pública.");
  });

  it("aceita texto plano e remove excesso de espaços", () => {
    expect(extractReadableSourceText("text/plain; charset=utf-8", "Lei   federal\n\n   vigente")).toBe("Lei federal vigente");
  });

  it("rejeita PDFs e tipos desconhecidos para uso de texto automático", () => {
    expect(() => extractReadableSourceText("application/pdf", "bytes")).toThrow(/PDF/);
    expect(() => extractReadableSourceText("application/octet-stream", "content")).toThrow(/não suportado/);
  });
});
