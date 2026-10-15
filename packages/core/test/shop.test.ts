import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNutrition, hasStock, nutritionHighlight, nutritionRows, priceRange, returnStock, sortVariants, takeStock, type Variant } from '../src/index.ts';

test('sklep: wariant bez limitu nie traci sztuk, policzalny – tak', () => {
  const v: Variant[] = [
    { id: 'a', stock: null },
    { id: 'b', size: 'M', stock: 1 },
  ];
  assert.deepEqual(takeStock(v, 'a', 5), v);
  assert.equal(takeStock(v, 'b', 1)[1].stock, 0);
  assert.throws(() => takeStock(v, 'b', 2), /tylko 1 szt/);
  assert.deepEqual(returnStock(v, 'a', 3), v);
  assert.equal(hasStock([{ id: 'x', stock: 0 }]), false);
  assert.equal(hasStock([{ id: 'x', stock: 0 }, { id: 'y', stock: null }]), true);
});

test('sklep: rozmiary w kolejności miary, własne na końcu; zakres cen wariantów', () => {
  const socks = sortVariants('socks', [{ size: '43–46' }, { size: '36–40' }, { size: '35–38' }]);
  assert.deepEqual(socks.map((v) => v.size), ['35–38', '43–46', '36–40']);
  assert.deepEqual(priceRange(4900, [{ id: 'a', stock: 1 }, { id: 'b', stock: 1, priceGrosze: 6900 }]), { min: 4900, max: 6900 });
});

test('sklep: makro – zostaje tylko to, co wpisano; przecinek dziesiętny działa', () => {
  assert.equal(cleanNutrition({ kcal: '', protein: null }), null);
  assert.deepEqual(cleanNutrition({ protein: '22,5', fat: -1, sugar: 'dużo', serving: ' 400 ml ' }), { protein: 22.5, serving: '400 ml' });
  assert.deepEqual(nutritionRows({ kcal: 120, sugar: 9 }).map((r) => [r.label, r.value, r.sub]), [
    ['Energia', '120 kcal', false],
    ['w tym cukry', '9 g', true],
  ]);
  assert.equal(nutritionHighlight({ kcal: 180 }), '180 kcal');
  assert.equal(nutritionHighlight({ kcal: 180, protein: 30 }), '30 g białka');
  assert.equal(nutritionHighlight(null), null);
});
