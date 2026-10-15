import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';

describe('EventBus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('on → emit yükü iletir; dönen off dinleyiciyi kaldırır', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    bus.emit('a', { x: 1 });
    expect(fn).toHaveBeenCalledWith({ x: 1 });
    off();
    bus.emit('a', { x: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dinleyiciler kayıt sırasıyla çağrılır', () => {
    const bus = new EventBus();
    const order = [];
    bus.on('a', () => order.push(1));
    bus.on('a', () => order.push(2));
    bus.on('a', () => order.push(3));
    bus.emit('a');
    expect(order).toEqual([1, 2, 3]);
  });

  it('once yalnızca bir kez çağrılır; dönen off emit öncesi iptal eder', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.once('a', fn);
    bus.emit('a', 1);
    bus.emit('a', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);

    const fn2 = vi.fn();
    const off = bus.once('b', fn2);
    off();
    bus.emit('b');
    expect(fn2).not.toHaveBeenCalled();
  });

  it('once içinde aynı olay yeniden yayılırsa sonsuz döngü olmaz', () => {
    const bus = new EventBus();
    const fn = vi.fn(() => bus.emit('a'));
    bus.once('a', fn);
    bus.emit('a');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('bir dinleyicideki hata diğerlerini durdurmaz ve console.error ile raporlanır', () => {
    const bus = new EventBus();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    bus.on('x', () => {
      throw new Error('bozuk');
    });
    bus.on('x', after);
    expect(() => bus.emit('x', 5)).not.toThrow();
    expect(after).toHaveBeenCalledWith(5);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('"x"');
  });

  it('dinleyicisi olmayan olay ve bilinmeyen off sessizce geçer', () => {
    const bus = new EventBus();
    expect(() => bus.emit('yok', 1)).not.toThrow();
    expect(() => bus.off('yok', () => {})).not.toThrow();
  });

  it('aynı fonksiyon iki kez eklenirse bir kez çağrılır (Set)', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('a', fn);
    bus.on('a', fn);
    bus.emit('a');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emit sırasında eklenen dinleyici o yayında çağrılmaz, sonrakinde çağrılır', () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.on('a', () => bus.on('a', late));
    bus.emit('a');
    expect(late).not.toHaveBeenCalled();
    bus.emit('a');
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('emit sırasında kendini kaldıran dinleyici diğerlerini atlatmaz', () => {
    const bus = new EventBus();
    const calls = [];
    const offA = bus.on('a', () => {
      calls.push('A');
      offA();
    });
    bus.on('a', () => calls.push('B'));
    bus.emit('a');
    bus.emit('a');
    expect(calls).toEqual(['A', 'B', 'B']);
  });

  it('olay türleri birbirinden bağımsız', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('state:a', a);
    bus.on('state:b', b);
    bus.emit('state:a', true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
