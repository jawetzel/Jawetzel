import Script from "next/script";

/**
 * Cookieless Google Analytics.
 *
 * `@next/third-parties`' `<GoogleAnalytics>` hardcodes `gtag('config', gaId)`
 * with no parameter object (see `dist/google/ga.js`) and its `GAParams` type
 * accepts only `gaId`/`dataLayerName`/`debugMode`/`nonce` — there is no seam to
 * pass storage settings through it. So we emit the same two scripts ourselves
 * with the storage switched off:
 *
 * - Consent Mode v2 defaults to `denied` across all four storage types, so GA
 *   sends cookieless pings instead of writing identifiers.
 * - `client_storage: 'none'` stops GA from persisting a client id in cookies
 *   or localStorage even where consent mode would otherwise allow it.
 *
 * No cookies means no consent banner. The cost is user/session accuracy: with
 * no persisted client id, a returning visitor counts as a new one and sessions
 * can't be stitched across pages. Page-view volume and referrers still work,
 * which is all this site reads. Do not "fix" the numbers by re-enabling
 * storage — that reintroduces the cookie and the banner obligation with it.
 *
 * The inline script must stay ahead of the gtag.js load: consent defaults are
 * only honoured for hits queued after them.
 */
export function Analytics({ gaId, nonce }: { gaId: string; nonce?: string }) {
  return (
    <>
      <Script
        id="ga-init"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied'
});
gtag('set', 'ads_data_redaction', true);
gtag('js', new Date());
gtag('config', '${gaId}', {
  client_storage: 'none',
  allow_google_signals: false,
  allow_ad_personalization_signals: false
});`,
        }}
      />
      <Script
        id="ga-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        nonce={nonce}
      />
    </>
  );
}
