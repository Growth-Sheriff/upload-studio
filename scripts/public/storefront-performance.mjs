// Dedicated owned-demo lab audit. Never attaches to an existing browser or changes a theme.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const HOST = 'auto-gang-sheet-demo.myshopify.com';
const THEMES = [
  {name: 'baseline', id: '189188636893'},
  {name: 'app-enabled', id: '189187817693'},
];
const PAGES = ['/', '/products/ready-dtf-gang-sheets', '/collections/ready-sheet-examples'];
const {values} = parseArgs({options: {
  'password-file': {type: 'string'},
  'output-dir': {type: 'string'},
  'module-root': {type: 'string'},
}});
if (!values['password-file'] || !values['output-dir'] || !values['module-root']) {
  throw new Error('Provide protected --password-file, protected --output-dir and disposable --module-root.');
}
const secretFile = path.resolve(values['password-file']);
const outputDir = path.resolve(values['output-dir']);
if (path.dirname(outputDir) !== path.dirname(secretFile) || !path.basename(outputDir).startsWith('lighthouse-')) {
  throw new Error('Results and temporary profiles must remain inside the protected password-file folder.');
}
await fs.mkdir(outputDir, {recursive: false});
const moduleRoot = path.resolve(values['module-root']);
const {default: lighthouse} = await import(pathToFileURL(path.join(moduleRoot, 'lighthouse/core/index.js')));
const {default: puppeteer} = await import(pathToFileURL(path.join(moduleRoot, 'puppeteer-core/lib/puppeteer/puppeteer-core.js')));
const lhPackage = JSON.parse(await fs.readFile(path.join(moduleRoot, 'lighthouse/package.json'), 'utf8'));
if (lhPackage.version !== '13.5.0') throw new Error('This proof is pinned to Lighthouse 13.5.0.');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await fs.access(chromePath);
const emit = value => console.log(JSON.stringify(value));
const safeUrl = value => {const u = new URL(value); return {host: u.hostname, path: u.pathname};};
const cookies = new Map();
const rememberCookies = response => {
  for (const header of response.headers.getSetCookie()) {
    const parts = header.split(';').map(s => s.trim());
    const split = parts[0].indexOf('=');
    if (split < 1) continue;
    const name = parts[0].slice(0, split), value = parts[0].slice(split + 1);
    const attrs = Object.fromEntries(parts.slice(1).map(s => {const i=s.indexOf('='); return i < 0 ? [s.toLowerCase(), true] : [s.slice(0,i).toLowerCase(), s.slice(i+1)];}));
    const expires = attrs.expires ? Date.parse(attrs.expires) / 1000 : undefined;
    if (!value || attrs['max-age'] === '0' || (expires && expires < Date.now() / 1000)) {cookies.delete(name); continue;}
    // Deliberately narrower than any server-supplied domain. Never send auth to another shop/CDN.
    cookies.set(name, {name, value, domain: HOST, path: '/', secure: true,
      httpOnly: Boolean(attrs.httponly), ...(expires ? {expires} : {}),
      ...(attrs.samesite ? {sameSite: {lax: 'Lax', strict: 'Strict', none: 'None'}[String(attrs.samesite).toLowerCase()]} : {})});
  }
};
let password = (await fs.readFile(secretFile, 'utf8')).replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
if (!password || password.length > 1024 || password.includes('\0')) throw new Error('Invalid protected password file.');
const login = await fetch(`https://${HOST}/password`, {
  method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
  headers: {'cache-control': 'no-cache', 'content-type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({form_type: 'storefront_password', utf8: '\u2713', password}),
});
password = undefined;
rememberCookies(login);
const location = login.headers.get('location');
const destination = location ? new URL(location, `https://${HOST}`) : null;
await login.body?.cancel();
if (![301,302,303].includes(login.status) || !destination || destination.hostname !== HOST || destination.pathname === '/password' || !cookies.size) {
  emit({event: 'login-rejected', at: new Date().toISOString(), status: login.status, shopScopedRedirect: destination?.hostname === HOST, hasCookies: Boolean(cookies.size)});
  throw new Error('Ordinary password login did not succeed; no guessing/retry or page score.');
}
emit({event: 'login-ready', at: new Date().toISOString(), status: login.status, shopScopedCookies: true});

const rows = [];
const median = a => [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
auditLoop: for (const [pageIndex, pagePath] of PAGES.entries()) for (let round=1;round<=3;round++) {
  for (const theme of round % 2 ? THEMES : [...THEMES].reverse()) {
    const runName = `${pageIndex}-${theme.name}-${round}`;
    const profile = path.resolve(outputDir, `profile-${runName}`);
    if (path.dirname(profile) !== outputDir || !path.basename(profile).startsWith('profile-')) throw new Error('Unsafe temporary-profile target.');
    let browser;
    const started = Date.now(), requests = [], documents = [];
    let hardTimer, fatalTarget = false;
    try {
      browser = await puppeteer.launch({executablePath: chromePath, headless: true, userDataDir: profile,
        defaultViewport: null, ignoreDefaultArgs: ['--enable-automation'], timeout: 30_000,
        args: ['--disable-extensions', '--no-first-run', '--no-default-browser-check']});
      await browser.defaultBrowserContext().setCookie(...cookies.values());
      const page = await browser.newPage();
      page.on('request', req => {try {requests.push({method:req.method(), ...safeUrl(req.url()), type:req.resourceType()});} catch {}});
      page.on('response', response => {try {const req=response.request(); if(req.isNavigationRequest()&&req.frame()===page.mainFrame()) documents.push({status:response.status(), ...safeUrl(response.url())});} catch {}});
      const url = new URL(pagePath, `https://${HOST}`);
      url.search = new URLSearchParams({preview_theme_id: theme.id, _fd: '0', pb: '0'}).toString();
      const deadline = new Promise((_, reject) => {hardTimer=setTimeout(()=>reject(new Error('Audit exceeded 150-second hard budget.')),150_000);});
      const result = await Promise.race([lighthouse(url.href, {logLevel:'silent', onlyCategories:['performance','accessibility'],
        formFactor:'mobile', throttlingMethod:'simulate', disableStorageReset:false, disableFullPageScreenshot:true,
        maxWaitForLoad:45_000, enableErrorReporting:false}, undefined, page), deadline]);
      clearTimeout(hardTimer);
      if (!result?.lhr || result.lhr.runtimeError) {
        fatalTarget = documents.some(d=>d.status===429||d.path==='/password');
        throw new Error('Lighthouse did not return a complete page audit.');
      }
      const lhr = result.lhr;
      const actual = await page.evaluate(() => ({path:location.pathname, themeId:String(window.Shopify?.theme?.id||''),
        hasPasswordForm:Boolean(document.querySelector('form[action="/password"]'))}));
      const final = safeUrl(lhr.finalDisplayedUrl || lhr.finalUrl);
      const lastDocument = documents.at(-1);
      if (final.host!==HOST || final.path!==pagePath || actual.path!==pagePath || actual.hasPasswordForm || actual.themeId!==theme.id || lastDocument?.status!==200) {
        fatalTarget = true;
        emit({event:'invalid-target', theme:theme.name, page:pagePath, round, final, actual, document:lastDocument});
        throw new Error('Actual page/theme did not match the protected audit target.');
      }
      const removedAppTracking = requests.filter(r=>/\/(?:api\/v1\/(?:visitors|sessions)|api\/(?:upload\/)?telemetry)(?:\/|$)|\/(?:ul-visitor|ul-analytics|ul-upload-telemetry)\.js$/i.test(r.path));
      const audit = key => lhr.audits[key]?.numericValue ?? null;
      const row = {event:'audit', at:lhr.fetchTime, page:pagePath, theme:theme.name, themeId:theme.id, round,
        performance:Math.round(lhr.categories.performance.score*100), accessibility:Math.round(lhr.categories.accessibility.score*100),
        fcpMs:audit('first-contentful-paint'), lcpMs:audit('largest-contentful-paint'), tbtMs:audit('total-blocking-time'),
        cls:audit('cumulative-layout-shift'), speedIndexMs:audit('speed-index'),
        transferBytes:lhr.audits['total-byte-weight']?.numericValue??null, requestCount:requests.length,
        removedAppTrackingRequests:removedAppTracking.length, elapsedMs:Date.now()-started,
        chrome:lhr.environment.hostUserAgent, lighthouse:lhr.lighthouseVersion, warnings:lhr.runWarnings};
      rows.push(row);
      // Native diagnostic artifacts: redacted summaries only, never raw cookies/headers/bodies/capability query strings.
      await fs.writeFile(path.join(outputDir, `${runName}.json`), JSON.stringify({row, settings:lhr.configSettings,
        final, actual, documents, requests, removedAppTracking,
        failedAudits:Object.values(lhr.audits).filter(a=>typeof a.score==='number'&&a.score<1).map(a=>({id:a.id,title:a.title,score:a.score,displayValue:a.displayValue}))},null,2));
      emit(row);
    } catch (error) {
      clearTimeout(hardTimer);
      const row = {event:'audit-failed', at:new Date().toISOString(), page:pagePath, theme:theme.name, themeId:theme.id, round,
        elapsedMs:Date.now()-started, reason:error instanceof Error&&/hard budget|complete page audit|match the protected/.test(error.message)?error.message:'Browser/Lighthouse execution failed; no raw authentication context emitted.'};
      rows.push(row); emit(row);
    } finally {
      clearTimeout(hardTimer);
      if(browser){const child=browser.process();await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,10_000))]);if(child&&child.exitCode===null)child.kill('SIGKILL');}
      // The exact validated child directory belongs solely to this run; no shared profile or broad deletion.
      await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:500});
    }
    if (fatalTarget) break auditLoop;
  }
}
const summaries=PAGES.map(page=>({page, ...Object.fromEntries(THEMES.map(theme=>{const group=rows.filter(r=>r.event==='audit'&&r.page===page&&r.theme===theme.name);return[theme.name,{validRuns:group.length,...Object.fromEntries(['performance','accessibility','fcpMs','lcpMs','tbtMs','cls','speedIndexMs','transferBytes','requestCount'].map(k=>[k,group.length===3?median(group.map(r=>r[k])):null]))}];}))}));
await fs.writeFile(path.join(outputDir,'summary.json'),JSON.stringify({at:new Date().toISOString(),shop:HOST,rows,summaries},null,2));
emit({event:'summary', summaries, failedRuns:rows.filter(r=>r.event!=='audit').length,
  removedAppTrackingRequests:rows.filter(r=>r.event==='audit').reduce((sum,r)=>sum+r.removedAppTrackingRequests,0)});
cookies.clear();
if(rows.some(r=>r.event!=='audit'))process.exitCode=1;
