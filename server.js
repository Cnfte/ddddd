const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置常量
const UPSTREAM_HOST = 'https://generativelanguage.googleapis.com';
const DEFAULT_API_VERSION = 'v1beta';
const DEBUG_MODE = process.env.DEBUG === 'true';

// 增加 JSON 解析限制，对应 PHP 的 memory_limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --------------------------------------------------------------------------
// 辅助函数
// --------------------------------------------------------------------------

function debugLog(message, data = null) {
    if (!DEBUG_MODE) return;
    const logData = {
        timestamp: new Date().toISOString(),
        message: message,
        data: data
    };
    console.log('GEMINI_PROXY:', JSON.stringify(logData, null, 2));
}

function extractApiKey(req) {
    // 1. Header: x-goog-api-key
    if (req.headers['x-goog-api-key']) return req.headers['x-goog-api-key'];
    
    // 2. Header: Authorization Bearer
    const auth = req.headers['authorization'];
    if (auth) {
        const match = auth.match(/^Bearer\s+(.+)$/i);
        if (match) return match[1].trim();
        if (!auth.includes(' ')) return auth.trim();
    }

    // 3. Query Parameters
    const queryKeys = ['key', 'api_key', 'apikey', 'token', 'access_token'];
    for (const key of queryKeys) {
        if (req.query[key]) return req.query[key];
    }
    
    return null;
}

// 检查是否需要切换 API 版本 (如果 body 包含 v1 不支持的字段)
function needsVersionDowngrade(body) {
    if (!body || typeof body !== 'object') return false;
    
    const unsupportedInV1 = ['systemInstruction', 'tool_config', 'tool_calls'];
    
    // 检查根级别
    for (const param of unsupportedInV1) {
        if (body[param]) return true;
    }

    // 检查 contents -> parts
    if (body.contents && Array.isArray(body.contents)) {
        for (const content of body.contents) {
            if (content.parts && Array.isArray(content.parts)) {
                for (const part of content.parts) {
                    for (const param of unsupportedInV1) {
                        if (part[param]) return true;
                    }
                }
            }
        }
    }
    return false;
}

// 移除不兼容字段的递归函数
function removeUnsupportedFields(obj, fields) {
    if (Array.isArray(obj)) {
        obj.forEach(item => removeUnsupportedFields(item, fields));
    } else if (obj && typeof obj === 'object') {
        fields.forEach(field => {
            if (field in obj) delete obj[field];
        });
        Object.values(obj).forEach(value => removeUnsupportedFields(value, fields));
    }
}

function makeBodyCompatible(body, targetVersion) {
    if (!body || targetVersion !== 'v1') return body;
    
    // 深拷贝以避免修改原始引用
    const newBody = JSON.parse(JSON.stringify(body));
    const unsupportedFields = ['systemInstruction', 'tool_config', 'tool_calls'];
    
    removeUnsupportedFields(newBody, unsupportedFields);
    return newBody;
}

// --------------------------------------------------------------------------
// 中间件：CORS 和 基础 Header
// --------------------------------------------------------------------------

app.use((req, res, next) => {
    // 设置 CORS
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Requested-With, User-Agent, Accept, Origin, Cache-Control, X-Request-ID, X-Goog-Api-Key, X-Session-Token, X-Client-Version, X-Device-Id');
    res.header('Access-Control-Max-Age', '86400');
    
    // 性能统计 Header
    const start = process.hrtime();
    const requestId = uuidv4();
    res.header('X-Request-ID', requestId);

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const timeMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
        res.header('X-Response-Time', `${timeMs}ms`);
    });

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    
    next();
});

// --------------------------------------------------------------------------
// 主处理逻辑
// --------------------------------------------------------------------------

app.all(/(.*)/, async (req, res) => {
    // 忽略 favicon
    if (req.path === '/favicon.ico') return res.status(404).end();

    const apiKey = extractApiKey(req);
    const method = req.method;
    const path = req.path;
    const body = req.body;

    // Debug 路由
    if (req.query.debug === 'true' || req.headers['http-debug'] === 'true') {
        return res.json({
            debug: true,
            method,
            path,
            api_key_found: !!apiKey,
            server_info: {
                platform: process.platform,
                node_version: process.version,
                memory: process.memoryUsage()
            }
        });
    }

    if (!apiKey) {
        return res.status(401).json({
            error: {
                code: 401,
                message: 'API key not found',
                status: 'UNAUTHENTICATED'
            }
        });
    }

    // 版本控制逻辑
    let targetVersion = DEFAULT_API_VERSION;
    
    // 尝试从路径中提取版本
    const versionMatch = path.match(/^\/(v1|v1beta)\//);
    if (versionMatch) {
        targetVersion = versionMatch[1];
    } else if (needsVersionDowngrade(body)) {
        // 如果 Body 里有新特性，强制使用 beta
        targetVersion = 'v1beta';
    }

    // 兼容性处理
    const compatibleBody = makeBodyCompatible(body, targetVersion);

    // 构建目标 URL
    let targetPath = path;
    if (!path.startsWith(`/${targetVersion}/`) && !path.startsWith(`/v1/`) && !path.startsWith(`/v1beta/`)) {
        targetPath = `/${targetVersion}${path.startsWith('/') ? '' : '/'}${path}`;
    }
    
    // 清理 URL 参数，移除 key 等
    const queryParams = { ...req.query };
    ['key', 'api_key', 'apikey', 'token', 'access_token', 'debug'].forEach(k => delete queryParams[k]);
    queryParams.key = apiKey; // 将 key 重新加回去

    const queryString = new url.URLSearchParams(queryParams).toString();
    const targetUrl = `${UPSTREAM_HOST}${targetPath}${queryString ? '?' + queryString : ''}`;

    // 构建请求 Header
    const upstreamHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': 'Gemini-API-Proxy/Node-No-Limits'
    };
    
    // 转发部分 Header (跳过敏感和自动处理的 Header)
    const skipHeaders = ['host', 'connection', 'content-length', 'x-goog-api-key', 'authorization', 'x-api-key', 'api-key', 'accept-encoding'];
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!skipHeaders.includes(key.toLowerCase())) {
            upstreamHeaders[key] = value;
        }
    });

    debugLog('转发请求', {
        url: targetUrl.replace(apiKey, '***'),
        method,
        version: targetVersion
    });

    try {
        // 发送请求到 Google
        const response = await axios({
            method: method,
            url: targetUrl,
            headers: upstreamHeaders,
            data: ['POST', 'PUT', 'PATCH'].includes(method) ? compatibleBody : undefined,
            validateStatus: () => true, // 允许所有状态码通过，不抛出错误
            responseType: 'stream' // 关键：使用流式响应，支持 SSE
        });

        // 设置响应 Header
        const responseHeaders = response.headers;
        const safeHeaders = [
            'content-type', 'content-encoding', 'cache-control',
            'expires', 'last-modified', 'etag', 'vary',
            'x-goog-generation', 'x-goog-metageneration'
        ];

        Object.entries(responseHeaders).forEach(([key, value]) => {
            if (safeHeaders.includes(key.toLowerCase()) || key.startsWith('x-goog-')) {
                res.setHeader(key, value);
            }
        });

        res.setHeader('X-Proxy-Request-ID', uuidv4());
        res.status(response.status);

        // 管道转发响应体
        response.data.pipe(res);

    } catch (error) {
        debugLog('代理错误', error.message);
        if (!res.headersSent) {
            res.status(502).json({
                error: {
                    code: 502,
                    message: 'Failed to connect to Google Gemini API: ' + error.message,
                    status: 'BAD_GATEWAY'
                }
            });
        }
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`Gemini Proxy is running on port ${PORT}`);
    console.log(`Upstream: ${UPSTREAM_HOST}`);
});