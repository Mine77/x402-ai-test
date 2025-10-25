import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { createMcpHandler } from "mcp-handler";
import type { ZodRawShape } from "zod";
import z from "zod";

import { PaymentProcessor } from "../core/payment-processor";
import type {
  PaymentServerConfig,
  PaymentServerOptions,
  AsyncSettlementOptions,
} from "../types";

export interface McpFacilitatorConfig {
  url: `${string}://${string}`;
  createAuthHeaders: () => Promise<{
    verify: Record<string, string>;
    settle: Record<string, string>;
    supported: Record<string, string>;
    list?: Record<string, string>;
  }>;
}

export interface PaymentMcpServerConfig extends PaymentServerConfig {
  facilitator: McpFacilitatorConfig;
}

export interface PaymentServerMethods {
  paidTool<Args extends ZodRawShape>(
    name: string,
    description: string,
    options: PaymentServerOptions,
    paramsSchema: Args,
    annotations: ToolAnnotations,
    cb: ToolCallback<Args>,
  ): RegisteredTool;
}

export type PaymentMcpServer = McpServer & PaymentServerMethods;

type ServerOptions = NonNullable<Parameters<typeof createMcpHandler>[1]>;
type Config = NonNullable<Parameters<typeof createMcpHandler>[2]>;

export interface CreatePaidMcpHandlerOptions {
  asyncSettlement?: AsyncSettlementOptions;
}

function createPaidToolMethod(
  server: McpServer,
  config: PaymentMcpServerConfig,
  options: CreatePaidMcpHandlerOptions = {}
): PaymentMcpServer["paidTool"] {
  const paymentProcessor = new PaymentProcessor(config, options);

  const paidTool: PaymentMcpServer["paidTool"] = (
    name,
    description,
    paymentOptions,
    paramsSchema,
    annotations,
    cb,
  ) => {
    const cbWithPayment = async (args: any, extra: any) => {
      console.log("[x402-mcp-server] Tool request received:", name);

      const payment = extra._meta?.["x402/payment"];

      // 创建支付要求
      const requirements = paymentProcessor.createPaymentRequirements(
        new Request("http://localhost"), // 虚拟请求，用于创建要求
        paymentOptions.price,
        `mcp://tool/${name}`,
        {
          description,
          mimeType: "application/json",
        }
      );

      if (!("scheme" in requirements)) {
        return {
          isError: true,
          structuredContent: requirements,
          content: [{ type: "text", text: JSON.stringify(requirements) }] as const,
        } as const;
      }

      if (!payment) {
        console.log("[x402-mcp-server] Payment required");
        return {
          isError: true,
          structuredContent: {
            x402Version: 1,
            error: "_meta.x402/payment is required",
            accepts: [requirements],
          },
          content: [{ type: "text", text: JSON.stringify({
            x402Version: 1,
            error: "_meta.x402/payment is required",
            accepts: [requirements],
          }) }] as const,
        } as const;
      }

      // 验证支付
      const verificationResult = await paymentProcessor.verifyPayment(
        payment as string,
        requirements
      );

      if (!verificationResult.success) {
        console.log("[x402-mcp-server] Payment verification failed:", verificationResult.error);
        return {
          isError: true,
          structuredContent: verificationResult,
          content: [{ type: "text", text: JSON.stringify(verificationResult) }] as const,
        } as const;
      }

      console.log("[x402-mcp-server] Payment verification successful. Executing tool...");

      // 执行工具
      let result: ReturnType<ToolCallback<any>>;
      let executionError = false;
      
      try {
        result = await cb(args, extra);
        
        // 检查结果是否表示错误
        if (
          result &&
          typeof result === "object" &&
          "isError" in result &&
          result.isError
        ) {
          executionError = true;
        }
      } catch (error) {
        console.log("[x402-mcp-server] Tool execution error:", error);
        executionError = true;
        result = {
          isError: true,
          content: [{ type: "text", text: `Tool execution failed: ${error}` }],
        };
      }

      // 处理结算
      if (!executionError && verificationResult.success) {
        console.log("[x402-mcp-server] Tool execution successful. Processing settlement...");
        
        if (options.asyncSettlement?.enabled) {
          // 异步结算：立即返回结果，后台处理结算
          console.log("[x402-mcp-server] Using async settlement");
          
          // 添加结算信息到结果元数据
          if (!result._meta) {
            result._meta = {};
          }
          result._meta["x402/payment-status"] = "pending_settlement";
          
          // 后台结算
          paymentProcessor.settlePaymentAsync(
            verificationResult.context,
            new Response()
          ).catch(error => {
            console.error("[x402-mcp-server] Async settlement error:", error);
          });
        } else {
          // 同步结算
          console.log("[x402-mcp-server] Using sync settlement");
          try {
            const settlementResult = await paymentProcessor.settlePayment(
              verificationResult.context
            );
            
            if (settlementResult.success && result) {
              if (!result._meta) {
                result._meta = {};
              }
              result._meta["x402/payment-response"] = {
                success: true,
                transaction: settlementResult.transaction,
                network: settlementResult.network,
                payer: settlementResult.payer,
              };
            }
          } catch (settlementError) {
            console.log("[x402-mcp-server] Settlement error:", settlementError);
            return {
              isError: true,
              structuredContent: {
                x402Version: 1,
                error: `Settlement failed: ${settlementError}`,
                accepts: [requirements],
              },
              content: [{ type: "text", text: JSON.stringify({
                x402Version: 1,
                error: `Settlement failed: ${settlementError}`,
                accepts: [requirements],
              }) }] as const,
            } as const;
          }
        }
      }

      console.log("[x402-mcp-server] Returning result to client");
      return result;
    };

    return server.tool(
      name,
      description,
      paramsSchema,
      {
        ...annotations,
        paymentHint: true,
      },
      cbWithPayment as any,
    );
  };

  return paidTool;
}

export function createPaidMcpHandler(
  initializeServer:
    | ((server: PaymentMcpServer) => Promise<void>)
    | ((server: PaymentMcpServer) => void),
  serverOptions: ServerOptions,
  config: PaymentMcpServerConfig & Config,
  options: CreatePaidMcpHandlerOptions = {}
): (request: Request) => Promise<Response> {
  // 创建基础处理器
  const paidHandler = createMcpHandler(
    // 包装初始化函数以使用扩展的 MCP 服务器
    async (server) => {
      const extendedServer = new Proxy(server as unknown as PaymentMcpServer, {
        get(target, prop, receiver) {
          if (prop === "paidTool") {
            return createPaidToolMethod(target, config, options);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as PaymentMcpServer;

      await initializeServer(extendedServer);
    },
    serverOptions,
    config,
  );

  return paidHandler;
}
