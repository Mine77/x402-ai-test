# X402 Payment SDK

一个用于 MCP 服务器和 HTTP API 的 X402 支付 SDK，支持异步结算优化。

## 特性

- 🚀 **异步结算优化**: 先验证支付后立即返回结果，后台处理结算，大幅提升响应速度
- 🔧 **MCP 服务器支持**: 轻松创建支持付费工具的 MCP 服务器
- 🌐 **HTTP API 支持**: 为任何 HTTP API 添加支付功能
- 💰 **多种支付方式**: 支持 Base 网络上的 USDC 支付
- 🛡️ **类型安全**: 完整的 TypeScript 类型定义
- ⚡ **高性能**: 优化的支付验证和结算流程

## 安装

```bash
npm install @x402/payment-sdk
```

## 快速开始

### MCP 服务器

```typescript
import { createPaidMcpHandler } from "@x402/payment-sdk/mcp";
import { facilitator } from "@coinbase/x402";
import { privateKeyToAccount } from "viem/accounts";
import z from "zod";

const sellerAccount = privateKeyToAccount(process.env.SERVICE_PRIVATE_KEY as `0x${string}`);
const config = {
  recipient: sellerAccount.address,
  facilitator: facilitator as any,
  network: "base" as const,
};

const handler = createPaidMcpHandler(
  (server) => {
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
        const randomNumber = Math.floor(Math.random() * (args.max - args.min + 1)) + args.min;
        return {
          content: [{ type: "text", text: randomNumber.toString() }],
        };
      },
    );
  },
  {
    serverInfo: { name: "my-mcp-server", version: "1.0.0" },
  },
  config,
  {
    // 启用异步结算优化
    asyncSettlement: {
      enabled: true,
      maxRetries: 3,
      retryDelay: 1000,
    },
  }
);

export { handler as GET, handler as POST };
```

### HTTP API 支付插件

```typescript
import { createPaymentPlugin } from "@x402/payment-sdk/http";
import { facilitator } from "@coinbase/x402";

const paymentPlugin = createPaymentPlugin({
  facilitator: facilitator as any,
  asyncSettlement: {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000,
  },
});

export async function POST(request: Request) {
  const paymentResult = await paymentPlugin.ensurePayment(
    request,
    {
      payTo: "0x...", // 收款地址
      price: "$0.01", // 价格
      network: "base",
      config: {
        description: "API access",
        mimeType: "application/json",
      },
    }
  );

  if (!paymentResult.ok) {
    return paymentResult.response;
  }

  // 处理业务逻辑
  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  // 结算支付（异步）
  const settlementResult = await paymentResult.settle(response);
  return settlementResult.response;
}
```

## 异步结算优化

SDK 支持异步结算优化，可以显著提升 API 响应速度：

### 传统流程
1. 接收请求
2. 验证支付
3. 处理业务逻辑
4. 结算支付
5. 返回结果

### 优化后流程
1. 接收请求
2. 验证支付
3. 处理业务逻辑
4. 立即返回结果
5. 后台异步结算支付

### 配置异步结算

```typescript
const options = {
  asyncSettlement: {
    enabled: true,           // 启用异步结算
    maxRetries: 3,          // 最大重试次数
    retryDelay: 1000,       // 重试延迟（毫秒）
    onSettlementSuccess: (result) => {
      console.log("结算成功:", result);
    },
    onSettlementError: (error) => {
      console.error("结算失败:", error);
    },
  },
};
```

## API 参考

### MCP 服务器

#### `createPaidMcpHandler`

创建支持付费工具的 MCP 服务器处理器。

**参数:**
- `initializeServer`: 服务器初始化函数
- `serverOptions`: 服务器选项
- `config`: 支付配置
- `options`: 处理器选项（可选）

**返回:** `(request: Request) => Promise<Response>`

#### `server.paidTool`

注册付费工具。

**参数:**
- `name`: 工具名称
- `description`: 工具描述
- `options`: 支付选项 `{ price: number }`
- `paramsSchema`: 参数模式（Zod schema）
- `annotations`: 工具注解
- `callback`: 工具回调函数

### HTTP 支付插件

#### `createPaymentPlugin`

创建支付插件实例。

**参数:**
- `options`: 插件选项

**返回:** `{ ensurePayment }`

#### `ensurePayment`

验证支付并返回结果。

**参数:**
- `request`: HTTP 请求
- `config`: 支付配置

**返回:** `Promise<EnsurePaymentResult>`

## 环境变量

```bash
# 必需
SERVICE_PRIVATE_KEY=0x...  # 服务私钥
NETWORK=base              # 网络 (base 或 base-sepolia)

# 可选
OPENROUTER_API_KEY=...    # OpenRouter API 密钥
```

## 许可证

MIT
