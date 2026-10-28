/**
 * Retired-endpoint response.
 * Returns HTTP 410 Gone with an OpenAI-style error body so existing SDK clients
 * surface the message instead of failing silently.
 */

import { NextResponse } from "next/server";

type ProductCode = "token_factory" | "pixel_factory";

const MESSAGES: Record<ProductCode, string> = {
  token_factory:
    "Token Factory has been retired and is no longer accepting requests. The product will relaunch soon — check the dashboard for updates.",
  pixel_factory:
    "Pixel Factory has been removed and is no longer available.",
};

export function retiredEndpointResponse(product: ProductCode) {
  return NextResponse.json(
    {
      error: {
        message: MESSAGES[product],
        type: "endpoint_retired",
        code: `${product}_retired`,
      },
    },
    { status: 410 },
  );
}
