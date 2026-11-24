import { compatibleUnits, convertQty, convertRate, unitLabel, unitShort } from '@brickledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, call, createProject, registerUser, type TestApp } from './helpers';

describe('units', () => {
  it('converts volumes between cft, m³ and brass', () => {
    expect(convertQty(1, 'cum', 'cft')).toBeCloseTo(35.3147, 4);
    expect(convertQty(100, 'cft', 'cum')).toBeCloseTo(2.8317, 4);
    expect(convertQty(2, 'brass', 'cft')).toBe(200);
    expect(convertQty(1, 'brass', 'cum')).toBeCloseTo(2.8317, 4);
    expect(convertQty(convertQty(123.456, 'cft', 'cum'), 'cum', 'cft')).toBeCloseTo(123.456, 9);
  });

  it('converts weights, areas and lengths', () => {
    expect(convertQty(2.5, 'ton', 'kg')).toBe(2500);
    expect(convertQty(3, 'qtl', 'kg')).toBe(300);
    expect(convertQty(1, 'sqm', 'sqft')).toBeCloseTo(10.7639, 4);
    expect(convertQty(10, 'rmt', 'rft')).toBeCloseTo(32.8084, 4);
  });

  it('converts a rate the other way round, so value stays the same', () => {
    const perCft = 50;
    const perCum = convertRate(perCft, 'cft', 'cum');
    expect(perCum).toBeCloseTo(1765.73, 2);
    expect(convertQty(100, 'cft', 'cum') * perCum).toBeCloseTo(100 * perCft, 6);
  });

  it('leaves units that don’t convert alone, and names them plainly', () => {
    expect(convertQty(10, 'bags', 'kg')).toBe(10);
    expect(convertQty(10, 'cft', 'kg')).toBe(10);
    expect(compatibleUnits('cft')).toEqual(['cft', 'cum', 'brass']);
    expect(compatibleUnits('bags')).toEqual(['bags']);
    expect(compatibleUnits('truckload')).toEqual(['truckload']);
    expect(unitShort('cum')).toBe('m³');
    expect(unitShort('sqm')).toBe('m²');
    expect(unitShort('truckload')).toBe('truckload');
    expect(unitLabel('cum')).toBe('m³ · cubic metre');
  });
});

describe('stock in another unit', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(async () => t.close());

  it('keeps a converted rate exact enough to come back as the price entered', async () => {
    const user = await registerUser(t.app);
    const project = await createProject(t.app, user, { useTemplates: false });
    const api = (path: string) => `/api/v1/projects/${project.id}${path}`;
    const sand = await call(t.app, { method: 'POST', url: api('/materials'), headers: user.headers, payload: { name: 'Sand', unit: 'cft', category: 'sand' }, expect: 201 });
    // 2.5 m³ at ₹1,800/m³, stored in cft:
    const rate = Math.round(convertRate(1800, 'cum', 'cft') * 10_000) / 10_000;
    const quantity = Math.round(convertQty(2.5, 'cum', 'cft') * 1000) / 1000;
    const move = await call(t.app, { method: 'POST', url: api('/movements'), headers: user.headers, payload: { materialId: sand.id, type: 'in', quantity, rate, date: '2026-11-20' }, expect: 201 });
    expect(move.rate).toBe(50.9703); // stored with all 4 decimals (₹1,800 ÷ 35.3147), not rounded to 50.97
    expect(Math.round(convertRate(move.rate, 'cft', 'cum') * 100) / 100).toBe(1800);
    expect(Math.round(convertQty(move.quantity, 'cft', 'cum') * 1000) / 1000).toBe(2.5);
  });
});
