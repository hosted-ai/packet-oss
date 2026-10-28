/**
 * Bare-metal KYC profile completeness (legal/finance mandate).
 *
 * A customer must have full name + personal address + country + ZIP + company
 * name + company address before ordering bare metal. "N/A" is an accepted value
 * for company fields (customers with no company), so completeness is "non-empty
 * after trim", NOT a semantic check. companyRegNumber is optional.
 *
 * Pure + side-effect free so it's shared by the server gate (orders POST → 422)
 * and the UI gate (redirect to the profile form). name lives on the Stripe
 * customer; the rest on CustomerSettings — callers merge them before checking.
 */

export interface BareMetalProfileInput {
  name?: string | null;
  personalAddress?: string | null;
  country?: string | null;
  zipCode?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
}

export const REQUIRED_BARE_METAL_PROFILE_FIELDS: (keyof BareMetalProfileInput)[] = [
  "name",
  "personalAddress",
  "country",
  "zipCode",
  "companyName",
  "companyAddress",
];

function filled(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** True when every required KYC field is non-empty ("N/A" counts as filled). */
export function isBareMetalProfileComplete(p: BareMetalProfileInput): boolean {
  return REQUIRED_BARE_METAL_PROFILE_FIELDS.every((k) => filled(p[k]));
}

/** The required fields still missing — drives the 422 body + UI field errors. */
export function missingBareMetalProfileFields(
  p: BareMetalProfileInput,
): (keyof BareMetalProfileInput)[] {
  return REQUIRED_BARE_METAL_PROFILE_FIELDS.filter((k) => !filled(p[k]));
}
