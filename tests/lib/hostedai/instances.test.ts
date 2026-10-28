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
  getUnifiedInstances,
  UnifiedInstancesUnavailableError,
  createScenario,
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

// Mock the region-maintenance resolver (createInstance gates on it). Keep the
// real RegionMaintenanceError so the thrown type is genuine.
const { mockIsRegionInMaintenance } = vi.hoisted(() => ({ mockIsRegionInMaintenance: vi.fn() }));
vi.mock('@/lib/maintenance/regions', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, isRegionInMaintenance: mockIsRegionInMaintenance };
});

import { hostedaiRequest } from '@/lib/hostedai/client';

const mockRequest = vi.mocked(hostedaiRequest);

describe('Instance Management', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockIsRegionInMaintenance.mockResolvedValue({ inMaintenance: false, message: '' });
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

      // createInstance defaults pod_opts.rootfs_enabled = true (Ariel rootfs
      // persistence, on by default for every provision).
      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/service/i/create-instance',
        { ...params, pod_opts: { rootfs_enabled: true } }
      );
      expect(result).toEqual(mockInstance);
    });

    it('defaults rootfs_enabled=true and merges into existing pod_opts', async () => {
      mockRequest.mockResolvedValueOnce({ id: 'i-1', name: 'x', status: 'creating' });
      await createInstance({
        name: 'x', service_id: 's', instance_type_id: 't',
        image_hash: 'h', root_storage_type_id: 'r', team_id: 'tm',
        pod_opts: { pool_id: 21, vgpus: 1, shared_volumes: [] },
      });
      expect(mockRequest).toHaveBeenCalledWith('POST', '/service/i/create-instance',
        expect.objectContaining({
          pod_opts: { pool_id: 21, vgpus: 1, shared_volumes: [], rootfs_enabled: true },
        }),
      );
    });

    it('respects an explicit rootfs_enabled=false (override wins)', async () => {
      mockRequest.mockResolvedValueOnce({ id: 'i-2', name: 'y', status: 'creating' });
      await createInstance({
        name: 'y', service_id: 's', instance_type_id: 't',
        image_hash: 'h', root_storage_type_id: 'r', team_id: 'tm',
        pod_opts: { vgpus: 1, rootfs_enabled: false },
      });
      expect(mockRequest).toHaveBeenCalledWith('POST', '/service/i/create-instance',
        expect.objectContaining({ pod_opts: { vgpus: 1, rootfs_enabled: false } }),
      );
    });

    it('blocks (throws) when the region is in maintenance — gate for snapshot/HF/v1 paths', async () => {
      mockIsRegionInMaintenance.mockResolvedValueOnce({ inMaintenance: true, message: 'Ariel upgrade' });
      await expect(
        createInstance({
          name: 'z', service_id: 's', instance_type_id: 't',
          image_hash: 'h', root_storage_type_id: 'r', team_id: 'tm', region_id: 6,
        }),
      ).rejects.toThrow('Ariel upgrade');
      expect(mockRequest).not.toHaveBeenCalled(); // never hits HAI
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
        '/gpuaas/compatible-instances/team-123',
        undefined,
        60000 // 60s timeout for large teams
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

    it('passes an extended timeout to scenario-compatible-services (PA-407)', async () => {
      // HAI takes 12-19s to answer this endpoint for the B200 scenario — the
      // default 15s GET timeout sat inside that band, so availability checks
      // timed out and surfaced as "No GPUs available". The call must opt out
      // of the default with an explicit longer timeout.
      const { getScenarioCompatibleServices } = await import('@/lib/hostedai/instances');
      mockRequest.mockResolvedValueOnce({ services: [], has_more_batches: false, next_offset: 0 });

      await getScenarioCompatibleServices('scenario-b200', 'team-123');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/service/i/scenario-compatible-services?scenario_id=scenario-b200&team_id=team-123&limit=50&offset=0',
        undefined,
        45_000
      );
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

  // HAI answers /instances/unified with a null "items" in two very different
  // situations, and the pagination envelope is the only thing that separates
  // them: a team with nothing running still carries total_items, an upstream
  // hiccup does not. Coercing the hiccup to [] renders a false-empty dashboard
  // and makes the deploy-flow stale-pod cleanup delete live pods' metadata
  // (PA-422); throwing on the empty team turns an idle account into a 503.
  // hostedai-user's ScenarioNameRegex — a name failing it is rejected outright,
  // so the coercion belongs here, where every caller goes through.
  describe('createScenario — HAI name rule', () => {
    const HAI_SCENARIO_NAME = /^[A-Za-z0-9 _-]+$/;

    it.each([
      ['Packet GPU: Inference', 'Packet GPU- Inference'],
      ['Packet GPU - A100 (80GB)', 'Packet GPU - A100 -80GB-'],
      ['  Packet Apps  ', 'Packet Apps'],
      ['Packet GPU - H100', 'Packet GPU - H100'],
    ])('coerces %s before sending it', async (input, expected) => {
      mockRequest.mockResolvedValue({ id: 'scn_1' });
      await createScenario({ name: input, description: 'd' });
      const sent = (mockRequest.mock.calls[0][2] as { name: string }).name;
      expect(sent).toBe(expected);
      expect(sent).toMatch(HAI_SCENARIO_NAME);
    });
  });

  describe('getUnifiedInstances — null-items guard', () => {
    it('returns the response when items is an array', async () => {
      const payload = { items: [{ id: 'inst-1' }], total_items: 1 };
      mockRequest.mockResolvedValueOnce(payload);

      const result = await getUnifiedInstances('team-1');

      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/instances/unified?page=0&per_page=100&team_id=team-1',
        undefined,
        60000
      );
      expect(result).toEqual(payload);
    });

    it('returns an empty result untouched (genuinely no instances)', async () => {
      mockRequest.mockResolvedValueOnce({ items: [], total_items: 0 });

      const result = await getUnifiedInstances('team-1');

      expect(result.items).toEqual([]);
    });

    // PA-883 regression: this is the byte-for-byte body HAI returns for a team
    // with no instances, and the shape the old guard misread as an outage.
    it('reads the empty-team body as an empty list, not a failure', async () => {
      mockRequest.mockResolvedValueOnce({
        items: null,
        status_counts: null,
        page: 0,
        per_page: 100,
        total_items: 0,
        total_pages: 0,
      });

      const result = await getUnifiedInstances('team-1');

      expect(result.items).toEqual([]);
      expect(result.total_items).toBe(0);
    });

    it('reads a missing items with a pagination envelope as an empty list', async () => {
      mockRequest.mockResolvedValueOnce({ total_items: 0, total_pages: 0 });

      await expect(getUnifiedInstances('team-1')).resolves.toMatchObject({ items: [] });
    });

    it('throws when items is null and there is no pagination envelope', async () => {
      mockRequest.mockResolvedValueOnce({ items: null });

      await expect(getUnifiedInstances('team-1')).rejects.toBeInstanceOf(
        UnifiedInstancesUnavailableError
      );
    });

    it('throws on a null total_items (envelope present in name only)', async () => {
      mockRequest.mockResolvedValueOnce({ items: null, total_items: null });

      await expect(getUnifiedInstances('team-1')).rejects.toBeInstanceOf(
        UnifiedInstancesUnavailableError
      );
    });

    // The client turns an empty body into {} and a non-JSON body into
    // { success: true }; neither carries an envelope, so both stay failures.
    it.each([
      ['an empty response body', {}],
      ['an unparseable response body', { success: true }],
      ['an error object', { error: 'upstream unavailable' }],
    ])('throws on %s', async (_label, payload) => {
      mockRequest.mockResolvedValueOnce(payload);

      await expect(getUnifiedInstances('team-1')).rejects.toBeInstanceOf(
        UnifiedInstancesUnavailableError
      );
    });

    it('propagates a non-2xx upstream error rather than reporting empty', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Hosted.ai API error (502): bad gateway'));

      await expect(getUnifiedInstances('team-1')).rejects.toThrow('(502)');
    });
  });
});
