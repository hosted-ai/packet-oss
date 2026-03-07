import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getInstance,
  createInstance,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  getTeamInstances,
  startVNCSession,
  stopVNCSession,
  renameInstance,
  factoryResetInstance,
  getAddDiskPricing,
  addDisksToInstance,
  getCompatibleServiceScenarios,
  getInstanceTypes,
  getCompatibleImages,
  getImagePolicies,
  getGPUaaSImages,
  getStorageBlocks,
} from '@/lib/hostedai/instances';
import type {
  Instance,
  CreateInstanceParams,
  VNCSession,
  AddDiskPricing,
  AddDiskParams,
  CompatibleScenariosResponse,
  InstanceType,
  Image,
  ImagePolicy,
  StorageBlock,
} from '@/lib/hostedai/types';

// Mock the client module
vi.mock('@/lib/hostedai/client', () => ({
  hostedaiRequest: vi.fn(),
}));

import { hostedaiRequest } from '@/lib/hostedai/client';

const mockRequest = vi.mocked(hostedaiRequest);

describe('Instance Management', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  describe('getInstance', () => {
    it('should fetch instance details', async () => {
      const mockInstance: Instance = {
        id: 'inst-123',
        name: 'Test Instance',
        status: 'running',
        instance_type: {
          id: 'type-1',
          name: 'GPU-Large',
          cpu_cores: 8,
          ram_gb: 32,
        },
      };

      mockRequest.mockResolvedValueOnce(mockInstance);

      const result = await getInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/instance/inst-123');
      expect(result).toEqual(mockInstance);
    });

    it('should handle errors when fetching instance', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Instance not found'));

      await expect(getInstance('invalid-id')).rejects.toThrow('Instance not found');
    });
  });

  describe('createInstance', () => {
    it('should create a new instance', async () => {
      const params: CreateInstanceParams = {
        name: 'New Instance',
        service_id: 'service-1',
        instance_type_id: 'type-1',
        image_hash_id: 'image-123',
        storage_block_id: 'storage-1',
        team_id: 'team-abc',
      };

      const mockInstance: Instance = {
        id: 'inst-456',
        name: params.name,
        status: 'creating',
      };

      mockRequest.mockResolvedValueOnce(mockInstance);

      const result = await createInstance(params);

      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/service/i/create-instance',
        params
      );
      expect(result).toEqual(mockInstance);
    });

    it('should handle validation errors', async () => {
      const params: CreateInstanceParams = {
        name: '',
        service_id: 'service-1',
        instance_type_id: 'type-1',
        image_hash_id: 'image-123',
        storage_block_id: 'storage-1',
        team_id: 'team-abc',
      };

      mockRequest.mockRejectedValueOnce(
        new Error('Validation failed: name is required')
      );

      await expect(createInstance(params)).rejects.toThrow('Validation failed');
    });
  });

  describe('Instance lifecycle operations', () => {
    it('should start an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await startInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('PUT', '/instance/inst-123/start');
    });

    it('should stop an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await stopInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('PUT', '/instance/inst-123/stop');
    });

    it('should restart an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await restartInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('PUT', '/instance/inst-123/restart');
    });

    it('should delete an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await deleteInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('DELETE', '/instance/inst-123');
    });

    it('should handle errors during lifecycle operations', async () => {
      mockRequest.mockRejectedValueOnce(
        new Error('Instance is already stopped')
      );

      await expect(stopInstance('inst-123')).rejects.toThrow(
        'Instance is already stopped'
      );
    });
  });

  describe('getTeamInstances', () => {
    it('should fetch team instances', async () => {
      const mockInstances: Instance[] = [
        { id: 'inst-1', name: 'Instance 1', status: 'running' },
        { id: 'inst-2', name: 'Instance 2', status: 'stopped' },
      ];

      mockRequest.mockResolvedValueOnce(mockInstances);

      const result = await getTeamInstances('team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/gpuaas/compatible-instances/team-123'
      );
      expect(result).toEqual(mockInstances);
    });

    it('should return empty array when no instances found', async () => {
      mockRequest.mockResolvedValueOnce([]);

      const result = await getTeamInstances('team-empty');

      expect(result).toEqual([]);
    });
  });

  describe('VNC session management', () => {
    it('should start VNC session', async () => {
      const mockSession: VNCSession = {
        url: 'https://vnc.example.com/session-123',
        token: 'vnc-token-abc',
        websocket_url: 'wss://vnc.example.com/ws/session-123',
        expires_at: '2024-01-01T12:00:00Z',
      };

      mockRequest.mockResolvedValueOnce(mockSession);

      const result = await startVNCSession('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('POST', '/instance/inst-123/vnc');
      expect(result).toEqual(mockSession);
    });

    it('should stop VNC session', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await stopVNCSession('inst-123');

      expect(mockRequest).toHaveBeenCalledWith('DELETE', '/instance/inst-123/vnc');
    });
  });

  describe('Instance management operations', () => {
    it('should rename an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await renameInstance('inst-123', 'New Name');

      expect(mockRequest).toHaveBeenCalledWith(
        'PUT',
        '/instance/inst-123/rename',
        { name: 'New Name' }
      );
    });

    it('should factory reset an instance', async () => {
      mockRequest.mockResolvedValueOnce(undefined);

      await factoryResetInstance('inst-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'PUT',
        '/instance/inst-123/factory_reset'
      );
    });
  });

  describe('Disk management', () => {
    it('should get add disk pricing', async () => {
      const mockPricing: AddDiskPricing = {
        hourly_cost: 0.5,
        monthly_cost: 360,
        currency: 'USD',
        storage_block: {
          id: 'storage-1',
          name: '500GB SSD',
          size_gb: 500,
        },
      };

      mockRequest.mockResolvedValueOnce(mockPricing);

      const result = await getAddDiskPricing('inst-123', 'storage-1');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/instance/inst-123/add-disk/pricing?storage_block_id=storage-1'
      );
      expect(result).toEqual(mockPricing);
    });

    it('should add disks to instance', async () => {
      const disks: AddDiskParams[] = [
        { storage_block_id: 'storage-1', disk_position: 1 },
        { storage_block_id: 'storage-2', disk_position: 2 },
      ];

      mockRequest.mockResolvedValueOnce(undefined);

      await addDisksToInstance('inst-123', disks);

      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/instance/inst-123/add-disks',
        { disks }
      );
    });
  });

  describe('Service scenarios and configuration', () => {
    it('should get compatible service scenarios', async () => {
      const mockScenarios: CompatibleScenariosResponse = {
        scenarios: [
          {
            id: 'scenario-1',
            name: 'GPU Workload',
            description: 'High-performance GPU instances',
            services: [1, 2, 3],
          },
        ],
        images: {
          'image-1': { name: 'Ubuntu 22.04', description: 'Latest LTS' },
        },
      };

      mockRequest.mockResolvedValueOnce(mockScenarios);

      const result = await getCompatibleServiceScenarios('team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/compatible-service-scenarios?team_id=team-123'
      );
      expect(result).toEqual(mockScenarios);
    });

    it('should get instance types', async () => {
      const mockTypes: InstanceType[] = [
        {
          id: 'type-1',
          name: 'GPU-Large',
          cpu_cores: 8,
          ram_gb: 32,
          gpu_count: 2,
          price_per_hour: 5.0,
        },
      ];

      mockRequest.mockResolvedValueOnce(mockTypes);

      const result = await getInstanceTypes('service-1', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/service/i/instance-types?service_id=service-1&team_id=team-123'
      );
      expect(result).toEqual(mockTypes);
    });

    it('should get compatible images', async () => {
      const mockImages: Image[] = [
        { id: 'img-1', name: 'Ubuntu 22.04', os: 'Linux' },
        { id: 'img-2', name: 'Windows Server 2022', os: 'Windows' },
      ];

      mockRequest.mockResolvedValueOnce(mockImages);

      const result = await getCompatibleImages('service-1', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/service/i/compatible-images?service_id=service-1&team_id=team-123'
      );
      expect(result).toEqual(mockImages);
    });

    it('should get storage blocks', async () => {
      const mockBlocks: StorageBlock[] = [
        { id: 'storage-1', name: '500GB SSD', size_gb: 500, price_per_hour: 0.1 },
        { id: 'storage-2', name: '1TB HDD', size_gb: 1000, price_per_hour: 0.05 },
      ];

      mockRequest.mockResolvedValueOnce(mockBlocks);

      const result = await getStorageBlocks();

      expect(mockRequest).toHaveBeenCalledWith('GET', '/storage-blocks');
      expect(result).toEqual(mockBlocks);
    });
  });

  describe('Image policies', () => {
    it('should get image policies', async () => {
      const mockPolicies: ImagePolicy[] = [
        {
          id: 'policy-1',
          name: 'GPUaaS Policy',
          type: 'image',
          is_default: true,
          objects: [
            { id: 'img-1', name: 'Ubuntu 22.04', gpu_workload_image: true },
          ],
          teams: [{ id: 'team-1', name: 'Test Team' }],
        },
      ];

      mockRequest.mockResolvedValueOnce(mockPolicies);

      const result = await getImagePolicies();

      expect(mockRequest).toHaveBeenCalledWith('GET', '/policy/image');
      expect(result).toEqual(mockPolicies);
    });

    it('should get GPUaaS images for specific team', async () => {
      const mockPolicies: ImagePolicy[] = [
        {
          id: 'policy-1',
          name: 'Team Policy',
          type: 'image',
          objects: [
            { id: 'img-1', name: 'Team Image', gpu_workload_image: true },
          ],
          teams: [{ id: 'team-123', name: 'Test Team' }],
        },
      ];

      mockRequest.mockResolvedValueOnce(mockPolicies);

      const result = await getGPUaaSImages('team-123');

      expect(result).toEqual(mockPolicies[0].objects);
    });

    it('should fallback to default GPUaaS Policy', async () => {
      const mockPolicies: ImagePolicy[] = [
        {
          id: 'policy-1',
          name: 'Other Policy',
          type: 'image',
          objects: [],
          teams: [{ id: 'team-456', name: 'Other Team' }],
        },
        {
          id: 'policy-2',
          name: 'GPUaaS Policy',
          type: 'image',
          objects: [
            { id: 'img-1', name: 'Default Image', gpu_workload_image: true },
          ],
          teams: [],
        },
      ];

      mockRequest.mockResolvedValueOnce(mockPolicies);

      const result = await getGPUaaSImages('team-123');

      expect(result).toEqual(mockPolicies[1].objects);
    });

    it('should return empty array when no policies found', async () => {
      mockRequest.mockResolvedValueOnce([]);

      const result = await getGPUaaSImages('team-123');

      expect(result).toEqual([]);
    });
  });
});
