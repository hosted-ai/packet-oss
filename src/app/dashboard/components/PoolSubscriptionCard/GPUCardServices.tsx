"use client";

import { useState } from "react";

interface ExposedService {
  id: number;
  service_name: string;
  port: number;
  internal_port?: number;
  external_port?: number;
  protocol: string;
  type?: string;
  service_type?: string;
  status?: string;
  ip?: string;
}

interface ServiceForm {
  service_name: string;
  port: string;
  protocol: 'TCP' | 'UDP';
  service_type: string; // TCP: 'http'|'https', UDP: 'NodePort'|'loadbalancer'
}

interface GPUCardServicesProps {
  exposedServices: ExposedService[];
  loadingServices: boolean;
  token: string;
  subscriptionId: string;
  podName?: string;
  onServicesUpdated: (services: ExposedService[]) => void;
}

export function GPUCardServices({
  exposedServices,
  loadingServices,
  token,
  subscriptionId,
  podName,
  onServicesUpdated,
}: GPUCardServicesProps) {
  const [showExposeServiceForm, setShowExposeServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState<ServiceForm>({
    service_name: '',
    port: '',
    protocol: 'TCP',
    service_type: 'http', // Default for TCP (hosted.ai API requirement)
  });
  const [submittingService, setSubmittingService] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);

  const handleExposeService = async () => {
    if (!serviceForm.service_name || !serviceForm.port) {
      alert("Please provide a service name and port");
      return;
    }

    if (!podName) {
      alert("No pod found for this subscription");
      return;
    }

    setSubmittingService(true);
    try {
      const response = await fetch('/api/services', {
        method: editingServiceId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingServiceId ? {
          id: editingServiceId,
          service_name: serviceForm.service_name,
          port: Number(serviceForm.port),
          protocol: serviceForm.protocol,
          service_type: serviceForm.service_type,
        } : {
          pod_name: podName,
          pool_subscription_id: subscriptionId,
          port: Number(serviceForm.port),
          service_name: serviceForm.service_name,
          protocol: serviceForm.protocol,
          service_type: serviceForm.service_type,
        }),
      });

      if (response.ok) {
        setServiceForm({ service_name: '', port: '', protocol: 'TCP', service_type: 'http' });
        setShowExposeServiceForm(false);
        setEditingServiceId(null);
        // Refetch services
        const servicesResponse = await fetch(`/api/services?instanceId=${subscriptionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (servicesResponse.ok) {
          const data = await servicesResponse.json();
          onServicesUpdated(data.services || []);
        }
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to expose service');
      }
    } catch (error) {
      console.error('Failed to expose service:', error);
      alert('Failed to expose service');
    } finally {
      setSubmittingService(false);
    }
  };

  const handleDeleteService = async (serviceId: number) => {
    if (!confirm('Remove this exposed service?')) return;

    try {
      const response = await fetch(`/api/services?id=${serviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        // Refetch services
        const servicesResponse = await fetch(`/api/services?instanceId=${subscriptionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (servicesResponse.ok) {
          const data = await servicesResponse.json();
          onServicesUpdated(data.services || []);
        }
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete service');
      }
    } catch (error) {
      console.error('Failed to delete service:', error);
      alert('Failed to delete service');
    }
  };

  const handleEditService = (service: ExposedService) => {
    setEditingServiceId(service.id);
    setServiceForm({
      service_name: service.service_name,
      port: service.port.toString(),
      protocol: service.protocol as 'TCP' | 'UDP',
      service_type: service.service_type || 'http',
    });
    setShowExposeServiceForm(true);
  };

  return (
    <div className="border-t border-[var(--line)]">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="text-sm font-medium text-[var(--ink)]">Exposed Services</span>
          </div>
          <button
            onClick={() => {
              setShowExposeServiceForm(!showExposeServiceForm);
              if (showExposeServiceForm) {
                setEditingServiceId(null);
                setServiceForm({ service_name: '', port: '', protocol: 'TCP', service_type: 'http' });
              }
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-medium transition-colors"
          >
            {showExposeServiceForm ? 'Cancel' : '+ Expose Port'}
          </button>
        </div>

        {loadingServices && (
          <div className="text-xs text-zinc-400 flex items-center gap-1 py-2">
            <span className="animate-spin">⟳</span> Loading services...
          </div>
        )}

        {/* Expose Service Form */}
        {showExposeServiceForm && (
          <div className="bg-zinc-50 rounded-lg p-4 mb-3 border border-[var(--line)]">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Service Name</label>
                <input
                  type="text"
                  value={serviceForm.service_name}
                  onChange={(e) => setServiceForm({ ...serviceForm, service_name: e.target.value })}
                  placeholder="e.g. vllm-api"
                  className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Port</label>
                <input
                  type="number"
                  value={serviceForm.port}
                  onChange={(e) => setServiceForm({ ...serviceForm, port: e.target.value })}
                  placeholder="e.g. 8000"
                  className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Protocol</label>
                <select
                  value={serviceForm.protocol}
                  onChange={(e) => {
                    const newProtocol = e.target.value as 'TCP' | 'UDP';
                    // Auto-switch service_type based on protocol (hosted.ai API requirement)
                    const newServiceType = newProtocol === 'TCP' ? 'http' : 'NodePort';
                    setServiceForm({ ...serviceForm, protocol: newProtocol, service_type: newServiceType });
                  }}
                  className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="TCP">TCP (HTTP/HTTPS)</option>
                  <option value="UDP">UDP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Service Type</label>
                <select
                  value={serviceForm.service_type}
                  onChange={(e) => setServiceForm({ ...serviceForm, service_type: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {serviceForm.protocol === 'TCP' ? (
                    <>
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="NodePort">Raw TCP (no prefix)</option>
                    </>
                  ) : (
                    <>
                      <option value="NodePort">NodePort</option>
                      <option value="loadbalancer">LoadBalancer</option>
                    </>
                  )}
                </select>
              </div>
            </div>
            <button
              onClick={handleExposeService}
              disabled={submittingService}
              className="w-full px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {submittingService ? 'Exposing...' : editingServiceId ? 'Update Service' : 'Expose Service'}
            </button>
          </div>
        )}

        {/* Services List */}
        {exposedServices.length > 0 && (
          <div className="space-y-2">
            {exposedServices.map((service) => {
              // Determine URL format based on service type
              const serviceType = (service.type || service.service_type || '').toLowerCase();
              const isHttpService = serviceType === 'http' || serviceType === 'https';
              const externalUrl = service.ip && service.external_port
                ? isHttpService
                  ? `${serviceType}://${service.ip}:${service.external_port}`
                  : `${service.ip}:${service.external_port}`
                : null;

              // Get credential info for known services
              const serviceName = service.service_name?.toLowerCase() || '';
              const getCredentials = () => {
                if (serviceName.includes('jupyter')) return { label: 'Token', value: 'packet' };
                if (serviceName.includes('vscode') || serviceName.includes('code-server')) return { label: 'Password', value: 'packet' };
                return null;
              };
              const credentials = getCredentials();

              return (
                <div key={service.id} className="bg-white border border-[var(--line)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--ink)]">{service.service_name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                        {service.type || service.service_type || 'http'}
                      </span>
                      {service.status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          service.status === 'ready' || service.status === 'active' || service.status === 'EXPOSED'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {service.status}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteService(service.id)}
                      className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 mb-2">
                    Port {service.internal_port || service.port} → {service.external_port || service.port}
                  </div>
                  {externalUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-zinc-100 px-2 py-1.5 rounded font-mono text-[var(--ink)] select-all">
                          {externalUrl}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(externalUrl);
                            alert('URL copied!');
                        }}
                        className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="Copy URL"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      </div>
                      {credentials && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-zinc-500">{credentials.label}:</span>
                          <code className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-mono font-medium">
                            {credentials.value}
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(credentials.value);
                              alert(`${credentials.label} copied!`);
                            }}
                            className="p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title={`Copy ${credentials.label}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loadingServices && exposedServices.length === 0 && !showExposeServiceForm && (
          <p className="text-xs text-zinc-400 py-2">No services exposed yet. Click "Expose Port" to make a service accessible.</p>
        )}
      </div>
    </div>
  );
}
