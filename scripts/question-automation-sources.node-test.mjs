import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedHost, resolveTrustedRedirect } from "../.github/scripts/question-automation.mjs";

test("aceita as obras de domínio público cadastradas no Wikisource", () => {
  assert.equal(isTrustedHost("https://pt.wikisource.org/wiki/O_Cortiço/I"), true);
  assert.equal(isTrustedHost("https://pt.wikisource.org/wiki/Dom_Casmurro/CXXI"), true);
});

test("mantém o Wikisource limitado aos caminhos literários aprovados", () => {
  assert.equal(isTrustedHost("https://pt.wikisource.org/wiki/Outro_livro"), false);
  assert.equal(isTrustedHost("https://pt.wikisource.org/"), false);
});

test("rejeita HTTP, credenciais na URL, domínios públicos governamentais e Planalto", () => {
  assert.equal(isTrustedHost("http://pt.wikipedia.org/wiki/História"), false);
  assert.equal(isTrustedHost("https://usuario:senha@pt.wikipedia.org/wiki/História"), false);
  assert.equal(isTrustedHost("https://www.gov.br/educacao"), false);
  assert.equal(isTrustedHost("https://www.planalto.gov.br/ccivil_03/"), false);
});

test("valida cada destino de redirecionamento antes do próximo download", () => {
  assert.equal(
    resolveTrustedRedirect("https://pt.wikisource.org/wiki/O_Cortiço/I", "/wiki/O_Cortiço/II"),
    "https://pt.wikisource.org/wiki/O_Cortiço/II"
  );
  assert.throws(
    () => resolveTrustedRedirect("https://pt.wikipedia.org/wiki/Matemática", "http://127.0.0.1:8080/"),
    /domínio não autorizado/
  );
  assert.throws(
    () => resolveTrustedRedirect("https://pt.wikipedia.org/wiki/Matemática", "//169.254.169.254/latest/meta-data/"),
    /domínio não autorizado/
  );
  assert.throws(
    () => resolveTrustedRedirect("https://docs.python.org/3/", "https://attacker.example/"),
    /domínio não autorizado/
  );
});

test("não permite redirecionamento com credenciais embutidas", () => {
  assert.throws(
    () => resolveTrustedRedirect("https://pt.wikipedia.org/wiki/Matemática", "https://user:pass@pt.wikipedia.org/wiki/Matemática"),
    /domínio não autorizado/
  );
});
