/**
 * Moolah SDK Core
 * 
 * This package provides type definitions and calculation functions for Moolah lending protocol.
 * It is designed to be framework-agnostic and can be used in any JavaScript/TypeScript environment.
 * 
 * Note: Decimal and Fraction classes are included in this package and are compatible with @lista/shared
 */

// Utils (Decimal and Fraction - compatible with @lista/shared)
export { Decimal } from './utils/decimal';
export * from './utils/fraction';

// Types
export * from './types/common';
export * from './types/vault';
export * from './types/market';
export * from './types/loan';

// Calculations
export * from './calculations/loan';
