/**
 * GPU catalog with display info and pricing.
 * Mirrors the catalog in /api/widget/pricing for consistency.
 */
const GPU_CATALOG: Record<
  string,
  { name: string; vram: string; architecture: string; hourlyRateCents: number }
> = {
  'rtx-pro-6000': { name: 'RTX PRO 6000', vram: '96GB GDDR7', architecture: 'Blackwell', hourlyRateCents: 66 },
  'b200': { name: 'NVIDIA B200', vram: '180GB HBM3e', architecture: 'Blackwell', hourlyRateCents: 225 },
  'h200': { name: 'NVIDIA H200', vram: '141GB HBM3e', architecture: 'Hopper', hourlyRateCents: 150 },
  'h100': { name: 'NVIDIA H100', vram: '80GB HBM3', architecture: 'Hopper', hourlyRateCents: 249 },
};

/**
 * Widget Checkout Page
 *
 * Minimal, branded page designed to be loaded inside an iframe by the
 * embedded checkout widget. Reads the `gpu` query parameter and displays
 * the GPU name, price, and a "Proceed to Payment" button that redirects
 * to the tenant's dashboard.
 *
 * Communication with parent widget is via postMessage:
 * - { type: 'checkout-complete', orderId, redirectUrl } on success
 * - { type: 'checkout-error', message } on error
 * - { type: 'checkout-resize', height } to auto-size the iframe
 */
export default async function WidgetCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ gpu?: string }>;
}) {
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'GPU Cloud';
  const primaryColor = '#1a4fff';
  const logoUrl = '/packet-logo.png';
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const params = await searchParams;
  const gpuType = params.gpu || '';
  const gpu = gpuType ? GPU_CATALOG[gpuType] : null;
  const deployUrl = gpu
    ? `${dashboardUrl}/dashboard?gpu=${encodeURIComponent(gpuType)}`
    : dashboardUrl;

  const hourlyPrice = gpu ? `$${(gpu.hourlyRateCents / 100).toFixed(2)}` : null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Checkout - {brandName}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.5;
                -webkit-font-smoothing: antialiased;
                background: transparent;
                color: #0b0f1c;
                padding: 0;
                margin: 0;
              }
              .checkout-container {
                max-width: 420px;
                margin: 0 auto;
                padding: 24px 16px;
              }
              .checkout-brand {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 20px;
                padding-bottom: 16px;
                border-bottom: 1px solid #e2e5ea;
              }
              .checkout-brand-logo {
                height: 24px;
                width: auto;
              }
              .checkout-brand-name {
                font-size: 15px;
                font-weight: 600;
                color: #0b0f1c;
              }
              .checkout-gpu-card {
                background: #f7f8fb;
                border: 1px solid #e2e5ea;
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 20px;
              }
              .checkout-gpu-name {
                font-size: 18px;
                font-weight: 700;
                color: #0b0f1c;
                margin-bottom: 4px;
              }
              .checkout-gpu-specs {
                font-size: 13px;
                color: #5b6476;
                margin-bottom: 12px;
              }
              .checkout-gpu-price {
                font-size: 28px;
                font-weight: 700;
                color: ${primaryColor};
              }
              .checkout-gpu-unit {
                font-size: 14px;
                font-weight: 400;
                color: #5b6476;
              }
              .checkout-btn {
                display: block;
                width: 100%;
                padding: 14px 24px;
                background: ${primaryColor};
                color: #fff;
                border: none;
                border-radius: 8px;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                text-align: center;
                text-decoration: none;
                transition: opacity 0.2s;
              }
              .checkout-btn:hover { opacity: 0.9; }
              .checkout-note {
                font-size: 12px;
                color: #5b6476;
                text-align: center;
                margin-top: 12px;
              }
              .checkout-error {
                padding: 24px;
                text-align: center;
                color: #5b6476;
                font-size: 14px;
              }
              .checkout-error-title {
                font-size: 16px;
                font-weight: 600;
                color: #0b0f1c;
                margin-bottom: 8px;
              }
            `,
          }}
        />
      </head>
      <body>
        <div className="checkout-container">
          {/* Brand header */}
          <div className="checkout-brand">
            {logoUrl && (
              <img
                className="checkout-brand-logo"
                src={logoUrl}
                alt={brandName}
              />
            )}
            <span className="checkout-brand-name">{brandName}</span>
          </div>

          {gpu ? (
            <>
              {/* GPU info card */}
              <div className="checkout-gpu-card">
                <div className="checkout-gpu-name">{gpu.name}</div>
                <div className="checkout-gpu-specs">
                  {gpu.vram} &middot; {gpu.architecture}
                </div>
                <div className="checkout-gpu-price">
                  {hourlyPrice}
                  <span className="checkout-gpu-unit">/hr</span>
                </div>
              </div>

              {/* Deploy button */}
              <a
                className="checkout-btn"
                href={deployUrl}
                target="_top"
                rel="noopener"
                id="checkout-deploy-btn"
              >
                Deploy {gpu.name}
              </a>
              <div className="checkout-note">
                You&apos;ll be redirected to the {brandName} dashboard to complete setup.
              </div>
            </>
          ) : (
            <div className="checkout-error">
              <div className="checkout-error-title">No GPU Selected</div>
              <p>
                Please select a GPU from the pricing widget to proceed with checkout.
              </p>
            </div>
          )}
        </div>

        {/* postMessage communication with parent widget */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                'use strict';

                // Notify parent of height for auto-sizing
                function reportHeight() {
                  var height = document.documentElement.scrollHeight;
                  if (window.parent !== window) {
                    window.parent.postMessage({
                      type: 'checkout-resize',
                      height: height
                    }, '*');
                  }
                }

                // Report height on load and resize
                reportHeight();
                window.addEventListener('resize', reportHeight);

                // Observe DOM changes for dynamic height updates
                if (typeof MutationObserver !== 'undefined') {
                  new MutationObserver(reportHeight).observe(
                    document.body,
                    { childList: true, subtree: true, attributes: true }
                  );
                }

                // Wire up the deploy button to send postMessage before redirect
                var btn = document.getElementById('checkout-deploy-btn');
                if (btn) {
                  btn.addEventListener('click', function(e) {
                    var redirectUrl = btn.href;
                    if (window.parent !== window) {
                      e.preventDefault();
                      window.parent.postMessage({
                        type: 'checkout-complete',
                        orderId: null,
                        redirectUrl: redirectUrl
                      }, '*');
                      // Give parent a moment to handle the message, then redirect
                      setTimeout(function() {
                        window.top.location.href = redirectUrl;
                      }, 100);
                    }
                    // If not in iframe, the default link behavior handles it
                  });
                }
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
