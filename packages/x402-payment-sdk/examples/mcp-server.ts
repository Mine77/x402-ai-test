import { facilitator } from "@coinbase/x402";
import { privateKeyToAccount } from "viem/accounts";
import z from "zod";
import {
  createPaidMcpHandler,
  type PaymentMcpServerConfig,
} from "@x402/payment-sdk/mcp";

// 配置
const sellerAccount = privateKeyToAccount(
  process.env.SERVICE_PRIVATE_KEY as `0x${string}`,
);
const network = process.env.NETWORK as "base-sepolia" | "base";

const config: PaymentMcpServerConfig = {
  recipient: sellerAccount.address,
  facilitator: facilitator as unknown as PaymentMcpServerConfig["facilitator"],
  network,
};

// 创建处理器
const handler = createPaidMcpHandler(
  (server: PaymentMcpServer) => {
    // 付费工具示例
    server.paidTool(
      "get_random_number",
      "Get a random number between two numbers",
      { price: 0.001 }, // $0.001 USD
      {
        min: z.number().int(),
        max: z.number().int(),
      },
      {},
      async (args) => {
        const randomNumber =
          Math.floor(Math.random() * (args.max - args.min + 1)) + args.min;
        return {
          content: [{ type: "text", text: randomNumber.toString() }],
        };
      },
    );

    // 另一个付费工具
    server.paidTool(
      "calculate_fibonacci",
      "Calculate the nth Fibonacci number",
      { price: 0.002 }, // $0.002 USD
      {
        n: z.number().int().min(0).max(100),
      },
      {},
      async (args) => {
        function fibonacci(n: number): number {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        
        const result = fibonacci(args.n);
        return {
          content: [{ type: "text", text: `Fibonacci(${args.n}) = ${result}` }],
        };
      },
    );

    // 免费工具示例
    server.tool(
      "hello",
      "Say hello",
      {
        name: z.string(),
      },
      async (args) => {
        return { 
          content: [{ type: "text", text: `Hello ${args.name}!` }] 
        };
      },
    );
  },
  {
    serverInfo: {
      name: "example-mcp-server",
      version: "1.0.0",
    },
  },
  config,
  {
    // 启用异步结算优化
    asyncSettlement: {
      enabled: true,
      maxRetries: 3,
      retryDelay: 1000,
      onSettlementSuccess: (result) => {
        console.log("Payment settled successfully:", result);
      },
      onSettlementError: (error) => {
        console.error("Payment settlement failed:", error);
      },
    },
  }
);

// Next.js API 路由处理
export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 200 });
}
