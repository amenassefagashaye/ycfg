/**
 * @license
 * Eras-Birhan Pharmaceuticals Stock Management System (EBP-SMS)
 * Enterprise Unit & Price Conversion Engine
 * Copyright (c) 2026 IDG, ETHIOPIA. Developer: Assefa Gashaye (+251918203416)
 * Version: 2.1.0-SECURE
 */

export interface ItemConversionFactors {
  baseUnit?: string;
  registeredUnit?: string;
  displayUnit?: string;
  registeredToBaseFactor?: number | string;
  displayToBaseFactor?: number | string;
  [key: string]: any;
}

export type UnitTypeKey = 'base' | 'baseunit' | 'register' | 'registered' | 'registeredunit' | 'display' | 'displayunit';

export interface PricingHierarchy {
  purchase: {
    base: number;
    display: number;
    register: number;
  };
  selling: {
    base: number;
    display: number;
    register: number;
  };
  markupPercent: number;
  discountPercent: number;
}

export const UnitConversionSystem = {
  /**
   * Safe extraction of conversion factors with fallback to 1.
   * regToBase: How many base units are in 1 registered unit (e.g. 1 Box = 100 Tablets -> 100)
   * dispToBase: How many base units are in 1 display unit (e.g. 1 Strip = 10 Tablets -> 10)
   */
  getItemFactors(item: ItemConversionFactors | null | undefined): { regToBase: number; dispToBase: number; regToDisp: number } {
    if (!item) return { regToBase: 1, dispToBase: 1, regToDisp: 1 };
    const reg = parseFloat(String(item.registeredToBaseFactor)) || 1;
    const disp = parseFloat(String(item.displayToBaseFactor)) || 1;
    const regToBase = reg > 0 ? reg : 1;
    const dispToBase = disp > 0 ? disp : 1;
    const regToDisp = regToBase / dispToBase;
    return { regToBase, dispToBase, regToDisp };
  },

  // -------------------------------------------------------------
  // QUANTITY CONVERSIONS
  // -------------------------------------------------------------
  baseToDisplay(baseQty: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return baseQty / f.dispToBase;
  },

  baseToRegister(baseQty: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return baseQty / f.regToBase;
  },

  displayToBase(dispQty: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return dispQty * f.dispToBase;
  },

  displayToRegister(dispQty: number, item: ItemConversionFactors): number {
    return this.baseToRegister(this.displayToBase(dispQty, item), item);
  },

  registerToBase(regQty: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return regQty * f.regToBase;
  },

  registerToDisplay(regQty: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return regQty * f.regToDisp;
  },

  /**
   * Normalize any quantity from an arbitrary unit type to base unit
   */
  toBase(qty: number, unitType: string, item: ItemConversionFactors): number {
    const u = (unitType || '').toLowerCase().trim();
    if (u === 'base' || u === 'baseunit') return qty;
    if (u === 'register' || u === 'registered' || u === 'registeredunit') return this.registerToBase(qty, item);
    if (u === 'display' || u === 'displayunit') return this.displayToBase(qty, item);
    return qty;
  },

  /**
   * Convert any quantity from an arbitrary unit type to display unit
   */
  toDisplay(qty: number, unitType: string, item: ItemConversionFactors): number {
    const base = this.toBase(qty, unitType, item);
    return this.baseToDisplay(base, item);
  },

  /**
   * Convert any quantity from an arbitrary unit type to registered unit
   */
  toRegister(qty: number, unitType: string, item: ItemConversionFactors): number {
    const base = this.toBase(qty, unitType, item);
    return this.baseToRegister(base, item);
  },

  /**
   * Convert quantity from one specific unit to another
   */
  convertQty(qty: number, fromUnit: string, toUnit: string, item: ItemConversionFactors): number {
    const base = this.toBase(qty, fromUnit, item);
    const to = (toUnit || '').toLowerCase().trim();
    if (to === 'base' || to === 'baseunit') return base;
    if (to === 'register' || to === 'registered' || to === 'registeredunit') return this.baseToRegister(base, item);
    if (to === 'display' || to === 'displayunit') return this.baseToDisplay(base, item);
    return base;
  },

  /**
   * Return all 3 representation quantities for a given base quantity
   */
  fromBase(baseQty: number, item: ItemConversionFactors) {
    return {
      base: baseQty,
      register: this.baseToRegister(baseQty, item),
      display: this.baseToDisplay(baseQty, item)
    };
  },

  // -------------------------------------------------------------
  // PRICE & COST CONVERSIONS
  // -------------------------------------------------------------
  /**
   * Given a price or cost defined per Display Unit, compute price per Base Unit
   */
  displayPriceToBasePrice(dispPrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return dispPrice / f.dispToBase;
  },

  /**
   * Given a price or cost defined per Display Unit, compute price per Register Unit
   */
  displayPriceToRegisterPrice(dispPrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return (dispPrice / f.dispToBase) * f.regToBase;
  },

  /**
   * Given a price or cost defined per Base Unit, compute price per Display Unit
   */
  basePriceToDisplayPrice(basePrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return basePrice * f.dispToBase;
  },

  /**
   * Given a price or cost defined per Base Unit, compute price per Register Unit
   */
  basePriceToRegisterPrice(basePrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return basePrice * f.regToBase;
  },

  /**
   * Given a price or cost defined per Register Unit, compute price per Base Unit
   */
  registerPriceToBasePrice(regPrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return regPrice / f.regToBase;
  },

  /**
   * Given a price or cost defined per Register Unit, compute price per Display Unit
   */
  registerPriceToDisplayPrice(regPrice: number, item: ItemConversionFactors): number {
    const f = this.getItemFactors(item);
    return (regPrice / f.regToBase) * f.dispToBase;
  },

  /**
   * Get the selling price for an arbitrary selected unit type
   * @param dispSellingPrice Selling price per display unit
   * @param targetUnitType 'base' | 'register' | 'display'
   */
  getPriceForUnit(dispSellingPrice: number, targetUnitType: string, item: ItemConversionFactors): number {
    const u = (targetUnitType || '').toLowerCase().trim();
    if (u === 'base' || u === 'baseunit') {
      return this.displayPriceToBasePrice(dispSellingPrice, item);
    }
    if (u === 'register' || u === 'registered' || u === 'registeredunit') {
      return this.displayPriceToRegisterPrice(dispSellingPrice, item);
    }
    return dispSellingPrice;
  },

  /**
   * Get the purchase cost for an arbitrary selected unit type
   * @param dispPurchasePrice Cost price per display unit
   * @param targetUnitType 'base' | 'register' | 'display'
   */
  getCostForUnit(dispPurchasePrice: number, targetUnitType: string, item: ItemConversionFactors): number {
    return this.getPriceForUnit(dispPurchasePrice, targetUnitType, item);
  },

  /**
   * Complete hierarchy calculator: Takes a price entered in any unit with markup & discount,
   * and calculates full purchase & selling price matrix across all 3 units.
   */
  calculatePricingHierarchy(
    priceInput: number,
    inputUnitType: string,
    markupPercent: number,
    discountPercent: number,
    item: ItemConversionFactors
  ): PricingHierarchy {
    // 1. Derive base purchase price
    const u = (inputUnitType || '').toLowerCase().trim();
    let basePurchase = 0;
    if (u === 'base' || u === 'baseunit') {
      basePurchase = priceInput;
    } else if (u === 'register' || u === 'registered' || u === 'registeredunit') {
      basePurchase = this.registerPriceToBasePrice(priceInput, item);
    } else {
      basePurchase = this.displayPriceToBasePrice(priceInput, item);
    }

    const dispPurchase = this.basePriceToDisplayPrice(basePurchase, item);
    const regPurchase = this.basePriceToRegisterPrice(basePurchase, item);

    // 2. Derive selling prices using markup and discount
    const calculateSelling = (cost: number) => {
      let s = cost * (1 + (markupPercent || 0) / 100);
      if (discountPercent > 0) {
        s = s * (1 - (discountPercent || 0) / 100);
      }
      return s;
    };

    const baseSelling = calculateSelling(basePurchase);
    const dispSelling = calculateSelling(dispPurchase);
    const regSelling = calculateSelling(regPurchase);

    return {
      purchase: {
        base: parseFloat(basePurchase.toFixed(4)),
        display: parseFloat(dispPurchase.toFixed(4)),
        register: parseFloat(regPurchase.toFixed(4))
      },
      selling: {
        base: parseFloat(baseSelling.toFixed(4)),
        display: parseFloat(dispSelling.toFixed(4)),
        register: parseFloat(regSelling.toFixed(4))
      },
      markupPercent,
      discountPercent
    };
  },

  /**
   * Helper string describing the full equation, e.g. "1 Box = 10 Strips = 100 Tablets"
   */
  getUnitEquation(item: ItemConversionFactors): string {
    const f = this.getItemFactors(item);
    const regUnit = item?.registeredUnit || 'Box';
    const dispUnit = item?.displayUnit || 'Strip';
    const baseUnit = item?.baseUnit || 'Tablet';
    return `1 ${regUnit} = ${f.regToDisp.toFixed(f.regToDisp % 1 === 0 ? 0 : 2)} ${dispUnit} = ${f.regToBase.toFixed(f.regToBase % 1 === 0 ? 0 : 2)} ${baseUnit}`;
  },

  formatQty(qty: number, maxDecimals = 4): string {
    if (isNaN(qty) || Math.abs(qty) < 0.00001) return '0';
    return parseFloat(qty.toFixed(maxDecimals)).toString();
  },

  formatPrice(price: number): string {
    if (isNaN(price)) return '0.00';
    return price.toFixed(2);
  }
};
