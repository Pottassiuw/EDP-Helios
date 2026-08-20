export interface FuncaoComDebounce<Argumentos extends unknown[]> {
  chamar: (...argumentos: Argumentos) => void;
  cancelar: () => void;
}

export function criarFuncaoComDebounce<Argumentos extends unknown[]>(
  funcao: (...argumentos: Argumentos) => void,
  atrasoMs: number,
): FuncaoComDebounce<Argumentos> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  function cancelar(): void {
    if (temporizador !== undefined) clearTimeout(temporizador);
    temporizador = undefined;
  }

  function chamar(...argumentos: Argumentos): void {
    cancelar();
    temporizador = setTimeout(() => {
      temporizador = undefined;
      funcao(...argumentos);
    }, atrasoMs);
  }

  return { chamar, cancelar };
}
