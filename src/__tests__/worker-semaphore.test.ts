import { describe, it, expect } from 'vitest';
import { Semaphore } from '../../codeswarm-service/packages/worker/dist/semaphore.js';

describe('Semaphore 5并发控制', () => {
  it('初始状态 available=5', () => {
    const sem = new Semaphore(5);
    expect(sem.available).toBe(5);
  });

  it('max 必须 >0，否则抛错', () => {
    expect(() => new Semaphore(0)).toThrow('Semaphore max must be positive');
    expect(() => new Semaphore(-1)).toThrow('Semaphore max must be positive');
  });

  it('tryAcquire 逐个消耗直到0，然后返回 false', () => {
    const sem = new Semaphore(5);
    for (let i = 0; i < 5; i++) {
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.available).toBe(5 - i - 1);
    }
    expect(sem.available).toBe(0);
    expect(sem.tryAcquire()).toBe(false);
    expect(sem.available).toBe(0);
  });

  it('release 恢复槽位，可再次 acquire', () => {
    const sem = new Semaphore(5);
    for (let i = 0; i < 5; i++) sem.tryAcquire();
    expect(sem.available).toBe(0);
    expect(sem.tryAcquire()).toBe(false);

    sem.release();
    expect(sem.available).toBe(1);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.available).toBe(0);
  });

  it('release 不超过 max 上限', () => {
    const sem = new Semaphore(5);
    sem.release();
    sem.release();
    sem.release();
    expect(sem.available).toBe(5);
  });

  it('5并发场景：跑满后释放一轮再跑满', () => {
    const sem = new Semaphore(5);
    const slots: boolean[] = [];
    for (let i = 0; i < 5; i++) slots.push(sem.tryAcquire());
    expect(slots).toEqual([true, true, true, true, true]);
    expect(sem.available).toBe(0);
    expect(sem.tryAcquire()).toBe(false);

    for (let i = 0; i < 5; i++) sem.release();
    expect(sem.available).toBe(5);

    const slots2: boolean[] = [];
    for (let i = 0; i < 5; i++) slots2.push(sem.tryAcquire());
    expect(slots2).toEqual([true, true, true, true, true]);
    expect(sem.available).toBe(0);
  });

  it('部分释放：3个任务完成后可再接受3个', () => {
    const sem = new Semaphore(5);
    for (let i = 0; i < 5; i++) sem.tryAcquire();
    expect(sem.available).toBe(0);

    for (let i = 0; i < 3; i++) sem.release();
    expect(sem.available).toBe(3);

    for (let i = 0; i < 3; i++) {
      expect(sem.tryAcquire()).toBe(true);
    }
    expect(sem.available).toBe(0);
    expect(sem.tryAcquire()).toBe(false);
  });

  it('并发交错：acquire-release 交替不会超限', () => {
    const sem = new Semaphore(5);
    const accepted = [sem.tryAcquire(), sem.tryAcquire(), sem.tryAcquire()];
    sem.release();
    expect(accepted).toEqual([true, true, true]);
    expect(sem.available).toBe(3);
    const afterRelease = [sem.tryAcquire(), sem.tryAcquire(), sem.tryAcquire()];
    expect(afterRelease).toEqual([true, true, true]);
    expect(sem.available).toBe(0);
    expect(sem.tryAcquire()).toBe(false);
  });
});