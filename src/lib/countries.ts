/**
 * ISO 3166-1 country list + the default embargoed set.
 *
 * Client-safe: NO server imports (unlike embargo.ts, which reads prisma/settings).
 * Billing dropdowns offer every country EXCEPT embargoed/sanctioned jurisdictions;
 * the authoritative runtime block stays server-side (embargo.ts → embargoCheck).
 * embargo.ts re-exports DEFAULT_EMBARGOED_COUNTRIES from here (one source of truth).
 */

// Default embargoed/sanctioned country codes (US OFAC + EU/UK targeted):
//   Comprehensive: CU, IR, KP, SY · Targeted sector: RU, BY, MM
// Admin can override the runtime set via Platform Settings; this seeds it and
// filters the billing dropdowns. Review with legal before changing.
export const DEFAULT_EMBARGOED_COUNTRIES = ["CU", "IR", "KP", "SY", "RU", "BY", "MM"];

// All officially-assigned ISO 3166-1 alpha-2 codes.
const ISO_ALPHA2 = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
];

export interface Country {
  code: string;
  name: string;
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function nameFor(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every ISO country, name-sorted. */
export const ALL_COUNTRIES: Country[] = ISO_ALPHA2.map((code) => ({
  code,
  name: nameFor(code),
})).sort((a, b) => a.name.localeCompare(b.name));

const EMBARGOED = new Set(DEFAULT_EMBARGOED_COUNTRIES);

/** Countries a customer may select — all except the default embargoed set. */
export const ORDERABLE_COUNTRIES: Country[] = ALL_COUNTRIES.filter(
  (c) => !EMBARGOED.has(c.code),
);
