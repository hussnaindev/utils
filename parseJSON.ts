/**
 * Universal parseJSON
 * Parses JSON from many sources (raw JSON, script-tag-style etc.)
 * and optionally returns nested object(s) that contain a given key.
 */

type JSONValue =
    | string
    | number
    | boolean
    | null
    | JSONValue[]
    | { [key: string]: JSONValue };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if the string begins with a JSON object or array after optional whitespace */
function looksLikeJSON(s: string): boolean {
    const t = s.trimStart();
    return t.startsWith("{") || t.startsWith("[") || t.startsWith('"') ||
        t === "true" || t === "false" || t === "null" || /^-?\d/.test(t);
}

/**
 * Pre-process a string into valid JSON:
 *  - single-quoted strings → double-quoted
 *  - unquoted object keys → double-quoted keys
 *  - trailing commas before } or ]
 */
function normalizeToJSON(raw: string): string {
    const chars = Array.from(raw);
    let out = "";
    let i = 0;

    while (i < chars.length) {
        const ch = chars[i];

        if (ch === "'") {
            // Single-quoted string → double-quoted
            out += '"';
            i++;
            while (i < chars.length) {
                const c = chars[i];
                if (c === "\\") {
                    const next = chars[i + 1] ?? "";
                    if (next === "'") {
                        out += "'"; // unescape \'  → '
                        i += 2;
                    } else if (next === '"') {
                        out += '\\"'; // escape " inside double-quoted
                        i += 2;
                    } else {
                        out += c + next;
                        i += 2;
                    }
                } else if (c === '"') {
                    out += '\\"'; // bare " inside single-quoted string → escape
                    i++;
                } else if (c === "'") {
                    out += '"';
                    i++;
                    break;
                } else {
                    out += c;
                    i++;
                }
            }
        } else if (ch === '"') {
            // Double-quoted string → pass through verbatim
            out += '"';
            i++;
            while (i < chars.length) {
                const c = chars[i];
                if (c === "\\") {
                    out += c + (chars[i + 1] ?? "");
                    i += 2;
                } else if (c === '"') {
                    out += '"';
                    i++;
                    break;
                } else {
                    out += c;
                    i++;
                }
            }
        } else {
            out += ch;
            i++;
        }
    }

    // Quote unquoted keys: after { or , (with optional whitespace), identifier, then :
    out = out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');

    // Remove trailing commas before ] or }
    out = out.replace(/,(\s*[}\]])/g, "$1");

    return out;
}

/**
 * Find the balanced JSON block starting at index `start` in `text`.
 * Returns the substring including both delimiters, or null if unbalanced.
 */
function extractBalanced(
    text: string,
    start: number,
    open: string,
    close: string
): string | null {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"' && !inString) { inString = true; continue; }
        if (ch === '"' && inString) { inString = false; continue; }
        if (inString) continue;

        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * Attempt to extract and parse a JSON value from arbitrary text.
 * Returns null if nothing parseable is found.
 */
function extractAndParse(raw: string): JSONValue | null {
    const trimmed = raw.trim();

    // Strategy 1: Looks like bare JSON already
    if (looksLikeJSON(trimmed)) {
        const normalized = normalizeToJSON(trimmed);
        const val = JSON.parse(normalized) as JSONValue;
        return val;
    }

    // Strategy 2: assignment operator RHS  (var x = {...}  or  x = {...})
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
        let jsonStart = eqIdx + 1;
        while (jsonStart < trimmed.length && /\s/.test(trimmed[jsonStart])) jsonStart++;
        const opener = trimmed[jsonStart];
        if (opener === "{" || opener === "[") {
            const closer = opener === "{" ? "}" : "]";
            const block = extractBalanced(trimmed, jsonStart, opener, closer);
            if (block !== null) {
                const normalized = normalizeToJSON(block);
                const val = JSON.parse(normalized) as JSONValue;
                return val;
            }
        }
    }

    // Strategy 3: Find first { or [ and extract balanced block
    for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
        const idx = trimmed.indexOf(open);
        if (idx !== -1) {
            const block = extractBalanced(trimmed, idx, open, close);
            if (block !== null) {
                const normalized = normalizeToJSON(block);
                const val = JSON.parse(normalized) as JSONValue;
                return val;
            }
        }
    }

    return null;
}

// ─── Key Search ───────────────────────────────────────────────────────────────

/** Recursively collect all objects that own `key`. */
function findByKey(node: JSONValue, key: string, results: JSONValue[]): void {
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
        for (const item of node) findByKey(item, key, results);
    } else {
        const obj = node as Record<string, JSONValue>;
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            results.push(node);
        }
        for (const k of Object.keys(obj)) {
            findByKey(obj[k], key, results);
        }
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Universal parseJSON
 *
 * @param rawData  A JSON string, script-tag–style text, or an already-parsed object/array.
 * @param nodeKey  Optional key to search for within the parsed structure.
 * @returns
 *   - If `nodeKey` is omitted: the root parsed value, or `null` on failure.
 *   - If `nodeKey` is provided: matching object (single), array of objects (multiple),
 *     or `[]` if none found / parse failed.
 */
export function parseJSON(
    rawData: string | object,
    nodeKey?: string
): JSONValue | null {
    let parsed: JSONValue | null = null;

    if (typeof rawData === "object" && rawData !== null) {
        parsed = rawData as JSONValue;
    } else if (typeof rawData === "string") {
        parsed = extractAndParse(rawData.trim());
    }

    if (nodeKey === undefined) return parsed;
    if (parsed === null) return [];

    const results: JSONValue[] = [];
    findByKey(parsed, nodeKey, results);

    if (results.length === 0) return [];
    if (results.length === 1) return results[0];
    return results;
}