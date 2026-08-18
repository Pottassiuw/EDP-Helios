import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarFuncaoComDebounce } from './debounce';

describe('criarFuncaoComDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não chama a função imediatamente', () => {
    const fn = vi.fn();
    const { chamar } = criarFuncaoComDebounce(fn, 300);

    chamar('a');

    expect(fn).not.toHaveBeenCalled();
  });

  it('chama a função uma vez após o atraso configurado', () => {
    const fn = vi.fn();
    const { chamar } = criarFuncaoComDebounce(fn, 300);

    chamar('a');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('reinicia o atraso a cada nova chamada, usando só os argumentos da última', () => {
    const fn = vi.fn();
    const { chamar } = criarFuncaoComDebounce(fn, 300);

    chamar('a');
    vi.advanceTimersByTime(200);
    chamar('b');
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('cancelar() impede a chamada pendente de executar', () => {
    const fn = vi.fn();
    const { chamar, cancelar } = criarFuncaoComDebounce(fn, 300);

    chamar('a');
    cancelar();
    vi.advanceTimersByTime(300);

    expect(fn).not.toHaveBeenCalled();
  });
});
