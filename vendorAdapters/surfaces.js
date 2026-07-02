const SURFACE_CATEGORIES = ['VIDRIO', 'CERÁMICA', 'MADERA', 'TEXTIL', 'RUBBER', 'METAL', 'PLÁSTICO'];

const SURFACE_KEYWORDS = [
    ['VIDRIO',   [/vidrio/, /borosilicato/, /\bcristal/, /\bk9\b/]],
    ['CERÁMICA', [/ceramica/, /porcelana/, /\bgres\b/, /\bloza\b/, /\bbarro\b/, /arcilla/]],
    ['MADERA',   [/bambu/, /bamboo/, /madera/, /corcho/, /carton/, /kraft/, /papel/, /paper/, /periodico/, /couche/, /\bmdf\b/, /\bpino\b/, /haya/, /acacia/, /\btilo\b/, /marmol/, /\bcana\b/, /\bcoco\b/, /mimbre/, /ratan/, /\byute\b/]],
    ['TEXTIL',   [/poliester/, /polyester/, /algodon/, /\btela\b/, /textil/, /nylon/, /nailon/, /\blona\b/, /ripstop/, /fieltro/, /jacquard/, /oxford/, /elastano/, /\brpet\b/, /forro/, /gucci/, /wulong/, /tasl[ao]n/, /pongee/, /\blino\b/, /lienzo/, /felpa/, /neopren/, /poliamida/, /spandex/, /microfibra/, /\bpeva\b/, /franela/, /non[ -]?woven/, /\bwoven\b/, /canvas/, /mezclilla/, /gamuza/, /terciopelo/, /\bpana\b/, /loneta/, /\bmalla\b/, /\bmesh\b/, /vinil/, /vinipiel/, /acetato/, /tarpaulin/, /\bpiel\b/, /curpiel/, /cuerina/, /cuero/, /dacron/, /tactel/, /etil vinil/, /fibra sintetica/]],
    ['RUBBER',   [/\bhule\b/, /latex/, /rubber/, /\btpr\b/]],
    ['METAL',    [/acero/, /aluminio/, /hierro/, /\bzinc\b/, /cobre/, /aleacion/, /metal/, /metalic/, /\blata\b/, /peltre/, /estano/, /laton/, /inoxidable/, /titani/, /niquel/, /zam[ai]c/, /zamak/, /hojalata/]],
    ['PLÁSTICO', [/plastic/, /\babs\b/, /\bpet\b/, /\bpla\b/, /polipropileno/, /poliestireno/, /\bestireno/, /acrilonitrilo/, /policarbonato/, /\bpp\b/, /\bpvc\b/, /\btpe\b/, /\btpu\b/, /silicon/, /acrilic/, /\beva\b/, /foami/, /\bgoma\b/, /\bgel\b/, /resina/, /melamina/, /elastomero/, /\bsan\b/, /\bas\b/, /poliuretano/, /poliuterano/, /\bpu\b/, /polietileno/, /tritan/, /popote/, /caucho/, /trigo/, /cebada/, /wheat/, /\bstraw\b/, /fibra de vidrio/]],
];

function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function classifySurface(text) {
    if (!text) return '';
    const t = norm(text);
    let best = '', bestIdx = Infinity, bestPrio = Infinity;
    SURFACE_KEYWORDS.forEach(([cat, regexes], prio) => {
        for (const r of regexes) {
            const m = t.match(r);
            if (m && (m.index < bestIdx || (m.index === bestIdx && prio < bestPrio))) {
                best = cat; bestIdx = m.index; bestPrio = prio;
            }
        }
    });
    return best;
}

function canonicalSurface(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (v.toUpperCase() === 'CERAMICA') return 'CERÁMICA';
    return v;
}

function normalizeSurface(raw, curatedMap, fallback = '') {
    const key = String(raw == null ? '' : raw).trim();
    const mapped = curatedMap ? curatedMap[key] : '';
    return canonicalSurface(mapped || classifySurface(key) || fallback);
}

function coverSurface(material) {
    const t = norm(material);
    if (/curpiel|cuerina|\bcuero\b|simil piel|\bpiel\b|termo\s*pu|termopiel/.test(t)) return 'TEXTIL';
    return classifySurface(material);
}

function coatingSurface(description) {

    const m = norm(description).match(/(?:recubrimiento|recubiert[oa]|revestid[oa]|revestimiento|tapizad[oa]|enfundad[oa]\s+en)\s+(?:exterior\s+)?(?:tipo\s+|en\s+|de\s+|del\s+|con\s+)?([a-z0-9.]+(?:\s+[a-z0-9.]+){0,2})/);
    if (!m) return '';

    const around = norm(description).slice(Math.max(0, m.index - 12), m.index + m[0].length + 14);
    if (/interior/.test(around) && !/exterior/.test(around)) return '';
    return /curpiel|cuerina|\bcuero\b|simil piel|\bpiel\b/.test(m[1]) ? 'TEXTIL' : classifySurface(m[1]);
}

function exteriorSurface(description) {
    const t = norm(description);
    const re = /(?:exterior(?:mente)?|por fuera)\s+(?:es\s+)?(?:de\s+|en\s+|:\s*)?([a-z0-9.]+(?:\s+[a-z0-9.]+){0,1})/g;
    let m;
    while ((m = re.exec(t))) {
        const before = t.slice(Math.max(0, m.index - 16), m.index);
        if (/(base|bolsa|bolsillo|compartimento|tapa|\basa\b|funda|malla)\s*$/.test(before)) continue;
        const c = classifySurface(m[1]);
        if (c) return c;
    }
    return '';
}

const COMPONENT_AREA_RANK = {
    mochila: 9, backpack: 9, maleta: 9, morral: 9, bolsa: 9, cartera: 9, cangurera: 9, playera: 9, camisa: 9, chamarra: 9, chaleco: 9, gorra: 9, mandil: 9, delantal: 9, toalla: 9, cojin: 9, manta: 9, cobija: 9,
    funda: 7, cubierta: 7,
    hielera: 6, lonchera: 6, cooler: 6,
    termo: 5, cilindro: 5, vaso: 5, taza: 5, botella: 5, jarra: 5, licorera: 5, envase: 5,
    cubiertos: 4, herramienta: 4,
    powerbank: 3, cargador: 3, bocina: 3, boligrafo: 3, pluma: 3, lapiz: 3,
    llavero: 2, audifonos: 2, placa: 2, correa: 2, tapa: 2, asa: 2, base: 2,
};
const NOTEBOOK_RE = /libreta|agenda|agendario|carpeta|cuaderno|block|planner|\blibro\b|folder|portafolio/;
const PACKAGING_RE = /estuche|\bcaja\b|empaque|presentacion|display/;
const componentRank = name => { let r = 0; for (const k in COMPONENT_AREA_RANK) { if (name.includes(k) && COMPONENT_AREA_RANK[k] > r) r = COMPONENT_AREA_RANK[k]; } return r; };

function parseComponentSet(materialRaw) {
    const s = String(materialRaw || '');
    if (!/:/.test(s)) return null;
    let segs = s.split(/\s*\/\/\s*|\s*\|\|\s*/);
    if (segs.length < 2) segs = s.split(/\s*\/\s*/);
    const comps = []; let hasBare = false;
    for (const seg of segs) {
        if (!seg.trim()) continue;
        const mm = seg.match(/^\s*([a-záéíóúñ ]+?)\s*:\s*(.+)$/i);
        if (mm) comps.push({ name: norm(mm[1]).trim(), mat: mm[2].trim() });
        else hasBare = true;
    }
    return { comps, hasBare };
}

function setSurface(materialRaw, curatedMap) {
    const parsed = parseComponentSet(materialRaw);
    if (!parsed || parsed.hasBare || parsed.comps.length < 2) return '';
    const usable = parsed.comps.filter(c => !PACKAGING_RE.test(c.name));
    const pool = usable.length ? usable : parsed.comps;

    const nb = pool.find(c => NOTEBOOK_RE.test(c.name));
    if (nb) return coverSurface(nb.mat);

    pool.sort((a, b) => componentRank(b.name) - componentRank(a.name));
    const topRank = componentRank(pool[0].name);
    if (topRank === 0 || (pool.length > 1 && componentRank(pool[1].name) === topRank)) return '';
    const cat = classifySurface(pool[0].mat);
    const derivable = new Set(parsed.comps.map(c => classifySurface(c.mat)).filter(Boolean));
    const mapCat = canonicalSurface(curatedMap && curatedMap[String(materialRaw || '').trim()]);
    if (cat && (!mapCat || !derivable.has(mapCat))) return cat;
    return '';
}

function isSingleClearMaterial(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    if (/[\/,+:]/.test(s)) return false;
    if (/\by\b|\bcon\b/.test(norm(s))) return false;
    return !!classifySurface(s);
}

function printableSurface(rawMaterial, description, curatedMap, fallback = '') {
    if (!isSingleClearMaterial(rawMaterial)) {
        const override = coatingSurface(description) || exteriorSurface(description) || setSurface(rawMaterial, curatedMap);
        if (override) return override;
    }
    return normalizeSurface(rawMaterial, curatedMap, fallback);
}

module.exports = { SURFACE_CATEGORIES, SURFACE_KEYWORDS, classifySurface, canonicalSurface, normalizeSurface, printableSurface };
