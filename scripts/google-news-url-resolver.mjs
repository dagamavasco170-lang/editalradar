import { isTrustedOfficialHost, validateTrustedOfficialUrl } from "./monitor-sources.mjs";

const GOOGLE_NEWS_HOST = "news.google.com";
const GOOGLE_REDIRECT_HOSTS = new Set([
  "news.google.com",
  "google.com",
  "www.google.com",
  "consent.google.com",
  "accounts.google.com"
]);
const GOOGLE_ARTICLE_RPC = "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je";
const GOOGLE_ARTICLE_RPC_ID = "Fbv4je";
const GOOGLE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 EditalRadar/1.0";
const MAX_GOOGLE_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_GOOGLE_RPC_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_REDIRECTS = 5;
const MAX_CONCURRENT_RESOLUTIONS = 2;
const RESOLUTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let activeResolutions = 0;
const resolutionWaiters = [];
const resolvedUrlCache = new Map();
const inFlightResolutions = new Map();

function normalizeHost(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function isSameDeclaredPublisherHost(candidateHost, declaredHost) {
  const candidate = normalizeHost(candidateHost);
  const declared = normalizeHost(declaredHost);
  return candidate === declared || candidate.endsWith("." + declared);
}

function validatePublisherUrl(value, declaredHost) {
  let url;
  try {
    url = validateTrustedOfficialUrl(value);
  } catch {
    throw new Error("O link resolvido não pertence a uma fonte oficial HTTPS autorizada.");
  }
  if (!isSameDeclaredPublisherHost(url.hostname, declaredHost)) {
    throw new Error("O link da notícia não corresponde ao domínio oficial indicado pela fonte (publisher declarado no Google Notícias).");
  }
  return url.href;
}

function extractArticleId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== GOOGLE_NEWS_HOST
    || url.username || url.password) return null;
  const match = url.pathname.match(/^\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]{1,300})\/?$/);
  return match?.[1] || null;
}

function extractLegacyPublisherUrl(articleId) {
  try {
    const bytes = Buffer.from(articleId, "base64url");
    const decoded = bytes.toString("latin1");
    const match = decoded.match(/https?:\/\/[^\u0000-\u0020\"'<>]+/i);
    return match?.[0] || null;
  } catch {
    return null;
  }
}

function extractSignatureAndTimestamp(html) {
  const signature = String(html || "").match(/data-n-a-sg\s*=\s*(["'])(.*?)\1/i)?.[2];
  const timestampValue = String(html || "").match(/data-n-a-ts\s*=\s*(["'])(.*?)\1/i)?.[2];
  const timestamp = Number(timestampValue);
  if (!signature || signature.length > 4096 || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    return null;
  }
  return { signature, timestamp };
}

function buildGoogleRpcBody(articleId, { signature, timestamp }) {
  const innerPayload = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "BR:pt", null, 1, null, null, null, null, null, 0, 1],
      "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    articleId,
    timestamp,
    signature
  ]);
  const outerPayload = JSON.stringify([[[GOOGLE_ARTICLE_RPC_ID, innerPayload, null, "generic"]]]);
  return "f.req=" + encodeURIComponent(outerPayload);
}

function parseGoogleRpcResponse(responseText) {
  const source = String(responseText || "").replace(/^\)\]\}'\s*/, "").trim();
  const candidates = [source, ...source.split(/\r?\n/).map(line => line.trim())];
  for (const candidate of candidates) {
    if (!candidate.startsWith("[")) continue;
    let frames;
    try {
      frames = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!Array.isArray(frame) || frame[0] !== "wrb.fr" || frame[1] !== GOOGLE_ARTICLE_RPC_ID) continue;
      if (typeof frame[2] !== "string") return null;
      try {
        const payload = JSON.parse(frame[2]);
        if (Array.isArray(payload) && payload[0] === "garturlres" && typeof payload[1] === "string") {
          return payload[1];
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function readLimitedText(response, maxBytes, label) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(label + " excedeu o limite de tamanho permitido.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(label + " excedeu o limite de tamanho permitido.");
  }
  return text;
}

function findOfficialUrlInGoogleRedirect(googleUrl, declaredHost) {
  for (const parameter of ["url", "q", "adurl", "continue", "uddg"]) {
    const value = googleUrl.searchParams.get(parameter);
    if (!value) continue;
    try {
      return validatePublisherUrl(value, declaredHost);
    } catch {
      // Parâmetros que não apontem para o publisher declarado não são seguidos.
    }
  }
  return null;
}

async function acquireResolutionSlot() {
  if (activeResolutions < MAX_CONCURRENT_RESOLUTIONS) {
    activeResolutions += 1;
    return;
  }
  // The releasing task reserves its slot for this waiter before waking it.
  await new Promise(resolve => resolutionWaiters.push(resolve));
}

function releaseResolutionSlot() {
  const next = resolutionWaiters.shift();
  if (next) {
    next();
  } else {
    activeResolutions = Math.max(0, activeResolutions - 1);
  }
}

async function withResolutionLimit(operation) {
  await acquireResolutionSlot();
  try {
    return await operation();
  } finally {
    releaseResolutionSlot();
  }
}

async function resolveGoogleNewsArticleUrlUncached(candidateUrl, declaredSource, request, options) {
  const articleId = extractArticleId(candidateUrl);
  if (!articleId) return null;

  const declaredHost = declaredSource.hostname;
  const legacyUrl = extractLegacyPublisherUrl(articleId);
  if (legacyUrl) {
    try {
      return validatePublisherUrl(legacyUrl, declaredHost);
    } catch {
      // IDs antigos só são usados quando revelam um endereço oficial do publisher declarado.
    }
  }

  const timeoutMs = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const maxRedirects = Math.max(0, Math.min(8, Number(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)));
  let currentUrl = new URL("https://news.google.com/rss/articles/" + articleId);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await request(currentUrl.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": "CONSENT=PENDING+987",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) {
        throw new Error("O Google Notícias excedeu o limite de redirecionamentos.");
      }
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("O Google Notícias retornou um redirecionamento sem destino.");
      let next;
      try {
        next = new URL(location, currentUrl);
      } catch {
        throw new Error("O Google Notícias retornou um endereço de redirecionamento inválido.");
      }
      if (next.protocol !== "https:" || next.username || next.password) {
        throw new Error("O Google Notícias tentou usar um redirecionamento inseguro.");
      }
      if (isTrustedOfficialHost(next.hostname)) return validatePublisherUrl(next.href, declaredHost);
      if (!GOOGLE_REDIRECT_HOSTS.has(next.hostname.toLowerCase())) {
        throw new Error("O Google Notícias redirecionou para um domínio diferente do publisher oficial informado.");
      }
      const parameterTarget = findOfficialUrlInGoogleRedirect(next, declaredHost);
      if (parameterTarget) return parameterTarget;
      currentUrl = next;
      continue;
    }

    if (!response.ok) {
      throw new Error("Google Notícias respondeu HTTP " + response.status + " ao resolver o link.");
    }

    const responseUrl = response.url || currentUrl.href;
    let finalPageUrl;
    try {
      finalPageUrl = new URL(responseUrl);
    } catch {
      throw new Error("O Google Notícias retornou um endereço final inválido.");
    }
    if (isTrustedOfficialHost(finalPageUrl.hostname)) {
      return validatePublisherUrl(finalPageUrl.href, declaredHost);
    }
    if (!GOOGLE_REDIRECT_HOSTS.has(finalPageUrl.hostname.toLowerCase())) {
      throw new Error("A página de resolução saiu dos domínios do Google antes da validação do publisher.");
    }

    const html = await readLimitedText(response, MAX_GOOGLE_PAGE_BYTES, "Página de resolução do Google Notícias");
    const params = extractSignatureAndTimestamp(html);
    if (!params) return null;

    const rpcResponse = await request(GOOGLE_ARTICLE_RPC, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://news.google.com",
        "Referer": "https://news.google.com/",
        "X-Same-Domain": "1",
        "Cookie": "CONSENT=PENDING+987"
      },
      body: buildGoogleRpcBody(articleId, params)
    });

    if (!rpcResponse.ok) {
      throw new Error("O serviço de resolução do Google respondeu HTTP " + rpcResponse.status + ".");
    }
    const rpcText = await readLimitedText(rpcResponse, MAX_GOOGLE_RPC_BYTES, "Resposta de resolução do Google Notícias");
    const publisherUrl = parseGoogleRpcResponse(rpcText);
    if (!publisherUrl) return null;
    return validatePublisherUrl(publisherUrl, declaredHost);
  }

  return null;
}

/**
 * Resolve um link do Google Notícias sem aceitar o agregador como fonte do edital.
 * O destino retornado precisa ser HTTPS, pertencer à lista oficial e corresponder
 * ao domínio do publisher declarado pelo feed RSS.
 *
 * O método Fbv4je é interno e não documentado pelo Google; mudanças do serviço
 * deixam a descoberta pendente, sem promover um link não verificado.
 */
export async function resolveGoogleNewsArticleUrl(candidateUrl, declaredSourceUrl, request = fetch, options = {}) {
  let newsUrl;
  let declaredSource;
  try {
    newsUrl = new URL(candidateUrl);
    declaredSource = validateTrustedOfficialUrl(declaredSourceUrl);
  } catch {
    return null;
  }
  if (newsUrl.protocol !== "https:" || newsUrl.hostname.toLowerCase() !== GOOGLE_NEWS_HOST
    || newsUrl.username || newsUrl.password) return null;

  const cacheable = request === fetch;
  const cacheKey = newsUrl.href + "|" + declaredSource.hostname.toLowerCase();
  if (cacheable) {
    const cached = resolvedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    if (cached) resolvedUrlCache.delete(cacheKey);
    const inFlight = inFlightResolutions.get(cacheKey);
    if (inFlight) return inFlight;
  }

  const operation = withResolutionLimit(() =>
    resolveGoogleNewsArticleUrlUncached(newsUrl.href, declaredSource, request, options)
  );
  if (!cacheable) return operation;

  inFlightResolutions.set(cacheKey, operation);
  try {
    const resolved = await operation;
    if (resolved) {
      resolvedUrlCache.set(cacheKey, { url: resolved, expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS });
      if (resolvedUrlCache.size > 1000) {
        const oldestKey = resolvedUrlCache.keys().next().value;
        if (oldestKey) resolvedUrlCache.delete(oldestKey);
      }
    }
    return resolved;
  } finally {
    inFlightResolutions.delete(cacheKey);
  }
}
