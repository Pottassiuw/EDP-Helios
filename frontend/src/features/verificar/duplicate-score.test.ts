import { describe, expect, it } from "vitest";

import { calculateDuplicateScore } from "./duplicate-score";

describe("calculateDuplicateScore", () => {
  it("classifica registros iguais como forte com todos os pesos cobertos", () => {
    const result = calculateDuplicateScore(
      {
        problema: "  Lâmpada apagada ",
        local_instalacao: "ABCDE123",
        poste: " P-01 ",
        referencia: "Em frente ao mercado",
        referencia_eletrica: " FF-655816 ",
      },
      {
        problema: "lâmpada apagada",
        local_instalacao: "abcde123",
        poste: "p-01",
        referencia: "EM FRENTE AO MERCADO",
        referencia_eletrica: "ff-655816",
      },
    );

    expect(result).toMatchObject({
      score: 1,
      cobertura: 1,
      matches: 5,
      pesoElegivel: 8,
      pesoMatches: 8,
      faixa: "forte",
      campos: {
        problema: { indicador: "match", peso: 2, pesoEfetivo: 2, erroOrigem: false, erroCandidata: false },
        local_instalacao: { indicador: "match", peso: 1.6, pesoEfetivo: 1.6 },
        poste: { indicador: "match", peso: 1.3, pesoEfetivo: 1.3 },
        referencia: { indicador: "match", peso: 1.1, pesoEfetivo: 1.1 },
        referencia_eletrica: { indicador: "match", peso: 2, pesoEfetivo: 2 },
      },
    });
  });

  it("não pontua um problema diferente, mas mantém sua cobertura", () => {
    const result = calculateDuplicateScore(
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: "P", referencia: "R" },
      { problema: "Lâmpada acesa", local_instalacao: "A", poste: "P", referencia: "R" },
    );

    expect(result).toMatchObject({
      score: 4 / 6,
      cobertura: 6 / 8,
      matches: 3,
      pesoElegivel: 6,
      pesoMatches: 4,
      faixa: "possivel",
      campos: { problema: { indicador: "diferente", pesoEfetivo: 2 } },
    });
  });

  it("reduz para um o peso efetivo de problema com erro em qualquer lado", () => {
    const result = calculateDuplicateScore(
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: "P", referencia: "R" },
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: "P", referencia: "R" },
      ["problema"],
    );

    expect(result).toMatchObject({
      score: 1,
      cobertura: 5 / 8,
      pesoElegivel: 5,
      pesoMatches: 5,
      faixa: "forte",
      campos: { problema: { peso: 2, pesoEfetivo: 1, erroOrigem: true, erroCandidata: false } },
    });
  });

  it("torna campo desconhecido indisponível fora do denominador", () => {
    const result = calculateDuplicateScore(
      { problema: "desconhecido", local_instalacao: "A", poste: "P", referencia: "R" },
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: "P", referencia: "R" },
    );

    expect(result).toMatchObject({
      score: 1,
      cobertura: 4 / 8,
      matches: 3,
      pesoElegivel: 4,
      pesoMatches: 4,
      faixa: "insuficiente",
      campos: { problema: { indicador: "indisponivel", pesoEfetivo: 0 } },
    });
  });

  it("usa somente poste quando é o único campo elegível", () => {
    const result = calculateDuplicateScore(
      { problema: "", local_instalacao: "desconhecido", poste: " P-01 ", referencia: "" },
      { problema: "desconhecido", local_instalacao: "", poste: "p-01", referencia: "desconhecido" },
    );

    expect(result).toMatchObject({
      score: 1,
      cobertura: 1.3 / 8,
      matches: 1,
      pesoElegivel: 1.3,
      pesoMatches: 1.3,
      faixa: "insuficiente",
      campos: { poste: { indicador: "match", pesoEfetivo: 1.3 } },
    });
  });

  it("retorna score nulo quando todos os campos são indisponíveis", () => {
    const result = calculateDuplicateScore(
      { problema: "", local_instalacao: "desconhecido", poste: "", referencia: "desconhecido" },
      { problema: "desconhecido", local_instalacao: "", poste: "desconhecido", referencia: "" },
    );

    expect(result).toMatchObject({
      score: null,
      cobertura: 0,
      matches: 0,
      pesoElegivel: 0,
      pesoMatches: 0,
      faixa: "insuficiente",
    });
  });

  it("trata null externo como indisponível, sem quebrar o card", () => {
    const result = calculateDuplicateScore(
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: null, referencia: "R" },
      { problema: "Lâmpada apagada", local_instalacao: "A", poste: "P", referencia: "R" },
    );

    expect(result).toMatchObject({
      score: 1,
      cobertura: 4.7 / 8,
      matches: 3,
      campos: { poste: { indicador: "indisponivel", pesoEfetivo: 0 } },
    });
  });

  it("ignora sentinelas indisponiveis sem produzir mismatch", () => {
    const result = calculateDuplicateScore(
      { problema: " - ", local_instalacao: "N/A", poste: " nan ", referencia: "None" },
      { problema: "desconhecido", local_instalacao: "—", poste: "", referencia: " n/a " },
    );

    expect(result).toMatchObject({
      score: null,
      cobertura: 0,
      matches: 0,
      campos: {
        problema: { indicador: "indisponivel" },
        local_instalacao: { indicador: "indisponivel" },
        poste: { indicador: "indisponivel" },
        referencia: { indicador: "indisponivel" },
      },
    });
  });
});
