import { facilitator } from "@coinbase/x402";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentPlugin } from "@x402/payment-sdk/http";

// 配置
const serviceAccount = privateKeyToAccount(
  process.env.SERVICE_PRIVATE_KEY as `0x${string}`,
);

const paymentPlugin = createPaymentPlugin({
  facilitator: facilitator as any,
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
});

// 示例 API 路由
export async function POST(request: Request) {
  const paymentResult = await paymentPlugin.ensurePayment(
    request,
    {
      payTo: serviceAccount.address,
      price: "$0.01", // $0.01 USD
      network: process.env.NETWORK as "base-sepolia" | "base",
      config: {
        description: "AI API access",
        mimeType: "application/json",
      },
    }
  );

  if (!paymentResult.ok) {
    return paymentResult.response;
  }

  // 处理业务逻辑
  const body = await request.json();
  const response = new Response(
    JSON.stringify({
      message: "Request processed successfully",
      data: body,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );

  // 结算支付（如果启用异步结算，这会立即返回响应并在后台处理结算）
  const settlementResult = await paymentResult.settle(response);
  
  if (!settlementResult.ok) {
    return settlementResult.response;
  }

  return settlementResult.response;
}

// 另一个示例：OpenRouter 代理
export async function forwardToOpenRouter(request: Request) {
  const OPENROUTER_BASE_URL = "https://openrouter.ai";
  const DEFAULT_TARGET_PATH = "/api/v1/chat/completions";

  const paymentResult = await paymentPlugin.ensurePayment(
    request,
    {
      payTo: serviceAccount.address,
      price: "$0.01",
      network: process.env.NETWORK as "base-sepolia" | "base",
      config: {
        description: "OpenRouter proxy access",
        mimeType: "application/json",
      },
    }
  );

  if (!paymentResult.ok) {
    return paymentResult.response;
  }

  // 转发到 OpenRouter
  const url = new URL(request.url);
  const targetPath = url.pathname === "/openrouter" ? DEFAULT_TARGET_PATH : url.pathname;
  const targetUrl = `${OPENROUTER_BASE_URL}${targetPath}${url.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!["host", "content-length"].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set("Authorization", `Bearer ${process.env.OPENROUTER_API_KEY}`);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
    });
  } catch (error) {
    const errorResponse = new Response(
      JSON.stringify({ error: "Failed to reach OpenRouter" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
    return await paymentResult.settle(errorResponse);
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-security-policy");
  responseHeaders.delete("content-length");

  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });

  // 结算支付
  const settlementResult = await paymentResult.settle(response);
  return settlementResult.response;
}
