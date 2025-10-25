import { exact } from "x402/schemes";
import { safeBase64Encode } from "x402/shared";
import type { Address } from "viem";
import { getAddress } from "viem";
import type { Resource } from "x402/types";

import { PaymentProcessor } from "../core/payment-processor";
import type {
  PaymentServerConfig,
  AsyncSettlementOptions,
  PaymentMiddlewareConfig,
} from "../types";

const X_PAYMENT_HEADER = "X-PAYMENT";
const X_PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";
const JSON_CONTENT_TYPE = { "Content-Type": "application/json" };
const X402_VERSION = 1;

export interface PaymentPluginOptions {
  facilitator?: PaymentServerConfig["facilitator"];
  asyncSettlement?: AsyncSettlementOptions;
}

export interface EnsurePaymentConfig {
  payTo: Address;
  price: string | number;
  network: "base-sepolia" | "base";
  config?: PaymentMiddlewareConfig;
  resource?: Resource;
  method?: string;
}

export interface PaymentFailureResult {
  ok: false;
  response: Response;
}

export interface PaymentSettlementSuccess {
  ok: true;
  response: Response;
}

export interface PaymentSettlementFailure {
  ok: false;
  response: Response;
}

export type PaymentSettlementResult =
  | PaymentSettlementSuccess
  | PaymentSettlementFailure;

export interface PaymentSuccessResult {
  ok: true;
  payment: any; // PaymentPayload
  requirements: any; // PaymentRequirements
  settle(response: Response): Promise<PaymentSettlementResult>;
}

export type EnsurePaymentResult = PaymentFailureResult | PaymentSuccessResult;

function buildPaymentRequiredResponse(
  error: string,
  accepts: unknown,
  additional?: Record<string, unknown>,
) {
  return new Response(
    JSON.stringify({
      x402Version: X402_VERSION,
      error,
      accepts,
      ...additional,
    }),
    {
      status: 402,
      headers: JSON_CONTENT_TYPE,
    },
  );
}

export function createPaymentPlugin(options: PaymentPluginOptions = {}) {
  const { facilitator, asyncSettlement } = options;
  
  // 创建支付处理器
  const paymentProcessor = new PaymentProcessor(
    {
      recipient: "" as Address, // 将在 ensurePayment 中设置
      facilitator: facilitator!,
      network: "base", // 将在 ensurePayment 中设置
    },
    { asyncSettlement }
  );

  const ensurePayment = async (
    request: Request,
    config: EnsurePaymentConfig,
  ): Promise<EnsurePaymentResult> => {
    // 创建支付要求
    const requirements = paymentProcessor.createPaymentRequirements(
      request,
      config.price,
      config.resource,
      config.config || {}
    );

    if (!("scheme" in requirements)) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            x402Version: X402_VERSION,
            error: requirements.error.message,
            code: requirements.error.code,
          }),
          {
            status: 500,
            headers: JSON_CONTENT_TYPE,
          },
        ),
      };
    }

    const paymentRequirements = [requirements];
    const errorMessages = config.config?.errorMessages ?? {};

    const paymentHeader = request.headers.get(X_PAYMENT_HEADER);
    if (!paymentHeader) {
      return {
        ok: false,
        response: buildPaymentRequiredResponse(
          errorMessages?.paymentRequired ||
            `${X_PAYMENT_HEADER} header is required`,
          paymentRequirements,
        ),
      };
    }

    // 验证支付
    const verificationResult = await paymentProcessor.verifyPayment(
      paymentHeader,
      requirements
    );

    if (!verificationResult.success) {
      return {
        ok: false,
        response: buildPaymentRequiredResponse(
          errorMessages?.verificationFailed ||
            verificationResult.error.message ||
            "Payment verification failed",
          paymentRequirements,
          {
            payer: verificationResult.error.details?.payer,
          },
        ),
      };
    }

    const settlePayment = async (
      response: Response,
    ): Promise<PaymentSettlementResult> => {
      if (response.status >= 400) {
        return { ok: true, response };
      }

      if (asyncSettlement?.enabled) {
        // 异步结算：立即返回响应，后台处理结算
        try {
          await paymentProcessor.settlePaymentAsync(
            verificationResult.context,
            response
          );
          return { ok: true, response };
        } catch (error) {
          return {
            ok: false,
            response: buildPaymentRequiredResponse(
              errorMessages?.settlementFailed ||
                (error instanceof Error ? error.message : "Settlement failed"),
              paymentRequirements,
            ),
          };
        }
      } else {
        // 同步结算
        try {
          const settlement = await paymentProcessor.settlePayment(
            verificationResult.context
          );

          if (settlement.success) {
            response.headers.set(
              X_PAYMENT_RESPONSE_HEADER,
              safeBase64Encode(
                JSON.stringify({
                  success: true,
                  transaction: settlement.transaction,
                  network: settlement.network,
                  payer: settlement.payer,
                }),
              ),
            );
          }

          return { ok: true, response };
        } catch (error) {
          return {
            ok: false,
            response: buildPaymentRequiredResponse(
              errorMessages?.settlementFailed ||
                (error instanceof Error ? error.message : "Settlement failed"),
              paymentRequirements,
            ),
          };
        }
      }
    };

    return {
      ok: true,
      payment: verificationResult.context.payment,
      requirements: verificationResult.context.requirements,
      settle: settlePayment,
    };
  };

  return {
    ensurePayment,
  };
}

export type {
  PaymentMiddlewareConfig,
  PaymentPayload,
  PaymentRequirements,
  RouteConfig,
  RoutesConfig,
} from "x402/types";
