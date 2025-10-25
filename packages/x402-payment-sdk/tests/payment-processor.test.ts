import { describe, it, expect, vi } from 'vitest';
import { PaymentProcessor } from '../src/core/payment-processor';
import type { PaymentServerConfig } from '../src/types';

// Mock facilitator
const mockFacilitator = {
  url: 'https://facilitator.example.com' as const,
  createAuthHeaders: vi.fn().mockResolvedValue({
    verify: { 'Authorization': 'Bearer token' },
    settle: { 'Authorization': 'Bearer token' },
    supported: { 'Authorization': 'Bearer token' },
  }),
};

const mockConfig: PaymentServerConfig = {
  recipient: '0x1234567890123456789012345678901234567890' as any,
  facilitator: mockFacilitator,
  network: 'base',
};

describe('PaymentProcessor', () => {
  it('should create payment requirements', () => {
    const processor = new PaymentProcessor(mockConfig);
    const mockRequest = new Request('http://localhost/test');
    
    const requirements = processor.createPaymentRequirements(
      mockRequest,
      0.001,
      'http://localhost/test'
    );

    expect(requirements).toHaveProperty('scheme', 'exact');
    expect(requirements).toHaveProperty('network', 'base');
    expect(requirements).toHaveProperty('payTo', mockConfig.recipient);
  });

  it('should handle invalid payment data', async () => {
    const processor = new PaymentProcessor(mockConfig);
    const mockRequest = new Request('http://localhost/test');
    
    const requirements = processor.createPaymentRequirements(
      mockRequest,
      0.001,
      'http://localhost/test'
    );

    if ('scheme' in requirements) {
      const result = await processor.verifyPayment('invalid-payment', requirements);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PAYMENT');
    }
  });
});
