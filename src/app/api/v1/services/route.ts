import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  created,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import {
  exposeService,
  deleteExposedService,
  getConnectionInfo,
} from "@/lib/hostedai";
import { clearCache } from "@/lib/hostedai/client";

/**
 * @swagger
 * /api/v1/services:
 *   get:
 *     summary: List exposed services
 *     description: Get all exposed services for an instance
 *     tags: [Services]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Instance/subscription ID
 *     responses:
 *       200:
 *         description: List of exposed services
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("instanceId");

    if (!instanceId) {
      throw ApiError.missingField("instanceId");
    }

    // Bypass cache to avoid stale empty service results
    clearCache(`connection-info:${auth.teamId}`);

    const connInfo = await getConnectionInfo(auth.teamId, instanceId);
    const subscription = connInfo?.find(s => String(s.id) === String(instanceId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (subscription?.pods?.[0] as any)?.discovered_services || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedServices = services.map((s: any) => ({
      id: s.id,
      service_name: s.service_name,
      ip: s.ip,
      internal_port: s.internal_port || s.port,
      external_port: s.port || s.node_port,
      protocol: s.protocol,
      type: s.service_type,
      status: s.status,
    }));

    return withRateLimitHeaders(success(formattedServices), info);
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/services:
 *   post:
 *     summary: Expose a service
 *     description: Expose a port as a public service
 *     tags: [Services]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pod_name
 *               - port
 *               - service_name
 *               - protocol
 *               - service_type
 *             properties:
 *               pod_name:
 *                 type: string
 *               pool_subscription_id:
 *                 type: string
 *               port:
 *                 type: integer
 *               service_name:
 *                 type: string
 *               protocol:
 *                 type: string
 *                 enum: [tcp, http, https]
 *               service_type:
 *                 type: string
 *                 enum: [NodePort, LoadBalancer]
 *     responses:
 *       201:
 *         description: Service exposed
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const { pod_name, pool_subscription_id, port, service_name, protocol, service_type } = body;

    if (!pod_name) throw ApiError.missingField("pod_name");
    if (!port) throw ApiError.missingField("port");
    if (!service_name) throw ApiError.missingField("service_name");
    if (!protocol) throw ApiError.missingField("protocol");
    if (!service_type) throw ApiError.missingField("service_type");

    const service = await exposeService({
      pod_name,
      pool_subscription_id,
      port: Number(port),
      service_name,
      protocol,
      service_type,
    });

    return withRateLimitHeaders(created(service), info);
  } catch (err) {
    const e = err as Error;
    if (e.message?.includes("service name already exists")) {
      return error(ApiError.alreadyExists("Service"));
    }
    return error(e);
  }
}

/**
 * @swagger
 * /api/v1/services:
 *   delete:
 *     summary: Delete an exposed service
 *     description: Remove a service exposure
 *     tags: [Services]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Service ID
 *     responses:
 *       200:
 *         description: Service deleted
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      throw ApiError.missingField("id");
    }

    await deleteExposedService(Number(id));

    return withRateLimitHeaders(success({ id: Number(id), deleted: true }), info);
  } catch (err) {
    return error(err as Error);
  }
}
