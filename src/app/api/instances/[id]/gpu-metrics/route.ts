import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getConnectionInfo } from "@/lib/hostedai";
import Stripe from "stripe";

interface DiscoveredService {
  id?: number;
  service_name?: string;
  ip?: string;
  internal_port?: number;
  port?: number;
  node_port?: number;
  external_port?: number;
}

interface GPUMetrics {
  // vLLM metrics
  gpuCacheUsagePercent: number;
  cpuCacheUsagePercent: number;
  numRequestsRunning: number;
  numRequestsWaiting: number;
  numRequestsSwapped: number;
  // Token metrics
  promptTokensTotal: number;
  generationTokensTotal: number;
  // Request metrics
  avgPromptThroughput: number;
  avgGenerationThroughput: number;
  // Time to first token
  avgTimeToFirstToken: number;
  // Model info
  modelId: string | null;
  // Status
  isHealthy: boolean;
}

// Parse Prometheus metrics from vLLM
function parseVllmMetrics(metricsText: string): Partial<GPUMetrics> {
  const metrics: Partial<GPUMetrics> = {
    gpuCacheUsagePercent: 0,
    cpuCacheUsagePercent: 0,
    numRequestsRunning: 0,
    numRequestsWaiting: 0,
    numRequestsSwapped: 0,
    promptTokensTotal: 0,
    generationTokensTotal: 0,
    avgPromptThroughput: 0,
    avgGenerationThroughput: 0,
    avgTimeToFirstToken: 0,
  };

  const lines = metricsText.split("\n");
  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue;

    // GPU cache usage percentage
    if (line.includes("gpu_cache_usage_perc")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.gpuCacheUsagePercent = parseFloat(match[1]) * 100;
    }

    // CPU cache usage percentage
    if (line.includes("cpu_cache_usage_perc")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.cpuCacheUsagePercent = parseFloat(match[1]) * 100;
    }

    // Number of running requests
    if (line.includes("num_requests_running")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.numRequestsRunning = parseInt(match[1]);
    }

    // Number of waiting requests
    if (line.includes("num_requests_waiting")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.numRequestsWaiting = parseInt(match[1]);
    }

    // Number of swapped requests
    if (line.includes("num_requests_swapped")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.numRequestsSwapped = parseInt(match[1]);
    }

    // Prompt tokens total
    if (line.includes("prompt_tokens_total")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.promptTokensTotal = parseInt(match[1]);
    }

    // Generation tokens total
    if (line.includes("generation_tokens_total")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.generationTokensTotal = parseInt(match[1]);
    }

    // Average prompt throughput (tokens/s)
    if (line.includes("avg_prompt_throughput_toks_per_s")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.avgPromptThroughput = parseFloat(match[1]);
    }

    // Average generation throughput (tokens/s)
    if (line.includes("avg_generation_throughput_toks_per_s")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.avgGenerationThroughput = parseFloat(match[1]);
    }

    // Time to first token (TTFT)
    if (line.includes("time_to_first_token_seconds") && line.includes("_sum")) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*$/);
      if (match) metrics.avgTimeToFirstToken = parseFloat(match[1]) * 1000; // Convert to ms
    }
  }

  return metrics;
}

/**
 * GET /api/instances/[id]/gpu-metrics
 * Fetches real-time GPU metrics from a running vLLM instance
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: subscriptionId } = await params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Get team ID from Stripe customer
    const stripe = await getStripe();
    const customerResult = await stripe.customers.retrieve(payload.customerId);
    if ("deleted" in customerResult && customerResult.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customerResult as Stripe.Customer;
    const teamId = (customer.metadata?.team_id || customer.metadata?.teamId || customer.metadata?.hostedai_team_id) as string;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with account" }, { status: 400 });
    }

    // Get connection info for this subscription
    const connectionInfo = await getConnectionInfo(teamId);
    const connInfo = connectionInfo.find((c) => String(c.id) === String(subscriptionId));

    if (!connInfo?.pods?.[0]) {
      return NextResponse.json({ error: "Instance not found or not running" }, { status: 404 });
    }

    const pod = connInfo.pods[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = ((pod as any).discovered_services as DiscoveredService[]) || [];

    // Find vLLM service (port 8000)
    const vllmService = services.find(
      (s) =>
        s.internal_port === 8000 ||
        s.port === 8000 ||
        s.service_name?.includes("vllm") ||
        s.service_name?.includes("inference")
    );

    if (!vllmService?.ip) {
      return NextResponse.json(
        { error: "vLLM service not found. Make sure port 8000 is exposed." },
        { status: 404 }
      );
    }

    const servicePort = vllmService.port || vllmService.external_port || vllmService.node_port;
    if (!servicePort) {
      return NextResponse.json({ error: "vLLM service port not found" }, { status: 404 });
    }

    const baseUrl = `http://${vllmService.ip}:${servicePort}`;
    let metrics: GPUMetrics = {
      gpuCacheUsagePercent: 0,
      cpuCacheUsagePercent: 0,
      numRequestsRunning: 0,
      numRequestsWaiting: 0,
      numRequestsSwapped: 0,
      promptTokensTotal: 0,
      generationTokensTotal: 0,
      avgPromptThroughput: 0,
      avgGenerationThroughput: 0,
      avgTimeToFirstToken: 0,
      modelId: null,
      isHealthy: false,
    };

    // Fetch metrics from vLLM /metrics endpoint (Prometheus format)
    try {
      const metricsResponse = await fetch(`${baseUrl}/metrics`, {
        signal: AbortSignal.timeout(5000),
      });

      if (metricsResponse.ok) {
        const metricsText = await metricsResponse.text();
        const parsedMetrics = parseVllmMetrics(metricsText);
        metrics = { ...metrics, ...parsedMetrics };
      }
    } catch (e) {
      console.error("Failed to fetch vLLM metrics:", e);
    }

    // Fetch model info from /v1/models
    try {
      const modelsResponse = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        const models = modelsData.data || [];
        if (models.length > 0) {
          metrics.modelId = models[0].id;
        }
      }
    } catch (e) {
      console.error("Failed to fetch models:", e);
    }

    // Check health
    try {
      const healthResponse = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      metrics.isHealthy = healthResponse.ok;
    } catch {
      metrics.isHealthy = false;
    }

    return NextResponse.json({
      subscriptionId,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GPU metrics error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
