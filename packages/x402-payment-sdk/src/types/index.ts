import type { Address } from "viem";
import type {
  ERC20TokenAmount,
  FacilitatorConfig,
  PaymentMiddlewareConfig,
  PaymentPayload,
  PaymentRequirements,
  Resource,
  RouteConfig,
} from "x402/types";

export interface PaymentServerConfig {
  recipient: Address;
  facilitator: FacilitatorConfig;
  network: "base-sepolia" | "base";
}

export interface PaymentServerOptions {
  price: number; // in USD
}

export interface AsyncSettlementOptions {
  enabled: boolean;
  maxRetries?: number;
  retryDelay?: number;
  onSettlementSuccess?: (result: SettlementResult) => void;
  onSettlementError?: (error: Error) => void;
}

export interface SettlementResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  error?: string;
}

export interface PaymentVerificationResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface PaymentContext {
  payment: PaymentPayload;
  requirements: PaymentRequirements;
  verification: PaymentVerificationResult;
}

export interface PaymentError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaymentSuccess {
  success: true;
  context: PaymentContext;
  settlementResult?: SettlementResult;
}

export interface PaymentFailure {
  success: false;
  error: PaymentError;
  requirements?: PaymentRequirements[];
}

export type PaymentResult = PaymentSuccess | PaymentFailure;

// Re-export commonly used types
export type {
  ERC20TokenAmount,
  FacilitatorConfig,
  PaymentMiddlewareConfig,
  PaymentPayload,
  PaymentRequirements,
  Resource,
  RouteConfig,
} from "x402/types";
