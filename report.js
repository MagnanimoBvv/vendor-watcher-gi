function makeReport() {
    const runs = [];

    function start(shop, vendor) {
        const entry = {
            shop: shop.shop,
            vendor: vendor.name,
            counters: {
                nuevos: 0,
                descontinuados: 0,
                reactivados: 0,
                preciosCambiados: 0,
                variantesAgregadas: 0,
                coloresNuevos: 0,
                tagsAgregados: 0,
                tagsRetirados: 0,
                ventanasExpiradas: 0,
                metafieldsActualizados: 0,
            },
            errors: [],
        };
        runs.push(entry);
        return entry;
    }

    function logError(entry, scope, err) {
        const message = err && err.message ? err.message : String(err);
        entry.errors.push({ scope, message });
        console.error(`[${entry.shop}/${entry.vendor}] ${scope}: ${message}`);
    }

    function toString() {
        const lines = [];
        lines.push('==== Vendor Watcher Summary ====');
        for (const r of runs) {
            lines.push(`\n[${r.shop} / ${r.vendor}]`);
            for (const k of Object.keys(r.counters)) {
                lines.push(`  ${k}: ${r.counters[k]}`);
            }
            lines.push(`  errores: ${r.errors.length}`);
            for (const e of r.errors.slice(0, 10)) {
                lines.push(`    - ${e.scope}: ${e.message}`);
            }
            if (r.errors.length > 10) {
                lines.push(`    ... (+${r.errors.length - 10} más)`);
            }
        }
        return lines.join('\n');
    }

    return { start, logError, toString, runs };
}

module.exports = { makeReport };
