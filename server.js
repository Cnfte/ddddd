'use strict';

const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const http    = require('http');
const https   = require('https');
const { URLSearchParams } = require('url');

const PORT             = process.env.PORT || 3000;
const UPSTREAM_HOST    = 'https://generativelanguage.googleapis.com';
const DEFAULT_VERSION  = 'v1beta';
const DEBUG_MODE       = process.env.DEBUG === 'true';
const REQUEST_TIMEOUT  = parseInt(process.env.REQUEST_TIMEOUT || '120000', 10); // ms

const axiosInstance = axios.create({
    baseURL: UPSTREAM_HOST,
    timeout: REQUEST_TIMEOUT,
    httpAgent:  new http.Agent({ keepAlive: true, maxSockets: 64 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
    validateStatus: () => true,
    responseType: 'stream',
    maxRedirects: 0,
    decompress: false, 
});

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function debugLog(message, data = null) {
    if (!DEBUG_MODE) return;
    console.log('GEMINI_PROXY:', JSON.stringify({
        timestamp: new Date().toISOString(),
        message,
        data: data ? sanitizeForLog(data) : null,
    }));
}

function sanitizeForLog(obj) {
    if (typeof obj === 'string') {
        return obj.replace(/(key|token|api[_-]?key)=([^&\s"]+)/gi, '$1=***');
    }
    if (Array.isArray(obj)) return obj.map(sanitizeForLog);
    if (obj && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
                k,
                /^(key|token|api_?key|apikey)$/i.test(k) ? '***' : sanitizeForLog(v),
            ])
        );
    }
    return obj;
}

function extractApiKey(req) {
    const googKey = req.headers['x-goog-api-key'];
    if (googKey) return googKey;

    const auth = req.headers['authorization'];
    if (auth) {
        const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
        if (bearerMatch) return bearerMatch[1].trim();
        if (!auth.includes(' ')) return auth.trim();
    }

    for (const k of ['key', 'api_key', 'apikey', 'token', 'access_token']) {
        if (req.query[k]) return req.query[k];
    }

    return null;
}

const V1BETA_FIELDS = new Set(['systemInstruction', 'tool_config', 'tool_calls']);

function requiresBeta(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) return obj.some(requiresBeta);
    for (const [k, v] of Object.entries(obj)) {
        if (V1BETA_FIELDS.has(k)) return true;
        if (requiresBeta(v)) return true;
    }
    return false;
}

function makeV1Compatible(body) {
    const clone = JSON.parse(JSON.stringify(body));
    function strip(o) {
        if (Array.isArray(o)) { o.forEach(strip); return; }
        if (!o || typeof o !== 'object') return;
        V1BETA_FIELDS.forEach(f => delete o[f]);
        Object.values(o).forEach(strip);
    }
    strip(clone);
    return clone;
}

const CORS_ALLOW_METHODS  = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
const CORS_ALLOW_HEADERS  = [
    'Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With',
    'User-Agent', 'Accept', 'Origin', 'Cache-Control', 'X-Request-ID',
    'X-Goog-Api-Key', 'X-Session-Token', 'X-Client-Version', 'X-Device-Id',
].join(', ');
const CORS_MAX_AGE = '86400';

app.use((req, res, next) => {
    const origin = req.headers['origin'] || '*';

    res.setHeader('Access-Control-Allow-Origin', origin);
    if (origin !== '*') {
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE);

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    next();
});

app.get('/favicon.ico', (_, res) => res.status(204).end());

app.all(/(.*)/, async (req, res) => {
    const requestId = uuidv4();
    res.setHeader('X-Request-ID', requestId);

    const { method, path, query, body } = req;

    if (query.debug === 'true' || req.headers['http-debug'] === 'true') {
        return res.json({
            debug: true, method, path,
            server_info: {
                platform: process.platform,
                node_version: process.version,
                memory: process.memoryUsage(),
            },
        });
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
        return res.status(401).json({
            error: { code: 401, message: 'API key not found', status: 'UNAUTHENTICATED' },
        });
    }

    const versionMatch = path.match(/^\/(v1beta|v1)\//);
    let targetVersion;
    if (versionMatch) {
        targetVersion = versionMatch[1];
    } else {
        targetVersion = (body && requiresBeta(body)) ? 'v1beta' : DEFAULT_VERSION;
    }

    const compatBody = (targetVersion === 'v1' && body) ? makeV1Compatible(body) : body;

    let targetPath = path;
    if (!/^\/(v1beta|v1)\//.test(path)) {
        targetPath = `/${targetVersion}${path.startsWith('/') ? '' : '/'}${path}`;
    }

    const forwardQuery = { ...query };
    ['key', 'api_key', 'apikey', 'token', 'access_token', 'debug'].forEach(k => delete forwardQuery[k]);
    forwardQuery.key = apiKey;
    const qs = new URLSearchParams(forwardQuery).toString();
    const targetUrl = `${targetPath}${qs ? '?' + qs : ''}`;

    const SKIP_HEADERS = new Set([
        'host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding',
        'x-goog-api-key', 'authorization', 'x-api-key', 'api-key', 'accept-encoding',
    ]);
    const upstreamHeaders = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(req.headers)) {
        if (!SKIP_HEADERS.has(k.toLowerCase())) upstreamHeaders[k] = v;
    }

    debugLog('转发请求', { url: targetUrl, method, version: targetVersion });

    try {
        const response = await axiosInstance({
            method,
            url: targetUrl,
            headers: upstreamHeaders,
            data: ['POST', 'PUT', 'PATCH'].includes(method) ? compatBody : undefined,
        });

        const SAFE_HEADERS = new Set([
            'content-type', 'content-encoding', 'cache-control',
            'expires', 'last-modified', 'etag', 'vary',
        ]);
        for (const [k, v] of Object.entries(response.headers)) {
            const lk = k.toLowerCase();
            if (SAFE_HEADERS.has(lk) || lk.startsWith('x-goog-')) {
                res.setHeader(k, v);
            }
        }
        res.setHeader('X-Proxy-Request-ID', requestId); // 复用同一 ID，减少 UUID 生成
        res.status(response.status);

        response.data.on('error', (streamErr) => {
            debugLog('上游流错误', streamErr.message);
            if (!res.headersSent) res.status(502).end();
            else res.end();
        });
        response.data.pipe(res);

    } catch (error) {
        debugLog('代理错误', error.message);

        const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
        if (!res.headersSent) {
            res.status(isTimeout ? 504 : 502).json({
                error: {
                    code: isTimeout ? 504 : 502,
                    message: isTimeout
                        ? 'Upstream request timed out'
                        : 'Failed to connect to Google Gemini API: ' + error.message,
                    status: isTimeout ? 'GATEWAY_TIMEOUT' : 'BAD_GATEWAY',
                },
            });
        }
    }
});

app.listen(PORT, () => {
    console.log(`✓ Gemini Proxy running on port ${PORT}`);
    console.log(`✓ Upstream: ${UPSTREAM_HOST}`);
    console.log(`✓ Default API version: ${DEFAULT_VERSION}`);
    console.log(`✓ Request timeout: ${REQUEST_TIMEOUT}ms`);
    if (DEBUG_MODE) console.log('⚠ DEBUG mode enabled');
});