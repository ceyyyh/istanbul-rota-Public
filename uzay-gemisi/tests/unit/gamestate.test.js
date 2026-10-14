import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { GameState } from '../../src/core/GameState.js';
import { recordEvents } from './_helpers.js';

function make() {
  const bus = new EventBus();
  return { bus, state: new GameState(bus) };
}

describe('GameState', () => {
  it('get varsayılan değer döndürür; is başlangıçta false', () => {
    const { state } = make();
    expect(state.get('power_restored')).toBeUndefined();
    expect(state.get('power_restored', 'yok')).toBe('yok');
    expect(state.is('power_restored')).toBe(false);
  });

  it('Object.prototype anahtarları bayrak sayılmaz', () => {
    const { state } = make();
    expect(state.get('constructor')).toBeUndefined();
    expect(state.is('toString')).toBe(false);
    expect(state.is('__proto__')).toBe(false);
  });

  it('set varsayılan true; state:changed ve state:<key> yayar', () => {
    const { bus, state } = make();
    const ev = recordEvents(bus, 'state:changed', 'state:power_restored');
    state.set('power_restored');
    expect(state.is('power_restored')).toBe(true);
    expect(state.get('power_restored')).toBe(true);
    expect(ev).toEqual([
      { type: 'state:changed', payload: { key: 'power_restored', value: true, prev: undefined } },
      { type: 'state:power_restored', payload: true },
    ]);
  });

  it('aynı değer tekrar ayarlanırsa olay yayılmaz', () => {
    const { bus, state } = make();
    state.set('a', true);
    const ev = recordEvents(bus, 'state:changed', 'state:a');
    state.set('a', true);
    expect(ev).toHaveLength(0);
  });

  it('true → false geçişi prev ile yayılır', () => {
    const { bus, state } = make();
    state.set('a', true);
    const ev = recordEvents(bus, 'state:changed');
    state.set('a', false);
    expect(ev[0].payload).toEqual({ key: 'a', value: false, prev: true });
    expect(state.is('a')).toBe(false);
  });

  it('sayı/metin değerleri saklanır', () => {
    const { state } = make();
    state.set('humor', 75);
    expect(state.get('humor')).toBe(75);
    expect(state.is('humor')).toBe(true);
    state.set('humor', 0);
    expect(state.is('humor')).toBe(false);
  });

  describe('when', () => {
    it('bayrak zaten doğruysa hemen (senkron) çağırır ve no-op off döner', () => {
      const { state } = make();
      state.set('a', 'evet');
      const fn = vi.fn();
      const off = state.when('a', fn);
      expect(fn).toHaveBeenCalledWith('evet');
      expect(typeof off).toBe('function');
      expect(() => off()).not.toThrow();
    });

    it('bayrak sonra doğru olunca bir kez çağrılır', () => {
      const { state } = make();
      const fn = vi.fn();
      state.when('a', fn);
      expect(fn).not.toHaveBeenCalled();
      state.set('a', true);
      expect(fn).toHaveBeenCalledTimes(1);
      state.set('a', false);
      state.set('a', true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('yanlış (falsy) değerle tetiklenmez', () => {
      const { state } = make();
      const fn = vi.fn();
      state.when('a', fn);
      state.set('a', false);
      state.set('a', 0);
      expect(fn).not.toHaveBeenCalled();
      state.set('a', 2);
      expect(fn).toHaveBeenCalledWith(2);
    });

    it('off ile iptal edilebilir', () => {
      const { state } = make();
      const fn = vi.fn();
      const off = state.when('a', fn);
      off();
      state.set('a');
      expect(fn).not.toHaveBeenCalled();
    });

    it('birden fazla bekleyen when hepsi çağrılır', () => {
      const { state } = make();
      const a = vi.fn();
      const b = vi.fn();
      state.when('x', a);
      state.when('x', b);
      state.set('x');
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('when geri çağrısı içinde başka bayrak ayarlamak zincirleme çalışır', () => {
      const { state } = make();
      const done = vi.fn();
      state.when('power_restored', () => state.set('lights_on'));
      state.when('lights_on', done);
      state.set('power_restored');
      expect(done).toHaveBeenCalledTimes(1);
      expect(state.is('lights_on')).toBe(true);
    });

    it('when geri çağrısı aynı bayrağı tekrar ayarlarsa döngü olmaz', () => {
      const { state } = make();
      const fn = vi.fn(() => state.set('a', true));
      state.when('a', fn);
      state.set('a', true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('geri çağrıdaki hata diğer dinleyicileri durdurmaz', () => {
      const { state } = make();
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ok = vi.fn();
      state.when('a', () => {
        throw new Error('x');
      });
      state.when('a', ok);
      state.set('a');
      expect(ok).toHaveBeenCalled();
      err.mockRestore();
    });
  });
});
