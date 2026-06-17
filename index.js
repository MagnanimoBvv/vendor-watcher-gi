require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { runShopVendor } = require('./runner');
const { makeReport } = require('./report');

function parseArgs(argv) {
    const opts = { dryRun: false, shop: null, vendor: null, updateMetafields: false, metafieldKeys: null };
    for (const arg of argv.slice(2)) {
        if (arg === '--dry-run') opts.dryRun = true;
        else if (arg.startsWith('--shop=')) opts.shop = arg.slice(7);
        else if (arg.startsWith('--vendor=')) opts.vendor = arg.slice(9);
        // Modo especial (NO corre en el ciclo normal): sólo recalcula metafields.
        // Opcionalmente --metafields=key1,key2 restringe qué keys lógicas escribir.
        else if (arg === '--update-metafields') opts.updateMetafields = true;
        else if (arg.startsWith('--metafields=')) {
            opts.updateMetafields = true;
            opts.metafieldKeys = arg.slice(13).split(',').map(s => s.trim()).filter(Boolean);
        }
        else if (arg === '--help' || arg === '-h') {
            console.log([
                'Uso: node index.js [--dry-run] [--shop=<abbr>] [--vendor=<abbr>]',
                '',
                'Actualización puntual de metafields (no corre en el ciclo normal):',
                '  --update-metafields            recalcula material, material_front,',
                '                                 tecnicas_de_impresion y tecnicas_de_impresion_front',
                '  --metafields=key1,key2         igual que --update-metafields pero sólo esas keys',
            ].join('\n'));
            process.exit(0);
        }
    }
    return opts;
}

function loadJson(filename) {
    const raw = fs.readFileSync(path.join(__dirname, filename), 'utf8');
    return JSON.parse(raw);
}

async function main() {
    const opts = parseArgs(process.argv);
    const shops = loadJson('shops.json');
    const vendors = loadJson('vendors.json');
    const vendorByAbbr = new Map(vendors.map(v => [v.abbr, v]));
    const report = makeReport();

    const targetShops = opts.shop ? shops.filter(s => s.shop === opts.shop) : shops;
    if (opts.shop && targetShops.length === 0) {
        console.error(`No hay tienda con shop="${opts.shop}" en shops.json`);
        process.exit(1);
    }

    for (const shop of targetShops) {
        const shopVendors = (opts.vendor ? [opts.vendor] : shop.vendors)
            .filter(abbr => shop.vendors.includes(abbr));
        if (shopVendors.length === 0) {
            console.warn(`[${shop.shop}] sin proveedores que correr (filtro --vendor=${opts.vendor})`);
            continue;
        }
        for (const abbr of shopVendors) {
            const vendor = vendorByAbbr.get(abbr);
            if (!vendor) {
                console.warn(`[${shop.shop}] vendor "${abbr}" referenciado pero no definido en vendors.json`);
                continue;
            }
            try {
                await runShopVendor(shop, vendor, opts, report);
            } catch (err) {
                console.error(`[${shop.shop}/${vendor.name}] error fatal:`, err);
            }
        }
    }

    console.log('\n' + report.toString());

    const totalErrors = report.runs.reduce((acc, r) => acc + r.errors.length, 0);
    process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(2);
});
