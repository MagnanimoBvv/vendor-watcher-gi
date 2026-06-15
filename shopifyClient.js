const axios = require('axios');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isThrottled(response) {
    if (response.status === 429) return true;
    const errs = response.data && response.data.errors;
    if (!errs) return false;
    return errs.some(e => e.extensions && (e.extensions.code === 'THROTTLED' || e.extensions.code === 'MAX_COST_EXCEEDED'));
}

function makeShopifyClient({ graphqlUrl, token, dryRun = false, maxAttempts = 5 }) {
    if (!graphqlUrl || !token) {
        throw new Error('makeShopifyClient: graphqlUrl y token son requeridos');
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
    };

    async function graphql(query, variables = {}, { isMutation = false } = {}) {
        if (isMutation) {
            if (dryRun) {
                console.log('[DRY-RUN] Mutation suppressed:', firstLine(query), JSON.stringify(variables));
                return { data: { __dryRun: true } };
            } else {
                console.log('Mutation executed:', firstLine(query), JSON.stringify(variables));
            }
        }

        let lastErr;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await axios.post(
                    graphqlUrl,
                    JSON.stringify({ query, variables }),
                    { headers, validateStatus: () => true }
                );

                if (isThrottled(response)) {
                    const retryAfter = Number(response.headers['retry-after']);
                    const wait = (retryAfter > 0 ? retryAfter * 1000 : (2 ** attempt) * 500);
                    console.warn(`[shopifyClient] Throttled (attempt ${attempt + 1}/${maxAttempts}), esperando ${wait}ms`);
                    await sleep(wait);
                    continue;
                }

                if (response.status >= 500) {
                    const wait = (2 ** attempt) * 500;
                    console.warn(`[shopifyClient] HTTP ${response.status} (attempt ${attempt + 1}/${maxAttempts}), reintento en ${wait}ms`);
                    await sleep(wait);
                    continue;
                }

                if (response.status >= 400) {
                    throw new Error(`Shopify GraphQL HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 500)}`);
                }

                if (response.data.errors) {
                    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(response.data.errors)}`);
                }

                return response.data;
            } catch (err) {
                lastErr = err;
                if (attempt === maxAttempts - 1) break;
                const wait = (2 ** attempt) * 500;
                console.warn(`[shopifyClient] Error de red (attempt ${attempt + 1}/${maxAttempts}): ${err.message}; reintento en ${wait}ms`);
                await sleep(wait);
            }
        }
        throw lastErr || new Error('Shopify request failed after retries');
    }

    function firstLine(s) {
        return s.split('\n').map(l => l.trim()).find(l => l.length > 0) || s.slice(0, 80);
    }

    return { graphql, headers, graphqlUrl, dryRun };
}

module.exports = { makeShopifyClient, sleep };
