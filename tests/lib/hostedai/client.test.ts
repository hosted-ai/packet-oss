import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hostedaiRequest,
  getCached,
  setCache,
  clearCache,
  getApiUrl,
  getApiKey,
} from '@/lib/hostedai/client';

// Environment variables are set in tests/setup.ts
const MOCK_API_URL = process.env.HOSTEDAI_API_URL!;
const MOCK_API_KEY = process.env.HOSTEDAI_API_KEY!;

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock console methods to avoid noise in test output
const mockConsole = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

describe('HostedAI Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearCache(); // Clear cache before each test
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('hostedaiRequest', () => {
    it('should make a successful GET request', async () => {
      const mockData = { id: '123', name: 'Test Instance' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockData),
      });

      const result = await hostedaiRequest('GET', '/instances/123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_API_URL}/api/instances/123`,
        {
          method: 'GET',
          headers: {
            'X-API-Key': MOCK_API_KEY,
            'Content-Type': 'application/json',
          },
          body: undefined,
        }
      );
      expect(result).toEqual(mockData);
    });

    it('should make a successful POST request with body', async () => {
      const requestData = { name: 'New Instance', type: 'gpu' };
      const mockResponse = { id: '456', ...requestData };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await hostedaiRequest('POST', '/instances', requestData);

      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_API_URL}/api/instances`,
        {
          method: 'POST',
          headers: {
            'X-API-Key': MOCK_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData),
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle empty response body (200 with no content)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      const result = await hostedaiRequest('DELETE', '/instances/123');

      expect(result).toEqual({});
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] Empty response')
      );
    });

    it('should handle non-JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const result = await hostedaiRequest('PUT', '/instances/123/start');

      expect(result).toEqual({ success: true });
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] Non-JSON response'),
        'OK'
      );
    });

    it('should throw error on 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'Instance not found' }),
      });

      await expect(
        hostedaiRequest('GET', '/instances/999')
      ).rejects.toThrow('Hosted.ai API error (404): Instance not found');

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] API error 404'),
        expect.any(String)
      );
    });

    it('should throw error on 500 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: 'Internal server error' }),
      });

      await expect(
        hostedaiRequest('POST', '/instances')
      ).rejects.toThrow('Hosted.ai API error (500): Internal server error');
    });

    it('should handle error response with validation errors array', async () => {
      const errorResponse = {
        message: 'Validation failed',
        errors: [
          { field: 'name', message: 'Name is required' },
          { field: 'type', message: 'Invalid type' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
      });

      await expect(
        hostedaiRequest('POST', '/instances')
      ).rejects.toThrow(
        'Hosted.ai API error (400): Validation failed (name: Name is required, type: Invalid type)'
      );
    });

    it('should handle non-JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Temporarily Unavailable',
      });

      await expect(
        hostedaiRequest('GET', '/instances')
      ).rejects.toThrow(
        'Hosted.ai API error (503): Service Temporarily Unavailable'
      );
    });

    it('should handle network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        hostedaiRequest('GET', '/instances')
      ).rejects.toThrow('Network error');
    });

    it('should include authentication headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await hostedaiRequest('GET', '/test');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['X-API-Key']).toBe(MOCK_API_KEY);
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Cache functionality', () => {
    it('should cache and retrieve data', () => {
      const testData = { id: '123', name: 'Test' };

      setCache('test-key', testData);
      const cached = getCached('test-key');

      expect(cached).toEqual(testData);
    });

    it('should return null for non-existent cache key', () => {
      const cached = getCached('non-existent-key');
      expect(cached).toBeNull();
    });

    it('should expire cache after TTL (5 minutes)', () => {
      const testData = { id: '123', name: 'Test' };

      setCache('test-key', testData);

      // Initially cached
      expect(getCached('test-key')).toEqual(testData);

      // Advance time by 5 minutes + 1 second
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Should be expired
      expect(getCached('test-key')).toBeNull();
    });

    it('should not expire cache before TTL', () => {
      const testData = { id: '123', name: 'Test' };

      setCache('test-key', testData);

      // Advance time by 4 minutes (less than 5 minute TTL)
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Should still be cached
      expect(getCached('test-key')).toEqual(testData);
    });

    it('should clear all cache when no pattern provided', () => {
      setCache('key1', { data: 'test1' });
      setCache('key2', { data: 'test2' });
      setCache('key3', { data: 'test3' });

      clearCache();

      expect(getCached('key1')).toBeNull();
      expect(getCached('key2')).toBeNull();
      expect(getCached('key3')).toBeNull();
    });

    it('should clear cache matching pattern', () => {
      setCache('instances:123', { id: '123' });
      setCache('instances:456', { id: '456' });
      setCache('pools:789', { id: '789' });

      clearCache('instances');

      expect(getCached('instances:123')).toBeNull();
      expect(getCached('instances:456')).toBeNull();
      expect(getCached('pools:789')).toEqual({ id: '789' });
    });

    it('should log cache hits', () => {
      setCache('test-key', { data: 'test' });
      getCached('test-key');

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] Cache hit for test-key')
      );
    });
  });

  describe('Environment configuration', () => {
    it('should return correct API URL', () => {
      expect(getApiUrl()).toBe(MOCK_API_URL);
    });

    it('should return correct API key', () => {
      expect(getApiKey()).toBe(MOCK_API_KEY);
    });
  });

  describe('Request logging', () => {
    it('should log request details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await hostedaiRequest('POST', '/test', { key: 'value' });

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] POST')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] Request body:'),
        expect.any(String)
      );
    });

    it('should log response details', async () => {
      const responseData = { id: '123', status: 'active' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseData),
      });

      await hostedaiRequest('GET', '/test');

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[Hosted.AI] Response:'),
        expect.any(String)
      );
    });
  });
});
