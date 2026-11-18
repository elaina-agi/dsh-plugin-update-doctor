import os from 'node:os';

export function makeRedactor({ home = os.homedir(), profileDir = process.env.DSH_PROFILE_DIR, installDir = process.env.DSH_INSTALL_DIR, maxString = 128_000 } = {}) {
    const roots = [[profileDir, '<profile>'], [installDir, '<dsh-install>'], [home, '<user-home>']]
        .filter(([value]) => typeof value === 'string' && value.length > 2)
        .sort((a, b) => b[0].length - a[0].length);
    return function redact(value, depth = 0) {
        if (depth > 16) return '<depth-limit>';
        if (typeof value === 'string') {
            let text = value;
            for (const [root, label] of roots) {
                const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '[\\\\/]');
                text = text.replace(new RegExp(escaped, 'gi'), label);
            }
            text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g, '<credential>')
                .replace(/\b(?:Bearer|Basic|Digest)\s+[^\r\n,;]+/gi, '<authorization>')
                .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|_authToken)["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1<credential>')
                .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://<credential>@')
                .replace(/([?&](?:token|key|password|secret|auth)\s*=)[^&#\s]+/gi, '$1<credential>')
                .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s"']+/gi, '<user-home>')
                .replace(/\/home\/[^\/\s"']+/g, '<linux-home>')
                .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
            return text.length > maxString ? text.slice(0, maxString) + '\n<diagnostic-truncated>' : text;
        }
        if (Array.isArray(value)) return value.slice(0, 500).map(item => redact(item, depth + 1));
        if (value && typeof value === 'object') {
            const result = {};
            for (const [key, item] of Object.entries(value).slice(0, 150)) {
                if (/token|password|secret|authorization|credential/i.test(key) && key !== 'errorCode') result[key] = '<credential>';
                else result[key] = redact(item, depth + 1);
            }
            return result;
        }
        return value ?? null;
    };
}
