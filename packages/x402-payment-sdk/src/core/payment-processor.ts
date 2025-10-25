import { exact } from "x402/schemes";
import {
  findMatchingPaymentRequirements,
  processPriceToAtomicAmount,
  safeBase64Encode,
  toJsonSafe,
} from "x402/shared";
import { useFacilitator } from "x402/verify";
import type { Address } from "viem";
import { getAddress } from "viem";
import type {
  ERC20TokenAmount,
  PaymentMiddlewareConfig,
  PaymentPayload,
  PaymentRequirements,
  Resource,
} from "x402/types";
import { SupportedEVMNetworks } from "x402/types";

import type {
  AsyncSettlementOptions,
  PaymentContext,
  PaymentError,
  PaymentFailure,
  PaymentResult,
  PaymentServerConfig,
  PaymentSuccess,
  PaymentVerificationResult,
  SettlementResult,
} from "../types";

const X402_VERSION = 1;

export interface PaymentProcessorOptions {
  asyncSettlement?: AsyncSettlementOptions;
}

export class PaymentProcessor {
  private config: PaymentServerConfig;
  private options: PaymentProcessorOptions;
  private facilitator: ReturnType<typeof useFacilitator>;

  constructor(config: PaymentServerConfig, options: PaymentProcessorOptions = {}) {
    this.config = config;
    this.options = options;
    this.facilitator = useFacilitator(config.facilitator);
  }

  /**
   * 创建支付要求
   */
  createPaymentRequirements(
    request: Request,
    price: string | number,
    resource?: Resource,
    additionalConfig?: Partial<PaymentMiddlewareConfig>
  ): PaymentRequirements | PaymentFailure {
    const atomicAmountForAsset = processPriceToAtomicAmount(
      price,
      this.config.network
    );

    if ("error" in atomicAmountForAsset) {
      return {
        success: false,
        error: {
          code: "PRICE_PROCESSING_ERROR",
          message: atomicAmountForAsset.error,
        },
      };
    }

    const { maxAmountRequired, asset } = atomicAmountForAsset;

    if (!SupportedEVMNetworks.includes(this.config.network)) {
      return {
        success: false,
        error: {
          code: "UNSUPPORTED_NETWORK",
          message: `Unsupported network: ${this.config.network}`,
        },
      };
    }

    const resourceUrl = resource || request.url;
    const method = request.method.toUpperCase();

    const requirement: PaymentRequirements = {
      scheme: "exact",
      network: this.config.network,
      maxAmountRequired,
      resource: resourceUrl,
      description: additionalConfig?.description ?? "",
      mimeType: additionalConfig?.mimeType ?? "application/json",
      payTo: getAddress(this.config.recipient),
      maxTimeoutSeconds: additionalConfig?.maxTimeoutSeconds ?? 300,
      asset: getAddress(asset.address),
      outputSchema: {
        input: {
          type: "http",
          method,
          discoverable: additionalConfig?.discoverable ?? true,
          ...additionalConfig?.inputSchema,
        },
        output: additionalConfig?.outputSchema,
      },
      extra: (asset as ERC20TokenAmount["asset"]).eip712,
    };

    return requirement;
  }

  /**
   * 验证支付
   */
  async verifyPayment(
    paymentData: string,
    requirements: PaymentRequirements
  ): Promise<PaymentResult> {
    let decodedPayment: PaymentPayload;
    
    try {
      decodedPayment = exact.evm.decodePayment(paymentData);
      decodedPayment.x402Version = X402_VERSION;
    } catch (error) {
      return {
        success: false,
        error: {
          code: "INVALID_PAYMENT",
          message: error instanceof Error ? error.message : "Invalid payment",
        },
        requirements: [requirements],
      };
    }

    const selectedRequirement = findMatchingPaymentRequirements(
      [requirements],
      decodedPayment
    );

    if (!selectedRequirement) {
      return {
        success: false,
        error: {
          code: "NO_MATCHING_REQUIREMENTS",
          message: "Unable to find matching payment requirements",
        },
        requirements: [requirements],
      };
    }

    try {
      const verification = await this.facilitator.verify(
        decodedPayment,
        selectedRequirement
      );

      if (!verification.isValid) {
        return {
          success: false,
          error: {
            code: "VERIFICATION_FAILED",
            message: verification.invalidReason || "Payment verification failed",
            details: { payer: verification.payer },
          },
          requirements: [requirements],
        };
      }

      const context: PaymentContext = {
        payment: decodedPayment,
        requirements: selectedRequirement,
        verification,
      };

      return {
        success: true,
        context,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "VERIFICATION_ERROR",
          message: error instanceof Error ? error.message : "Verification failed",
        },
        requirements: [requirements],
      };
    }
  }

  /**
   * 同步结算支付
   */
  async settlePayment(context: PaymentContext): Promise<SettlementResult> {
    try {
      const settlement = await this.facilitator.settle(
        context.payment,
        context.requirements
      );

      return {
        success: settlement.success,
        transaction: settlement.transaction,
        network: settlement.network,
        payer: settlement.payer,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Settlement failed",
      };
    }
  }

  /**
   * 异步结算支付（优化版本）
   */
  async settlePaymentAsync(
    context: PaymentContext,
    response: Response
  ): Promise<Response> {
    const { asyncSettlement } = this.options;
    
    if (!asyncSettlement?.enabled) {
      // 如果未启用异步结算，则同步结算
      const settlementResult = await this.settlePayment(context);
      return this.addSettlementHeaders(response, settlementResult);
    }

    // 异步结算：立即返回响应，后台处理结算
    this.settlePaymentInBackground(context);
    
    // 添加待结算标识
    response.headers.set(
      "X-Payment-Status",
      safeBase64Encode(JSON.stringify({ status: "pending_settlement" }))
    );

    return response;
  }

  /**
   * 后台结算处理
   */
  private async settlePaymentInBackground(context: PaymentContext): Promise<void> {
    const { asyncSettlement } = this.options;
    const maxRetries = asyncSettlement?.maxRetries ?? 3;
    const retryDelay = asyncSettlement?.retryDelay ?? 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const settlementResult = await this.settlePayment(context);
        
        if (settlementResult.success) {
          asyncSettlement?.onSettlementSuccess?.(settlementResult);
          return;
        } else {
          throw new Error(settlementResult.error || "Settlement failed");
        }
      } catch (error) {
        if (attempt === maxRetries) {
          asyncSettlement?.onSettlementError?.(error as Error);
          return;
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  /**
   * 添加结算信息到响应头
   */
  private addSettlementHeaders(response: Response, settlement: SettlementResult): Response {
    if (settlement.success) {
      response.headers.set(
        "X-Payment-Response",
        safeBase64Encode(
          JSON.stringify({
            success: true,
            transaction: settlement.transaction,
            network: settlement.network,
            payer: settlement.payer,
          })
        )
      );
    } else {
      response.headers.set(
        "X-Payment-Error",
        safeBase64Encode(
          JSON.stringify({
            success: false,
            error: settlement.error,
          })
        )
      );
    }

    return response;
  }

  /**
   * 创建支付错误响应
   */
  createPaymentErrorResponse(
    error: PaymentError,
    requirements?: PaymentRequirements[]
  ): Response {
    return new Response(
      JSON.stringify({
        x402Version: X402_VERSION,
        error: error.message,
        code: error.code,
        details: error.details,
        accepts: requirements ? toJsonSafe(requirements) : undefined,
      }),
      {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
