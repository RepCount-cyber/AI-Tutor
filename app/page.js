import Script from 'next/script';

export default function Page() {
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <div id="app"><main id="main" className="loading-screen"><span className="brand-mark">f<span>t</span></span><p>Opening your learning space…</p></main></div>
    <div id="notification" className="toast" role="status" aria-live="polite" hidden />
    <Script src="/app.js" strategy="afterInteractive" type="module" />
  </>;
}
