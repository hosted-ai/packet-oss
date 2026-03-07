/**
 * Email Template Loader
 *
 * Loads email templates from the database with fallback to code-based templates.
 * Templates support variable substitution using {{variableName}} syntax.
 */

import { prisma } from "@/lib/prisma";

export interface LoadedTemplate {
  subject: string;
  html: string;
  text: string;
  fromDatabase: boolean;
}

/**
 * Load an email template by slug, falling back to provided defaults if not in database
 */
export async function loadTemplate(
  slug: string,
  variables: Record<string, string>,
  fallback: {
    subject: string;
    html: string;
    text: string;
  }
): Promise<LoadedTemplate> {
  try {
    // Try to load from database
    const template = await prisma.emailTemplate.findUnique({
      where: { slug },
    });

    if (template && template.active) {
      // Use database template
      let { subject, htmlContent, textContent } = template;

      // Apply variable substitution
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        subject = subject.replace(regex, value);
        htmlContent = htmlContent.replace(regex, value);
        if (textContent) {
          textContent = textContent.replace(regex, value);
        }
      }

      return {
        subject,
        html: htmlContent,
        text: textContent || stripHtml(htmlContent),
        fromDatabase: true,
      };
    }
  } catch (error) {
    console.error(`[Email] Failed to load template "${slug}" from database:`, error);
  }

  // Fall back to code-based template
  let { subject, html, text } = fallback;

  // Apply variable substitution to fallback too (for consistency)
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    subject = subject.replace(regex, value);
    html = html.replace(regex, value);
    text = text.replace(regex, value);
  }

  return {
    subject,
    html,
    text,
    fromDatabase: false,
  };
}

/**
 * Simple HTML to plain text conversion
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n---\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
