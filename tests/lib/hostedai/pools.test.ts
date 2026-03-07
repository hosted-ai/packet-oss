import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAvailableRegions,
  getAvailablePools,
  getPoolSubscriptions,
  subscribeToPool,
  unsubscribeFromPool,
  scalePoolSubscription,
  calculatePoolSubscriptionCost,
  getConnectionInfo,
  podAction,
  reimagePoolSubscription,
  getAllPools,
  getPoolInstanceTypes,
  getPoolEphemeralStorageBlocks,
  getPoolPersistentStorageBlocks,
  createSharedVolume,
  getSharedVolumes,
  deleteSharedVolume,
} from '@/lib/hostedai/pools';
import type {
  GPURegion,
  GPUPool,
  PoolSubscription,
  PoolSubscriptionCostEstimate,
  SubscriptionConnectionInfo,
  SharedVolume,
} from '@/lib/hostedai/types';

// Mock the client module
vi.mock('@/lib/hostedai/client', () => ({
  hostedaiRequest: vi.fn(),
  getCached: vi.fn(),
  setCache: vi.fn(),
  clearCache: vi.fn(),
  getApiUrl: vi.fn(() => 'https://api.test.hostedai.com'),
  getApiKey: vi.fn(() => 'test-api-key'),
}));

// Mock the subscription lineage module (uses Prisma)
vi.mock('@/lib/subscription-lineage', () => ({
  recordSubscriptionLineage: vi.fn().mockResolvedValue(undefined),
}));

import {
  hostedaiRequest,
  getCached,
  setCache,
  clearCache,
} from '@/lib/hostedai/client';

const mockRequest = vi.mocked(hostedaiRequest);
const mockGetCached = vi.mocked(getCached);
const mockSetCache = vi.mocked(setCache);
const mockClearCache = vi.mocked(clearCache);

// Mock global fetch for getAvailablePools
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Pool Management', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockGetCached.mockReset();
    mockSetCache.mockReset();
    mockClearCache.mockReset();
    mockFetch.mockReset();
  });

  describe('getAvailableRegions', () => {
    it('should fetch available regions', async () => {
      const mockRegions: GPURegion[] = [
        {
          id: 'region-1',
          name: 'US East',
          location: 'Virginia',
          available_pools: 5,
        },
        {
          id: 'region-2',
          name: 'EU West',
          location: 'Ireland',
          available_pools: 3,
        },
      ];

      mockRequest.mockResolvedValueOnce(mockRegions);

      const result = await getAvailableRegions('team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/available-regions?team_id=team-123'
      );
      expect(result).toEqual(mockRegions);
    });
  });

  describe('getAvailablePools', () => {
    it('should fetch and transform available pools', async () => {
      const apiResponse = [
        {
          id: 1,
          pool_name: 'GPU Pool 1',
          gpu_model_type: 'NVIDIA A100',
          available_vgpus: 10,
          pricing_hourly: '2.50',
        },
        {
          id: 2,
          pool_name: 'GPU Pool 2',
          gpu_model_type: 'NVIDIA V100',
          available_vgpus: 5,
          pricing_hourly: '1.75',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(apiResponse),
      });

      const result = await getAvailablePools('team-123', 'gpuaas-1');

      expect(result).toEqual([
        {
          id: '1',
          name: 'GPU Pool 1',
          gpu_model: 'NVIDIA A100',
          available_gpus: 10,
          price_per_hour: 2.5,
        },
        {
          id: '2',
          name: 'GPU Pool 2',
          gpu_model: 'NVIDIA V100',
          available_gpus: 5,
          price_per_hour: 1.75,
        },
      ]);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        getAvailablePools('team-123', 'gpuaas-1')
      ).rejects.toThrow('Hosted.ai API error: 500');
    });

    it('should return empty array for empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

      const result = await getAvailablePools('team-123', 'gpuaas-1');

      expect(result).toEqual([]);
    });
  });

  describe('getPoolSubscriptions', () => {
    it('should fetch pool subscriptions with cache', async () => {
      const mockSubs: PoolSubscription[] = [
        {
          id: 'sub-1',
          pool_id: 'pool-1',
          pool_name: 'GPU Pool 1',
          status: 'active',
          gpu_count: 2,
        },
      ];

      // First call - cache miss
      mockGetCached.mockReturnValueOnce(null);
      mockRequest.mockResolvedValueOnce({
        items: mockSubs,
        page: 0,
        per_page: 100,
        total_items: 1,
        total_pages: 1,
      });

      const result1 = await getPoolSubscriptions('team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/pool-subscription?team_id=team-123&page=0&per_page=100'
      );
      expect(result1).toEqual(mockSubs);
      expect(mockSetCache).toHaveBeenCalled();

      // Second call - cache hit
      mockGetCached.mockReturnValueOnce(mockSubs);
      const result2 = await getPoolSubscriptions('team-123');

      expect(result2).toEqual(mockSubs);
      expect(mockRequest).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should support metric window parameter', async () => {
      mockGetCached.mockReturnValueOnce(null);
      mockRequest.mockResolvedValueOnce({ items: [] });

      await getPoolSubscriptions('team-123', 'last_24h');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/pool-subscription?team_id=team-123&page=0&per_page=100&metric_window=last_24h'
      );
    });
  });

  describe('subscribeToPool', () => {
    it('should subscribe to a pool successfully', async () => {
      mockRequest.mockResolvedValueOnce({ subscription_id: 'sub-123' });

      const result = await subscribeToPool({
        pool_id: '123', // Use numeric string
        team_id: 'team-123',
        vgpus: 2,
        instance_type_id: 'type-1',
        ephemeral_storage_block_id: 'storage-1',
        image_uuid: 'image-abc',
      });

      expect(result).toEqual({ subscription_id: 'sub-123' });
      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/gpuaas/pool/subscribe',
        expect.objectContaining({
          pool_id: 123, // Converted to number
          team_id: 'team-123',
          vgpus: 2,
          instance_type_id: 'type-1',
        })
      );
    });

    it('should handle already subscribed error and find existing subscription', async () => {
      // First call - subscription fails with 409
      mockRequest.mockRejectedValueOnce(
        new Error('Hosted.ai API error (409): Already subscribed')
      );

      // Second call - fetch subscriptions
      mockGetCached.mockReturnValueOnce(null);
      mockRequest.mockResolvedValueOnce({
        items: [
          {
            id: 'sub-existing',
            pool_id: '456', // Use numeric string that matches
            status: 'subscribed',
          },
        ],
      });

      const result = await subscribeToPool({
        pool_id: '456',
        team_id: 'team-123',
        vgpus: 1,
        instance_type_id: 'type-1',
      });

      expect(result).toEqual({ subscription_id: 'sub-existing' });
      expect(mockClearCache).toHaveBeenCalled();
    });

    it('should throw error when subscription not found after polling', async () => {
      // Subscribe returns empty
      mockRequest.mockResolvedValueOnce({});

      // All polls return empty - subscription never appears
      for (let i = 0; i < 10; i++) {
        mockGetCached.mockReturnValueOnce(null);
        mockRequest.mockResolvedValueOnce({ items: [] });
      }

      // Should timeout after polling attempts
      await expect(
        subscribeToPool({
          pool_id: '999',
          team_id: 'team-123',
          vgpus: 1,
          instance_type_id: 'type-1',
        })
      ).rejects.toThrow('Failed to create subscription - no subscription found after subscribing');
    }, 60000);
  });

  describe('unsubscribeFromPool', () => {
    it('should unsubscribe from a pool', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await unsubscribeFromPool('123', 'team-123', '456');

      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/gpuaas/pool/unsubscribe',
        {
          subscription_id: 123,
          team_id: 'team-123',
          pool_id: 456,
        }
      );
    });
  });

  describe('scalePoolSubscription', () => {
    it('should scale subscription by unsubscribing and resubscribing', async () => {
      vi.useFakeTimers();

      // Unsubscribe
      mockRequest.mockResolvedValueOnce(undefined);

      // Check unsubscribe status - first call still unsubscribing
      mockRequest.mockResolvedValueOnce({
        items: [{ id: '123', pool_id: '456', status: 'un_subscribing' }],
      });

      // Second check - unsubscribed
      setTimeout(() => {
        mockRequest.mockResolvedValueOnce({ items: [] });
        // Resubscribe
        mockRequest.mockResolvedValueOnce({ subscription_id: 'sub-new' });
      }, 1000);

      const promise = scalePoolSubscription({
        subscriptionId: '123',
        poolId: '456',
        teamId: 'team-123',
        vgpus: 4,
        instanceTypeId: 'type-1',
        ephemeralStorageBlockId: 'storage-1',
      });

      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toEqual({ subscription_id: 'sub-new' });

      vi.useRealTimers();
    });
  });

  describe('calculatePoolSubscriptionCost', () => {
    it('should calculate subscription cost', async () => {
      const mockEstimate: PoolSubscriptionCostEstimate = {
        total_cost: 48,
        hourly_cost: 2,
        currency: 'USD',
        breakdown: {
          gpu_cost: 40,
          storage_cost: 8,
        },
      };

      mockRequest.mockResolvedValueOnce(mockEstimate);

      const result = await calculatePoolSubscriptionCost({
        pool_id: 'pool-1',
        gpu_count: 2,
        duration_hours: 24,
        team_id: 'team-123',
      });

      expect(result).toEqual(mockEstimate);
      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/gpuaas/calculate-pool-subscription',
        {
          pool_id: 'pool-1',
          gpu_count: 2,
          duration_hours: 24,
          team_id: 'team-123',
        }
      );
    });

    it('should return fallback estimate on error', async () => {
      mockRequest.mockRejectedValueOnce(new Error('API error'));

      const result = await calculatePoolSubscriptionCost({
        pool_id: 'pool-1',
        gpu_count: 3,
        duration_hours: 10,
        team_id: 'team-123',
      });

      // Fallback: 3 GPUs * $2/hour * 10 hours = $60
      expect(result).toEqual({
        total_cost: 60,
        hourly_cost: 6,
        currency: 'USD',
      });
    });
  });

  describe('getConnectionInfo', () => {
    it('should fetch connection info with caching', async () => {
      const mockInfo: SubscriptionConnectionInfo[] = [
        {
          id: 1,
          pool_name: 'GPU Pool',
          region_id: 1,
          pods: [
            {
              pod_name: 'pod-1',
              pod_status: 'Running',
              ssh_info: {
                cmd: 'ssh user@host',
                pass: 'password123',
              },
            },
          ],
        },
      ];

      mockGetCached.mockReturnValueOnce(null);
      mockRequest.mockResolvedValueOnce(mockInfo);

      const result = await getConnectionInfo('team-123', 'sub-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/connection-info?team_id=team-123&subscription_id=sub-123'
      );
      expect(result).toEqual(mockInfo);
      expect(mockSetCache).toHaveBeenCalled();
    });
  });

  describe('podAction', () => {
    it('should execute pod start action', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });

      const result = await podAction('pod-1', '123', 'start');

      expect(mockRequest).toHaveBeenCalledWith('POST', '/pods/action', {
        pod_name: 'pod-1',
        pool_subscription_id: 123,
        pod_action: 'start',
      });
      expect(result).toEqual({ success: true });
    });

    it('should execute pod restart action', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });

      await podAction('pod-1', '123', 'restart');

      expect(mockRequest).toHaveBeenCalledWith('POST', '/pods/action', {
        pod_name: 'pod-1',
        pool_subscription_id: 123,
        pod_action: 'restart',
      });
    });
  });

  describe('Shared volumes', () => {
    it('should create shared volume', async () => {
      const mockVolume: SharedVolume = {
        id: 1,
        name: 'my-volume',
        region_id: 1,
        team_id: 'team-123',
        size_in_gb: 500,
        mount_point: '/mnt/shared',
        cost: '0.10',
        status: 'active',
      };

      mockRequest.mockResolvedValueOnce(mockVolume);

      const result = await createSharedVolume({
        team_id: 'team-123',
        region_id: 1,
        name: 'my-volume',
        storage_block_id: 'storage-1',
      });

      expect(result).toEqual(mockVolume);
    });

    it('should get shared volumes', async () => {
      const mockVolumes: SharedVolume[] = [
        {
          id: 1,
          name: 'volume-1',
          region_id: 1,
          team_id: 'team-123',
          size_in_gb: 500,
          mount_point: '/mnt/v1',
          cost: '0.10',
          status: 'active',
        },
      ];

      mockRequest.mockResolvedValueOnce(mockVolumes);

      const result = await getSharedVolumes('team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/shared-volumes?team_id=team-123'
      );
      expect(result).toEqual(mockVolumes);
    });

    it('should delete shared volume', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await deleteSharedVolume(1);

      expect(mockRequest).toHaveBeenCalledWith('DELETE', '/shared-volumes/1');
    });
  });

  describe('Pool configuration', () => {
    it('should get pool instance types', async () => {
      const mockTypes = [
        { id: 'type-1', name: 'Small', cpu_cores: 4, ram_gb: 16 },
      ];

      mockRequest.mockResolvedValueOnce(mockTypes);

      const result = await getPoolInstanceTypes('region-1', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/pool/compatible-instance-types?region_id=region-1&team_id=team-123'
      );
      expect(result).toEqual(mockTypes);
    });

    it('should get ephemeral storage blocks', async () => {
      const mockBlocks = [
        { id: 'storage-1', name: '100GB', size_gb: 100, price_per_hour: 0.05 },
      ];

      mockRequest.mockResolvedValueOnce(mockBlocks);

      const result = await getPoolEphemeralStorageBlocks('region-1', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/pool/ephemeral-storage-blocks?region_id=region-1&team_id=team-123'
      );
      expect(result).toEqual(mockBlocks);
    });

    it('should get persistent storage blocks', async () => {
      const mockBlocks = [
        { id: 'storage-1', name: '500GB', size_gb: 500, price_per_hour: 0.1 },
      ];

      mockRequest.mockResolvedValueOnce(mockBlocks);

      const result = await getPoolPersistentStorageBlocks('region-1', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/pool/persistent-storage-blocks?region_id=region-1&team_id=team-123'
      );
      expect(result).toEqual(mockBlocks);
    });
  });

  describe('reimagePoolSubscription', () => {
    it('should reimage a pool subscription', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await reimagePoolSubscription('123', 'team-123', 'new-image-uuid');

      expect(mockRequest).toHaveBeenCalledWith('POST', '/gpuaas/pool/reimage', {
        subscription_id: 123,
        team_id: 'team-123',
        image_uuid: 'new-image-uuid',
      });
    });
  });

  describe('getAllPools', () => {
    it('should get and transform all pools', async () => {
      const mockRawPools = [
        {
          pool_id: 1,
          pool_name: 'NVIDIA A100 Pool',
          gpuaas_id: 10,
          region_id: 5,
        },
        {
          pool_id: 2,
          pool_name: 'NVIDIA V100 Pool',
          gpuaas_id: 11,
          region_id: 6,
        },
      ];

      mockRequest.mockResolvedValueOnce(mockRawPools);

      const result = await getAllPools();

      expect(mockRequest).toHaveBeenCalledWith('GET', '/gpuaas/all-pools');
      expect(result).toEqual([
        {
          id: '1',
          name: 'NVIDIA A100 Pool',
          gpu_model: 'NVIDIA A100 Pool',
          gpuaas_id: 10,
          region_id: 5,
        },
        {
          id: '2',
          name: 'NVIDIA V100 Pool',
          gpu_model: 'NVIDIA V100 Pool',
          gpuaas_id: 11,
          region_id: 6,
        },
      ]);
    });
  });
});
