import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitise remote HTML before it reaches dangerouslySetInnerHTML.
 *
 * Shared deliberately: the admin SupportTab sanitised its Zammad article/message
 * bodies while the tenant-admin copy of the same view did not (PA-675). One
 * function means a fix cannot land in only one copy again.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
