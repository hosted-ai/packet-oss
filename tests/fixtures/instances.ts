export const testInstance = {
  id: 'test-instance-id',
  customerId: 'test-customer-id',
  name: 'test-instance',
  status: 'running' as const,
  region: 'us-east-1',
  cpu: 2,
  memory: 4096,
  storage: 50,
  ipAddress: '192.168.1.100',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

export const testInstanceList = [
  {
    id: 'test-instance-1',
    customerId: 'test-customer-id',
    name: 'instance-1',
    status: 'running' as const,
    region: 'us-east-1',
    cpu: 2,
    memory: 4096,
    storage: 50,
    ipAddress: '192.168.1.101',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
  {
    id: 'test-instance-2',
    customerId: 'test-customer-id',
    name: 'instance-2',
    status: 'stopped' as const,
    region: 'us-west-1',
    cpu: 4,
    memory: 8192,
    storage: 100,
    ipAddress: '192.168.1.102',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
];

export const testPodMetadata = {
  name: 'test-pod',
  namespace: 'default',
  labels: {
    app: 'test-app',
    environment: 'test',
  },
  annotations: {
    'example.com/created-by': 'test-user',
  },
  uid: 'test-pod-uid',
  creationTimestamp: '2024-01-01T00:00:00.000Z',
  resourceVersion: '1234',
};
