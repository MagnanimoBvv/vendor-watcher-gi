const WINDOW_DAYS = 90;

const TAG_TO_METAFIELD = {
    nuevo: 'vencimiento_tag_nuevo',
    oferta: 'vencimiento_tag_oferta',
    'nuevo color': 'vencimiento_tag_nuevo_color',
};

function todayUTC() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 3600 * 1000);
}

function toISODate(date) {
    return date.toISOString().slice(0, 10);
}

function getMetafield(product, key) {
    const mf = (product.metafields && product.metafields.nodes) || [];
    return mf.find(m => m.key === key) || null;
}

function getWindowDate(product, tagName) {
    const key = TAG_TO_METAFIELD[tagName];
    if (!key) return null;
    const m = getMetafield(product, key);
    if (!m || !m.value) return null;
    const d = new Date(m.value);
    return isNaN(d.getTime()) ? null : d;
}

function isExpired(date) {
    return date.getTime() < todayUTC().getTime();
}

function buildWindowMetafieldInput(productId, tagName, untilDate) {
    return {
        ownerId: productId,
        namespace: 'custom',
        key: TAG_TO_METAFIELD[tagName],
        type: 'date',
        value: toISODate(untilDate),
    };
}

function freshUntilDate(days = WINDOW_DAYS) {
    return addDays(todayUTC(), days);
}

module.exports = {
    WINDOW_DAYS,
    TAG_TO_METAFIELD,
    todayUTC,
    addDays,
    toISODate,
    getMetafield,
    getWindowDate,
    isExpired,
    buildWindowMetafieldInput,
    freshUntilDate,
};
