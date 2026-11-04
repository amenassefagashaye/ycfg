import test from 'node:test';
import assert from 'node:assert/strict';
import { UnitConversionSystem } from './security/conversion';

test('Unit Conversion: quantity conversions across Base, Display, and Register units', () => {
  // Pharmaceutical item: 1 Box = 10 Strips = 100 Tablets
  const item = {
    baseUnit: 'tablet',
    registeredUnit: 'box',
    displayUnit: 'strip',
    registeredToBaseFactor: 100, // 1 box = 100 tablets
    displayToBaseFactor: 10      // 1 strip = 10 tablets
  };

  // Base to Display
  assert.equal(UnitConversionSystem.baseToDisplay(100, item), 10);
  assert.equal(UnitConversionSystem.baseToDisplay(50, item), 5);
  assert.equal(UnitConversionSystem.baseToDisplay(5, item), 0.5);

  // Base to Register
  assert.equal(UnitConversionSystem.baseToRegister(100, item), 1);
  assert.equal(UnitConversionSystem.baseToRegister(250, item), 2.5);

  // Display to Base
  assert.equal(UnitConversionSystem.displayToBase(10, item), 100);
  assert.equal(UnitConversionSystem.displayToBase(2.5, item), 25);

  // Register to Base
  assert.equal(UnitConversionSystem.registerToBase(5, item), 500);

  // Register to Display
  assert.equal(UnitConversionSystem.registerToDisplay(5, item), 50);

  // toBase helper
  assert.equal(UnitConversionSystem.toBase(5, 'register', item), 500);
  assert.equal(UnitConversionSystem.toBase(12, 'display', item), 120);
  assert.equal(UnitConversionSystem.toBase(45, 'base', item), 45);

  // toDisplay helper
  assert.equal(UnitConversionSystem.toDisplay(2, 'register', item), 20);
  assert.equal(UnitConversionSystem.toDisplay(35, 'base', item), 3.5);
  assert.equal(UnitConversionSystem.toDisplay(7, 'display', item), 7);

  // toRegister helper
  assert.equal(UnitConversionSystem.toRegister(30, 'display', item), 3);
  assert.equal(UnitConversionSystem.toRegister(300, 'base', item), 3);
});

test('Price Conversion: price and cost conversions between units', () => {
  // 1 Box = 10 Strips = 100 Tablets
  // Selling price per display unit (per strip) = ETB 50.00
  const item = {
    baseUnit: 'tablet',
    registeredUnit: 'box',
    displayUnit: 'strip',
    registeredToBaseFactor: 100,
    displayToBaseFactor: 10,
    sellingPricePerDisplay: 50.00,
    purchasePricePerDisplay: 30.00
  };

  // Selling price per tablet (Base) should be 50 / 10 = ETB 5.00
  const priceBase = UnitConversionSystem.displayPriceToBasePrice(50, item);
  assert.equal(priceBase, 5.00);

  // Selling price per box (Register) should be 50 * 10 = ETB 500.00
  const priceRegister = UnitConversionSystem.displayPriceToRegisterPrice(50, item);
  assert.equal(priceRegister, 500.00);

  // Cost conversions
  const costBase = UnitConversionSystem.displayPriceToBasePrice(30, item);
  assert.equal(costBase, 3.00);
  const costRegister = UnitConversionSystem.displayPriceToRegisterPrice(30, item);
  assert.equal(costRegister, 300.00);

  // getPriceForUnit
  assert.equal(UnitConversionSystem.getPriceForUnit(50, 'display', item), 50);
  assert.equal(UnitConversionSystem.getPriceForUnit(50, 'base', item), 5);
  assert.equal(UnitConversionSystem.getPriceForUnit(50, 'register', item), 500);

  // calculatePricingHierarchy starting from Box Purchase Price of ETB 300 with 50% markup
  const hierarchy = UnitConversionSystem.calculatePricingHierarchy(300, 'register', 50, 0, item);
  assert.equal(hierarchy.purchase.register, 300);
  assert.equal(hierarchy.purchase.display, 30);
  assert.equal(hierarchy.purchase.base, 3);
  assert.equal(hierarchy.selling.register, 450); // 300 * 1.5
  assert.equal(hierarchy.selling.display, 45);   // 30 * 1.5
  assert.equal(hierarchy.selling.base, 4.5);     // 3 * 1.5
});

test('Unit Equation: returns human-readable relationship', () => {
  const item = {
    baseUnit: 'Tablet',
    registeredUnit: 'Box',
    displayUnit: 'Strip',
    registeredToBaseFactor: 100,
    displayToBaseFactor: 10
  };

  assert.equal(UnitConversionSystem.getUnitEquation(item), '1 Box = 10 Strip = 100 Tablet');
});
